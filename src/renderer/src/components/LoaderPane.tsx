import { useEffect, useMemo, useState } from 'react'
import type { LoaderType, LoaderVersionInfo } from '../../../shared/types'
import { useApp } from '../store'
import { Icon, Spinner, Tag } from './ui'

/** PCL 里这些加载器都列出来，能自动装的走 installLoader，不能的给出说明 */
const CAT_LABEL: Record<string, string> = {
  minecraft: 'Minecraft 原版',
  optifine: 'OptiFine',
  forge: 'Forge',
  neoforge: 'NeoForge',
  cleanroom: 'Cleanroom',
  fabric: 'Fabric',
  legacyfabric: 'Legacy Fabric',
  labymod: 'LabyMod',
  liteloader: 'LiteLoader'
}

const UNSUPPORTED: Record<string, string> = {
  cleanroom: 'Cleanroom 需要官方 installer（安装流程和 Forge 类似，但还没接），先用 1.12.2 + Forge 代替',
  labymod: 'LabyMod 的 installer 是带下载器的专有程序，暂不支持自动安装',
  liteloader: 'LiteLoader 已停止维护，installer 只支持老版本，暂不支持自动安装'
}

export default function LoaderPane({ type }: { type: string }) {
  const { localVersions, selectedVersion, setSelectedVersion, toast, installing, progress } = useApp()
  const [list, setList] = useState<LoaderVersionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [installed, setInstalled] = useState<{ versionId: string; type: string; mcVersion: string }[]>([])

  const mcVersions = useMemo(() => {
    const cmp = (a: string, b: string): number => {
      const pa = a.split('.').map(Number)
      const pb = b.split('.').map(Number)
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] ?? 0
        const y = pb[i] ?? 0
        if (x !== y) return x - y
      }
      return 0
    }
    return localVersions
      .filter((v) => v.complete && /^\d+\.\d+(\.\d+)?$/.test(v.id))
      .map((v) => v.id)
      .sort((a, b) => cmp(b, a))
  }, [localVersions])
  const mc = mcVersions.includes(selectedVersion) ? selectedVersion : (mcVersions[0] ?? '')

  const loadInstalled = async (): Promise<void> => {
    setInstalled(await window.api.loaders.installed())
  }

  useEffect(() => {
    void loadInstalled()
  }, [])

  useEffect(() => {
    if (UNSUPPORTED[type]) {
      setUnsupported(true)
      setList([])
      return
    }
    if (!mc) return
    let alive = true
    setLoading(true)
    setError(null)
    setUnsupported(false)
    window.api.loaders
      .list(type as LoaderType, mc)
      .then((v) => {
        if (alive) setList(v)
      })
      .catch((e) => {
        if (!alive) return
        const msg = (e as Error).message
        if (/HTTP (400|404)/.test(msg)) {
          setList([])
          setUnsupported(true)
        } else setError(msg)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [type, mc])

  const install = async (v: LoaderVersionInfo): Promise<void> => {
    setInstallingId(v.version)
    try {
      const r = await window.api.loaders.install(type as LoaderType, mc, v.version)
      toast(`已安装 ${v.label}${type === 'fabric' || type === 'legacyfabric' ? '（已顺带装 Fabric API）' : ''}`, 'ok')
      setSelectedVersion(r.versionId)
      await loadInstalled()
    } catch (e) {
      toast(`安装失败：${(e as Error).message}`, 'err')
    } finally {
      setInstallingId(null)
    }
  }

  if (UNSUPPORTED[type]) {
    return (
      <div className="pane">
        <div className="center-box">
          <Icon name="alert" size={26} />
          <div style={{ textAlign: 'center', maxWidth: 460, lineHeight: 1.7 }}>{UNSUPPORTED[type]}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="pane">
      <div className="pane-head">
        <div className="loader-mc">
          <span className="label">目标 Minecraft 版本</span>
          <select className="select" value={mc} onChange={(e) => setSelectedVersion(e.target.value)}>
            {mcVersions.length === 0 && <option value="">（先去「Minecraft 原版」装一个）</option>}
            {mcVersions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <span className="muted tiny">
            {CAT_LABEL[type]} · {list.length} 个版本
          </span>
        </div>
      </div>

      {installing && progress && (
        <div className="install-banner">
          <Spinner />
          <div className="ib-text">
            <div className="ib-phase">{progress.phase}</div>
            <div className="ib-sub">{progress.currentFile ?? ''}</div>
          </div>
        </div>
      )}

      {loading && (
        <div className="center-box">
          <Spinner size={20} /> 正在获取版本列表……
        </div>
      )}

      {error && !loading && (
        <div className="center-box err">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <div className="loader-list">
          {unsupported && <div className="center-box muted">这个 Minecraft 版本没有可用的 {CAT_LABEL[type]}</div>}
          {!unsupported && list.length === 0 && <div className="center-box muted">没有找到版本</div>}
          {list.map((v) => (
            <div key={v.version} className="loader-row">
              <div className="lr-main">
                <div className="lr-version">{v.label}</div>
                <div className="lr-meta">
                  {v.stable ? <Tag tone="ok">稳定</Tag> : <Tag tone="warn">测试</Tag>}
                  {v.kind && <span className="muted tiny">{v.kind}</span>}
                  <span className="muted tiny mono">{v.versionId}</span>
                </div>
              </div>
              <button className="dl-btn" disabled={installing || !mc} onClick={() => void install(v)}>
                {installingId === v.version ? <Spinner size={12} /> : <Icon name="download" size={14} />}
                {installed.some((x) => x.versionId === v.versionId) ? '重装' : '安装'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
