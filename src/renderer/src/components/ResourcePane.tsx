import { useEffect, useMemo, useRef, useState } from 'react'
import type { McmodHit, ResourceHit } from '../../../shared/types'
import { useApp } from '../store'
import { Icon, Spinner, Tag, cmpMcVersions, fmtDownloads } from './ui'

const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt']
const TAGS = [
  { id: '', label: '全部' },
  { id: 'optimization', label: '优化' },
  { id: 'adventure', label: '冒险' },
  { id: 'technology', label: '科技' },
  { id: 'magic', label: '魔法' },
  { id: 'decoration', label: '装饰' },
  { id: 'worldgen', label: '世界生成' }
]
const SORTS = [
  { id: 'relevance', label: '默认' },
  { id: 'downloads', label: '下载量' },
  { id: 'updated', label: '最近更新' },
  { id: 'newest', label: '最新发布' }
]
const SOURCES = [
  { id: 'all', label: '全部' },
  { id: 'modrinth', label: 'Modrinth' },
  { id: 'curseforge', label: 'CurseForge' },
  { id: 'mcmod', label: 'MC百科' }
]

/** 只有这几类 CurseForge 才有对应类目 */
const CF_TYPES = new Set(['mod', 'modpack', 'resourcepack', 'shader'])

function normName(s?: string): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[\s._-]+/g, '')
    .replace(/[^\w\u4e00-\u9fff]/g, '')
}

export default function ResourcePane({ type }: { type: string }) {
  const { localVersions, settings, toast } = useApp()
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState('relevance')
  const [loader, setLoader] = useState('')
  const [mcFilter, setMcFilter] = useState('')
  const [hits, setHits] = useState<ResourceHit[]>([])
  const [mcmodHits, setMcmodHits] = useState<McmodHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<string[]>([])
  const seqRef = useRef(0)

  const mc = useMemo(() => {
    const plain = localVersions.filter((v) => v.complete && /^\d+\.\d+(\.\d+)?$/.test(v.id)).map((v) => v.id)
    return plain.sort((a, b) => cmpMcVersions(b, a))[0]
  }, [localVersions])

  const selectedVersion = localVersions[0]?.id

  const loadFav = async (): Promise<void> => {
    try {
      const list = await window.api.favorites.list()
      setFavorites(list.map((f) => f.id))
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  useEffect(() => {
    void loadFav()
  }, [])

  const run = async (): Promise<void> => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    const ver = mcFilter || mc
    try {
      const wantModrinth = source === 'all' || source === 'modrinth'
      const wantCf = (source === 'all' || source === 'curseforge') && CF_TYPES.has(type)
      const wantMcmod = (source === 'all' || source === 'mcmod') && query.trim().length > 0

      const [res, cfRes, mcmod] = await Promise.all([
        wantModrinth
          ? window.api.resources.search({
              query,
              type,
              mcVersion: ver,
              loader: loader || undefined,
              tag: tag || undefined,
              sort,
              limit: 24
            })
          : Promise.resolve({ hits: [] as ResourceHit[], total: 0 }),
        wantCf
          ? window.api.cf
              .search({ type, query, mcVersion: ver, loader: loader || undefined })
              .catch(() => ({ hits: [] as ResourceHit[], total: 0 }))
          : Promise.resolve({ hits: [] as ResourceHit[], total: 0 }),
        wantMcmod ? window.api.resources.searchMcmod(query, 10).catch(() => [] as McmodHit[]) : Promise.resolve([] as McmodHit[])
      ])
      if (seq !== seqRef.current) return

      // 两个源合并：同名（规范化后）的只留 Modrinth 那条
      const seen = new Set<string>()
      const merged: ResourceHit[] = []
      for (const h of [...res.hits, ...cfRes.hits]) {
        const key = normName(h.title) || normName(h.slug)
        if (key && seen.has(key)) continue
        if (key) seen.add(key)
        merged.push(h)
      }

      setHits(merged)
      setTotal(res.total + cfRes.total)

      // MC百科去重：同名的（按英文名/标题规范化）不再显示
      const existing = new Set<string>()
      for (const h of merged) {
        existing.add(normName(h.title))
        existing.add(normName(h.slug))
      }
      const deduped = mcmod.filter((m) => {
        const a = normName(m.title)
        const b = normName(m.enName)
        if (a && existing.has(a)) return false
        if (b && existing.has(b)) return false
        return true
      })
      setMcmodHits(deduped)
    } catch (e) {
      if (seq === seqRef.current) setError((e as Error).message)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, sort, tag, loader, mcFilter, source])

  const act = async (hit: ResourceHit): Promise<void> => {
    setBusyId(hit.id)
    try {
      const isCf = hit.source === 'curseforge'
      const cfId = Number(hit.id.replace(/^cf:/, ''))

      if (isCf) {
        const files = await window.api.cf.files(cfId, mcFilter || mc, loader || undefined)
        const first = files[0]
        if (!first) throw new Error('没有匹配当前版本的文件')
        if (type === 'modpack') {
          const r = await window.api.cf.installModpack(cfId, first.id)
          toast(`整合包「${r.name}」已装成 ${r.versionId}（${r.files} 个文件）`, 'ok')
        } else {
          const r = await window.api.cf.download(type, first, settings?.versionIsolation ? selectedVersion : undefined)
          toast(`已从 CurseForge 下载到 ${r.dir}`, 'ok')
        }
        return
      }

      if (type === 'modpack') {
        const r = await window.api.resources.installModpack(hit.id, mcFilter || mc)
        toast(`整合包「${r.name}」已装成 ${r.versionId}`, 'ok')
        return
      }
      const versions = await window.api.resources.versions(hit.id, mcFilter || mc, loader || undefined)
      const v = versions[0]
      const file = v?.files[0]
      if (!file) throw new Error('没有匹配当前版本的文件')
      const r = await window.api.resources.download({
        type,
        file: { name: file.name, url: file.url, size: file.size, sha1: file.sha1 },
        versionId: settings?.versionIsolation ? selectedVersion : undefined
      })
      if (type === 'datapack') {
        toast(`已下载到 ${r.dir}；数据包要放进某个存档的 datapacks 文件夹才会生效`, 'ok')
      } else {
        toast(`已下载到 ${r.dir}`, 'ok')
      }
    } catch (e) {
      toast(`失败：${(e as Error).message}`, 'err')
    } finally {
      setBusyId((cur) => (cur === hit.id ? null : cur))
    }
  }

  const toggleFav = async (hit: ResourceHit): Promise<void> => {
    try {
      if (favorites.includes(hit.id)) {
        const list = await window.api.favorites.remove(hit.id)
        setFavorites(list.map((f) => f.id))
        toast('已取消收藏')
        return
      }
      const list = await window.api.favorites.add({
        id: hit.id,
        type: hit.type,
        title: hit.title,
        iconUrl: hit.iconUrl,
        author: hit.author,
        addedAt: Date.now()
      })
      setFavorites(list.map((f) => f.id))
      toast('已收藏', 'ok')
    } catch (e) {
      toast((e as Error).message, 'err')
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
              placeholder="搜索，比如 sodium / iris / 钠"
              onKeyDown={(e) => e.key === 'Enter' && void run()}
            />
          </div>
          <button className="primary-btn" onClick={() => void run()} disabled={loading}>
            搜索
          </button>
        </div>
        <div className="filter-row">
          <span className="filter-label">来源</span>
          <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <span className="filter-label">标签</span>
          <select className="select" value={tag} onChange={(e) => setTag(e.target.value)}>
            {TAGS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>

          <span className="filter-label">排序</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <span className="filter-label">版本</span>
          <select className="select" value={mcFilter} onChange={(e) => setMcFilter(e.target.value)}>
            <option value="">自动（{mc ?? '—'}）</option>
            {localVersions
              .filter((v) => v.complete && /^\d+\.\d+(\.\d+)?$/.test(v.id))
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                </option>
              ))}
          </select>

          <span className="filter-label">加载器</span>
          <select className="select" value={loader} onChange={(e) => setLoader(e.target.value)}>
            <option value="">任意</option>
            {LOADERS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          <button className="icon-btn" title="刷新" onClick={() => void run()}>
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="center-box">
          <Spinner size={20} /> 正在搜索……
        </div>
      )}

      {error && !loading && (
        <div className="center-box err">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="res-count muted tiny">
            Modrinth + CurseForge 共 {total} 个结果 · MC百科 {mcmodHits.length} 条（已去重）
            {hits.length > 0 && ` · 本页 ${hits.length} 个`}
          </div>

          <div className="res-grid">
            {hits.map((h) => (
              <div key={h.id} className="res-card">
                <div className="res-top">
                  {h.iconUrl ? <img className="res-icon" src={h.iconUrl} alt="" /> : <div className="res-icon placeholder">{h.title.slice(0, 1)}</div>}
                  <div className="res-title-wrap">
                    <div className="res-title">{h.title}</div>
                    <div className="res-author muted tiny">{h.author}</div>
                  </div>
                  <button className={`fav-btn ${favorites.includes(h.id) ? 'on' : ''}`} title="收藏" onClick={() => void toggleFav(h)}>
                    <Icon name="heart" size={14} />
                  </button>
                </div>
                <div className="res-desc">{h.description}</div>
                <div className="res-tags">
                  {h.source === 'curseforge' && <Tag tone="warn">CurseForge</Tag>}
                  {h.categories.slice(0, 3).map((c) => (
                    <Tag key={c}>{c}</Tag>
                  ))}
                  <Tag tone="accent">
                    <Icon name="download" size={10} /> {fmtDownloads(h.downloads)}
                  </Tag>
                </div>
                <button className="dl-btn full" disabled={busyId === h.id} onClick={() => void act(h)}>
                  {busyId === h.id ? <Spinner size={12} /> : type === 'modpack' ? <Icon name="box" size={14} /> : <Icon name="download" size={14} />}
                  {type === 'modpack' ? '安装整合包' : '下载'}
                </button>
              </div>
            ))}

            {mcmodHits.map((m) => (
              <div key={`mcmod-${m.id}`} className="res-card mcmod">
                <div className="res-top">
                  <div className="res-icon placeholder mcmod-icon">MC</div>
                  <div className="res-title-wrap">
                    <div className="res-title">{m.title}</div>
                    <div className="res-author muted tiny">{m.enName ?? 'MC百科'}</div>
                  </div>
                </div>
                <div className="res-desc">{m.desc || 'MC百科条目'}</div>
                <div className="res-tags">
                  <Tag tone="warn">MC百科</Tag>
                </div>
                <button className="ghost-btn full" onClick={() => void window.api.openExternal(m.url)}>
                  <Icon name="globe" size={14} /> 去 MC百科 看
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
