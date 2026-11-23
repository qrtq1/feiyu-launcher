import { useEffect, useState } from 'react'
import type { FavoriteItem } from '../../../shared/types'
import { useApp } from '../store'
import { Icon, Spinner, Tag } from './ui'

const TYPE_LABEL: Record<string, string> = {
  mod: '模组',
  modpack: '整合包',
  resourcepack: '资源包',
  shader: '光影包',
  datapack: '数据包'
}

export default function FavoritePane() {
  const { toast } = useApp()
  const [items, setItems] = useState<FavoriteItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setItems(await window.api.favorites.list())
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const remove = async (id: string): Promise<void> => {
    try {
      setItems(await window.api.favorites.remove(id))
      toast('已取消收藏')
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  return (
    <div className="pane">
      <div className="pane-head">
        <span className="muted tiny">在资源列表里点 ♥ 收藏的项目会出现在这里（{items.length} 个）</span>
      </div>

      {loading && (
        <div className="center-box">
          <Spinner size={20} /> 读取收藏……
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="center-box muted">
          <Icon name="heart" size={26} />
          <span>还没有收藏。去「模组 / 整合包 / 资源包」里点一下心形图标。</span>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="res-grid">
          {items.map((f) => (
            <div key={f.id} className="res-card">
              <div className="res-top">
                {f.iconUrl ? <img className="res-icon" src={f.iconUrl} alt="" /> : <div className="res-icon placeholder">{f.title.slice(0, 1)}</div>}
                <div className="res-title-wrap">
                  <div className="res-title">{f.title}</div>
                  <div className="res-author muted tiny">{f.author}</div>
                </div>
                <button className="fav-btn on" title="取消收藏" onClick={() => void remove(f.id)}>
                  <Icon name="heart" size={14} />
                </button>
              </div>
              <div className="res-tags">
                <Tag tone="accent">{TYPE_LABEL[f.type] ?? f.type}</Tag>
                <span className="muted tiny">{new Date(f.addedAt).toLocaleDateString('zh-CN')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
