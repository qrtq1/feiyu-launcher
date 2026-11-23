import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Account, DownloadProgress, LaunchProgress, LaunchStatus, LocalVersion, LogLine, Settings } from '../../shared/types'

type Page = 'home' | 'downloads' | 'multiplayer' | 'accounts' | 'settings' | 'instance'

interface Toast {
  id: number
  kind: 'info' | 'ok' | 'err'
  text: string
}

interface AppCtx {
  page: Page
  setPage: (p: Page) => void
  /** 下载页当前选中的分类（把「版本库」并进下载页后，别处可以直接跳过去） */
  downloadsTab: string
  setDownloadsTab: (tab: string) => void
  settings: Settings | null
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  accounts: Account[]
  active: Account | null
  reloadAccounts: () => Promise<void>
  localVersions: LocalVersion[]
  reloadLocal: () => Promise<void>
  selectedVersion: string
  setSelectedVersion: (id: string) => void
  pinnedVersions: string[]
  togglePin: (id: string) => void
  launching: boolean
  stopping: boolean
  launchError: string | null
  /** 每个实例的启动过程进度（versionId → 进度） */
  launchProgress: Record<string, LaunchProgress>
  progress: DownloadProgress | null
  installing: boolean
  installVersion: (id: string) => Promise<void>
  cancelInstall: () => Promise<void>
  status: LaunchStatus
  /** 每个实例各自的运行状态（多开时用） */
  statuses: Record<string, LaunchStatus>
  logs: (LogLine & { id: number })[]
  clearLogs: () => void
  launch: (versionId: string, accountId: string) => Promise<void>
  stop: (launchId?: string) => Promise<void>
  toast: (text: string, kind?: Toast['kind']) => void
  toasts: Toast[]
  logOpen: boolean
  setLogOpen: (v: boolean) => void
  instanceId: string
  openInstance: (id: string) => void
}

const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp 必须在 AppProvider 内使用')
  return c
}

const MAX_LOGS = 1500
const SELECTED_KEY = 'feiyu.selected-instance'
const PINS_KEY = 'feiyu.pinned-instances'

function readPreference(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') }
  catch { return null }
}

function writePreference(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) }
  catch { /* UI still works when storage is unavailable. */ }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<Page>('home')
  const [downloadsTab, setDownloadsTab] = useState<string>('mod')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [active, setActive] = useState<Account | null>(null)
  const [localVersions, setLocalVersions] = useState<LocalVersion[]>([])
  const [selectedVersion, setSelectedVersion] = useState(() => {
    const saved = readPreference(SELECTED_KEY)
    return typeof saved === 'string' ? saved : ''
  })
  const [pinnedVersions, setPinnedVersions] = useState<string[]>(() => {
    const saved = readPreference(PINS_KEY)
    return Array.isArray(saved) ? [...new Set(saved.filter((id): id is string => typeof id === 'string'))] : []
  })
  const [launching, setLaunching] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [installing, setInstalling] = useState(false)
  const [status, setStatus] = useState<LaunchStatus>({ running: false })
  /** 每个实例的启动状态（支持多开） */
  const [statuses, setStatuses] = useState<Record<string, LaunchStatus>>({})
  const [launchProgress, setLaunchProgress] = useState<Record<string, LaunchProgress>>({})
  const [logs, setLogs] = useState<(LogLine & { id: number })[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [instanceId, setInstanceId] = useState('')
  const toastId = useRef(0)
  const logSeq = useRef(0)
  const installBusy = useRef(false)
  const stoppingIds = useRef<Set<string>>(new Set())
  /** 正在启动中的 versionId，防止同一个实例被连点两次起两个进程 */
  const launchingIds = useRef<Set<string>>(new Set())
  const statusReceived = useRef(false)

  useEffect(() => writePreference(SELECTED_KEY, selectedVersion), [selectedVersion])
  useEffect(() => writePreference(PINS_KEY, pinnedVersions), [pinnedVersions])

  const togglePin = useCallback((id: string) => {
    setPinnedVersions((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id])
  }, [])

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const reloadAccounts = useCallback(async () => {
    const [list, act] = await Promise.all([window.api.accounts.list(), window.api.accounts.active()])
    setAccounts(list)
    setActive(act)
  }, [])

  const reloadLocal = useCallback(async () => {
    const list = await window.api.versions.local()
    setLocalVersions(list)
    setSelectedVersion((prev) => {
      if (prev && list.some((v) => v.id === prev)) return prev
      return list.find((v) => v.complete)?.id ?? list[0]?.id ?? ''
    })
  }, [])

  useEffect(() => {
    void (async () => {
      const s = await window.api.settings.get()
      setSettings(s)
      await Promise.all([reloadAccounts(), reloadLocal()])
      const st = await window.api.launch.status()
      if (!statusReceived.current) {
        const map: Record<string, LaunchStatus> = {}
        for (const item of st) if (item.launchId) map[item.launchId] = item
        setStatuses(map)
        const firstRunning = st.find((item) => item.running)
        if (firstRunning) setStatus(firstRunning)
      }
    })().catch((e) => toast(`读取启动器数据失败：${(e as Error).message}`, 'err'))
  }, [reloadAccounts, reloadLocal, toast])

  useEffect(() => {
    const off1 = window.api.onProgress((p) => {
      setProgress(p)
      if (p.finished) {
        setInstalling(false)
        if (p.error) toast(`安装失败：${p.error}`, 'err')
        else if (p.phase === '已取消') toast('已取消安装')
        else void reloadLocal()
      } else {
        setInstalling(true)
      }
    })
    const off2 = window.api.onLog((l) => {
      const line = { ...l, id: ++logSeq.current }
      setLogs((prev) => (prev.length >= MAX_LOGS ? [...prev.slice(-MAX_LOGS + 1), line] : [...prev, line]))
    })
    const off3 = window.api.onStatus((s) => {
      statusReceived.current = true
      if (s.launchId) setStatuses((prev) => ({ ...prev, [s.launchId!]: s }))
      setStatus(s)
      if (s.running) return
      // 进程退出就把这个实例的启动进度清掉
      if (s.versionId) {
        setLaunchProgress((prev) => {
          const next = { ...prev }
          delete next[s.versionId!]
          return next
        })
      }
      if (s.launchId && stoppingIds.current.has(s.launchId)) {
        stoppingIds.current.delete(s.launchId)
        setStopping(stoppingIds.current.size > 0)
        toast('已停止游戏')
      } else if (s.exitCode === 0) {
        toast('游戏已退出')
      } else if (s.versionId) {
        const text = s.exitCode == null ? '游戏进程意外终止' : `游戏异常退出（退出码 ${s.exitCode}）`
        setLaunchError(text)
        toast(text, 'err')
      }
    })
    const off4 = window.api.onLaunchProgress((p) => {
      setLaunchProgress((prev) => ({ ...prev, [p.versionId]: p }))
    })
    return () => {
      off1()
      off2()
      off3()
      off4()
    }
  }, [reloadLocal, toast])

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = await window.api.settings.set(patch)
      setSettings(next)
      if (patch.gameDir || patch.versionsDir !== undefined || patch.versionIsolation !== undefined || patch.extraVersionDirs) void reloadLocal()
    },
    [reloadLocal]
  )

  const installVersion = useCallback(
    async (id: string) => {
      if (installBusy.current) return
      installBusy.current = true
      setInstalling(true)
      setProgress({ taskId: '', phase: '准备中', current: 0, total: 1, bytesDone: 0, bytesTotal: 0, finished: false })
      try {
        await window.api.versions.install(id)
        toast(`版本 ${id} 安装完成`, 'ok')
        await reloadLocal()
        setSelectedVersion(id)
      } catch (e) {
        toast(`安装失败：${(e as Error).message}`, 'err')
      } finally {
        installBusy.current = false
        setInstalling(false)
      }
    },
    [reloadLocal, toast]
  )

  const cancelInstall = useCallback(async () => {
    await window.api.versions.cancelInstall()
    toast('正在取消……')
  }, [toast])

  const launch = useCallback(
    async (versionId: string, accountId: string) => {
      // per-实例防重入：同一瞬间连点两次也只会起一个进程
      if (launchingIds.current.has(versionId) || stoppingIds.current.has(versionId)) return
      launchingIds.current.add(versionId)
      setLaunching(true)
      setLaunchError(null)
      setLogs([])
      try {
        await window.api.launch.start(versionId, accountId)
      } catch (e) {
        const message = (e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
        const text = `启动失败：${message}`
        setLaunchError(text)
        setLogs((prev) => [...prev.slice(-MAX_LOGS + 1), { stream: 'launcher', line: text, ts: Date.now(), id: ++logSeq.current }])
        toast(text, 'err')
      } finally {
        launchingIds.current.delete(versionId)
        setLaunching(launchingIds.current.size > 0)
      }
    },
    [toast]
  )

  const stop = useCallback(
    async (launchId?: string) => {
      const target = launchId ?? status.launchId
      if (!target || stoppingIds.current.has(target)) return
      stoppingIds.current.add(target)
      setStopping(true)
      try {
        await window.api.launch.stop(target)
      } catch (e) {
        stoppingIds.current.delete(target)
        setStopping(stoppingIds.current.size > 0)
        toast(`无法停止游戏：${(e as Error).message}`, 'err')
      }
    },
    [status.launchId, toast]
  )

  const clearLogs = useCallback(() => setLogs([]), [])
  const openInstance = useCallback((id: string) => {
    setInstanceId(id)
    setPage('instance')
  }, [])

  const value = useMemo<AppCtx>(
    () => ({
      page,
      setPage,
      downloadsTab,
      setDownloadsTab,
      settings,
      saveSettings,
      accounts,
      active,
      reloadAccounts,
      localVersions,
      reloadLocal,
      selectedVersion,
      setSelectedVersion,
      pinnedVersions,
      togglePin,
      launching,
      stopping,
      launchError,
      launchProgress,
      progress,
      installing,
      installVersion,
      cancelInstall,
      status,
      statuses,
      logs,
      clearLogs,
      launch,
      stop,
      toast,
      toasts,
      logOpen,
      setLogOpen,
      instanceId,
      openInstance
    }),
    [
      page,
      downloadsTab,
      settings,
      saveSettings,
      accounts,
      active,
      reloadAccounts,
      localVersions,
      reloadLocal,
      selectedVersion,
      pinnedVersions,
      togglePin,
      launching,
      stopping,
      launchError,
      launchProgress,
      progress,
      installing,
      installVersion,
      cancelInstall,
      status,
      statuses,
      logs,
      clearLogs,
      launch,
      stop,
      toast,
      toasts,
      logOpen,
      instanceId,
      openInstance
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
