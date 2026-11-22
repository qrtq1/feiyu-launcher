import { useEffect, useState } from 'react'
import type { LoaderVersionInfo } from '../../../shared/types'
import { useApp } from '../store'
import { Icon, Spinner } from './ui'

interface Entry {
  id: string
  label: string
  desc: string
}

const LOADERS: Entry[] = [
  { id: 'forge', label: 'Forge', desc: '老牌模组加载器' },
  { id: 'neoforge', label: 'NeoForge', desc: 'Forge 分叉，1.20.2+ 用' },
  { id: 'fabric', label: 'Fabric', desc: '轻量、更新快' },
  { id: 'quilt', label: 'Quilt', desc: 'Fabric 分叉' },
  { id: 'optifine', label: 'OptiFine', desc: '画质 / 性能优化' },
  { id: 'cleanroom', label: 'Cleanroom', desc: '1.12.2 的 Forge 分支' },
  { id: 'legacyfabric', label: 'Legacy Fabric', desc: '1.13 及以前的 Fabric' },
  { id: 'labymod', label: 'LabyMod', desc: '带客户端功能的加载器' },
  { id: 'liteloader', label: 'LiteLoader', desc: '已停止维护' }
]

type Status = 'loading' | 'available' | 'installed' | 'none' | 'unsupported'

export default function LoaderSelectPane({ mc, onBack, onPick }: { mc: string; onBack: () => void; onPick: (type: string) => void }) {
  const [mounted, setMounted] = useState<Record<string, LoaderVersionInfo[] | null>>({})
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [installedLoaders, setInstalledLoaders] = useState<{ versionId: string; type: string; mcVersion: string }[]>([])

  useEffect(() => {
    void window.api.loaders.installed().then(setInstalledLoaders)
  }, [])

  useEffect(() => {
    let alive = true
    setMounted({})
    setErrors({})
    for (const l of LOADERS) {
      window.api.loaders
        .list(l.id, mc)
        .then((list) => {
          if (alive) setMounted((m) => ({ ...m, [l.id]: list }))
        })
        .catch(() => {
          if (alive) setErrors((e) => ({ ...e, [l.id]: true }))
        })
    }
    return () => {
      alive = false
    }
  }, [mc])

  const statusOf = (id: string): Status => {
    const list = mounted[id]
    const installed = installedLoaders.find((x) => x.mcVersion === mc && x.type === id)
    if (errors[id]) return 'unsupported'
    if (list === null || list === undefined) return installed ? 'installed' : 'loading'
    if (list.length === 0) return 'none'
    if (installed) return 'installed'
    return 'available'
  }

  const installedText = (id: string): string => {
    const hit = installedLoaders.find((x) => x.mcVersion === mc && x.type === id)
    return hit ? hit.versionId : ''
  }

  return (
    <div className="pane">
      <div className="loader-pick-head">
        <button className="icon-btn" onClick={onBack} title="返回版本列表">
          <Icon name="chevron" size={16} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <div className="lp-version">{mc}</div>
        <span className="muted tiny">选择一个加载器</span>
      </div>

      <div className="warn-banner">
        <Icon name="alert" size={14} />
        <span>装 Fabric 的话，记得再单独装一个 Fabric API，大多数模组都依赖它。</span>
      </div>

      <div className="loader-pick-list">
        {LOADERS.map((l) => {
          const st = statusOf(l.id)
          return (
            <button key={l.id} className={`loader-pick-row ${st === 'unsupported' || st === 'none' ? 'disabled' : ''}`} disabled={st === 'none' || st === 'unsupported'} onClick={() => onPick(l.id)}>
              <div className="lpr-main">
                <div className="lpr-name">{l.label}</div>
                <div className="lpr-desc">{l.desc}</div>
              </div>
              <div className="lpr-status">
                {st === 'loading' && <Spinner size={12} />}
                {st === 'available' && <span className="muted">可以添加</span>}
                {st === 'installed' && <span className="ok">已安装 {installedText(l.id)}</span>}
                {st === 'none' && <span className="muted-2">无可用版本</span>}
                {st === 'unsupported' && <span className="muted-2">暂不支持</span>}
                {st !== 'none' && st !== 'unsupported' && <Icon name="chevron" size={15} style={{ transform: 'rotate(-90deg)' }} />}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
