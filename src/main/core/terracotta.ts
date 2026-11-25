import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { TerracottaMeta, TerracottaState } from '../../shared/types'
import { downloadFile, fetchJson } from './http'
import { dataRoot } from './paths'

const execFileAsync = promisify(execFile)

/**
 * 陶瓦联机（Terracotta）集成。
 * 方案：下载官方未经修改的二进制 → 以 `terracotta --hmcl <portFile>` 集成模式启动 →
 * 通过本机回环 HTTP API 创建/加入房间、读状态。
 * 许可：Terracotta 为 AGPL-3.0-or-later（附例外）；本启动器只经 HTTP API 与未修改二进制交互，
 * 并在联机页显著位置标注版权（例外条款第 2 项）。
 * 文档：https://burningtnt.github.io/Terracotta/http-api/
 */

const GITHUB_LATEST = 'https://api.github.com/repos/burningtnt/Terracotta/releases/latest'
const GITEE_LATEST = 'https://gitee.com/api/v5/repos/burningtnt/Terracotta/releases/latest'

interface ReleaseAsset {
  name: string
  url: string
  size?: number
}
interface ReleaseInfo {
  tag: string
  assets: ReleaseAsset[]
}

interface InstalledMarker {
  version: string
  /** 相对 terracotta 目录的可执行文件路径 */
  exe: string
  installedAt: number
}

function tcDir(): string {
  return join(dataRoot(), 'terracotta')
}

function markerFile(): string {
  return join(tcDir(), 'terracotta.json')
}

function portFile(): string {
  return join(tcDir(), 'port.json')
}

function readMarker(): InstalledMarker | null {
  try {
    const m = JSON.parse(readFileSync(markerFile(), 'utf8')) as InstalledMarker
    if (!m.exe || !existsSync(join(tcDir(), m.exe))) return null
    return m
  } catch {
    return null
  }
}

/** 当前平台的发行包资产名关键字（官方命名：terracotta-<ver>-<os>-<arch>-pkg.tar.gz） */
function platformKey(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : 'x86_64'
  if (process.platform === 'win32') return `windows-${arch}`
  if (process.platform === 'darwin') return `macos-${arch}`
  return `linux-${arch}`
}

function exeName(): string {
  return process.platform === 'win32' ? 'terracotta.exe' : 'terracotta'
}

async function resolveRelease(): Promise<ReleaseInfo> {
  // GitHub 优先；被墙/限流时回落 Gitee 镜像仓库（同一作者维护）
  try {
    const r = await fetchJson<{ tag_name: string; assets: { name: string; browser_download_url: string; size?: number }[] }>(GITHUB_LATEST, { timeout: 20000 })
    if (r.assets?.length) return { tag: r.tag_name, assets: r.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })) }
  } catch {
    /* 试镜像 */
  }
  const r = await fetchJson<{ tag_name: string; assets: { name: string; browser_download_url: string }[] }>(GITEE_LATEST, { timeout: 20000 })
  if (!r.assets?.length) throw new Error('陶瓦联机发行版里没有可用资产')
  return { tag: r.tag_name, assets: r.assets.map((a) => ({ name: a.name, url: a.browser_download_url })) }
}

function pickAsset(rel: ReleaseInfo): ReleaseAsset {
  const key = platformKey()
  const match = rel.assets.filter((a) => a.name.includes(key) && !a.name.includes('android'))
  // 新版是 -pkg.tar.gz 平台包；旧版（≤0.3.x）是裸二进制
  const pkg = match.find((a) => a.name.endsWith('-pkg.tar.gz'))
  if (pkg) return pkg
  const bare = match.find((a) => a.name.endsWith('.exe') || !a.name.includes('.'))
  if (bare) return bare
  throw new Error(`没有找到适配当前平台（${key}）的陶瓦联机发行包`)
}

/** 在解包目录里找 terracotta 可执行文件（最多 3 层；官方 exe 带版本号，按前缀匹配） */
async function findExe(dir: string, depth = 0): Promise<string | null> {
  const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const isExe = (name: string): boolean => {
    if (!name.startsWith('terracotta')) return false
    if (process.platform === 'win32') return name.toLowerCase().endsWith('.exe')
    return !/\.(so|dll|dylib|tar\.gz|json|log|md|pkg)$/i.test(name)
  }
  for (const it of items) {
    if (it.isFile() && isExe(it.name)) return join(dir, it.name)
  }
  if (depth >= 3) return null
  for (const it of items) {
    if (!it.isDirectory()) continue
    const hit = await findExe(join(dir, it.name), depth + 1)
    if (hit) return hit
  }
  return null
}

export interface InstallResult {
  version: string
}

/** 32 位 Windows 上陶瓦只发 64 位包，别去下一个跑不起来的 exe */
export function multiplayerSupported(): boolean {
  return process.arch !== 'ia32'
}

function assertMultiplayerSupported(): void {
  if (!multiplayerSupported()) throw new Error('陶瓦联机没有 32 位构建，32 位启动器用不了联机；要联机请换 64 位系统 + 64 位启动器')
}

/** 下载并安装陶瓦联机组件（已安装且非强制时直接返回） */
export async function installTerracotta(
  onProgress?: (done: number, total: number) => void,
  force = false
): Promise<InstallResult> {
  assertMultiplayerSupported()
  const existing = readMarker()
  if (existing && !force) return { version: existing.version }

  const rel = await resolveRelease()
  const asset = pickAsset(rel)
  const dlDir = join(tcDir(), 'download')
  await fs.mkdir(dlDir, { recursive: true })
  const archive = join(dlDir, asset.name)
  await downloadFile(asset.url, archive, {
    size: asset.size,
    retries: 3,
    timeout: 600000,
    onBytes: (n) => onProgress?.(n, asset.size ?? 0)
  })

  const version = rel.tag.replace(/^v/, '')
  const pkgDir = join(tcDir(), 'pkg', version)
  await fs.mkdir(pkgDir, { recursive: true })

  let exeAbs: string
  if (asset.name.endsWith('.tar.gz')) {
    // Windows 10+ / macOS / Linux 都自带 tar；解官方平台包
    try {
      await execFileAsync('tar', ['-xzf', archive, '-C', pkgDir], { windowsHide: true, timeout: 120000 })
    } catch (e) {
      throw new Error(`解压陶瓦联机包失败（需要系统自带 tar）：${(e as Error).message}`)
    }
    const found = await findExe(pkgDir)
    if (!found) throw new Error('陶瓦联机包里没有可执行文件')
    exeAbs = found
  } else {
    // 旧版裸二进制：直接放进 pkg 目录
    exeAbs = join(pkgDir, exeName())
    await fs.copyFile(archive, exeAbs)
  }

  // Linux/macOS 从 tar 包里解出来的可执行文件没有执行位，补上
  if (process.platform !== 'win32') await fs.chmod(exeAbs, 0o755).catch(() => undefined)

  const marker: InstalledMarker = {
    version,
    exe: exeAbs.slice(tcDir().length + 1).replace(/\\/g, '/'),
    installedAt: Date.now()
  }
  await fs.mkdir(tcDir(), { recursive: true })
  await fs.writeFile(markerFile(), JSON.stringify(marker, null, 2))
  return { version }
}

// ---------------- 进程与 HTTP API ----------------

interface Runtime {
  port: number
  /** true = 复用别的程序（如 HMCL）已启动的实例，退出时不该杀它 */
  attached: boolean
  child: ChildProcess | null
}
let runtime: Runtime | null = null

function lockPort(): number | null {
  // 锁文件：macOS 为 ~/terracotta/，其他平台为系统临时目录下的 terracotta/；2 字节大端端口
  const file = process.platform === 'darwin'
    ? join(homedir(), 'terracotta', 'terracotta.lock')
    : join(tmpdir(), 'terracotta', 'terracotta.lock')
  try {
    const buf = readFileSync(file)
    if (buf.length >= 2) return buf.readUInt16BE(0)
  } catch {
    /* 没有实例在跑 */
  }
  return null
}

async function apiGet<T>(port: number, path: string, timeout = 5000): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error(`陶瓦联机接口 HTTP ${res.status} @ ${path}`)
  // 控制接口（scanning/ide 等）返回 200 空 body，不能无脑 res.json()
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function healthy(port: number): Promise<TerracottaMeta | null> {
  try {
    return await apiGet<TerracottaMeta>(port, '/meta', 1500)
  } catch {
    return null
  }
}

export interface RunningInfo {
  port: number
  attached: boolean
  meta: TerracottaMeta
}

/** 确保陶瓦进程在跑：已有健康实例就复用，否则以集成模式启动 */
export async function ensureRunning(): Promise<RunningInfo> {
  assertMultiplayerSupported()
  if (runtime) {
    const meta = await healthy(runtime.port)
    if (meta) return { port: runtime.port, attached: runtime.attached, meta }
    runtime = null
  }

  // 别的启动器已经开了陶瓦？直接附着，不重复启动
  const locked = lockPort()
  if (locked) {
    const meta = await healthy(locked)
    if (meta) {
      runtime = { port: locked, attached: true, child: null }
      return { port: locked, attached: true, meta }
    }
  }

  const marker = readMarker()
  if (!marker) throw new Error('还没有安装陶瓦联机组件，请先下载')
  const exe = join(tcDir(), marker.exe)

  const pf = portFile()
  await fs.mkdir(tcDir(), { recursive: true })
  await fs.rm(pf, { force: true })
  // Windows 下 --hmcl 进程只是引导：fork 出工作进程后自己退出，端口写进 pf
  const child = spawn(exe, ['--hmcl', pf], { windowsHide: true, stdio: 'ignore' })
  child.on('error', () => {
    /* 启动失败由下面的超时兜底 */
  })

  const deadline = Date.now() + 20000
  let port = 0
  while (Date.now() < deadline) {
    try {
      const j = JSON.parse(await fs.readFile(pf, 'utf8')) as { port?: number }
      if (j.port) {
        port = j.port
        break
      }
    } catch {
      /* 还没写出来 */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  if (!port) {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    throw new Error('陶瓦联机启动超时（20 秒内没有写出端口）')
  }
  const meta = await healthy(port)
  if (!meta) {
    throw new Error('陶瓦联机进程已启动但 HTTP 服务无响应')
  }
  runtime = { port, attached: false, child }
  return { port, attached: false, meta }
}

export function isRunning(): boolean {
  return runtime !== null
}

export function runtimeInfo(): { port: number; attached: boolean } | null {
  return runtime ? { port: runtime.port, attached: runtime.attached } : null
}

/** 当前实例的元信息；进程已失联时顺手清掉本地运行时状态 */
export async function currentMeta(): Promise<TerracottaMeta | null> {
  if (!runtime) return null
  const meta = await healthy(runtime.port)
  if (!meta) runtime = null
  return meta
}

/** 读房间状态（未运行时返回 null） */
export async function getState(): Promise<TerracottaState | null> {
  if (!runtime) return null
  try {
    return await apiGet<TerracottaState>(runtime.port, '/state', 2500)
  } catch {
    return null
  }
}

/** 以房主身份开房；room 传入则用指定房间码重开 */
export async function hostRoom(player: string, room?: string): Promise<void> {
  const { port } = await ensureRunning()
  const params = new URLSearchParams()
  if (player) params.set('player', player)
  if (room) params.set('room', room)
  await apiGet(port, `/state/scanning${params.toString() ? `?${params.toString()}` : ''}`)
}

/** 以加入方身份进房 */
export async function joinRoom(room: string, player: string): Promise<void> {
  const code = room.trim()
  if (!code) throw new Error('请输入房间码')
  const { port } = await ensureRunning()
  const params = new URLSearchParams({ room: code })
  if (player) params.set('player', player)
  const res = await fetch(`http://127.0.0.1:${port}/state/guesting?${params.toString()}`, { signal: AbortSignal.timeout(5000) })
  if (res.status === 400) throw new Error('房间码无效，或当前不在待机状态（先离开现有房间）')
  if (!res.ok) throw new Error(`加入房间失败 HTTP ${res.status}`)
}

/** 回到待机（离开房间 / 异常复位） */
export async function leaveRoom(): Promise<void> {
  if (!runtime) return
  await apiGet(runtime.port, '/state/ide').catch(() => undefined)
}

/** 读陶瓦日志（排查用） */
export async function getLog(): Promise<string> {
  if (!runtime) return ''
  const res = await fetch(`http://127.0.0.1:${runtime.port}/log?fetch=true`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`读取日志失败 HTTP ${res.status}`)
  return await res.text()
}

/** 停止联机服务。附着的实例（别的程序开的）只断开本启动器的使用，不杀进程 */
export async function stopTerracotta(): Promise<void> {
  const rt = runtime
  runtime = null
  if (!rt) return
  if (!rt.attached) {
    await fetch(`http://127.0.0.1:${rt.port}/panic?peaceful=true`, { signal: AbortSignal.timeout(3000) }).catch(() => undefined)
  }
  if (rt.child) {
    try {
      rt.child.kill()
    } catch {
      /* 引导进程通常已自行退出 */
    }
  }
}

export function installedVersion(): string | undefined {
  return readMarker()?.version
}

export function terracottaDir(): string {
  return tcDir()
}
