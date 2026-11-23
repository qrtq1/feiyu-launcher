import { useEffect, useRef, useState } from 'react'
import type { WorldMapFile, WorldMapHit } from '../../../shared/types'
import { useApp } from '../store'
import { Icon, Spinner, Tag, fmtDownloads } from './ui'

/**
 * 下载页「地图」：在线下载世界存档（CurseForge Worlds）+ 导入本地地图包。
 * 本地存档管理在「实例 → 存档」里，这里只管下载。
 */
export default function WorldPane() {
  const { settings, selectedVersion, toast } = useApp()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<WorldMapHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<WorldMapHit | null>(null)
  const [files, setFiles] = useState<WorldMapFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const seqRef = useRef(0)
  const fileSeq = useRef(0)

  const hasKey = Boolean(settings?.curseforgeApiKey?.trim())

  const run = async (): Promise<void> => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      const r = await window.api.maps.search(query)
      if (seq !== seqRef.current) return
      setHits(r.hits)
      setTotal(r.total)
    } catch (e) {
      if (seq === seqRef.current) setError((e as Error).message)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openFiles = async (hit: WorldMapHit): Promise<void> => {
    const seq = ++fileSeq.current
    setPicked(hit)
    setFilesLoading(true)
    setFiles([])
    try {
      const list = await window.api.maps.files(hit.id, selectedVersion || undefined)
      if (seq !== fileSeq.current) return
      setFiles(list)
      if (!list.length) toast('这个地图没有匹配当前版本的文件', 'err')
    } catch (e) {
      if (seq === fileSeq.current) toast(`读取文件失败：${(e as Error).message}`, 'err')
    } finally {
      if (seq === fileSeq.current) setFilesLoading(false)
    }
  }

  const download = async (f: WorldMapFile): Promise<void> => {
    if (!picked) return
    setBusy(true)
    try {
      const r = await window.api.maps.download(picked.id, f, selectedVersion || undefined)
      toast(`地图已装进存档：${r.world}`, 'ok')
      fileSeq.current++
      setPicked(null)
    } catch (e) {
      toast(`下载失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  const importLocal = async (): Promise<void> => {
    try {
      const r = await window.api.maps.importZip(selectedVersion || undefined)
      if (!r) return
      toast(`地图已导入存档：${r.world}`, 'ok')
    } catch (e) {
      toast(`导入失败：${(e as Error).message}`, 'err')
    }
  }

  return (
    <div className="pane">
      <div className="filter-bar">
        <div className="filter-row">
          <div className="search" style={{ flex: 1 }}>
            <Icon name="search" size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜地图，比如 lucky block / 幸运方块 / parkour"
              onKeyDown={(e) => e.key === 'Enter' && void run()}
            />
          </div>
          <button className="primary-btn" onClick={() => void run()} disabled={loading}>
            搜索
          </button>
          <button className="ghost-btn" onClick={() => void importLocal()}>
            <Icon name="folder" size={14} /> 导入本地地图包
          </button>
        </div>
        <div className="filter-row">
          <span className="filter-label">
            装到实例：<b>{selectedVersion || '（根目录 saves）'}</b>
          </span>
          <span className="filter-label muted">下载后解压到该实例的 saves/ · 来源 CurseForge{hasKey ? '（自己的 Key）' : '（MCIM 免 Key 镜像）'}</span>
        </div>
      </div>

      {loading && (
        <div className="center-box">
          <Spinner size={20} /> 正在搜地图……
        </div>
      )}

      {!loading && error && (
        <div className="center-box err">
          <Icon name="alert" size={18} />
          <span>{error}</span>
          <span className="muted tiny">如果是 403，多半是 API Key 不对或过期了。</span>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="res-count muted tiny">CurseForge {total} 个地图</div>
          {hits.length === 0 && (
            <div className="center-box muted">
              <Icon name="globe" size={26} />
              <span>没搜到。换个关键词，比如 lucky / parkour / skyblock / adventure。</span>
            </div>
          )}
          <div className="res-grid">
            {hits.map((h) => (
              <div key={h.id} className="res-card">
                <div className="res-top">
                  {h.iconUrl ? (
                    <img className="res-icon" src={h.iconUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="res-icon placeholder">
                      <Icon name="globe" size={18} />
                    </div>
                  )}
                  <div className="res-title-wrap">
                    <div className="res-title" title={h.name}>
                      {h.name}
                    </div>
                    <div className="res-author muted tiny">CurseForge · {fmtDownloads(h.downloads)} 下载</div>
                  </div>
                </div>
                <div className="res-desc">{h.summary}</div>
                <div className="res-tags">
                  <Tag tone="accent">世界存档</Tag>
                </div>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="ghost-btn" onClick={() => void window.api.openExternal(h.url)}>
                    页面
                  </button>
                  <button className="dl-btn full" onClick={() => void openFiles(h)}>
                    <Icon name="download" size={14} /> 选文件
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {picked && (
        <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) { fileSeq.current++; setPicked(null) } }}>
          <div className="modal" style={{ width: 560 }}>
            <h3>{picked.name}</h3>
            <p className="muted small">选一个文件下载，会解压到当前实例的 saves/ 里。</p>
            {filesLoading && (
              <div className="center-box">
                <Spinner size={18} />
              </div>
            )}
            {!filesLoading && files.length === 0 && <p className="muted small">没有可用文件。</p>}
            {!filesLoading && files.length > 0 && (
              <div className="file-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {files.slice(0, 20).map((f) => (
                  <div key={f.id} className="file-row">
                    <div className="file-main">
                      <div className="file-name">{f.name}</div>
                      <div className="file-meta">
                        {(f.size / 1048576).toFixed(1)} MB · {f.gameVersions.slice(0, 3).join(' / ')}
                      </div>
                    </div>
                    <div className="file-actions">
                      <button className="primary-btn" disabled={busy || !f.downloadUrl} onClick={() => void download(f)}>
                        {busy ? <Spinner size={12} /> : <Icon name="download" size={13} />} 下载
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => { fileSeq.current++; setPicked(null) }}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
