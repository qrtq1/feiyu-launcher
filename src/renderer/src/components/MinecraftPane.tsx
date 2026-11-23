import { useEffect, useMemo, useRef, useState } from 'react'
import type { VersionManifest, VersionManifestEntry } from '../../../shared/types'
import { useApp } from '../store'
import { Icon, Spinner } from '../components/ui'

const DT_FMT = new Intl.DateTimeFormat('zh-CN')

export default function MinecraftPane({ onPickLoader }: { onPickLoader?: (versionId: string) => void }) {
  const { localVersions, installVersion, installing, progress, reloadLocal, toast } = useApp()
  const [manifest, setManifest] = useState<VersionManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [cloneSrc, setCloneSrc] = useState<string | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [cloning, setCloning] = useState(false)
  const loadReq = useRef(0)

  const openClone = (srcId: string): void => {
    setCloneSrc(srcId)
    // 默认给个不冲突的名字：1.20.1 → 1.20.1-2
    setCloneName(`${srcId}-2`)
  }

  const doClone = async (): Promise<void> => {
    if (cloning) return
    if (!cloneSrc) return
    setCloning(true)
    try {
      const id = await window.api.versions.clone(cloneSrc, cloneName)
      toast(`已创建实例 ${id}（版本本体已复制，mods 和存档是新的）`, 'ok')
      setCloneSrc(null)
      await reloadLocal()
    } catch (e) {
      toast(`没建成：${(e as Error).message}`, 'err')
    } finally {
      setCloning(false)
    }
  }
  const [expanded, setExpanded] = useState<string | null>('release')
  /** 版本筛选：全部 = 所有分组都展开 */
  const [typeFilter, setTypeFilter] = useState<'all' | 'release' | 'snapshot' | 'old' | 'april'>('all')

  const load = async (): Promise<void> => {
    const req = ++loadReq.current
    setLoading(true)
    setError(null)
    try {
      const m = await window.api.versions.manifest()
      if (req !== loadReq.current) return
      setManifest(m)
      await reloadLocal()
      if (req !== loadReq.current) return
    } catch (e) {
      if (req === loadReq.current) setError((e as Error).message)
    } finally {
      if (req === loadReq.current) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const installed = useMemo(() => {
    const m = new Set<string>()
    for (const v of localVersions) if (v.complete) m.add(v.id)
    return m
  }, [localVersions])

  const latestRelease = useMemo(() => manifest?.versions.find((v) => v.id === manifest.latest.release), [manifest])
  const latestSnapshot = useMemo(() => manifest?.versions.find((v) => v.id === manifest.latest.snapshot), [manifest])

  const groups = useMemo(() => {
    const list = manifest?.versions ?? []
    const q = query.trim().toLowerCase()
    const filtered = q ? list.filter((v) => v.id.toLowerCase().includes(q)) : list
    const april: VersionManifestEntry[] = []
    const release: VersionManifestEntry[] = []
    const snapshot: VersionManifestEntry[] = []
    const old: VersionManifestEntry[] = []
    for (const v of filtered) {
      if (APRIL_IDS.has(v.id)) april.push(v)
      else if (v.type === 'release') release.push(v)
      else if (v.type === 'snapshot') snapshot.push(v)
      else old.push(v)
    }
    return { release, snapshot, old, april }
  }, [manifest, query])

  const row = (v: VersionManifestEntry) => {    const ok = installed.has(v.id)
    const t = v.type === 'release' ? 'release' : v.type === 'snapshot' ? 'snapshot' : 'old'
    return (
      <div key={v.id} className="ver-row">
        <div className={`ver-icon ${t}`}>
          {v.type === 'release' ? <Icon name="grid" size={18} /> : v.type === 'snapshot' ? <Icon name="sparkles" size={18} /> : <Icon name="box" size={18} />}
        </div>
        <div className="ver-main">
          <div className="ver-id">{v.id}</div>
          <div className="ver-meta">
            {v.type === 'release' ? '正式版' : v.type === 'snapshot' ? '预览版' : '远古版'} · {DT_FMT.format(new Date(v.releaseTime))}
          </div>
        </div>
        {ok ? (
          <>
            <span className="installed-mark">
              <Icon name="check" size={14} /> 已安装
            </span>
            <button className="ghost-btn" disabled={installing} onClick={() => openClone(v.id)} title="复制一份成新实例，两份互不影响">
              <Icon name="plus" size={14} /> 再装一份
            </button>
          </>
        ) : (
          <button className="dl-btn" disabled={installing} onClick={() => void installVersion(v.id)}>
            <Icon name="download" size={14} /> 安装
          </button>
        )}
        {onPickLoader && (
          <button className="icon-btn" title="给这个版本添加加载器" onClick={() => onPickLoader(v.id)}>
            <Icon name="box" size={15} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="pane">
      <div className="pane-head">
        <div className="res-toolbar">
          <div className="search">
            <Icon name="search" size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索版本号，比如 1.20.1" />
          </div>
          <button className="ghost-btn" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" size={14} /> 刷新
          </button>
        </div>
      </div>

      {installing && progress && (
        <div className="install-banner">
          <Spinner />
          <div className="ib-text">
            <div className="ib-phase">{progress.phase}</div>
            <div className="ib-sub">
              {progress.total > 0 ? `${progress.current}/${progress.total}` : ''} {progress.currentFile ?? ''}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="center-box">
          <Spinner size={20} /> 正在拉取版本清单……
        </div>
      )}

      {error && !loading && (
        <div className="center-box err">
          <Icon name="alert" size={18} />
          <span>{error}</span>
          <button className="ghost-btn" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      {!loading && !error && manifest && (
        <div className="ver-scroll">
          {!query && (
            <div className="latest-card">
              <div className="latest-title">最新版本</div>
              {latestRelease && (
                <div className="latest-row">
                  <div className="ver-icon release">
                    <Icon name="grid" size={20} />
                  </div>
                  <div className="ver-main">
                    <div className="ver-id">{latestRelease.id}</div>
                    <div className="ver-meta">最新正式版，发布于 {DT_FMT.format(new Date(latestRelease.releaseTime))}</div>
                  </div>
                  {installed.has(latestRelease.id) ? (
                    <>
                      <span className="installed-mark">
                        <Icon name="check" size={14} /> 已安装
                      </span>
                      <button className="ghost-btn" disabled={installing} onClick={() => openClone(latestRelease.id)}>
                        <Icon name="plus" size={14} /> 再装一份
                      </button>
                    </>
                  ) : (
                    <button className="dl-btn" disabled={installing} onClick={() => void installVersion(latestRelease.id)}>
                      <Icon name="download" size={14} /> 安装
                    </button>
                  )}
                </div>
              )}
              {latestSnapshot && (
                <div className="latest-row">
                  <div className="ver-icon snapshot">
                    <Icon name="sparkles" size={20} />
                  </div>
                  <div className="ver-main">
                    <div className="ver-id">{latestSnapshot.id}</div>
                    <div className="ver-meta">最新预览版，发布于 {DT_FMT.format(new Date(latestSnapshot.releaseTime))}</div>
                  </div>
                  {installed.has(latestSnapshot.id) ? (
                    <>
                      <span className="installed-mark">
                        <Icon name="check" size={14} /> 已安装
                      </span>
                      <button className="ghost-btn" disabled={installing} onClick={() => openClone(latestSnapshot.id)}>
                        <Icon name="plus" size={14} /> 再装一份
                      </button>
                    </>
                  ) : (
                    <button className="dl-btn" disabled={installing} onClick={() => void installVersion(latestSnapshot.id)}>
                      <Icon name="download" size={14} /> 安装
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 版本类型筛选 */}
          <div className="ver-filter">
            {([
              ['all', '全部'],
              ['release', '正式版'],
              ['snapshot', '预览版'],
              ['old', '远古版'],
              ['april', '愚人节版']
            ] as const).map(([id, label]) => (
              <button
                key={id}
                className={`ver-filter-btn${typeFilter === id ? ' active' : ''}`}
                onClick={() => {
                  setTypeFilter(id)
                  setExpanded(id === 'all' ? null : id)
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {(
            [
              ['release', '正式版', groups.release],
              ['snapshot', '预览版', groups.snapshot],
              ['old', '远古版', groups.old],
              ['april', '愚人节版', groups.april]
            ] as const
          )
            .filter(([key]) => typeFilter === 'all' || typeFilter === key)
            .map(([key, label, list]) => {
              // 「全部」时把所有分组都摊开，选具体类型时那个分组跟着展开
              const open = typeFilter === 'all' ? true : expanded === key
              return (
            <div key={key} className={`ver-group ${open ? 'open' : ''}`}>
              <button className="ver-group-head" onClick={() => setExpanded(open ? null : key)}>
                <span>
                  {label} <span className="ver-count">({list.length})</span>
                </span>
                <Icon name="chevron" size={16} />
              </button>
              {open && (
                <div className="ver-group-body">
                  {list.length === 0 && <div className="muted tiny" style={{ padding: 12 }}>没有匹配的版本</div>}
                  {list.slice(0, 400).map((v) => row(v))}
                  {list.length > 400 && <div className="muted tiny" style={{ padding: 12 }}>只显示前 400 个，用搜索缩小范围</div>}
                </div>
              )}
            </div>
              )
            })}
        </div>
      )}

      {cloneSrc && (
        <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && setCloneSrc(null)}>
          <div className="modal" style={{ width: 470 }}>
            <h3>再装一份「{cloneSrc}」</h3>
            <p className="muted small">
              会复制版本本体（版本 json / jar / natives）成一个新实例。mods、存档、配置都是全新的，两份互不影响。
            </p>
            <p className="muted tiny">同一个文件夹里不能有同名版本，所以这里得换个名字。</p>
            <input
              className="input"
              style={{ marginTop: 8 }}
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              placeholder="新实例名字，比如 1.20.1-2"
              onKeyDown={(e) => e.key === 'Enter' && !cloning && void doClone()}
            />
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setCloneSrc(null)}>
                取消
              </button>
              <button
                className="primary-btn"
                disabled={cloning || !cloneName.trim() || cloneName.trim() === cloneSrc}
                onClick={() => void doClone()}
              >
                {cloning ? '复制中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** PCL 里归到「愚人节版」的那些（Mojang 清单本身没有这个分类） */
const APRIL_IDS = new Set([
  '15w14a',
  '1.RV-Pre1',
  '3D Shareware v1.34',
  '20w14infinite',
  '22w13oneblockatatime',
  '23w13a_or_b',
  '24w14potato',
  '25w14craftmine',
  '26w14craftmine'
])
