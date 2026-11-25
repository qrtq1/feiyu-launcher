import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { LaunchStatus } from '../../shared/types'
import { AppProvider, useApp } from './store'
import { Icon, Logo, ProgressBar, Spinner } from './components/ui'
import Home from './pages/Home'
import Downloads from './pages/Downloads'
import Accounts from './pages/Accounts'
import SettingsPage from './pages/Settings'
import InstancePage from './pages/Instance'
import Multiplayer from './pages/Multiplayer'

function TitleBar() {
  return (
    <header className="titlebar">
      <div className="tb-left">
        <span className="tb-mark"><Logo size={21} /></span>
        <span className="tb-title">肥鱼启动器</span>
      </div>
      <TopNavigation />
      <div className="tb-drag" />
      <div className="tb-btns">
        <button className="tb-btn" onClick={() => window.api.window.minimize()} aria-label="最小化">
          <Icon name="minus" size={14} />
        </button>
        <button className="tb-btn" onClick={() => window.api.window.toggleMaximize()} aria-label="最大化">
          <Icon name="square" size={12} />
        </button>
        <button className="tb-btn close" onClick={() => window.api.window.close()} aria-label="关闭">
          <Icon name="x" size={14} />
        </button>
      </div>
    </header>
  )
}

function TopNavigation() {
  const { page, setPage, status, installing } = useApp()
  const items = [
    { id: 'home', icon: 'play', label: '启动' },
    { id: 'downloads', icon: 'download', label: '下载' },
    { id: 'multiplayer', icon: 'globe', label: '联机' },
    { id: 'accounts', icon: 'user', label: '账号' },
    { id: 'settings', icon: 'settings', label: '设置' }
  ] as const
  return (
    <nav className="top-nav" aria-label="主导航">
      {items.map(({ id, icon, label }) => {
        const current = page === id || (page === 'instance' && id === 'home')
        return (
          <button key={id} className="top-nav-item" data-page={id} aria-current={current ? 'page' : undefined} onClick={() => setPage(id)}>
            <Icon name={icon} size={16} />
            <span>{label}</span>
            {(id === 'downloads' && installing || id === 'home' && status.running) && <span className="top-nav-dot" aria-hidden="true" />}
          </button>
        )
      })}
    </nav>
  )
}

function StatusBar() {
  const { status, statuses, progress, installing, launching, stopping, logOpen, setLogOpen } = useApp()
  const [now, setNow] = useState(Date.now())
  const runningList = Object.entries(statuses).filter(([, s]) => s.running)
  const runningCount = runningList.length
  useEffect(() => {
    if (runningCount === 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [runningCount])

  // 多开时显示最早启动的那个的时长，并标出正在跑几个
  const first = runningList.reduce<LaunchStatus | null>((earliest, [, current]) => {
    if (!current.startedAt) return earliest
    return !earliest || current.startedAt < (earliest.startedAt ?? 0) ? current : earliest
  }, null) ?? (status.running ? status : null)
  const elapsed = first?.startedAt ? Math.max(0, Math.floor((now - first.startedAt) / 1000)) : 0
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return (
    <div className="statusbar">
      <div className="sb-left">
        {stopping || launching ? (
          <span className="sb-state"><Spinner size={12} /> {stopping ? '正在停止游戏' : '正在准备启动'}</span>
        ) : runningCount > 0 ? (
          <span className="sb-state ok">
            <span className="pulse" /> 运行中 {runningCount > 1 ? `${runningCount} 个实例` : first?.versionId} · {mm}:{ss}
          </span>
        ) : installing && progress ? (
          <span className="sb-state">
            <Spinner size={12} /> {progress.phase} {progress.total > 0 ? `${progress.current}/${progress.total}` : ''}
          </span>
        ) : (
          <span className="sb-state muted">就绪</span>
        )}
      </div>
      {installing && progress && (
        <div className="sb-progress">
          <ProgressBar value={progress.bytesTotal > 0 ? progress.bytesDone : progress.current} max={progress.bytesTotal > 0 ? progress.bytesTotal : progress.total} />
        </div>
      )}
      <div className="sb-right">
        <button className={`sb-btn ${logOpen ? 'on' : ''}`} onClick={() => setLogOpen(!logOpen)} aria-expanded={logOpen}>
          <Icon name="terminal" size={14} /> 日志
        </button>
      </div>
    </div>
  )
}

function LogDrawer() {
  const { logs, logOpen, setLogOpen, clearLogs, status, toast } = useApp()
  const [onlyErr, setOnlyErr] = useState(false)
  const [follow, setFollow] = useState(true)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  const term = query.trim().toLowerCase()
  const isError = (l: (typeof logs)[number]) => l.stream === 'stderr' || /error|exception|失败|caused by/i.test(l.line)
  const shown = logOpen ? logs.filter((l) => (!onlyErr || isError(l)) && (!term || l.line.toLowerCase().includes(term))) : []

  async function copyLogs() {
    try {
      await navigator.clipboard.writeText(shown.map((l) => l.line).join('\n'))
      toast(`已复制 ${shown.length} 行日志`, 'ok')
    } catch {
      toast('复制失败，可选中日志手动复制', 'err')
    }
  }

  useEffect(() => {
    if (!follow) return
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs, term, onlyErr, follow, logOpen])

  if (!logOpen) return <></>

  return (
    <div className="logdrawer">
      <div className="ld-head">
        <div className="ld-title">
          <Icon name="terminal" size={15} /> 运行日志
          <span className="ld-count">{shown.length} 行</span>
          {status.running && <span className="ld-live">LIVE</span>}
        </div>
        <div className="ld-actions">
          <input className="input ld-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索日志" aria-label="搜索日志" />
          <label className="ld-check">
            <input type="checkbox" checked={onlyErr} onChange={(e) => setOnlyErr(e.target.checked)} /> 只看错误
          </label>
          <label className="ld-check">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> 跟随
          </label>
          <button className="ghost-btn" onClick={() => void copyLogs()} disabled={!shown.length}>复制结果</button>
          <button className="ghost-btn" onClick={clearLogs} disabled={!logs.length}>清空显示</button>
          <button className="icon-btn" onClick={() => setLogOpen(false)} aria-label="收起日志">
            <Icon name="chevron" size={16} style={{ transform: 'rotate(180deg)' }} />
          </button>
        </div>
      </div>
      <div className="ld-body" ref={boxRef} onWheel={() => setFollow(false)}>
        {shown.length === 0 && <div className="log-line muted">{logs.length ? '没有匹配的日志' : '暂无运行日志'}</div>}
        {shown.map((l, i) => (
          <div key={i} className={`log-line ${l.stream} ${isError(l) ? 'lvl-err' : ''}`}>
            {l.line}
          </div>
        ))}
      </div>
    </div>
  )
}

function Toasts() {
  const { toasts } = useApp()
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'ok' && <Icon name="check" size={14} />}
          {t.kind === 'err' && <Icon name="alert" size={14} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

function BackgroundLayer() {
  const { settings } = useApp()
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (!settings?.backgroundPath || settings.backgroundKind === 'none') {
      setSrc(null)
      return () => { alive = false }
    }
    void window.api.settings.resolveMedia(settings.backgroundPath).then((url) => {
      if (alive) setSrc(url)
    })
    return () => { alive = false }
  }, [settings?.backgroundPath, settings?.backgroundKind])

  if (!src) return null
  if (settings?.backgroundKind === 'video') {
    return <video className="app-background-media" src={src} autoPlay loop muted playsInline aria-hidden="true" />
  }
  if (settings?.backgroundKind === 'wallpaper') {
    return <iframe className="app-background-media app-background-frame" src={src} title="自定义动态壁纸" tabIndex={-1} />
  }
  return <img className="app-background-media" src={src} alt="" aria-hidden="true" />
}

function Shell() {
  const { page, settings } = useApp()
  return (
    <div className="app" style={settings?.accentColor ? { '--accent': settings.accentColor, '--accent-soft': `${settings.accentColor}18` } as CSSProperties : undefined}>
      <TitleBar />
      <div className="body">
        <BackgroundLayer />
        <div className="app-background-shade" />
        <main className="content">
          <div className="page-wrap" key={page}>
            {page === 'home' && <Home />}
            {page === 'downloads' && <Downloads />}
            {page === 'multiplayer' && <Multiplayer />}
            {page === 'accounts' && <Accounts />}
            {page === 'settings' && <SettingsPage />}
            {page === 'instance' && <InstancePage />}
          </div>
        </main>
      </div>
      <LogDrawer />
      <StatusBar />
      <Toasts />
    </div>
  )
}

export default function App() {
  // 让 CSS 知道在哪个平台：macOS 要留出红绿灯的位置、藏起自绘的窗口按钮
  useEffect(() => {
    let alive = true
    void window.api.platform()
      .then((p) => {
        if (alive) document.documentElement.dataset.os = p.os
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
