import { useEffect, useMemo, useRef, useState } from 'react'
import type { LaunchStatus, LocalVersion } from '../../../shared/types'
import { Icon, ProgressBar, Spinner } from '../components/ui'
import { useApp } from '../store'

const ACCOUNT_TYPES = {
  offline: '离线账号',
  microsoft: 'Microsoft 账号',
  authlib: '外置登录'
}

const VERSION_TYPES: Record<string, string> = {
  release: '正式版',
  snapshot: '快照版',
  old_beta: '旧版 Beta',
  old_alpha: '旧版 Alpha'
}

function versionType(version: LocalVersion): string {
  return version.hasFabric ? 'Fabric' : VERSION_TYPES[version.type] ?? '自定义版本'
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function GrassBlock() {
  return (
    <div className="home-block" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="30" height="30" shapeRendering="crispEdges">
        <path fill="#8dc36b" d="m3 9 13-6 13 6-13 6z" />
        <path fill="#a5d487" d="m8 9 5-2 5 2-5 2zm11 0 2-1 4 2-2 1z" />
        <path fill="#76543a" d="m3 9 13 6v14L3 23z" />
        <path fill="#523d2d" d="m29 9-13 6v14l13-6z" />
        <path fill="#6b9e51" d="m3 9 13 6v5l-4-2v2l-4-2v-2l-5-2z" />
        <path fill="#4b793e" d="m16 15 13-6v5l-4 2v2l-4 2v-2l-5 2z" />
        <path fill="#a17852" d="m5 18 3 1v3l-3-1zm6 4 3 1v2l-3-1z" />
        <path fill="#76543a" d="m18 22 3-1v3l-3 1zm6-3 3-1v2l-3 1z" />
      </svg>
    </div>
  )
}

export default function Home() {
  const {
    localVersions, selectedVersion, setSelectedVersion, pinnedVersions, togglePin,
    active, status, statuses, launchProgress, launch, stop, launching, stopping, launchError, installing, progress,
    setPage, setLogOpen, openInstance, toast, reloadLocal, setDownloadsTab, saveSettings
  } = useApp()
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [javaPrompt, setJavaPrompt] = useState<{ need: number; versionId: string; accountId: string } | null>(null)
  /** 启动器打开时先看一眼这台机器有没有 Java */
  const [noJava, setNoJava] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.api.java.list()
        setNoJava(list.length === 0)
      } catch {
        /* 探测失败就当有，别拿这个拦用户 */
      }
    })()
  }, [])
  const stopDialog = useRef<HTMLDialogElement>(null)
  /** 同一个实例可以开多份，这里数它现在跑了几个 */
  const runningOf = (id: string): LaunchStatus[] =>
    Object.values(statuses).filter((s) => s.running && s.versionId === id)
  const selectedRunningList = runningOf(selectedVersion)
  const selectedRunningCount = selectedRunningList.length
  const selectedRunning = selectedRunningCount > 0
  const anyRunning = Object.values(statuses).some((s) => s.running)
  const running = selectedRunning
  const pending = launching || stopping || (installing && !running)
  const selected = localVersions.find((version) => version.id === selectedVersion)

  useEffect(() => {
    if (!running) stopDialog.current?.close()
  }, [running])

  /** 停止按钮：把当前选中实例跑着的几份都停掉 */
  const stopSelected = async (): Promise<void> => {
    const list = [...runningOf(selectedVersion)]
    for (const s of list) {
      if (s.launchId) await stop(s.launchId)
    }
  }

  const refreshInstances = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await reloadLocal()
      toast('实例列表已刷新', 'ok')
    } catch (e) {
      toast(`刷新失败：${(e as Error).message}`, 'err')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !event.ctrlKey || event.isComposing) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, button')) return
      event.preventDefault()
      onMainClick()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const addFolder = async (): Promise<void> => {
    try {
      const r = await window.api.versions.addFolder()
      if (!r) return
      if (r.found > 0) toast(`已加入 ${r.dir}，扫到 ${r.found} 个实例`, 'ok')
      else toast(`已加入 ${r.dir}，但里面没找到实例（要求 <版本名>/<版本名>.json）`, 'err')
      await reloadLocal()
    } catch (e) {
      toast(`加入失败：${(e as Error).message}`, 'err')
    }
  }

  const current = selected
  const currentId = selected?.id
  const pins = useMemo(() => new Set(pinnedVersions), [pinnedVersions])
  const shown = useMemo(() => {
    const term = query.trim().toLowerCase()
    return localVersions
      .filter((version) => `${version.id} ${versionType(version)}`.toLowerCase().includes(term))
      .sort((a, b) => Number(pins.has(b.id)) - Number(pins.has(a.id)))
  }, [localVersions, pins, query])

  const actionLabel = stopping ? '正在停止…' : launching ? '正在启动…'
    : installing ? '正在安装…' : !selected?.complete ? (selected ? '前往安装' : '安装版本')
      : !active ? '添加账号' : selectedRunningCount > 0 ? `再开一份（已开 ${selectedRunningCount}）` : '启动游戏'
  const actionIcon = !selected?.complete ? 'download' : !active ? 'plus' : 'play'
  const progressMax = progress ? progress.bytesTotal > 0 ? progress.bytesTotal : progress.total : 0
  const progressValue = progress ? progress.bytesTotal > 0 ? progress.bytesDone : progress.current : 0

  // 主目录的实例和「加入的文件夹」里的实例分开显示
  const ownShown = useMemo(() => shown.filter((v) => !v.external), [shown])
  const externalGroups = useMemo(() => {
    const map = new Map<string, LocalVersion[]>()
    for (const v of shown) {
      if (!v.external) continue
      const dir = v.externalDir ?? '（来源未知）'
      const list = map.get(dir) ?? []
      list.push(v)
      map.set(dir, list)
    }
    return [...map.entries()]
  }, [shown])

  const renderInstance = (version: LocalVersion) => {
    const pinned = pins.has(version.id)
    const isSelected = selectedVersion === version.id
    const mine = runningOf(version.id)
    const isRunning = mine.length > 0
    // 停止按钮停「最近启动的那一份」
    const latest = [...mine].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]
    const meta = [versionType(version), version.javaVersion ? `Java ${version.javaVersion}` : '', version.sizeBytes ? fmtSize(version.sizeBytes) : ''].filter(Boolean)
    return (
      <li className={`home-instance${isSelected ? ' is-selected' : ''}`} key={version.id}>
        <button className="home-instance-select" onClick={() => setSelectedVersion(version.id)} aria-pressed={isSelected} title={version.id}>
          <span className={`home-instance-icon${version.hasFabric ? ' is-fabric' : version.type === 'snapshot' ? ' is-snapshot' : ''}`}>
            <Icon name="box" size={17} />
          </span>
          <span className="home-instance-details">
            <span className="home-instance-name">{version.id}</span>
            <span className="home-instance-meta">{meta.join(' · ')}</span>
          </span>
          {isRunning ? <span className="home-running home-row-state">运行中</span>
            : !version.complete && <span className="home-incomplete home-row-state">未完成</span>}
        </button>
        <div className="home-instance-tools">
          {isRunning && (
            <button
              className="icon-btn home-stop-btn"
              onClick={() => void stop(latest?.launchId)}
              title={mine.length > 1 ? `停止最近启动的那一份（共 ${mine.length} 份在跑）` : '停止这个实例'}
              aria-label={`停止 ${version.id}`}
            >
              <Icon name="stop" size={16} />
            </button>
          )}
          {mine.length > 1 && <span className="home-run-count">×{mine.length}</span>}
          <button className={`icon-btn home-pin${pinned ? ' is-pinned' : ''}`} onClick={() => togglePin(version.id)} aria-pressed={pinned} aria-label={`置顶 ${version.id}`} title={pinned ? '取消置顶' : '置顶实例'}>
            <Icon name="pin" size={16} />
          </button>
          <button className="icon-btn" onClick={() => void openFolder(version.id)} title="打开实例目录" aria-label={`打开 ${version.id} 的目录`}>
            <Icon name="folder" size={17} />
          </button>
          <button className="icon-btn" onClick={() => openInstance(version.id)} title="实例设置" aria-label={`${version.id} 的实例设置`}>
            <Icon name="settings" size={16} />
          </button>
        </div>
      </li>
    )
  }

  function onMainClick(): void {
    if (pending) return
    // 主按钮只负责「启动 / 再开一份」；停止在实例行里单独有按钮
    if (!selected?.complete) {
      setDownloadsTab('minecraft')
      setPage('downloads')
    } else if (!active) setPage('accounts')
    else void startWithJavaCheck(selected.id, active.id)
  }

  /** 启动前先确认有能用的 Java；没有就问用户要下载还是手动指定，绝不偷偷下载 */
  async function startWithJavaCheck(versionId: string, accountId: string): Promise<void> {
    const need = selected?.javaVersion ?? 17
    const hit = await window.api.java.detect(need)
    if (hit) {
      void launch(versionId, accountId)
      return
    }
    setJavaPrompt({ need, versionId, accountId })
  }

  /** 用户选「手动指定」：挑一个 java.exe，存进设置后直接用 */
  async function pickJavaForLaunch(): Promise<void> {
    const p = await window.api.settings.pickJava()
    if (!p) return
    await saveSettings({ javaPath: p })
    const target = javaPrompt
    setJavaPrompt(null)
    if (target) void launch(target.versionId, target.accountId)
  }

  /** 用户选「下载」：下载对应版本的运行时，成功后再启动 */
  async function downloadJavaForLaunch(): Promise<void> {
    if (!javaPrompt) return
    const need = javaPrompt.need
    toast(`开始下载 Java ${need}，可能要几分钟…`)
    try {
      await window.api.java.download('', need)
      const hit = await window.api.java.detect(need)
      if (!hit) throw new Error('下载完成但没检测到，去设置里手动指定试试')
      toast(`Java ${need} 已就绪`, 'ok')
      const target = javaPrompt
      setJavaPrompt(null)
      if (target) void launch(target.versionId, target.accountId)
    } catch (e) {
      toast(`下载失败：${(e as Error).message}`, 'err')
    }
  }

  async function openFolder(id: string): Promise<void> {
    try {
      await window.api.instance.openFolder(id, 'root')
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
      toast(message.startsWith('无法打开实例文件夹：') ? message : `无法打开实例目录：${message}`, 'err')
    }
  }

  return (
    <div className="home">
      <section className="home-launch" aria-label="游戏启动">
        <div className="home-launch-head">
          <GrassBlock />
          <div>
            <h2>Minecraft</h2>
            <span>Java 版</span>
          </div>
        </div>

        <div className="home-launch-body">
          <div className="home-launch-field">
            <div className="home-field-label">启动账号</div>
            <button className="home-account" onClick={() => setPage('accounts')}
              title={active ? `切换账号：${active.name}` : '添加账号'}
              aria-label={active ? `切换账号，当前账号：${active.name}` : '添加账号'}>
              <span className="home-account-icon"><Icon name="user" size={17} /></span>
              <span className="home-account-details">
                <strong>{active?.name ?? '未添加账号'}</strong>
                {active && <small>{ACCOUNT_TYPES[active.type]}</small>}
              </span>
              <Icon name={active ? 'chevron' : 'plus'} size={15} />
            </button>
          </div>
          <div className="home-launch-field">
            <div className="home-field-label">{running ? '运行实例' : '当前实例'}</div>
            <div className="home-launch-details">
              <span className="home-target-icon"><Icon name="box" size={17} /></span>
              <div className="home-target-text">
                <strong title={currentId}>{currentId ?? '尚未选择实例'}</strong>
                {(running || current) && (
                  <div className="home-launch-meta" role="status">
                    {running ? <span className="home-running">运行中</span> : <span>{current && versionType(current)}</span>}
                    {current?.javaVersion && <span>Java {current.javaVersion}</span>}
                    {!running && current && !current.complete && <span className="home-incomplete">安装未完成</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="home-launch-controls">
          {installing && progress && (
            <div className="home-install">
              <div className="home-install-label">
                <span>{progress.phase}</span>
                {progressMax > 0 && (
                  <span>{progress.bytesTotal > 0 ? `${fmtSize(progressValue)} / ${fmtSize(progressMax)}` : `${progressValue} / ${progressMax}`}</span>
                )}
              </div>
              <ProgressBar value={progressValue} max={progressMax} indeterminate={progressMax <= 0} />
            </div>
          )}
          {!installing && launchProgress[selectedVersion] && launchProgress[selectedVersion].percent < 100 && (
            <div className="home-install home-launch-progress">
              <div className="home-install-label">
                <span>{launchProgress[selectedVersion].phase}</span>
                <span>{launchProgress[selectedVersion].percent}%</span>
              </div>
              <ProgressBar value={launchProgress[selectedVersion].percent} max={100} />
            </div>
          )}
          <div className="home-action-row">
            <button className="home-action" onClick={onMainClick} disabled={pending}>
              {pending ? <Spinner size={19} /> : <Icon name={actionIcon} size={21} />}
              {actionLabel}
            </button>
            <button
              className="home-stop-action"
              disabled={selectedRunningCount === 0 || stopping}
              onClick={() => void stopSelected()}
              title={selectedRunningCount > 1 ? `停止 ${selected?.id} 的全部 ${selectedRunningCount} 份` : '停止这个实例'}
            >
              {stopping && selectedRunningCount > 0 ? <Spinner size={16} /> : <Icon name="stop" size={18} />}
              {selectedRunningCount > 1 ? `全停（${selectedRunningCount}）` : '停止'}
            </button>
          </div>
        </div>
      </section>

      <section className="home-library" aria-labelledby="home-library-title">
        <header className="home-library-head">
          <div className="home-library-title">
            <h1 id="home-library-title">本地实例</h1>
            <span className="home-count">{localVersions.length} 个</span>
          </div>
          <div className="home-library-tools">
            {localVersions.length > 0 && (
              <div className="search home-search" role="search">
                <Icon name="search" size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索实例" placeholder="搜索实例" />
                {query && (
                  <button className="icon-btn" type="button" onClick={() => setQuery('')} title="清除搜索" aria-label="清除搜索">
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            )}
            <button className="ghost-btn home-add" onClick={() => void refreshInstances()} disabled={refreshing} title="重新扫描当前版本目录">
              {refreshing ? <Spinner size={15} /> : <Icon name="refresh" size={16} />} 刷新
            </button>
            <button className="ghost-btn home-add" onClick={() => void addFolder()}>
              <Icon name="folder" size={16} /> 加入文件夹
            </button>
            <button className="ghost-btn home-add" onClick={() => { setDownloadsTab('minecraft'); setPage('downloads') }}>
              <Icon name="plus" size={16} /> 安装版本
            </button>
          </div>
        </header>

        {!running && !launching && !stopping && launchError && (
          <div className="home-error" role="alert">
            <Icon name="alert" size={16} />
            <span>{launchError}</span>
            <button className="ghost-btn" onClick={() => setLogOpen(true)}>查看日志</button>
          </div>
        )}

        {noJava && (
          <div className="home-error" role="alert">
            <Icon name="alert" size={16} />
            <span>这台电脑上没检测到 Java。可以自己指定一个 java.exe，或下载一份内置的（不下载也行）。</span>
            <button className="ghost-btn" onClick={() => setPage('settings')}>去设置</button>
          </div>
        )}

        {shown.length === 0 ? (
          <div className="home-empty">
            <Icon name={localVersions.length ? 'search' : 'box'} size={22} />
            <p>{localVersions.length ? '没有匹配的实例' : '还没有本地实例'}</p>
          </div>
        ) : (
          <>
            {ownShown.length > 0 && <ul className="home-list">{ownShown.map(renderInstance)}</ul>}
            {ownShown.length === 0 && externalGroups.length > 0 && (
              <div className="home-empty">
                <Icon name="folder" size={22} />
                <p>主目录里没有实例，下面这些来自你加入的文件夹</p>
              </div>
            )}
            {externalGroups.map(([dir, list]) => {
              const open = expanded[dir] !== false
              return (
                <section className="home-ext-group" key={dir}>
                  <button className="home-ext-head" onClick={() => setExpanded((prev) => ({ ...prev, [dir]: !open }))} aria-expanded={open}>
                    <Icon name="chevron" size={14} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
                    <span className="home-ext-path" title={dir}>{dir}</span>
                    <span className="home-ext-count">{list.length} 个</span>
                  </button>
                  {open && <ul className="home-list">{list.map(renderInstance)}</ul>}
                </section>
              )
            })}
          </>
        )}
      </section>

      {javaPrompt && (
        <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && setJavaPrompt(null)}>
          <div className="modal" style={{ width: 490 }}>
            <h3>需要一个 Java {javaPrompt.need}</h3>
            <p className="muted small">
              这台电脑上没找到能跑这个版本的 Java。可以下载一份内置的，也可以手动指定你已有的 java.exe。
            </p>
            <p className="muted tiny">不下载也行——只要指定一个可用的 Java 就能启动，不会强制下载。</p>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setJavaPrompt(null)}>
                取消
              </button>
              <button className="ghost-btn" onClick={() => void pickJavaForLaunch()}>
                手动指定
              </button>
              <button className="primary-btn" onClick={() => void downloadJavaForLaunch()}>
                <Icon name="download" size={14} /> 下载 Java {javaPrompt.need}
              </button>
            </div>
          </div>
        </div>
      )}

      <dialog className="home-stop-dialog" ref={stopDialog} aria-labelledby="home-stop-title" aria-describedby="home-stop-note">        <h2 id="home-stop-title">强制停止游戏？</h2>
        <p id="home-stop-note">强制停止可能导致未保存的进度丢失，甚至损坏存档。建议先在游戏内保存并退出。</p>
        <div className="modal-actions">
          <button className="ghost-btn" autoFocus onClick={() => stopDialog.current?.close()}>取消</button>
          <button className="danger-btn" disabled={!running || stopping} onClick={() => {
            stopDialog.current?.close()
            if (running && !stopping) void stop()
          }}>强制停止</button>
        </div>
      </dialog>
    </div>
  )
}
