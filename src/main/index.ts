import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { appendFileSync, existsSync, promises as fs, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { IPC } from '../shared/api'
import type { DownloadProgress, FavoriteItem, InstanceFileKind, LaunchProgress, LaunchStatus, LogLine, ModFile, ServerEntry, Settings, TerracottaStatus, VersionSettings, WorldMapFile } from '../shared/types'
import { addOfflineAccount, ensureFreshAccount, pollDeviceCode, refreshMicrosoftAccount, startDeviceCode } from './core/auth'
import { ensureAuthlibInjector, fetchAuthlibMeta, findAuthlibAccount, loginAuthlib, refreshAuthlib } from './core/authlib'
import { downloadJavaRuntime, findJava, listJava, probeJava, runtimeComponentFor } from './core/java'
import { installVersion, isInstalled, readInstalledMark, setSourceLabel, dirSize, InstallCancelled } from './core/install'
import { getResolvedVersionJson, getVersionJson, getVersionManifest, ensureEffectiveSource, setDownloadSource } from './core/manifest'
import { downloadFile, ensureDir } from './core/http'
import { assertInsideData, assertSafeVersionId, ensureGameDirs, externalVersionDir, externalVersionIds, externalVersionRoot, setExternalVersions, P, setGameDir } from './core/paths'
import { launchGame, LAUNCHER_VERSION, type LaunchHandle } from './core/launch'
import { installLoader, listInstalledLoaders, listLoaderVersions, type LoaderType } from './core/loaders'
import { downloadResource, getResourceVersions, searchResources, targetDirFor, type SearchOptions } from './core/modrinth'
import { installModpack } from './core/modpack'
import { searchMcmod } from './core/mcmod'
import type { ResourceType } from '../shared/resources'
import { deleteWorld, listWorlds } from './core/worlds'
import { addServer, listServers, removeServer } from './core/servers'
import { downloadWorldMap, importWorldZip, installCfModpack, listCfFiles, listWorldMapFiles, searchCfProjects, searchWorldMaps } from './core/curseforge'
import { cloneInstance, describeComponents, exportInstance, importInstance, instanceStats, listInstanceFiles, renameInstance, retireComponent, toggleInstanceFile } from './core/instances'
import * as terracotta from './core/terracotta'
import { bumpLaunchCount, getVersionSettings, setVersionSettings } from './core/store'
import { activeAccount, addFavorite, getSettings, listAccounts, listFavorites, loadStore, migrateVersionData, removeAccount, removeFavorite, setActiveAccount, updateSettings } from './core/store'

/** 启动阶段的诊断日志，打包后没控制台时靠它排查 */
const BOOT_LOG_FILE = join(tmpdir(), 'feiyu-launcher-boot.log')
/** 超过这个体积就滚动一次，否则它会在 %TEMP% 里跟着启动次数无限增长 */
const BOOT_LOG_MAX_BYTES = 256 * 1024
let bootLogRotated = false

export function bootLog(msg: string): void {
  try {
    if (!bootLogRotated) {
      bootLogRotated = true
      if (existsSync(BOOT_LOG_FILE) && statSync(BOOT_LOG_FILE).size > BOOT_LOG_MAX_BYTES) {
        const rotated = `${BOOT_LOG_FILE}.1`
        if (existsSync(rotated)) unlinkSync(rotated)
        renameSync(BOOT_LOG_FILE, rotated)
      }
    }
    appendFileSync(BOOT_LOG_FILE, `${new Date().toISOString()} [${process.pid}] ${msg}\n`)
  } catch {
    /* ignore */
  }
}

bootLog(`start argv=${process.argv.join(' ')}`)

/**
 * 演示 / 截图 / 端到端自检这几个钩子只允许在开发构建里生效。
 * FEIYU_SHOT_JS 会把环境变量里的字符串直接交给 executeJavaScript，
 * 打包版要是也认它，就等于给「能设置本进程环境变量的人」开了一条渲染进程代码执行的口子。
 */
const DEV_HOOKS = !app.isPackaged

let mainWindow: BrowserWindow | null = null

/** 端到端自检脚本：在渲染进程里跑，走真实 window.api 通道 */
const E2E_SCRIPT = `(async () => {
  const out = []
  const log = []
  const off = window.api.onLog((l) => log.push(l.line))
  try {
    const s = await window.api.settings.set({ gameDir: ${JSON.stringify(process.env.FEIYU_E2E_GAMEDIR ?? '')} })
    out.push('settings.gameDir=' + s.gameDir)
    const acc = await window.api.accounts.addOffline('E2ETester')
    out.push('account=' + acc.name + ' uuid=' + acc.uuid)
    const active = await window.api.accounts.active()
    out.push('active=' + (active ? active.name : 'none'))
    const local = await window.api.versions.local()
    out.push('localVersions=' + JSON.stringify(local.map((v) => v.id + ':' + (v.complete ? 'ok' : 'bad'))))
    const javas = await window.api.java.list()
    out.push('javas=' + javas.map((j) => j.major + '@' + j.source).join(','))
    await window.api.launch.start('1.20.1', active.id)
    out.push('launch.start ok')
    let st = { running: true }
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      st = await window.api.launch.status()
      if (!st.running) break
    }
    const joined = log.join('\\n')
    const markers = ['Setting user', 'LWJGL', 'OpenAL initialized', 'Sound engine started'].map((k) => k + '=' + joined.includes(k))
    out.push('status=' + JSON.stringify(st))
    out.push('markers=' + markers.join(' '))
    out.push('logLines=' + log.length)
    await window.api.launch.stop()
    await new Promise((r) => setTimeout(r, 1500))
    const st2 = await window.api.launch.status()
    out.push('afterStop.running=' + st2.running)
  } catch (e) {
    out.push('ERROR: ' + (e && e.message ? e.message : String(e)))
  } finally {
    off()
  }
  return out.join('\\n')
})()`

/** 扫描「其他文件夹」里形如 <id>/<id>.json 的子目录，跳过主 versions 已存在的 id */
async function scanVersionFolders(dirs: string[]): Promise<{ id: string; dir: string; root: string }[]> {
  const out: { id: string; dir: string; root: string }[] = []
  const seen = new Set<string>()
  for (const root of dirs) {
    if (!root || !existsSync(root)) continue
    const items = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    for (const it of items) {
      if (!it.isDirectory()) continue
      const id = it.name
      const dir = join(root, id)
      if (!existsSync(join(dir, `${id}.json`))) continue
      if (seen.has(id)) continue
      // 主 versions 里已经有同名版本 → 以主目录为准
      if (existsSync(join(P.versions, id, `${id}.json`))) continue
      seen.add(id)
      out.push({ id, dir, root })
    }
  }
  return out
}

/** 重新扫描并注册映射，返回发现数量 */
async function refreshExternalVersions(): Promise<number> {
  const s = await getSettings()
  const found = await scanVersionFolders(s.extraVersionDirs ?? [])
  setExternalVersions(found.map((f) => [f.id, f.dir, f.root]))
  return found.length
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0d1117',
    title: '肥鱼启动器',
    // 窗口/任务栏图标：打包后从 resources 拿，开发时直接用 build 里的
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(__dirname, '../../build/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 渲染进程只应该显示本地页面。任何跳转和新窗口一律拦掉，
  // 外链交给系统浏览器（走 IPC.openExternal，那边已经限定了 http(s)）。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const allowed = devUrl ? url.startsWith(devUrl) : false
    if (!allowed) {
      e.preventDefault()
      bootLog(`blocked navigation to ${url}`)
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // 演示/调试用：把窗口钉在最前面并挪到左上角
    if (DEV_HOOKS && process.env.FEIYU_TOPMOST) {
      mainWindow?.setAlwaysOnTop(true, 'screen-saver')
      mainWindow?.setPosition(60, 60)
      mainWindow?.focus()
    }
  })

  // 把渲染进程的报错打到终端，没窗口的时候也能排查
  mainWindow.webContents.on('console-message', (...args: unknown[]) => {
    const detail = args.find((a) => a && typeof a === 'object' && typeof (a as { message?: string }).message === 'string') as
      | { level?: string | number; message?: string; lineNumber?: number; sourceId?: string }
      | undefined
    if (detail) {
      console.log(`[renderer:${String(detail.level)}] ${detail.message} (${detail.sourceId ?? ''}:${detail.lineNumber ?? 0})`)
      return
    }
    if (typeof args[1] === 'number' && typeof args[2] === 'string') {
      console.log(`[renderer:${String(args[1])}] ${args[2]}`)
    }
  })
  mainWindow.webContents.on('preload-error', (_e, path, error) => {
    console.error(`[preload-error] ${path}: ${error.message}`)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[did-fail-load] ${code} ${desc} ${url}`)
  })

  // 隐藏的截图模式：设置 FEIYU_SHOT=<png 路径>，页面加载完截一张就退出
  if (DEV_HOOKS && process.env.FEIYU_SHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const pageName = process.env.FEIYU_PAGE
          if (pageName) {
            await mainWindow!.webContents.executeJavaScript(
              `(() => { const b = document.querySelector('[data-page="${pageName}"]'); if (b) b.click(); return Boolean(b) })()`
            )
            await new Promise((r) => setTimeout(r, 2600))
          }
          const extraJs = process.env.FEIYU_SHOT_JS
          if (extraJs) {
            const result = await mainWindow!.webContents.executeJavaScript(extraJs)
            console.log('[shot-js]', JSON.stringify(result))
            await new Promise((r) => setTimeout(r, 2600))
          }
          const image = await mainWindow!.capturePage()
          const { writeFileSync } = await import('node:fs')
          writeFileSync(process.env.FEIYU_SHOT!, image.toPNG())
          console.log('[shot] saved', process.env.FEIYU_SHOT)
        } catch (e) {
          console.error('[shot] failed', (e as Error).message)
        }
        setTimeout(() => app.quit(), 300)
      }, Number(process.env.FEIYU_SHOT_DELAY ?? 2600))
    })
  }

  // 端到端自检：用真实 IPC 走一遍「设目录 → 加账号 → 启动游戏」，结果写文件
  if (DEV_HOOKS && process.env.FEIYU_E2E) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        let result = ''
        try {
          result = await mainWindow!.webContents.executeJavaScript(E2E_SCRIPT)
        } catch (e) {
          result = `E2E 脚本异常: ${(e as Error).message}`
        }
        try {
          const { writeFileSync } = await import('node:fs')
          writeFileSync(process.env.FEIYU_E2E!, result)
        } catch {
          /* ignore */
        }
        console.log('[e2e]', result)
        setTimeout(() => app.quit(), 500)
      }, 2500)
    })
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---------------- 安装任务 ----------------
interface InstallState {
  running: boolean
  taskId: string
  cancelled: boolean
}
let installState: InstallState = { running: false, taskId: '', cancelled: false }

/**
 * 进度节流按 taskId 分开记账。
 * 之前是全进程共用一个时间戳，downloadConcurrency 默认 24 时 24 个文件抢同一个
 * 90ms 窗口，全局每秒只剩十来个更新，而且窗口内最后那条会被直接丢掉，
 * 进度条就卡在半路直到 finished 才跳满。这里改成：窗口内的更新攒着，到点补发最新一条。
 */
const PROGRESS_INTERVAL_MS = 90
const lastProgressAt = new Map<string, number>()
const pendingProgress = new Map<string, NodeJS.Timeout>()

function flushPending(taskId: string): void {
  const timer = pendingProgress.get(taskId)
  if (timer) {
    clearTimeout(timer)
    pendingProgress.delete(taskId)
  }
  lastProgressAt.delete(taskId)
}

function emitProgress(p: DownloadProgress): void {
  const key = p.taskId

  if (p.finished) {
    // 完成事件必须直发，且要先丢掉还挂着的尾包，否则它会晚于 finished 到达
    flushPending(key)
    send(IPC.evProgress, p)
    return
  }

  const now = Date.now()
  const last = lastProgressAt.get(key)
  if (last === undefined || now - last >= PROGRESS_INTERVAL_MS) {
    lastProgressAt.set(key, now)
    send(IPC.evProgress, p)
    return
  }

  const held = pendingProgress.get(key)
  if (held) clearTimeout(held)
  const timer = setTimeout(() => {
    pendingProgress.delete(key)
    lastProgressAt.set(key, Date.now())
    send(IPC.evProgress, p)
  }, PROGRESS_INTERVAL_MS - (now - last))
  // 别让一个待发的进度事件吊住进程退出
  timer.unref?.()
  pendingProgress.set(key, timer)
}

// ---------------- 游戏进程（支持多开，同一个实例也能开多份） ----------------
let launchPreparing = false
/** launchId → 句柄；同一个实例每次启动各占一条，靠 launchId 区分 */
const launches = new Map<string, { versionId: string; handle: LaunchHandle }>()
const launchStatuses = new Map<string, LaunchStatus>()

function publishLaunchStatus(status: LaunchStatus): void {
  if (status.launchId) launchStatuses.set(status.launchId, status)
  send(IPC.evStatus, status)
}

// ---------------- 陶瓦联机 ----------------
/** 同意了联机协议的时间戳；跟数据目录走，绿色版搬走也还在 */
function mpAgreeFile(): string {
  return join(terracotta.terracottaDir(), 'agreed.json')
}

function readMpAgreed(): number | null {
  try {
    const j = JSON.parse(readFileSync(mpAgreeFile(), 'utf8')) as { agreedAt?: number }
    return typeof j.agreedAt === 'number' ? j.agreedAt : null
  } catch {
    return null
  }
}

async function registerIpc(): Promise<void> {
  const settings = await getSettings()
  setGameDir(settings.gameDir)
  setDownloadSource(settings.downloadSource)
  await loadStore()
  ensureGameDirs()
  // 启动时先把「其他文件夹」的实例映射注册好，之后版本列表/启动才能找到它们
  await refreshExternalVersions()

  // ---- 平台 ----
  ipcMain.handle('platform:info', () => ({
    os: process.platform,
    arch: process.arch,
    version: LAUNCHER_VERSION,
    userData: app.getPath('userData')
  }))

  // ---- 设置 ----
  ipcMain.handle(IPC.settingsGet, async () => getSettings())
  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<Settings>) => {
    const next = await updateSettings(patch)
    if (patch.downloadSource) setDownloadSource(patch.downloadSource)
    if (patch.gameDir || patch.versionsDir !== undefined) {
      ensureGameDirs()
      // 版本目录变了，外部的映射要重新算
      await refreshExternalVersions()
    }
    if (patch.extraVersionDirs) await refreshExternalVersions()
    return next
  })
  ipcMain.handle(IPC.pickDir, async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.pickJava, async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Java', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }]
    })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  ipcMain.handle('dialog:pickBackground', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] },
        { name: '视频', extensions: ['mp4', 'webm', 'm4v', 'mov', 'ogv'] },
        { name: 'Wallpaper Engine 网页壁纸', extensions: ['html', 'htm'] },
        { name: '所有支持的文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'mp4', 'webm', 'm4v', 'mov', 'ogv', 'html', 'htm'] }
      ]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const path = r.filePaths[0]
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const kind = ['mp4', 'webm', 'm4v', 'mov', 'ogv'].includes(ext) ? 'video' : ['html', 'htm'].includes(ext) ? 'wallpaper' : 'image'
    return { path, kind }
  })
  ipcMain.handle(IPC.resolveMedia, async (_e, rawPath: string) => {
    if (typeof rawPath !== 'string' || !rawPath.trim()) return null
    try {
      const path = rawPath.trim()
      if (!existsSync(path) || !statSync(path).isFile()) return null
      return pathToFileURL(path).toString()
    } catch {
      return null
    }
  })

  // ---- 版本 ----
  ipcMain.handle(IPC.manifest, async (_e, force: boolean) => getVersionManifest(Boolean(force)))

  /** 扫描「其他文件夹」：形如 <id>/<id>.json 的子目录算一个实例 */
  ipcMain.handle(IPC.addVersionFolder, async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
    const dir = r.canceled ? null : r.filePaths[0]
    if (!dir) return null
    const s = await getSettings()
    const dirs = Array.from(new Set([...(s.extraVersionDirs ?? []), dir]))
    await updateSettings({ extraVersionDirs: dirs })
    const found = await refreshExternalVersions()
    return { dir, dirs, found }
  })
  ipcMain.handle(IPC.removeVersionFolder, async (_e, dir: string) => {
    const s = await getSettings()
    const dirs = (s.extraVersionDirs ?? []).filter((d) => d !== dir)
    await updateSettings({ extraVersionDirs: dirs })
    await refreshExternalVersions()
    return dirs
  })
  ipcMain.handle(IPC.extraVersionDirs, async () => {
    const s = await getSettings()
    return s.extraVersionDirs ?? []
  })
  ipcMain.handle(IPC.cloneVersion, async (_e, srcId: string, newId: string) =>
    cloneInstance(assertSafeVersionId(srcId), newId)
  )

  ipcMain.handle(IPC.localVersions, async () => {
    const dirs = existsSync(P.versions) ? await fs.readdir(P.versions, { withFileTypes: true }) : []
    const ids = new Set<string>()
    for (const d of dirs) if (d.isDirectory()) ids.add(d.name)
    // 「其他文件夹」里扫到的实例也一起列出来
    for (const id of externalVersionIds()) ids.add(id)
    const out = []
    for (const id of ids) {
      const jsonFile = P.versionJson(id)
      if (!existsSync(jsonFile)) continue
      let type = 'release'
      let javaVersion = undefined as number | undefined
      let inheritsFrom: string | undefined
      try {
        const j = JSON.parse(await fs.readFile(jsonFile, 'utf8'))
        type = j.type ?? 'release'
        javaVersion = j.javaVersion?.majorVersion
        inheritsFrom = j.inheritsFrom
      } catch {
        /* ignore */
      }
      const mark = await readInstalledMark(id)
      // 加载器版本自己没有 javaVersion / 大小，从继承的父版本或安装记录里找
      if (!javaVersion) {
        javaVersion = mark?.javaMajor
        if (!javaVersion && inheritsFrom) {
          try {
            const pj = JSON.parse(await fs.readFile(P.versionJson(inheritsFrom), 'utf8'))
            javaVersion = pj.javaVersion?.majorVersion
          } catch {
            /* ignore */
          }
        }
      }
      const extDir = externalVersionDir(id)
      out.push({
        id,
        type,
        installed: Boolean(mark),
        complete: await isInstalled(id),
        sizeBytes: mark?.sizeBytes,
        installedAt: mark?.installedAt,
        javaVersion,
        external: extDir !== undefined,
        externalDir: extDir === undefined ? undefined : externalVersionRoot(id)
      })
    }
    return out.sort((a, b) => (b.installedAt ?? 0) - (a.installedAt ?? 0))
  })

  ipcMain.handle(IPC.installVersion, async (_e, id: string) => {
    if (installState.running) throw new Error('已经有安装任务在进行')
    installState = { running: true, taskId: randomUUID(), cancelled: false }
    const taskId = installState.taskId
    const s = await getSettings()
    setSourceLabel(await ensureEffectiveSource())
    try {
      const mark = await installVersion(id, {
        taskId,
        onProgress: emitProgress,
        isCancelled: () => installState.cancelled,
        concurrency: s.downloadConcurrency
      })
      // Java 自动准备
      try {
        const vj = await getVersionJson(id)
        const major = vj.javaVersion?.majorVersion
        if (major) {
          let java = await findJava(major)
          if (!java) {
            const component = vj.javaVersion?.component || runtimeComponentFor(major)
            emitProgress({ taskId, phase: '下载 Java 运行时', current: 0, total: 1, bytesDone: 0, bytesTotal: 0, currentFile: `Java ${major}`, finished: false })
            java = await downloadJavaRuntime(
              component,
              (done, total, bd, bt) => emitProgress({ taskId, phase: '下载 Java 运行时', current: done, total, bytesDone: bd, bytesTotal: bt, currentFile: `Java ${major}`, finished: false }),
              () => installState.cancelled
            )
            send(IPC.evLog, { stream: 'launcher', line: `已准备好 Java ${java.major} (${java.version})`, ts: Date.now() } as LogLine)
          }
        }
      } catch (e) {
        send(IPC.evLog, { stream: 'launcher', line: `⚠ Java 运行时准备失败: ${(e as Error).message}（可以在设置里手动指定 Java）`, ts: Date.now() } as LogLine)
      }
      send(IPC.evProgress, { taskId, phase: '完成', current: 1, total: 1, bytesDone: 0, bytesTotal: 0, finished: true })
      return mark
    } catch (e) {
      const cancelled = e instanceof InstallCancelled || installState.cancelled
      send(IPC.evProgress, {
        taskId,
        phase: cancelled ? '已取消' : '失败',
        current: 0,
        total: 0,
        bytesDone: 0,
        bytesTotal: 0,
        finished: true,
        error: cancelled ? undefined : (e as Error).message
      })
      throw e
    } finally {
      installState.running = false
    }
  })

  ipcMain.handle(IPC.cancelInstall, async () => {
    installState.cancelled = true
    return true
  })

  ipcMain.handle(IPC.removeVersion, async (_e, id: string) => {
    if (installState.running) throw new Error('安装中不能删除版本')
    const dir = P.versionDir(assertSafeVersionId(id))
    if (!existsSync(dir)) return
    await fs.rm(dir, { recursive: true, force: true })
  })

  // ---- 账号 ----
  ipcMain.handle(IPC.accountsList, async () => listAccounts())
  ipcMain.handle(IPC.accountsActive, async () => activeAccount())
  ipcMain.handle(IPC.accountsAddOffline, async (_e, name: string) => addOfflineAccount(name))
  ipcMain.handle(IPC.accountsAuthlibMeta, async (_e, apiUrl: string) => fetchAuthlibMeta(apiUrl))
  ipcMain.handle(IPC.accountsAddAuthlib, async (_e, apiUrl: string, username: string, password: string) => loginAuthlib(apiUrl, username, password))
  ipcMain.handle(IPC.accountsRefreshAuthlib, async (_e, id: string) => {
    const acc = await findAuthlibAccount(id)
    if (!acc) throw new Error('账号不存在')
    return refreshAuthlib(acc)
  })
  ipcMain.handle(IPC.accountsRemove, async (_e, id: string) => removeAccount(id))
  ipcMain.handle(IPC.accountsSetActive, async (_e, id: string) => setActiveAccount(id))
  ipcMain.handle(IPC.msStart, async () => {
    const s = await getSettings()
    return startDeviceCode(s.msaClientId)
  })
  ipcMain.handle(IPC.msPoll, async (_e, deviceCode: string) => {
    const s = await getSettings()
    return pollDeviceCode(deviceCode, s.msaClientId)
  })
  ipcMain.handle(IPC.msRefresh, async (_e, id: string) => {
    const s = await getSettings()
    return refreshMicrosoftAccount(id, s.msaClientId)
  })

  // ---- Java ----
  ipcMain.handle(IPC.javaList, async () => listJava())
  ipcMain.handle(IPC.javaDetect, async (_e, major: number) => findJava(major))
  ipcMain.handle(IPC.javaDownload, async (_e, component: string, major: number) => {
    // 和其它三个安装入口一样要挡住并发：installState 是全局单例，
    // 直接覆盖会把在跑任务的 cancelled 标志和 running 状态一起冲掉
    if (installState.running) throw new Error('已经有安装任务在进行')
    const taskId = randomUUID()
    installState = { running: true, taskId, cancelled: false }
    try {
      return await downloadJavaRuntime(
        component || runtimeComponentFor(major),
        (done, total, bd, bt) =>
          emitProgress({ taskId, phase: '下载 Java 运行时', current: done, total, bytesDone: bd, bytesTotal: bt, currentFile: `Java ${major}`, finished: false }),
        () => installState.cancelled
      )
    } finally {
      installState.running = false
    }
  })

  // ---- 启动（同一个实例也能开多份，每次一个 launchId） ----
  ipcMain.handle(IPC.launchStart, async (_e, versionId: string, accountId: string): Promise<string> => {
    assertSafeVersionId(versionId)
    if (launchPreparing) throw new Error('游戏正在准备启动，稍等一下')
    launchPreparing = true
    try {
      return await startLaunch(versionId, accountId)
    } finally {
      launchPreparing = false
    }
  })

  async function startLaunch(versionId: string, accountId: string): Promise<string> {
    const launchId = randomUUID()

    /**
     * 启动进度：Minecraft 没有真正的进度回调，只能看日志推进到哪一步了。
     * 关键字按出现顺序映射成百分比，只增不减。
     */
    let percent = 0
    let doneTimer: NodeJS.Timeout | undefined
    const bump = (phase: string, p: number): void => {
      if (p <= percent) return
      percent = p
      console.log('[launch-progress]', versionId, phase, p + '%')
      send(IPC.evLaunchProgress, { versionId, launchId, phase, percent: p } as LaunchProgress)
      if (p >= 92 && !doneTimer) {
        doneTimer = setTimeout(() => bump('已经进主菜单了', 100), 4000)
        doneTimer.unref?.()
      }
    }
    const STAGES: [RegExp, string, number][] = [
      [/Setting user/i, '初始化游戏', 25],
      [/Backend library: LWJGL/i, '加载图形后端', 45],
      [/Reloading ResourceManager/i, '加载资源包', 62],
      [/Created: .*atlas/i, '构建贴图', 78],
      [/Sound engine started/i, '声音引擎就绪', 92],
      [/Narrator library/i, '准备进主菜单', 96]
    ]
    bump('准备启动', 5)
    const s = await getSettings()
    const accounts = await listAccounts()
    let acc = accounts.find((a) => a.id === accountId) ?? (await activeAccount())
    if (!acc) throw new Error('还没有账号，先添加一个')
    if (acc.type === 'microsoft') acc = await ensureFreshAccount(acc.id, s.msaClientId)

    // 实例级设置覆盖全局
    const vs = await getVersionSettings(versionId)
    const eff = {
      ...s,
      maxMemory: vs.maxMemory ?? s.maxMemory,
      minMemory: vs.minMemory ?? s.minMemory,
      jvmArgs: vs.jvmArgs ?? s.jvmArgs,
      gameArgs: vs.gameArgs ?? s.gameArgs,
      fullscreen: vs.fullscreen ?? s.fullscreen,
      javaPath: vs.javaPath ?? s.javaPath
    }
    s.maxMemory = eff.maxMemory
    s.minMemory = eff.minMemory
    s.jvmArgs = eff.jvmArgs
    s.gameArgs = eff.gameArgs
    s.fullscreen = eff.fullscreen
    s.javaPath = eff.javaPath

    // 外置登录：续期 token + 准备 authlib-injector
    let authlibInjector: string | undefined
    if (acc.type === 'authlib') {
      if (!acc.apiUrl) throw new Error('外置账号缺少服务器地址')
      try {
        acc = await refreshAuthlib(acc)
        send(IPC.evLog, { stream: 'launcher', line: `外置登录令牌已刷新（${acc.serverName ?? acc.apiUrl}）`, ts: Date.now() } as LogLine)
      } catch (e) {
        send(IPC.evLog, { stream: 'launcher', line: `令牌续期失败，按已有令牌继续：${(e as Error).message}`, ts: Date.now() } as LogLine)
      }
      authlibInjector = await ensureAuthlibInjector()
    }

    const mark = await readInstalledMark(versionId)
    if (!mark) throw new Error(`版本 ${versionId} 还没安装`)
    const vj = await getResolvedVersionJson(versionId)
    const major = vj.javaVersion?.majorVersion ?? 17

    let java = null as Awaited<ReturnType<typeof listJava>>[number] | null
    if (s.javaPath) {
      const info = await probeJava(s.javaPath)
      java = { path: s.javaPath, version: info.version, major: info.major, source: 'custom' }
    } else {
      java = await findJava(major)
    }
    if (!java) throw new Error(`找不到可用的 Java ${major}，请在设置里指定，或先下载 Java 运行时`)
    if (java.major < major) throw new Error(`Java 版本太低（需要 ${major}，当前 ${java.major}）`)

    ensureGameDirs()
    bump('启动 Java 进程', 15)
    const handle = await launchGame({
      versionId,
      account: acc,
      settings: s,
      java,
      authlibInjector,
      onLog: (l) => {
        send(IPC.evLog, l)
        // 只在游戏自己的输出里找阶段关键字，别把启动器的日志算进去
        if (l.stream !== 'stdout' && l.stream !== 'stderr') return
        for (const [re, phase, p] of STAGES) {
          if (re.test(l.line)) {
            bump(phase, p)
            break
          }
        }
      },
      onExit: (code) => {
        launches.delete(launchId)
        if (doneTimer) clearTimeout(doneTimer)
        // 被信号终止时没有数字退出码；保留 null，不把主动停止误报为崩溃。
        publishLaunchStatus({ running: false, versionId, launchId, exitCode: code })
      }
    })
    launches.set(launchId, { versionId, handle })
    publishLaunchStatus({ running: true, versionId, launchId, pid: handle.child.pid, startedAt: Date.now() })
    void bumpLaunchCount(versionId)
    if (s.closeOnLaunch) mainWindow?.minimize()
    return launchId
  }

  ipcMain.handle(IPC.launchStop, async (_e, launchId?: string) => {
    if (launchId) {
      launches.get(launchId)?.handle.stop()
      return
    }
    // 不传就是全部停
    for (const item of launches.values()) item.handle.stop()
  })
  ipcMain.handle(IPC.launchStatus, () => [...launchStatuses.values()])

  // ---- mods ----
  ipcMain.handle(IPC.modsList, async (_e, versionId: string): Promise<ModFile[]> => {
    const s = await getSettings()
    const dir = s.versionIsolation ? join(P.versionDir(assertSafeVersionId(versionId)), 'mods') : join(P.root, 'mods')
    if (!existsSync(dir)) return []
    const items = await fs.readdir(dir, { withFileTypes: true })
    const out: ModFile[] = []
    for (const it of items) {
      if (!it.isFile() || !it.name.toLowerCase().endsWith('.jar')) continue
      const full = join(dir, it.name)
      const st = await fs.stat(full).catch(() => null)
      out.push({ name: it.name, size: st?.size ?? 0, path: full })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  })
  ipcMain.handle(IPC.modsOpen, async (_e, versionId: string) => {
    const s = await getSettings()
    const dir = s.versionIsolation ? join(P.versionDir(assertSafeVersionId(versionId)), 'mods') : join(P.root, 'mods')
    await fs.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })

  // ---- 模组加载器 ----
  ipcMain.handle(IPC.loaderList, async (_e, type: string, mcVersion: string) => listLoaderVersions(type as LoaderType, mcVersion))
  ipcMain.handle(IPC.loaderInstalled, async () => listInstalledLoaders())
  ipcMain.handle(IPC.loaderInstall, async (_e, type: string, mcVersion: string, loaderVersion: string) => {
    if (installState.running) throw new Error('已经有安装任务在进行')
    installState = { running: true, taskId: randomUUID(), cancelled: false }
    const taskId = installState.taskId
    const s = await getSettings()
    setSourceLabel(await ensureEffectiveSource())
    try {
      const r = await installLoader(type as LoaderType, mcVersion, loaderVersion, {
        taskId,
        onProgress: emitProgress,
        isCancelled: () => installState.cancelled,
        concurrency: s.downloadConcurrency
      })
      send(IPC.evProgress, { taskId, phase: '完成', current: 1, total: 1, bytesDone: 0, bytesTotal: 0, finished: true })
      return r
    } catch (e) {
      send(IPC.evProgress, { taskId, phase: '失败', current: 0, total: 0, bytesDone: 0, bytesTotal: 0, finished: true, error: (e as Error).message })
      throw e
    } finally {
      installState.running = false
    }
  })

  // ---- 社区资源（Modrinth） ----
  ipcMain.handle(IPC.resSearch, async (_e, opts: SearchOptions) => searchResources(opts))
  ipcMain.handle(IPC.resVersions, async (_e, projectId: string, mcVersion?: string, loader?: string) => getResourceVersions(projectId, mcVersion, loader))
  ipcMain.handle(IPC.resDownload, async (_e, opts: { type: ResourceType; file: { name: string; url: string; size: number; sha1?: string }; versionId?: string }) => {
    // 渲染进程传来的地址只允许 Modrinth 的 CDN，避免被拿去请求内网或本地文件
    let host = ''
    try {
      const u = new URL(opts.file.url)
      if (u.protocol !== 'https:') throw new Error('只允许 https 下载地址')
      host = u.hostname.toLowerCase()
    } catch (e) {
      throw new Error(`下载地址不合法：${(e as Error).message}`)
    }
    const allow = host === 'cdn.modrinth.com' || host === 'github.com' || host.endsWith('.githubusercontent.com') || host === 'api.modrinth.com'
    if (!allow) throw new Error(`拒绝从 ${host} 下载（只允许 Modrinth / GitHub 的地址）`)
    return downloadResource({
      type: opts.type,
      file: opts.file,
      versionId: opts.versionId ? assertSafeVersionId(opts.versionId) : undefined,
      onProgress: (n) => {
        void n
      }
    })
  })

  // 整合包：下载 .mrpack 后直接安装（装原版 + 加载器 + 文件 + overrides）
  ipcMain.handle(IPC.resSearchMcmod, async (_e, query: string, limit?: number) => searchMcmod(query, limit))

  ipcMain.handle(IPC.resInstallModpack, async (_e, projectId: string, mcVersion?: string) => {
    if (installState.running) throw new Error('已经有安装任务在进行')
    installState = { running: true, taskId: randomUUID(), cancelled: false }
    const taskId = installState.taskId
    const s = await getSettings()
    setSourceLabel(await ensureEffectiveSource())
    try {
      const versions = await getResourceVersions(projectId, mcVersion)
      const v = versions[0]
      if (!v) throw new Error('这个整合包没有可用版本')
      const file = v.files[0]
      if (!file) throw new Error('整合包版本里没有可下载文件')

      const dir = join(P.root, 'installers')
      await fs.mkdir(dir, { recursive: true })
      const jar = join(dir, file.name.replace(/[\\/:*?"<>|]/g, '_'))
      emitProgress({ taskId, phase: '下载整合包', current: 0, total: 1, bytesDone: 0, bytesTotal: file.size, currentFile: file.name, finished: false })
      await downloadFile(file.url, jar, {
        size: file.size,
        sha1: file.sha1,
        retries: 3,
        timeout: 600000,
        onBytes: (n) => emitProgress({ taskId, phase: '下载整合包', current: 0, total: 1, bytesDone: n, bytesTotal: file.size, currentFile: file.name, finished: false })
      })

      const r = await installModpack(jar, {
        taskId,
        onProgress: emitProgress,
        isCancelled: () => installState.cancelled,
        concurrency: s.downloadConcurrency
      })
      send(IPC.evProgress, { taskId, phase: '完成', current: 1, total: 1, bytesDone: 0, bytesTotal: 0, finished: true })
      return r
    } catch (e) {
      send(IPC.evProgress, { taskId, phase: '失败', current: 0, total: 0, bytesDone: 0, bytesTotal: 0, finished: true, error: (e as Error).message })
      throw e
    } finally {
      installState.running = false
    }
  })

  // ---- 存档 ----
  ipcMain.handle(IPC.worldsList, async (_e, versionId?: string, isolated?: boolean) => {
    const s = await getSettings()
    return listWorlds(versionId, isolated ?? s.versionIsolation)
  })
  ipcMain.handle(IPC.worldsOpen, async (_e, versionId?: string, isolated?: boolean) => {
    const s = await getSettings()
    const dir =
      versionId && (isolated ?? s.versionIsolation) ? join(P.versionDir(assertSafeVersionId(versionId)), 'saves') : join(P.root, 'saves')
    const safeDir = assertInsideData(dir, '打开')
    await fs.mkdir(safeDir, { recursive: true })
    const error = await shell.openPath(safeDir)
    if (error) throw new Error(`无法打开存档文件夹：${error}`)
  })
  ipcMain.handle(IPC.worldsDelete, async (_e, p: string) => {
    await deleteWorld(assertInsideData(p, '删除'))
  })

  // ---- 服务器列表（servers.dat） ----
  ipcMain.handle(IPC.serversList, async (_e, versionId?: string, isolated?: boolean) => {
    const s = await getSettings()
    return listServers(versionId, isolated ?? s.versionIsolation)
  })
  ipcMain.handle(IPC.serversAdd, async (_e, versionId: string | undefined, isolated: boolean, entry: ServerEntry) => {
    const s = await getSettings()
    return addServer(versionId, isolated ?? s.versionIsolation, entry)
  })
  ipcMain.handle(IPC.serversRemove, async (_e, versionId: string | undefined, isolated: boolean, ip: string) => {
    const s = await getSettings()
    return removeServer(versionId, isolated ?? s.versionIsolation, ip)
  })

  // ---- CurseForge：mod / 资源包 / 光影 / 整合包 ----
  ipcMain.handle(IPC.cfSearch, async (_e, opts: { type: string; query: string; mcVersion?: string; loader?: string; index?: number }) => {
    const s = await getSettings()
    return searchCfProjects({ ...opts, apiKey: s.curseforgeApiKey ?? '' })
  })
  ipcMain.handle(IPC.cfFiles, async (_e, projectId: number, mcVersion?: string, loader?: string) => {
    const s = await getSettings()
    return listCfFiles({ projectId, apiKey: s.curseforgeApiKey ?? '', mcVersion, loader })
  })
  ipcMain.handle(IPC.cfDownload, async (_e, type: string, file: WorldMapFile, versionId?: string) => {
    if (!file.downloadUrl) throw new Error('这个文件没有下载地址')
    const s = await getSettings()
    const dir = targetDirFor(type as ResourceType, versionId ? join(P.versions, assertSafeVersionId(versionId)) : undefined)
    ensureDir(dir)
    const dest = join(dir, file.fileName.replace(/[\\/:*?"<>|]/g, '_'))
    await downloadFile(file.downloadUrl, dest, { size: file.size || undefined, retries: 3, timeout: 300000 })
    void s
    return { file: dest, dir }
  })
  ipcMain.handle(IPC.cfInstallModpack, async (_e, projectId: number, fileId: number) => {
    if (installState.running) throw new Error('已经有安装任务在进行')
    installState = { running: true, taskId: randomUUID(), cancelled: false }
    const taskId = installState.taskId
    const s = await getSettings()
    try {
      return await installCfModpack({
        projectId,
        fileId,
        apiKey: s.curseforgeApiKey ?? '',
        ctx: {
          taskId,
          isCancelled: () => installState.cancelled,
          onProgress: (p) => emitProgress(p)
        }
      })
    } finally {
      installState.running = false
    }
  })
  ipcMain.handle(IPC.mapSearch, async (_e, query: string, index?: number) => {
    const s = await getSettings()
    return searchWorldMaps(query ?? '', s.curseforgeApiKey ?? '', index ?? 0)
  })
  ipcMain.handle(IPC.mapFiles, async (_e, modId: number, gameVersion?: string) => {
    const s = await getSettings()
    return listWorldMapFiles(modId, s.curseforgeApiKey ?? '', gameVersion)
  })
  ipcMain.handle(IPC.mapDownload, async (_e, _modId: number, file: WorldMapFile, versionId?: string) => {
    const s = await getSettings()
    return downloadWorldMap({
      file,
      versionId: versionId ? assertSafeVersionId(versionId) : undefined,
      isolated: s.versionIsolation
    })
  })
  ipcMain.handle(IPC.mapImport, async (_e, versionId?: string) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: '地图包（zip）', extensions: ['zip'] }]
    })
    const picked = r.canceled ? null : r.filePaths[0]
    if (!picked) return null
    const s = await getSettings()
    return importWorldZip(picked, versionId ? assertSafeVersionId(versionId) : undefined, s.versionIsolation)
  })

  // ---- 收藏 ----
  ipcMain.handle(IPC.favList, async () => listFavorites())
  ipcMain.handle(IPC.favAdd, async (_e, item: FavoriteItem) => addFavorite(item))
  ipcMain.handle(IPC.favRemove, async (_e, id: string) => removeFavorite(id))

  // ---- 实例（版本）管理 ----
  ipcMain.handle(IPC.instComponents, async (_e, versionId: string) => describeComponents(versionId))
  ipcMain.handle(IPC.instFiles, async (_e, versionId: string, kind: InstanceFileKind) => {
    const s = await getSettings()
    return listInstanceFiles(versionId, kind, s.versionIsolation)
  })
  ipcMain.handle(IPC.instStats, async (_e, versionId: string) => instanceStats(versionId))
  ipcMain.handle(IPC.instToggle, async (_e, p: string) => toggleInstanceFile(assertInsideData(p, '操作')))
  ipcMain.handle(IPC.instRetire, async (_e, versionId: string, kind: string) => retireComponent(assertSafeVersionId(versionId), kind))
  ipcMain.handle(IPC.instRename, async (_e, versionId: string, newId: string) => {
    const id = await renameInstance(versionId, newId)
    await migrateVersionData(versionId, id)
    return id
  })
  ipcMain.handle(IPC.instExport, async (_e, versionId: string) => {
    const dir = join(P.root, 'exports')
    await fs.mkdir(dir, { recursive: true })
    const target = join(dir, `${versionId}-${new Date().toISOString().slice(0, 10)}.zip`)
    return exportInstance(versionId, target)
  })
  ipcMain.handle(IPC.instImport, async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: '实例包', extensions: ['zip'] }]
    })
    const file = r.canceled ? null : r.filePaths[0]
    if (!file) return null
    return importInstance(file)
  })
  ipcMain.handle(IPC.instSettingsGet, async (_e, versionId: string) => getVersionSettings(versionId))
  ipcMain.handle(IPC.instSettingsSet, async (_e, versionId: string, patch: Partial<VersionSettings>) => setVersionSettings(versionId, patch))
  ipcMain.handle(IPC.instOpenFolder, async (_e, versionId: string, kind?: InstanceFileKind | 'root') => {
    const s = await getSettings()
    const base = s.versionIsolation ? P.versionDir(assertSafeVersionId(versionId)) : P.root
    // kind 也是从渲染进程来的裸字符串，所以校验拼完之后的最终路径，一并挡住 ../ 逃逸
    const dir = assertInsideData(!kind || kind === 'root' ? base : join(base, kind), '打开')
    await fs.mkdir(dir, { recursive: true })
    const error = await shell.openPath(dir)
    if (error) throw new Error(`无法打开实例文件夹：${error}`)
  })
  ipcMain.handle(IPC.instDeleteFiles, async (_e, paths: string[]) => {
    // 整批先校验再动手：不要校验到一半才发现越界，那时前面几个已经删掉了
    const targets = paths.map((p) => assertInsideData(p, '删除'))
    for (const p of targets) {
      if (!existsSync(p)) continue
      await fs.rm(p, { recursive: true, force: true })
    }
  })

  // ---- 陶瓦联机（Terracotta）----
  ipcMain.handle(IPC.mpStatus, async (): Promise<TerracottaStatus> => {
    const info = terracotta.runtimeInfo()
    const meta = info ? await terracotta.currentMeta() : null
    const version = terracotta.installedVersion()
    return {
      agreedAt: readMpAgreed(),
      installed: Boolean(version),
      version,
      running: Boolean(info),
      attached: Boolean(info?.attached),
      meta
    }
  })
  ipcMain.handle(IPC.mpAgree, async () => {
    await fs.mkdir(terracotta.terracottaDir(), { recursive: true })
    await fs.writeFile(mpAgreeFile(), JSON.stringify({ agreedAt: Date.now() }, null, 2), 'utf8')
    return true
  })
  ipcMain.handle(IPC.mpInstall, async () => {
    const task = { taskId: randomUUID(), phase: '陶瓦联机', current: 0, total: 1 }
    emitProgress({ ...task, bytesDone: 0, bytesTotal: 0, finished: false })
    try {
      const r = await terracotta.installTerracotta((done, total) => {
        emitProgress({ ...task, bytesDone: done, bytesTotal: total, finished: false })
      })
      emitProgress({ ...task, current: 1, bytesDone: 0, bytesTotal: 0, finished: true })
      return r
    } catch (e) {
      emitProgress({ ...task, bytesDone: 0, bytesTotal: 0, finished: true, error: (e as Error).message })
      throw e
    }
  })
  ipcMain.handle(IPC.mpStart, async () => {
    await terracotta.ensureRunning()
  })
  ipcMain.handle(IPC.mpHost, async () => {
    await terracotta.hostRoom((await activeAccount())?.name ?? '')
  })
  ipcMain.handle(IPC.mpJoin, async (_e, room: string) => {
    await terracotta.joinRoom(String(room ?? ''), (await activeAccount())?.name ?? '')
  })
  ipcMain.handle(IPC.mpLeave, async () => {
    await terracotta.leaveRoom()
  })
  ipcMain.handle(IPC.mpStop, async () => {
    await terracotta.stopTerracotta()
  })
  ipcMain.handle(IPC.mpState, async () => terracotta.getState())
  ipcMain.handle(IPC.mpLog, async () => terracotta.getLog())
  ipcMain.handle(IPC.mpOpenDir, async () => {
    const dir = terracotta.terracottaDir()
    await fs.mkdir(dir, { recursive: true })
    const error = await shell.openPath(dir)
    if (error) throw new Error(`无法打开陶瓦联机目录：${error}`)
  })

  // ---- shell ----
  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('只允许打开 http(s) 链接')
    await shell.openExternal(url)
  })
  ipcMain.handle(IPC.openPath, async (_e, p: string) => {
    const error = await shell.openPath(assertInsideData(p, '打开'))
    if (error) throw new Error(`无法打开路径：${error}`)
  })

  // ---- 窗口控制 ----
  ipcMain.on(IPC.windowMin, () => mainWindow?.minimize())
  ipcMain.on(IPC.windowMax, () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on(IPC.windowClose, () => mainWindow?.close())
}

const gotLock = app.requestSingleInstanceLock()
bootLog(`singleInstanceLock=${gotLock}`)
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    bootLog('whenReady')
    await registerIpc()
    bootLog('ipc registered')
    createWindow()
    bootLog('window created')
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((e: Error) => {
    bootLog(`whenReady failed: ${e?.stack ?? e}`)
  })

  app.on('before-quit', () => {
    // 联机服务是本启动器拉起来的，退出时顺手停掉（附着的别人的实例不动）
    void terracotta.stopTerracotta()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

export { dirSize }
