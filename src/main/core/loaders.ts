import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, promises as fs, writeSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fetchJson, downloadFile, ensureDir, pool, sleep } from './http'
import { installVersion, type InstallContext } from './install'
import { getVersionJson, rewriteUrl, setDownloadSource } from './manifest'
import { P, ensureGameDirs } from './paths'

export type LoaderType = 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'optifine' | 'legacyfabric'

export interface LoaderVersionInfo {
  type: LoaderType
  mcVersion: string
  /** 加载器自己的版本号（Forge 是 47.4.29，Fabric 是 0.15.11） */
  version: string
  /** 安装后生成的版本 id（能指回具体 mc + 加载器） */
  versionId: string
  label: string
  stable: boolean
  kind?: string
}

export interface LoaderInstallProgress {
  phase: string
  detail?: string
  current?: number
  total?: number
  bytesDone?: number
  bytesTotal?: number
}

// ---------------- 列表 ----------------

const FABRIC_META = 'https://meta.fabricmc.net/v2'
const QUILT_META = 'https://meta.quiltmc.org/v3'
const LEGACY_FABRIC_META = 'https://meta.legacyfabric.net/v2'
const BMCL = 'https://bmclapi2.bangbang93.com'

async function listFabric(mc: string): Promise<LoaderVersionInfo[]> {
  const arr = await fetchJson<{ loader: { version: string; stable: boolean } }[]>(`${FABRIC_META}/versions/loader/${encodeURIComponent(mc)}`, { timeout: 20000 })
  return arr.map((x) => ({
    type: 'fabric' as const,
    mcVersion: mc,
    version: x.loader.version,
    versionId: `fabric-loader-${x.loader.version}-${mc}`,
    label: `Fabric ${x.loader.version}`,
    stable: x.loader.stable
  }))
}

async function listQuilt(mc: string): Promise<LoaderVersionInfo[]> {
  const arr = await fetchJson<{ loader: { version: string } }[]>(`${QUILT_META}/versions/loader/${encodeURIComponent(mc)}`, { timeout: 20000 })
  return arr.map((x) => ({
    type: 'quilt' as const,
    mcVersion: mc,
    version: x.loader.version,
    versionId: `quilt-loader-${x.loader.version}-${mc}`,
    label: `Quilt ${x.loader.version}`,
    stable: !/beta|alpha|pre|rc/i.test(x.loader.version)
  }))
}

async function listForge(mc: string): Promise<LoaderVersionInfo[]> {
  const arr = await fetchJson<{ version: string; build: number }[]>(`${BMCL}/forge/minecraft/${encodeURIComponent(mc)}`, { timeout: 20000 })
  return arr
    .filter((x) => x.version)
    .map((x) => ({
      type: 'forge' as const,
      mcVersion: mc,
      version: x.version,
      versionId: `${mc}-forge-${x.version}`,
      label: `Forge ${x.version}`,
      stable: !/beta/i.test(x.version)
    }))
    .reverse()
}

async function listNeoForge(mc: string): Promise<LoaderVersionInfo[]> {
  const arr = await fetchJson<{ version: string; rawVersion?: string; mcversion: string }[]>(`${BMCL}/neoforge/list/${encodeURIComponent(mc)}`, { timeout: 20000 })
  return arr
    .filter((x) => x.version)
    .map((x) => ({
      type: 'neoforge' as const,
      mcVersion: mc,
      version: x.version,
      versionId: `neoforge-${x.version}`,
      label: `NeoForge ${x.rawVersion ?? x.version}`,
      stable: true
    }))
    .reverse()
}

async function listOptiFine(mc: string): Promise<LoaderVersionInfo[]> {
  const arr = await fetchJson<{ type: string; patch: string; filename: string; forge?: string }[]>(`${BMCL}/optifine/${encodeURIComponent(mc)}`, { timeout: 20000 })
  return arr.map((x) => {
    const ver = `${x.type}_${x.patch}`
    return {
      type: 'optifine' as const,
      mcVersion: mc,
      version: ver,
      versionId: `${mc}-OptiFine_${ver}`,
      label: x.filename.replace(/\.jar$/, ''),
      stable: true,
      kind: x.forge ? `Forge ${x.forge}` : undefined
    }
  })
}

async function listLegacyFabric(mc: string): Promise<LoaderVersionInfo[]> {
  // 新版 Minecraft（26.x 之类）在 Legacy Fabric 那边根本没有条目，接口直接 400/404。
  // 那不是错误，就是「没这个版本」，返回空列表让 UI 显示「无可用版本」。
  const arr = await fetchJson<{ loader: { version: string } }[]>(`${LEGACY_FABRIC_META}/versions/loader/${encodeURIComponent(mc)}`, { timeout: 20000 }).catch(
    (e: Error) => {
      if (/40[04]/.test(e.message)) return [] as { loader: { version: string } }[]
      throw e
    }
  )
  return arr.map((x) => ({
    type: 'legacyfabric' as const,
    mcVersion: mc,
    version: x.loader.version,
    versionId: `legacy-fabric-loader-${x.loader.version}-${mc}`,
    label: `Legacy Fabric ${x.loader.version}`,
    stable: !/beta|alpha|pre|rc/i.test(x.loader.version)
  }))
}

export async function listLoaderVersions(type: LoaderType, mcVersion: string): Promise<LoaderVersionInfo[]> {
  switch (type) {
    case 'fabric':
      return listFabric(mcVersion)
    case 'legacyfabric':
      return listLegacyFabric(mcVersion)
    case 'quilt':
      return listQuilt(mcVersion)
    case 'forge':
      return listForge(mcVersion)
    case 'neoforge':
      return listNeoForge(mcVersion)
    case 'optifine':
      return listOptiFine(mcVersion)
    default:
      return []
  }
}

// ---------------- 安装：Fabric / Quilt（纯 JSON，不需要跑安装器） ----------------

async function installFabricLike(type: 'fabric' | 'quilt' | 'legacyfabric', mc: string, loaderVersion: string, ctx: InstallContext): Promise<string> {
  const base = type === 'fabric' ? FABRIC_META : type === 'quilt' ? QUILT_META : LEGACY_FABRIC_META
  const url = `${base}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loaderVersion)}/profile/json`
  ctx.onProgress({ taskId: ctx.taskId, phase: '获取加载器配置', current: 0, total: 1, bytesDone: 0, bytesTotal: 0, finished: false })
  const profile = await fetchJson<Record<string, unknown> & { id: string; inheritsFrom: string; libraries?: unknown[] }>(url, { timeout: 20000 })
  const id = profile.id || `${type}-loader-${loaderVersion}-${mc}`

  const dir = P.versionDir(id)
  ensureDir(dir)
  await fs.writeFile(P.versionJson(id), JSON.stringify(profile, null, 2))
  ctx.onProgress({ taskId: ctx.taskId, phase: '获取加载器配置', current: 1, total: 1, bytesDone: 0, bytesTotal: 0, finished: false })

  // 复用通用安装流程：它会顺着 inheritsFrom 把父版本和加载器的库都下齐
  await installVersion(id, { ...ctx, taskId: ctx.taskId })

  // Fabric 家族顺手补一份 API —— 大多数模组没有它就直接不工作
  const apiSlug = type === 'legacyfabric' ? 'legacy-fabric-api' : type === 'fabric' ? 'fabric-api' : null
  if (apiSlug) {
    try {
      ctx.onProgress({ taskId: ctx.taskId, phase: '安装 Fabric API', current: 0, total: 1, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: apiSlug })
      const { downloadProjectMod } = await import('./modrinth')
      const r = await downloadProjectMod({ projectSlug: apiSlug, mcVersion: mc, versionId: id, loader: 'fabric' })
      if (r) {
        ctx.onProgress({ taskId: ctx.taskId, phase: '安装 Fabric API', current: 1, total: 1, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: r.name })
      }
    } catch {
      /* API 拉不到就算了，别让加载器安装失败 */
    }
  }
  return id
}

// ---------------- 安装：Forge / NeoForge（跑官方 installer） ----------------

async function pickJavaFor(major: number): Promise<string> {
  const { findJava } = await import('./java')
  const hit = await findJava(major)
  if (!hit) throw new Error(`没有可用的 Java ${major}，请先安装/下载 Java 运行时`)
  return hit.path
}

async function runJavaJar(java: string, jar: string, args: string[], logFile: string, onLine?: (s: string) => void): Promise<number> {
  mkdirSync(join(logFile, '..'), { recursive: true })
  const fd = openSync(logFile, 'w')
  const header = `[启动器] ${java} -jar ${jar} ${args.join(' ')}\n`
  let offset = writeSync(fd, header)
  let child
  try {
    child = spawn(java, ['-jar', jar, ...args], { stdio: ['ignore', fd, fd], windowsHide: true })
  } finally {
    try {
      closeSync(fd)
    } catch {
      /* ignore */
    }
  }
  let buf = ''
  const drain = (): void => {
    try {
      const { statSync, readSync } = require('node:fs') as typeof import('node:fs')
      const st = statSync(logFile)
      if (st.size <= offset) return
      const len = st.size - offset
      const b = Buffer.alloc(len)
      const rfd = openSync(logFile, 'r')
      try {
        readSync(rfd, b, 0, len, offset)
      } finally {
        closeSync(rfd)
      }
      offset = st.size
      buf += b.toString('utf8')
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const l of lines) if (l.trim()) onLine?.(l)
    } catch {
      /* ignore */
    }
  }
  const timer = setInterval(drain, 200)
  return new Promise<number>((resolve) => {
    child.on('error', () => {
      clearInterval(timer)
      resolve(-1)
    })
    child.on('exit', (code) => {
      clearInterval(timer)
      setTimeout(() => {
        drain()
        resolve(code ?? 0)
      }, 200)
    })
  })
}

/** Forge/NeoForge 的 installer 只会从官方 maven 拉库，国内经常连不上。
 *  这里先把 install_profile 里的库 + processors 要用的库用 BMCLAPI 镜像预下载到
 *  libraries/，installer 看到文件已存在就会跳过下载。 */
async function prefetchInstallerLibraries(jar: string, ctx: InstallContext): Promise<void> {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(jar)
  const entry = zip.getEntry('install_profile.json')
  if (!entry) return
  const profile = JSON.parse(entry.getData().toString('utf8')) as {
    libraries?: { name?: string; downloads?: { artifact?: { path: string; url: string; sha1?: string; size?: number } } }[]
    processors?: { jar?: string; classpath?: string[] }[]
  }

  interface Job {
    path: string
    url?: string
    sha1?: string
    size?: number
  }
  const jobs: Job[] = []
  const seen = new Set<string>()

  for (const l of profile.libraries ?? []) {
    const a = l.downloads?.artifact
    if (!a?.path) continue
    if (seen.has(a.path)) continue
    seen.add(a.path)
    jobs.push({ path: a.path, url: a.url, sha1: a.sha1, size: a.size })
  }

  const coordToPath = (c: string): string | null => {
    const [g, a, v, clf] = c.split(':')
    if (!g || !a || !v) return null
    return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${clf ? `-${clf}` : ''}.jar`
  }
  for (const p of profile.processors ?? []) {
    const coords = [p.jar, ...(p.classpath ?? [])].filter(Boolean) as string[]
    for (const c of coords) {
      const path = coordToPath(c)
      if (!path || seen.has(path)) continue
      seen.add(path)
      jobs.push({ path })
    }
  }

  // installer 里的 version.json 也带着库（forge/neoforge 本体、fml 组件），
  // installer 装的时候会照着它去下，得一起预下载
  const vjEntry = zip.getEntry('version.json')
  if (vjEntry) {
    try {
      const vj = JSON.parse(vjEntry.getData().toString('utf8')) as {
        libraries?: { name?: string; downloads?: { artifact?: { path: string; url: string; sha1?: string; size?: number } } }[]
      }
      for (const l of vj.libraries ?? []) {
        const a = l.downloads?.artifact
        if (!a?.path || seen.has(a.path)) continue
        seen.add(a.path)
        jobs.push({ path: a.path, url: a.url, sha1: a.sha1, size: a.size })
      }
    } catch {
      /* ignore */
    }
  }
  if (!jobs.length) return

  let done = 0
  let failed = 0
  const emit = (): void =>
    ctx.onProgress({ taskId: ctx.taskId, phase: '预下载安装器依赖', current: done, total: jobs.length, bytesDone: 0, bytesTotal: 0, finished: false })

  const fetchOne = async (job: Job): Promise<boolean> => {
    const dest = join(P.libraries, job.path)
    if (existsSync(dest)) return true
    const sources = [`${BMCL}/maven/${job.path}`]
    if (job.url) sources.push(job.url)
    let lastErr = ''
    for (const src of sources) {
      try {
        await downloadFile(src, dest, { sha1: job.sha1, size: job.size, retries: 4, timeout: 120000 })
        return true
      } catch (e) {
        lastErr = (e as Error).message
      }
    }
    console.error(`[prefetch] 失败 ${job.path}: ${lastErr}`)
    return false
  }

  emit()
  // 并发压低一点：BMCLAPI 的 maven 并发高了容易超时
  await pool(jobs, 4, async (job) => {
    const ok = await fetchOne(job)
    if (!ok) failed++
    done++
    emit()
  })

  // 失败的最后再串行补一遍
  if (failed > 0) {
    const retryJobs = jobs.filter((j) => !existsSync(join(P.libraries, j.path)))
    for (const job of retryJobs) {
      if (await fetchOne(job)) failed--
    }
  }
}

async function installForgeInstaller(type: 'forge' | 'neoforge', mc: string, loaderVersion: string, ctx: InstallContext): Promise<string> {
  ensureGameDirs()
  const javaMajor = (await getVersionJson(mc)).javaVersion?.majorVersion ?? 17
  const java = await pickJavaFor(javaMajor)

  // NeoForge 的版本号本身就带 mc 前缀（1.20.1-47.1.105），别拼重复
  const fullVersion = loaderVersion.startsWith(`${mc}-`) ? loaderVersion : `${mc}-${loaderVersion}`

  const installerDir = join(P.root, 'installers')
  ensureDir(installerDir)
  const fileName = `${type}-${fullVersion}-installer.jar`
  const jar = join(installerDir, fileName)

  const url =
    type === 'forge'
      ? `${BMCL}/forge/download?mcversion=${encodeURIComponent(mc)}&version=${encodeURIComponent(loaderVersion)}&category=installer&format=jar`
      : `${BMCL}/maven/net/neoforged/forge/${encodeURIComponent(fullVersion)}/forge-${encodeURIComponent(fullVersion)}-installer.jar`

  ctx.onProgress({ taskId: ctx.taskId, phase: '下载安装器', current: 0, total: 1, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: fileName })
  await downloadFile(url, jar, { retries: 4, timeout: 300000 })
  await ensureLauncherProfiles()

  // 先把 installer 要的库用镜像拉下来，避免卡在 maven.neoforged.net / maven.minecraftforge.net
  await prefetchInstallerLibraries(jar, ctx)

  ctx.onProgress({ taskId: ctx.taskId, phase: '运行安装器', current: 0, total: 1, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: `${type} installer` })
  const log = join(P.logs, `${type}-install-${Date.now()}.log`)
  const code = await runJavaJar(java, jar, ['--installClient', P.root], log, (line) => {
    if (/Downloading|Extracting|Patching|Building|Installing/i.test(line)) {
      ctx.onProgress({ taskId: ctx.taskId, phase: '运行安装器', current: 0, total: 1, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: line.slice(0, 90) })
    }
  })
  if (code !== 0) {
    let tail = ''
    try {
      const text = await fs.readFile(log, 'utf8')
      tail = text.split(/\r?\n/).filter(Boolean).slice(-6).join(' | ')
    } catch {
      /* ignore */
    }
    throw new Error(`${type} 安装器退出码 ${code}。${tail}`)
  }

  // installer 自己会在 versions 下建目录，找一下
  // NeoForge 1.20.1 的 installer 沿用了 Forge 的命名：<mc>-forge-<去掉 mc 前缀的版本号>
  // 例如 loaderVersion=1.20.1-47.1.105 → 目录 1.20.1-forge-47.1.105
  const shortVersion = fullVersion.startsWith(`${mc}-`) ? fullVersion.slice(mc.length + 1) : fullVersion
  const expected = type === 'forge' ? `${mc}-forge-${shortVersion}` : `neoforge-${fullVersion}`
  const candidates =
    type === 'forge'
      ? [`${mc}-forge-${shortVersion}`, `forge-${shortVersion}`, `${mc}-forge-${fullVersion}`]
      : [`${mc}-forge-${shortVersion}`, `neoforge-${fullVersion}`, `${mc}-neoforge-${fullVersion}`, `neoforge-${shortVersion}`]
  let found = ''
  for (const c of candidates) {
    if (existsSync(join(P.versionDir(c), `${c}.json`))) {
      found = c
      break
    }
  }
  if (!found) {
    // 兜底：挑最新创建的、名字里带加载器的版本目录
    const dirs = await fs.readdir(P.versions, { withFileTypes: true }).catch(() => [])
    const hit = dirs
      .filter((d) => d.isDirectory() && d.name.includes(type) && d.name.includes(mc))
      .map((d) => d.name)
      .sort()
      .pop()
    if (!hit) throw new Error(`安装器跑完了但没找到版本目录（预期 ${expected}）`)
    found = hit
  }

  // installer 不会写我们的 .installed.json，补一个
  const mark = {
    id: found,
    installedAt: Date.now(),
    sizeBytes: 0,
    files: 0,
    javaMajor,
    source: `${type}-installer`
  }
  await fs.writeFile(P.installedMark(found), JSON.stringify(mark, null, 2))

  // Forge/NeoForge 的 patched client jar 只落在 libraries 里，官方启动器要求
  // versions/<id>/<id>.jar 存在（-DignoreList 里就是这个名字），这里补一份
  const clientCoords =
    type === 'forge'
      ? `net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-client.jar`
      : `net/neoforged/forge/${fullVersion}/forge-${fullVersion}-client.jar`
  const srcJar = join(P.libraries, clientCoords)
  const dstJar = P.versionJar(found)
  if (existsSync(srcJar) && !existsSync(dstJar)) {
    await fs.copyFile(srcJar, dstJar)
  }

  return found
}

/** Forge 安装器要求目录里先有官方启动器的 profile 文件 */
export async function ensureLauncherProfiles(): Promise<void> {
  const file = join(P.root, 'launcher_profiles.json')
  if (existsSync(file)) return
  const data = {
    profiles: {},
    settings: { enableSnapshots: false, keepLauncherOpen: false, showMenu: false },
    version: 3
  }
  await fs.writeFile(file, JSON.stringify(data, null, 2))
}

// ---------------- 安装：OptiFine（解包 + 手工拼版本） ----------------

/**
 * OptiFine 的 installer 是会弹 GUI 的自解压 jar，没法静默跑。
 * 但它的结构很固定：本体就是一个 optifine jar，外加一个 launchwrapper-of。
 * 所以手工拼一份继承版本：mainClass 用 Launch，tweakClass 指向 optifine.OptiFineTweaker。
 */
async function installOptiFine(mc: string, optiVersion: string, ctx: InstallContext): Promise<string> {
  // optiVersion 形如 HD_U_I5 或 HD_U_I5_pre4，最后一段是 patch
  const cut = optiVersion.lastIndexOf('_')
  const kind = cut > 0 ? optiVersion.slice(0, cut) : optiVersion
  const patch = cut > 0 ? optiVersion.slice(cut + 1) : ''
  const url = `${BMCL}/optifine/${encodeURIComponent(mc)}/${encodeURIComponent(kind)}/${encodeURIComponent(patch)}`
  const dir = join(P.root, 'installers')
  ensureDir(dir)
  const jar = join(dir, `OptiFine_${mc}_${optiVersion}.jar`)

  ctx.onProgress({ taskId: ctx.taskId, phase: '下载 OptiFine', current: 0, total: 1, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: jar })
  await downloadFile(url, jar, { retries: 4, timeout: 300000 })

  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(jar)
  const ver = `${kind}_${patch}`
  const id = `${mc}-OptiFine_${ver}`

  // 1) OptiFine 本体：installer jar 本身就是 optifine jar
  const optiRel = `optifine/OptiFine/${ver}/OptiFine-${ver}.jar`
  const optiAbs = join(P.libraries, optiRel)
  ensureDir(join(P.libraries, 'optifine', 'OptiFine', ver))
  await fs.copyFile(jar, optiAbs)

  // 2) launchwrapper-of：installer 里带着就用它的，没有就去 maven 拿
  let lwVersion = '2.3'
  let lwRel = `optifine/launchwrapper-of/${lwVersion}/launchwrapper-of-${lwVersion}.jar`
  const lwEntry = zip.getEntries().find((e) => /^launchwrapper-of-.*\.jar$/.test(e.entryName))
  if (lwEntry) {
    const m = lwEntry.entryName.match(/launchwrapper-of-(.+)\.jar$/)
    if (m) lwVersion = m[1]
    lwRel = `optifine/launchwrapper-of/${lwVersion}/launchwrapper-of-${lwVersion}.jar`
    const abs = join(P.libraries, lwRel)
    ensureDir(join(P.libraries, 'optifine', 'launchwrapper-of', lwVersion))
    await fs.writeFile(abs, lwEntry.getData())
  } else {
    const abs = join(P.libraries, lwRel)
    ensureDir(join(P.libraries, lwRel, '..'))
    await downloadFile(`${BMCL}/maven/${lwRel}`, abs, { retries: 3, timeout: 60000 }).catch(() => {})
  }

  // 3) 拼版本 json（不对 libs 做下载：文件已经在本地了，installVersion 会跳过）
  const merged = {
    id,
    inheritsFrom: mc,
    type: 'release',
    mainClass: 'net.minecraft.launchwrapper.Launch',
    libraries: [
      { name: `optifine:OptiFine:${ver}`, downloads: { artifact: { path: optiRel, url: `${BMCL}/optifine/${encodeURIComponent(mc)}/${encodeURIComponent(kind)}/${encodeURIComponent(patch)}` } } },
      { name: `optifine:launchwrapper-of:${lwVersion}`, downloads: { artifact: { path: lwRel, url: `${BMCL}/maven/${lwRel}` } } }
    ],
    arguments: {
      game: ['--tweakClass', 'optifine.OptiFineTweaker'],
      jvm: []
    }
  }
  ensureDir(P.versionDir(id))
  await fs.writeFile(P.versionJson(id), JSON.stringify(merged, null, 2))
  await installVersion(id, { ...ctx, taskId: ctx.taskId })
  return id
}

// ---------------- 统一入口 ----------------

export async function installLoader(
  type: LoaderType,
  mcVersion: string,
  loaderVersion: string,
  ctx: InstallContext,
  onProgress?: (p: LoaderInstallProgress) => void
): Promise<{ versionId: string; type: LoaderType }> {
  void onProgress
  // 装加载器之前，父版本必须完整
  if (!existsSync(P.versionJson(mcVersion))) {
    ctx.onProgress({ taskId: ctx.taskId, phase: '安装父版本', current: 0, total: 1, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: mcVersion })
    await installVersion(mcVersion, { ...ctx, taskId: ctx.taskId })
  }

  let versionId = ''
  switch (type) {
    case 'fabric':
    case 'quilt':
    case 'legacyfabric':
      versionId = await installFabricLike(type, mcVersion, loaderVersion, ctx)
      break
    case 'forge':
    case 'neoforge':
      versionId = await installForgeInstaller(type, mcVersion, loaderVersion, ctx)
      break
    case 'optifine':
      versionId = await installOptiFine(mcVersion, loaderVersion, ctx)
      break
    default:
      throw new Error(`不支持的加载器: ${type}`)
  }
  ctx.onProgress({ taskId: ctx.taskId, phase: '完成', current: 1, total: 1, bytesDone: 0, bytesTotal: 0, finished: true, currentFile: versionId })
  return { versionId, type }
}

export async function listInstalledLoaders(): Promise<{ versionId: string; type: string; mcVersion: string }[]> {
  const out: { versionId: string; type: string; mcVersion: string }[] = []
  const dirs = await fs.readdir(P.versions, { withFileTypes: true }).catch(() => [])
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const file = P.versionJson(d.name)
    if (!existsSync(file)) continue
    try {
      const j = JSON.parse(await fs.readFile(file, 'utf8')) as { inheritsFrom?: string; id: string }
      if (!j.inheritsFrom) continue
      const type = /fabric/i.test(j.id) ? 'fabric' : /quilt/i.test(j.id) ? 'quilt' : /forge/i.test(j.id) ? 'forge' : /optifine/i.test(j.id) ? 'optifine' : 'unknown'
      out.push({ versionId: j.id, type, mcVersion: j.inheritsFrom })
    } catch {
      /* ignore */
    }
  }
  return out
}

export { sleep, setDownloadSource, rewriteUrl }
