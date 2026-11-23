import AdmZip from 'adm-zip'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Artifact, AssetIndex, DownloadProgress, InstalledMark, Library, Rule } from '../../shared/types'
export type { InstalledMark }
import { downloadFile, ensureDir, formatBytes, pool } from './http'
import { getResolvedVersionJson, alternateUrl, rewriteUrl } from './manifest'
import { assetPath, libPath, P, ensureGameDirs } from './paths'

export interface InstallContext {
  taskId: string
  onProgress: (p: DownloadProgress) => void
  isCancelled: () => boolean
  /** 并发下载数，默认 16 */
  concurrency?: number
}

interface DlTask {
  url: string
  dest: string
  sha1?: string
  size?: number
  label: string
}

/**
 * 实际下载：url 存的是官方地址，真正请求时按当前源改写。
 * 镜像返回 503 之类时 downloadFile 会自动回退到官方地址再试。
 */
async function downloadTask(t: DlTask, onBytes: (n: number) => void): Promise<{ skipped: boolean; bytes: number }> {
  const primary = rewriteUrl(t.url)
  // 当前源挂了就换另一个源再试（auto 模式下是双向的）
  const alt = alternateUrl(t.url)
  return downloadFile(primary, t.dest, {
    sha1: t.sha1 || undefined,
    size: t.size && t.size > 0 ? t.size : undefined,
    altUrl: alt !== primary ? alt : undefined,
    retries: 4,
    onBytes
  })
}

export class InstallCancelled extends Error {
  constructor() {
    super('安装已取消')
  }
}

export function currentOS(): { name: string; arch: string } {
  const name = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'arm64' : process.arch
  return { name, arch }
}

/** 平台信息是进程常量，缓存一份，别每条规则都新建对象 */
const OS = currentOS()

function ruleMatches(rule: Rule): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== OS.name) return false
    if (rule.os.arch && rule.os.arch !== OS.arch) return false
    // os.version 只在 macOS 上偶有用到，这里忽略，避免误判
  }
  if (rule.features) {
    for (const v of Object.values(rule.features)) {
      // 启动器的 features：demo / custom_resolution / quick_play 等，我们一律按 false
      if (v) return false
    }
  }
  return true
}

export function rulesAllow(rules: Rule[] | undefined): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const r of rules) {
    if (!ruleMatches(r)) continue
    if (r.action === 'disallow') return false
    if (r.action === 'allow') allowed = true
  }
  return allowed
}

export interface ResolvedLibraryEntry {
  library: Library
  artifact?: Artifact
  native?: { artifact: Artifact; exclude?: string[] }
}

/** 把 libraries 解析成「要下载的 artifact」+「要解压的 natives」 */
export function resolveLibraries(libs: Library[]): ResolvedLibraryEntry[] {
  const out: ResolvedLibraryEntry[] = []
  const os = currentOS()
  const seen = new Set<string>()
  for (const lib of libs) {
    if (!rulesAllow(lib.rules)) continue
    const coords = lib.name.split(':')
    // key 要带上 classifier：lwjgl 和 lwjgl:natives-windows 是同一个 group:artifact，
    // 但它们是两个不同的文件，不能被当成重复项去掉
    const key = `${coords[0]}:${coords[1]}${coords[3] ? `:${coords[3]}` : ''}`
    if (seen.has(key)) continue
    seen.add(key)

    let artifact: Artifact | undefined = lib.downloads?.artifact
    let native: { artifact: Artifact; exclude?: string[] } | undefined

    // Fabric / Quilt / Forge 的库常常只有 maven 坐标，没有 downloads 字段
    if (!artifact && !lib.natives && coords.length >= 3) {
      const [group, name, version, classifier] = coords
      const p = `${group.replace(/\./g, '/')}/${name}/${version}/${name}-${version}${classifier ? `-${classifier}` : ''}.jar`
      const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/$/, '')
      artifact = { path: p, url: `${base}/${p}`, sha1: '', size: 0 }
    }

    if (lib.natives) {
      const classifierKey = lib.natives[os.name]
      if (classifierKey) {
        const cl = classifierKey.replace('${arch}', os.arch === 'arm64' ? 'arm64' : '64')
        const art = lib.downloads?.classifiers?.[cl]
        if (art) native = { artifact: art, exclude: lib.extract?.exclude }
      }
    }

    // 新格式（1.19+）：名字里带 natives-<os> 的库，自身就是 native jar
    if (!native && /:natives-/.test(lib.name) && artifact) {
      native = { artifact, exclude: lib.extract?.exclude }
    }

    if (!artifact && native) artifact = native.artifact
    if (!artifact) continue
    out.push({ library: lib, artifact, native })
  }
  return out
}

export function buildClasspath(entries: ResolvedLibraryEntry[], clientJar: string): string {
  const sep = process.platform === 'win32' ? ';' : ':'
  const paths: string[] = []
  for (const e of entries) {
    if (!e.artifact) continue
    paths.push(libPath(e.artifact.path))
  }
  if (existsSync(clientJar)) paths.push(clientJar)
  // 去重但保持顺序
  return [...new Set(paths)].join(sep)
}

async function unzipNatives(jar: string, dest: string, exclude?: string[]): Promise<void> {
  ensureDir(dest)
  const zip = new AdmZip(jar)
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const name = entry.entryName.replace(/\\/g, '/')
    if (exclude?.some((ex) => name.startsWith(ex))) continue
    if (name.startsWith('META-INF/')) continue
    // 只保留库文件与常见资源，跳过源码/文档
    if (/\.(java|txt|md)$/i.test(name)) continue
    const target = join(dest, basename(name))
    if (existsSync(target)) continue
    await fs.writeFile(target, entry.getData())
  }
}

export async function readInstalledMark(id: string): Promise<InstalledMark | null> {
  try {
    return JSON.parse(await fs.readFile(P.installedMark(id), 'utf8')) as InstalledMark
  } catch {
    return null
  }
}

export async function installVersion(id: string, ctx: InstallContext): Promise<InstalledMark> {
  ensureGameDirs()
  let totalFiles = 0

  const emit = (phase: string, current: number, total: number, bytesDone: number, bytesTotal: number, currentFile?: string, finished = false): void => {
    ctx.onProgress({ taskId: ctx.taskId, phase, current, total, bytesDone, bytesTotal, currentFile, finished })
  }

  if (ctx.isCancelled()) throw new InstallCancelled()

  emit('版本信息', 0, 1, 0, 0)
  const version = await getResolvedVersionJson(id)

  // ---- 收集下载任务 ----
  const tasks: DlTask[] = []
  const natives: { name: string; jar: string; exclude?: string[] }[] = []

  if (version.downloads?.client) {
    // 继承版本（Fabric/Forge/OptiFine）直接用父版本的 client jar，别再下一份
    const inheritedJar = version.jar ?? version.inheritsFrom
    const dest = inheritedJar && inheritedJar !== id ? P.versionJar(inheritedJar) : P.versionJar(id)
    if (!existsSync(dest)) {
      tasks.push({
        url: version.downloads.client.url,
        dest,
        sha1: version.downloads.client.sha1,
        size: version.downloads.client.size,
        label: `${id}.jar`
      })
    }
  }

  const entries = resolveLibraries(version.libraries ?? [])
  for (const e of entries) {
    if (e.artifact) {
      tasks.push({
        url: e.artifact.url,
        dest: libPath(e.artifact.path),
        sha1: e.artifact.sha1,
        size: e.artifact.size,
        label: basename(e.artifact.path)
      })
    }
    if (e.native) {
      // 老版本（1.8.9 之类）的 natives 在 classifiers 里，跟 artifact 是两个文件，
      // 必须单独下载，否则解压出来只有一半 DLL
      if (!e.artifact || e.native.artifact.path !== e.artifact.path) {
        tasks.push({
          url: e.native.artifact.url,
          dest: libPath(e.native.artifact.path),
          sha1: e.native.artifact.sha1,
          size: e.native.artifact.size,
          label: basename(e.native.artifact.path)
        })
      }
      natives.push({
        name: e.library.name,
        jar: libPath(e.native.artifact.path),
        exclude: e.native.exclude
      })
    }
  }

  // assets index
  let assetsIndex: AssetIndex | null = null
  const assetIndexId = version.assetIndex?.id ?? version.assets
  if (version.assetIndex) {
    tasks.push({
      url: version.assetIndex.url,
      dest: join(P.indexes, `${version.assetIndex.id}.json`),
      sha1: version.assetIndex.sha1,
      size: version.assetIndex.size,
      label: `assets index ${version.assetIndex.id}`
    })
  }

  // log config
  if (version.logging?.client?.file) {
    const f = version.logging.client.file
    tasks.push({
      url: f.url,
      dest: join(P.logConfigs, f.id),
      sha1: f.sha1,
      size: f.size,
      label: f.id
    })
  }

  let bytesTotal = tasks.reduce((s, t) => s + (t.size ?? 0), 0)

  // ---- 下载 versions/libraries/logconfig ----
  let bytesDone = 0
  let done = 0

  const dl = async (t: DlTask): Promise<void> => {
    if (ctx.isCancelled()) throw new InstallCancelled()
    try {
      const r = await downloadTask(t, (n) => {
        bytesDone += n
      })
      // 已经存在的文件不产生字节回调，手动补上，进度才准
      if (r.skipped) bytesDone += t.size ?? 0
    } catch (e) {
      throw new Error(`下载失败 ${t.label}: ${(e as Error).message}`)
    }
    done++
    totalFiles++
    emit('下载文件', done, tasks.length, bytesDone, bytesTotal, t.label)
  }

  emit('下载文件', 0, tasks.length, 0, bytesTotal, `共 ${tasks.length} 个文件`)
  const concurrency = Math.max(1, Math.min(64, ctx.concurrency ?? 16))
  await pool(tasks, concurrency, dl)

  // ---- 解压 natives ----
  emit('解压 natives', 0, natives.length, bytesDone, bytesTotal)
  for (let i = 0; i < natives.length; i++) {
    if (ctx.isCancelled()) throw new InstallCancelled()
    const n = natives[i]
    if (existsSync(n.jar)) {
      await unzipNatives(n.jar, P.versionNatives(id), n.exclude)
    }
    emit('解压 natives', i + 1, natives.length, bytesDone, bytesTotal, n.name)
  }

  // ---- assets objects ----
  const indexPath = join(P.indexes, `${assetIndexId}.json`)
  if (existsSync(indexPath)) {
    assetsIndex = JSON.parse(await fs.readFile(indexPath, 'utf8')) as AssetIndex
    const objects = Object.entries(assetsIndex.objects ?? {})
    // 同一个 hash 可能对应多个名字（1.8 索引实测有 12 条重复）；按 hash 去重，
    // 否则并发任务会写同一个 .part 互相截断，sha1 校验失败白白重试
    const byHash = new Map<string, DlTask>()
    for (const [, obj] of objects) {
      if (byHash.has(obj.hash)) continue
      byHash.set(obj.hash, {
        url: `https://resources.download.minecraft.net/${obj.hash.slice(0, 2)}/${obj.hash}`,
        dest: assetPath(obj.hash),
        sha1: obj.hash,
        size: obj.size,
        label: obj.hash
      })
    }
    const assetTasks = [...byHash.values()]
    const assetBytes = assetTasks.reduce((s, t) => s + (t.size ?? 0), 0)
    bytesTotal += assetBytes
    let aDone = 0
    const failed: string[] = []
    emit('下载资源', 0, assetTasks.length, bytesDone, bytesTotal, `${objects.length} 个资源对象`)

    await pool(assetTasks, concurrency, async (t) => {
      if (ctx.isCancelled()) throw new InstallCancelled()
      try {
        const r = await downloadTask(t, (n) => {
          bytesDone += n
        })
        if (r.skipped) bytesDone += t.size ?? 0
      } catch (e) {
        // 单个资源失败不中断整体：记下来最后一起报
        failed.push(`${t.label}: ${(e as Error).message}`)
      }
      aDone++
      if (aDone % 8 === 0 || aDone === assetTasks.length) {
        emit('下载资源', aDone, assetTasks.length, bytesDone, bytesTotal, `${aDone}/${assetTasks.length}`)
      }
    })

    if (failed.length > 0) {
      const ratio = failed.length / assetTasks.length
      const detail = failed.slice(0, 5).join('; ')
      if (ratio > 0.05) {
        throw new Error(`${failed.length}/${assetTasks.length} 个资源下载失败，已下载的会保留，重试安装即可续传。示例: ${detail}`)
      }
      emit('下载资源', assetTasks.length, assetTasks.length, bytesDone, bytesTotal, `警告: ${failed.length} 个资源失败`, false)
    }

    // legacy / virtual assets
    if (assetsIndex.virtual || assetsIndex.map_to_resources) {
      emit('生成旧版资源目录', 0, 1, bytesDone, bytesTotal)
      const base = assetsIndex.map_to_resources ? join(P.root, 'resources') : join(P.assets, 'virtual', 'legacy')
      await materializeVirtualAssets(assetsIndex, base)
      emit('生成旧版资源目录', 1, 1, bytesDone, bytesTotal)
    }
  }

  // ---- 写安装标记 ----
  // 只算本版本自己的 jar；继承版本共用父 jar，不重复计算
  let sizeBytes = 0
  try {
    const st = await fs.stat(P.versionJar(id))
    sizeBytes += st.size
  } catch {
    /* jar 可能不存在（继承版本） */
  }

  const mark: InstalledMark = {
    id,
    installedAt: Date.now(),
    sizeBytes,
    files: totalFiles,
    javaMajor: version.javaVersion?.majorVersion,
    source: getSourceLabel()
  }
  await fs.writeFile(P.installedMark(id), JSON.stringify(mark, null, 2))
  emit('完成', 1, 1, bytesDone, bytesTotal, `已安装 ${id}（${formatBytes(bytesTotal)}）`, true)
  return mark
}

let sourceLabel = 'official'
export function setSourceLabel(s: string): void {
  sourceLabel = s
}
function getSourceLabel(): string {
  return sourceLabel
}

async function materializeVirtualAssets(index: AssetIndex, base: string): Promise<void> {
  ensureDir(base)
  const madeDirs = new Set<string>([base])
  const entries = Object.entries(index.objects ?? {}).filter(([name, obj]) => {
    const src = assetPath(obj.hash)
    const dest = join(base, name)
    return existsSync(src) && !existsSync(dest)
  })
  // 小文件成千上万，串行复制太慢；并发复制，目录按需建一次
  await pool(entries, 16, async ([name, obj]) => {
    const src = assetPath(obj.hash)
    const dest = join(base, name)
    const dir = dirname(dest)
    if (!madeDirs.has(dir)) {
      ensureDir(dir)
      madeDirs.add(dir)
    }
    await fs.copyFile(src, dest).catch(() => {})
  })
}

/** 检查某个版本是否已完整安装 */
export async function isInstalled(id: string): Promise<boolean> {
  if (!P.versionJson(id) || !existsSync(P.versionJson(id))) return false
  const mark = await readInstalledMark(id)
  if (mark) return true
  // 不是本启动器装的（从别的文件夹扫进来的、手工放的）：json 在、jar 在就算能用
  if (existsSync(P.versionJar(id))) return true
  try {
    const raw = await fs.readFile(P.versionJson(id), 'utf8')
    const j = JSON.parse(raw) as { inheritsFrom?: string }
    // 加载器版本自己没 jar，靠继承的父版本
    if (j.inheritsFrom && existsSync(P.versionJson(j.inheritsFrom))) return true
  } catch {
    /* ignore */
  }
  return false
}

/** 计算目录大小 */
export async function dirSize(dir: string): Promise<number> {
  const files: string[] = []
  const walk = async (d: string): Promise<void> => {
    const items = await fs.readdir(d, { withFileTypes: true }).catch(() => [])
    for (const it of items) {
      const full = join(d, it.name)
      if (it.isDirectory()) await walk(full)
      else if (it.isFile()) files.push(full)
    }
  }
  await walk(dir)
  // stat 并发跑（整数求和，顺序不影响结果）
  let total = 0
  await pool(files, 32, async (f) => {
    try {
      total += (await fs.stat(f)).size
    } catch {
      /* ignore */
    }
  })
  return total
}
