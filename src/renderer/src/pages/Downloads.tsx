import { useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../components/ui'
import ResourcePane from '../components/ResourcePane'
import LoaderPane from '../components/LoaderPane'
import MinecraftPane from '../components/MinecraftPane'
import LoaderSelectPane from '../components/LoaderSelectPane'
import WorldPane from '../components/WorldPane'
import FavoritePane from '../components/FavoritePane'

interface Cat {
  id: string
  label: string
  icon: 'box' | 'grid' | 'download' | 'folder' | 'globe' | 'heart' | 'sparkles'
  kind: 'resource' | 'loader' | 'minecraft' | 'world' | 'favorites'
}

const GROUPS: { title: string; items: Cat[] }[] = [
  {
    title: '社区资源',
    items: [
      { id: 'mod', label: '模组', icon: 'box', kind: 'resource' },
      { id: 'modpack', label: '整合包', icon: 'grid', kind: 'resource' },
      { id: 'datapack', label: '数据包', icon: 'sparkles', kind: 'resource' },
      { id: 'resourcepack', label: '资源包', icon: 'folder', kind: 'resource' },
      { id: 'shader', label: '光影包', icon: 'globe', kind: 'resource' },
      { id: 'world', label: '地图', icon: 'globe', kind: 'world' },
      { id: 'favorites', label: '收藏夹', icon: 'heart', kind: 'favorites' }
    ]
  },
  {
    title: '安装包',
    items: [
      { id: 'minecraft', label: 'Minecraft', icon: 'download', kind: 'minecraft' },
      { id: 'optifine', label: 'OptiFine', icon: 'box', kind: 'loader' },
      { id: 'forge', label: 'Forge', icon: 'box', kind: 'loader' },
      { id: 'neoforge', label: 'NeoForge', icon: 'box', kind: 'loader' },
      { id: 'cleanroom', label: 'Cleanroom', icon: 'box', kind: 'loader' },
      { id: 'fabric', label: 'Fabric', icon: 'box', kind: 'loader' },
      { id: 'legacyfabric', label: 'Legacy Fabric', icon: 'box', kind: 'loader' },
      { id: 'labymod', label: 'LabyMod', icon: 'box', kind: 'loader' },
      { id: 'liteloader', label: 'LiteLoader', icon: 'box', kind: 'loader' }
    ]
  }
]

const ALL = GROUPS.flatMap((g) => g.items)

export default function Downloads() {
  const { downloadsTab, setDownloadsTab } = useApp()
  const active = downloadsTab
  const setActive = setDownloadsTab
  const [loaderTarget, setLoaderTarget] = useState<string | null>(null)
  const current = ALL.find((c) => c.id === active) ?? ALL[0]

  const pickLoader = (type: string): void => {
    setLoaderTarget(null)
    setActive(type)
  }

  return (
    <div className="downloads">
      <aside className="dl-nav">
        {GROUPS.map((g) => (
          <div key={g.title} className="dl-group">
            <div className="dl-group-title">{g.title}</div>
            {g.items.map((it) => (
              <button
                key={it.id}
                className={`dl-cat ${active === it.id ? 'active' : ''}`}
                onClick={() => {
                  setLoaderTarget(null)
                  setActive(it.id)
                }}
              >
                <Icon name={it.icon} size={15} />
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>

      <section className="dl-body">
        {loaderTarget ? (
          <LoaderSelectPane mc={loaderTarget} onBack={() => setLoaderTarget(null)} onPick={pickLoader} />
        ) : (
          <>
            <div className="dl-title-row">
              <h2>{current.label}</h2>
              <span className="dl-hint">
                {current.kind === 'resource' && '来自 Modrinth 的社区资源'}
                {current.kind === 'loader' && '给已安装的原版版本套加载器'}
                {current.kind === 'minecraft' && 'Mojang 官方版本'}
                {current.kind === 'world' && '世界存档地图 · CurseForge'}
                {current.kind === 'favorites' && '你收藏的资源'}
              </span>
            </div>
            {current.kind === 'resource' && <ResourcePane key={current.id} type={current.id} />}
            {current.kind === 'loader' && <LoaderPane key={current.id} type={current.id} />}
            {current.kind === 'minecraft' && <MinecraftPane onPickLoader={setLoaderTarget} />}
            {current.kind === 'world' && <WorldPane />}
            {current.kind === 'favorites' && <FavoritePane />}
          </>
        )}
      </section>
    </div>
  )
}
