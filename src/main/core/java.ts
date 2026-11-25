import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, closeSync, readdirSync, promises as fs, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JavaRuntimeInfo } from '../../shared/types'
import { downloadFile, ensureDir, pool, retry } from './http'
import { rewriteUrl } from './manifest'
import { P } from './paths'

const JAVA_RUNTIME_ALL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

interface RuntimeEntry {
  version: { name: string; released: string }
  manifest: { url: string; sha1: string; size: number }
}
interface RuntimeManifestFile {
  type: 'file' | 'directory' | 'link'
  downloads?: {
    raw?: { url: string; sha1: string; size: number }
    lzma?: { url: string; sha1: string; size: number }
  }
  executable?: boolean
  target?: string
}
interface RuntimeManifest {
  files: Record<string, RuntimeManifestFile>
}

/** 32 位和 64 位 Java 不能共用一个目录：同一台机器上装两份会互相覆盖 */
function runtimeDirName(component: string): string {
  return process.arch === 'ia32' ? `${component}-x86` : component
}

export function javaExe(component: string): string {
  const name = runtimeDirName(component)
  const base = join(P.runtime, name, name)
  // macOS 的 Mojang 运行时是大 bundle：jre.bundle/Contents/Home/bin/java
  if (process.platform === 'darwin') return join(base, 'jre.bundle', 'Contents', 'Home', 'bin', 'java')
  return process.platform === 'win32' ? join(base, 'bin', 'java.exe') : join(base, 'bin', 'java')
}

/** 32 位 JVM 报告 os.arch=x86；amd64 / x86_64 / aarch64 都是 64 位 */
export function is32BitJavaArch(arch: string | undefined): boolean {
  if (!arch) return false
  const a = arch.toLowerCase()
  return a === 'x86' || a === 'i386' || a === 'i686'
}

/**
 * 读取 java 版本信息。
 * 不用 pipe 抓输出（某些受限环境 / 特殊终端下会 EPERM），改成重定向到临时文件再读。
 */
export function probeJava(exe: string): Promise<{ version: string; major: number; arch?: string }> {
  return new Promise((resolve, reject) => {
    if (!existsSync(exe)) return reject(new Error(`java 不存在: ${exe}`))
    const tmp = join(tmpdir(), `feiyu-java-probe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
    let fd = -1
    try {
      fd = openSync(tmp, 'w')
    } catch (e) {
      return reject(e as Error)
    }
    let settled = false
    const finish = (err: Error | null, data?: { version: string; major: number; arch?: string }): void => {
      if (settled) return
      settled = true
      try {
        closeSync(fd)
      } catch {
        /* 已关闭 */
      }
      try {
        rmSync(tmp, { force: true })
      } catch {
        /* ignore */
      }
      if (err) reject(err)
      else resolve(data!)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(exe, ['-XshowSettings:properties', '-version'], { stdio: ['ignore', fd, fd], windowsHide: true })
    } catch (e) {
      return finish(e as Error)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish(new Error(`java 探测超时: ${exe}`))
    }, 20000)

    child.on('error', (e) => {
      clearTimeout(timer)
      finish(e)
    })
    // stdio 是文件描述符不是 pipe：close 时写入已完成，不必额外等 120ms
    child.on('close', () => {
      clearTimeout(timer)
      let text = ''
      try {
        text = readFileSync(tmp, 'utf8')
      } catch {
        /* ignore */
      }
      const ver = /java\.version\s*=\s*(\S+)/.exec(text)?.[1] ?? /version "([^"]+)"/.exec(text)?.[1]
      if (!ver) return finish(new Error(`无法解析 java 版本: ${(text || '(空输出)').slice(0, 200)}`))
      const major = ver.startsWith('1.') ? parseInt(ver.split('.')[1], 10) : parseInt(ver.split('.')[0], 10)
      const arch = /os\.arch\s*=\s*(\S+)/.exec(text)?.[1]
      finish(null, { version: ver, major: Number.isFinite(major) ? major : 0, arch })
    })
  })
}

function commonJavaDirs(): string[] {
  const dirs: string[] = []
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const pfx86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const local = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
  const candidates = [
    join(pf, 'Java'),
    join(pf, 'Eclipse Adoptium'),
    join(pf, 'Microsoft'),
    join(pf, 'BellSoft'),
    join(pf, 'Zulu'),
    join(pfx86, 'Java'),
    join(local, 'Programs', 'Eclipse Adoptium'),
    join(local, 'Programs', 'Microsoft'),
    join(local, 'Programs', 'Java'),
    join(homedir(), '.jdks')
  ]
  for (const c of candidates) {
    try {
      for (const name of readdirSync(c)) {
        const exe = process.platform === 'win32' ? join(c, name, 'bin', 'java.exe') : join(c, name, 'bin', 'java')
        if (existsSync(exe)) dirs.push(exe)
      }
    } catch {
      /* 无权限或不存在 */
    }
  }
  return dirs
}

/** 用户手动添加的 Java 路径（设置里维护），由 store 在加载/改设置时灌进来 */
let extraJavaPaths: string[] = []
export function setExtraJavaPaths(paths: string[]): void {
  extraJavaPaths = paths.filter(Boolean)
}

/** 探测所有可用 Java：mojang 下载的 + 系统的 + 用户手动加的 */
export async function listJava(): Promise<JavaRuntimeInfo[]> {
  const candidates: { exe: string; source: JavaRuntimeInfo['source'] }[] = []
  // 1) 启动器自己下载的
  try {
    const comps = await fs.readdir(P.runtime, { withFileTypes: true })
    for (const c of comps) {
      if (!c.isDirectory()) continue
      // 目录名就是组件名（32 位带 -x86 后缀），直接按目录拼，别再走一遍命名规则
      const base = join(P.runtime, c.name, c.name)
      const exeCandidates = process.platform === 'win32'
        ? [join(base, 'bin', 'java.exe')]
        : [join(base, 'bin', 'java'), join(base, 'jre.bundle', 'Contents', 'Home', 'bin', 'java')]
      const exe = exeCandidates.find((p) => existsSync(p))
      if (!exe) continue
      candidates.push({ exe, source: 'mojang' })
    }
  } catch {
    /* runtime 目录还没建 */
  }
  // 2) 系统 PATH + 常见安装目录
  const pathDirs = (process.env['PATH'] ?? '').split(process.platform === 'win32' ? ';' : ':')
  const systemExes = new Set<string>()
  for (const d of pathDirs) {
    const exe = join(d, process.platform === 'win32' ? 'java.exe' : 'java')
    if (existsSync(exe)) systemExes.add(exe)
  }
  for (const exe of commonJavaDirs()) systemExes.add(exe)
  for (const exe of systemExes) candidates.push({ exe, source: 'system' })
  // 3) 用户手动添加的（哪怕不在 PATH、不在常见目录也认）
  for (const exe of extraJavaPaths) {
    if (!existsSync(exe)) continue
    candidates.push({ exe, source: 'custom' })
  }
  // 先去重再探测：PATH / 常见目录 / 手动路径经常重叠，同一个 java 别 spawn 两次。
  // Map.set 保留首次插入位置、后来源覆盖先来源，与原来「探测后去重」的语义一致
  const unique = new Map<string, { exe: string; source: JavaRuntimeInfo['source'] }>()
  for (const c of candidates) unique.set(c.exe.toLowerCase(), c)
  // 并发探测：每个 probe 都要起一个 java 进程，串行太慢。
  // pool 按候选原顺序回填结果，过滤/排序规则与串行版完全一致
  const probed = await pool([...unique.values()], 4, async (c): Promise<JavaRuntimeInfo | null> => {
    try {
      const p = await probeJava(c.exe)
      if (c.source === 'system' && !(p.major >= 8 && p.major < 40)) return null
      return { path: c.exe, version: p.version, major: p.major, source: c.source, arch: p.arch }
    } catch {
      /* 探测失败 / 路径失效就跳过 */
      return null
    }
  })
  const out = probed.filter((j): j is JavaRuntimeInfo => j !== null)
  // 去重
  const dedup = new Map<string, JavaRuntimeInfo>()
  for (const j of out) dedup.set(j.path.toLowerCase(), j)
  return [...dedup.values()].sort((a, b) => a.major - b.major)
}

/** 找最合适的 Java。
 *  注意：老版本（1.8.9 之类）在 Java 16+ 上会崩（LaunchWrapper / 反射 API 不兼容），
 *  所以「差得太多的高版本」不能拿来凑数，宁可返回 null 让调用方去下载。 */
export async function findJava(major: number): Promise<JavaRuntimeInfo | null> {
  const all = await listJava()
  // 1) 精确匹配
  const exact = all.filter((j) => j.major === major)
  if (exact.length) return exact.sort((a, b) => (a.source === 'mojang' ? -1 : 1) - (b.source === 'mojang' ? -1 : 1))[0]
  // 2) 现代版本可以吃略高的 Java（跨 1~4 个大版本），老版本不行
  if (major >= 16) {
    const higher = all.filter((j) => j.major > major && j.major <= major + 4)
    if (higher.length) return higher.sort((a, b) => a.major - b.major)[0]
  }
  return null
}

export function runtimeComponentFor(major: number): string {
  if (major <= 8) return 'jre-legacy'
  if (major <= 16) return 'java-runtime-alpha'
  if (major <= 17) return 'java-runtime-gamma'
  if (major <= 21) return 'java-runtime-delta'
  return 'java-runtime-epsilon'
}

/** Mojang 运行时清单里的平台键：32 位 Windows 要拿 windows-x86 那一份（清单里确实有） */
function runtimeOsKey(): string {
  if (process.platform === 'win32') return process.arch === 'ia32' ? 'windows-x86' : 'windows-x64'
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  return process.arch === 'ia32' ? 'linux-i386' : 'linux'
}

/** 从 Mojang 下载完整的 Java 运行时 */
export async function downloadJavaRuntime(component: string, onProgress?: (done: number, total: number, bytesDone: number, bytesTotal: number) => void, isCancelled?: () => boolean): Promise<JavaRuntimeInfo> {
  const osKey = runtimeOsKey()
  const all = await retry(() => fetchJsonSafe<Record<string, Record<string, RuntimeEntry[]>>>(rewriteUrl(JAVA_RUNTIME_ALL)), 3, 1000)
  const entries = all[osKey]?.[component]
  if (!entries?.length) throw new Error(`没有找到 Java 运行时组件 ${component}（${osKey}）`)
  const entry = entries[0]

  const manifest = await retry(() => fetchJsonSafe<RuntimeManifest>(rewriteUrl(entry.manifest.url)), 3, 1000)
  const dirName = runtimeDirName(component)
  const root = join(P.runtime, dirName)
  ensureDir(root)

  const files = Object.entries(manifest.files).filter(([, f]) => f.type === 'file' && f.downloads?.raw)
  const total = files.length
  const bytesTotal = files.reduce((s, [, f]) => s + (f.downloads?.raw?.size ?? 0), 0)
  let done = 0
  let bytesDone = 0

  await pool(files, 4, async ([rel, f]) => {
    if (isCancelled?.()) throw new Error('已取消')
    const raw = f.downloads!.raw!
    const dest = join(root, dirName, rel)
    const primary = rewriteUrl(raw.url)
    try {
      const r = await downloadFile(primary, dest, {
        sha1: raw.sha1,
        size: raw.size,
        altUrl: primary !== raw.url ? raw.url : undefined,
        retries: 5,
        onBytes: (n) => {
          bytesDone += n
          onProgress?.(done, total, bytesDone, bytesTotal)
        }
      })
      // Linux/macOS 下 manifest 标了 executable 的（bin/java 之类）要补执行位，
      // 少这一步游戏根本起不来；Windows 上 chmod 是空操作
      if (f.executable && process.platform !== 'win32') await fs.chmod(dest, 0o755).catch(() => undefined)
      // 已存在的文件不计字节，补上，进度才对得上
      if (r.skipped) bytesDone += raw.size
    } catch (e) {
      throw new Error(`Java 文件下载失败 ${rel}: ${(e as Error).message}`)
    }
    done++
    onProgress?.(done, total, bytesDone, bytesTotal)
  })

  const exe = javaExe(component)
  if (!existsSync(exe)) throw new Error(`Java 运行时下载不完整：缺少 ${exe}`)
  // manifest 万一没标 executable，这一步兜底
  if (process.platform !== 'win32') await fs.chmod(exe, 0o755).catch(() => undefined)
  const p = await probeJava(exe)
  if (p.major < 8) throw new Error(`下载的 Java 版本异常: ${p.version}`)
  return { path: exe, version: p.version, major: p.major, source: 'mojang' }
}

async function fetchJsonSafe<T>(url: string): Promise<T> {
  // 裸 fetch 挂起时 retry 也救不了，必须有超时
  const res = await fetch(url, { headers: { 'User-Agent': 'FeiyuLauncher/0.1.0' }, signal: AbortSignal.timeout(25000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`)
  return (await res.json()) as T
}

