import { useEffect, useMemo, useRef, useState } from 'react'
import type { InstanceFile, InstanceFileKind, ServerEntry, VersionComponent, VersionSettings, VersionStats } from '../../../shared/types'
import { useApp } from '../store'
import { Icon, Spinner, Switch, Tag } from '../components/ui'

type Tab = 'overview' | 'settings' | 'modify' | 'export' | InstanceFileKind | 'servers'

const TABS: { id: Tab; label: string; group?: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'settings', label: '设置' },
  { id: 'modify', label: '修改' },
  { id: 'export', label: '导出' },
  { id: 'saves', label: '存档', group: '游戏资源' },
  { id: 'screenshots', label: '截图', group: '游戏资源' },
  { id: 'mods', label: '模组', group: '游戏资源' },
  { id: 'resourcepacks', label: '资源包', group: '游戏资源' },
  { id: 'shaderpacks', label: '光影包', group: '游戏资源' },
  { id: 'servers', label: '服务器', group: '游戏资源' }
]

export default function InstancePage() {
  const { instanceId, setPage, localVersions, toast, launch, active } = useApp()
  const [tab, setTab] = useState<Tab>('overview')
  const [components, setComponents] = useState<VersionComponent[]>([])
  const [stats, setStats] = useState<VersionStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const version = useMemo(() => localVersions.find((v) => v.id === instanceId), [localVersions, instanceId])

  const reload = async (): Promise<void> => {
    if (!instanceId) return
    setLoading(true)
    try {
      const [c, s] = await Promise.all([window.api.instance.components(instanceId), window.api.instance.stats(instanceId)])
      setComponents(c)
      setStats(s)
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  if (!instanceId) {
    return (
      <div className="page">
        <div className="center-box muted">没有选中实例</div>
      </div>
    )
  }

  const groups = [
    { title: '', items: TABS.filter((t) => !t.group) },
    { title: '游戏资源', items: TABS.filter((t) => t.group) }
  ]

  return (
    <div className="instance">
      <aside className="inst-nav">
        <button className="inst-back" onClick={() => setPage('home')}>
          <Icon name="chevron" size={15} style={{ transform: 'rotate(90deg)' }} /> 返回本地实例
        </button>
        {groups.map((g) => (
          <div key={g.title || 'main'} className="inst-group">
            {g.title && <div className="inst-group-title">{g.title}</div>}
            {g.items.map((t) => (
              <button key={t.id} className={`inst-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <section className="inst-body">
        <div className="inst-head">
          <h2>{instanceId}</h2>
          <span className="muted tiny">
            {version?.complete ? '已安装' : '未完成'} · {components.map((c) => c.name).join(' + ') || '…'}
          </span>
        </div>

        {loading && (
          <div className="center-box">
            <Spinner size={18} /> 读取实例信息……
          </div>
        )}

        {!loading && tab === 'overview' && (
          <Overview
            versionId={instanceId}
            components={components}
            stats={stats}
            onDelete={() => setConfirmDelete(true)}
            onRefresh={() => void reload()}
            onTest={() => void launch(instanceId, active?.id ?? '')}
          />
        )}
        {!loading && tab === 'settings' && <InstanceSettings versionId={instanceId} />}
        {!loading && tab === 'modify' && <ModifyPane versionId={instanceId} components={components} onChanged={() => void reload()} />}
        {!loading && tab === 'export' && <ExportPane versionId={instanceId} components={components} />}
        {!loading && tab === 'servers' && <ServerPane versionId={instanceId} />}
        {!loading && tab !== 'overview' && tab !== 'settings' && tab !== 'modify' && tab !== 'export' && tab !== 'servers' && <FilePane versionId={instanceId} kind={tab} />}

        {confirmDelete && (
          <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && setConfirmDelete(false)}>
            <div className="modal" style={{ width: 460 }}>
              <h3>删除实例「{instanceId}」？</h3>
              <p className="muted">
                会删掉整个版本目录：版本 json、模组、存档、截图、配置全部一起没。公共库和资源不动。
                <br />
                这个操作不能撤销。
              </p>
              <div className="modal-actions">
                <button className="ghost-btn" onClick={() => setConfirmDelete(false)}>
                  取消
                </button>
                <button
                  className="danger-btn"
                  onClick={async () => {
                    try {
                      await window.api.versions.remove(instanceId)
                      toast(`已删除 ${instanceId}`)
                      setPage('home')
                    } catch (e) {
                      toast(`删除失败：${(e as Error).message}`, 'err')
                    } finally {
                      setConfirmDelete(false)
                    }
                  }}
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

// ---------------- 概览 ----------------

function Overview({
  versionId,
  components,
  stats,
  onDelete,
  onRefresh,
  onTest
}: {
  versionId: string
  components: VersionComponent[]
  stats: VersionStats | null
  onDelete: () => void
  onRefresh: () => void
  onTest: () => void
}) {
  const { toast } = useApp()
  const fmt = (n: number): string => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${(n / 1048576).toFixed(0)} MB`)

  return (
    <>
      <div className="inst-card">
        <div className="comp-list">
          {components.map((c) => (
            <div key={`${c.kind}-${c.name}`} className="comp-row">
              <span className="comp-name">{c.name}</span>
              <span className="comp-ver">{c.version}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="inst-card">
        <div className="inst-card-title">实例信息</div>
        <div className="info-grid">
          <div className="info-cell">
            <div className="info-label">启动次数</div>
            <div className="info-value">{stats?.launchCount ?? 0}</div>
          </div>
          <div className="info-cell">
            <div className="info-label">占用空间</div>
            <div className="info-value">{stats ? fmt(stats.sizeBytes) : '—'}</div>
          </div>
          <div className="info-cell">
            <div className="info-label">安装时间</div>
            <div className="info-value">{stats?.installedAt ? new Date(stats.installedAt).toLocaleDateString('zh-CN') : '—'}</div>
          </div>
          <div className="info-cell">
            <div className="info-label">最后启动</div>
            <div className="info-value">{stats?.lastPlayedAt ? new Date(stats.lastPlayedAt).toLocaleDateString('zh-CN') : '还没启动过'}</div>
          </div>
        </div>
      </div>

      <div className="inst-card">
        <div className="inst-card-title">快捷方式</div>
        <div className="btn-row">
          <button className="ghost-btn" onClick={() => void window.api.instance.openFolder(versionId, 'root')}>
            <Icon name="folder" size={14} /> 实例文件夹
          </button>
          <button className="ghost-btn" onClick={() => void window.api.instance.openFolder(versionId, 'saves')}>
            <Icon name="globe" size={14} /> 存档文件夹
          </button>
          <button className="ghost-btn" onClick={() => void window.api.instance.openFolder(versionId, 'mods')}>
            <Icon name="box" size={14} /> 模组文件夹
          </button>
          <button className="ghost-btn" onClick={() => void window.api.instance.openFolder(versionId, 'screenshots')}>
            <Icon name="sparkles" size={14} /> 截图文件夹
          </button>
        </div>
      </div>

      <div className="inst-card">
        <div className="inst-card-title">高级管理</div>
        <div className="btn-row">
          <button className="ghost-btn" onClick={onTest}>
            <Icon name="play" size={14} /> 测试启动
          </button>
          <button className="ghost-btn" onClick={() => void onRefresh()}>
            <Icon name="refresh" size={14} /> 刷新信息
          </button>
          <button
            className="ghost-btn"
            onClick={async () => {
              const r = await window.api.instance.export(versionId)
              toast(`已导出到 ${r.file}`, 'ok')
            }}
          >
            <Icon name="download" size={14} /> 导出整合包
          </button>
          <button className="danger-btn" onClick={onDelete}>
            <Icon name="trash" size={14} /> 删除实例
          </button>
        </div>
      </div>
    </>
  )
}

// ---------------- 设置 ----------------

function InstanceSettings({ versionId }: { versionId: string }) {
  const { settings, toast } = useApp()
  const [vs, setVs] = useState<VersionSettings>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void window.api.instance.getSettings(versionId).then((v) => {
      setVs(v)
      setLoaded(true)
    })
  }, [versionId])

  const save = async (patch: Partial<VersionSettings>): Promise<void> => {
    const next = await window.api.instance.setSettings(versionId, patch)
    setVs(next)
    toast('已保存', 'ok')
  }

  if (!loaded) return <div className="center-box"><Spinner size={18} /></div>

  return (
    <>
      <div className="inst-card">
        <div className="inst-card-title">启动选项</div>
        <div className="set-row">
          <div className="set-label">
            最大内存
            <span className="set-desc">留空 = 跟随全局（{settings?.maxMemory ?? '—'} MB）</span>
          </div>
          <div className="set-control">
            <input
              className="input num"
              type="number"
              min={512}
              step={256}
              placeholder={String(settings?.maxMemory ?? 4096)}
              value={vs.maxMemory ?? ''}
              onChange={(e) => setVs({ ...vs, maxMemory: e.target.value ? Number(e.target.value) : undefined })}
            />
            <span className="unit">MB</span>
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">
            最小内存
            <span className="set-desc">留空 = 跟随全局</span>
          </div>
          <div className="set-control">
            <input
              className="input num"
              type="number"
              min={0}
              step={256}
              placeholder={String(settings?.minMemory ?? 512)}
              value={vs.minMemory ?? ''}
              onChange={(e) => setVs({ ...vs, minMemory: e.target.value ? Number(e.target.value) : undefined })}
            />
            <span className="unit">MB</span>
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">
            JVM 参数
            <span className="set-desc">附加给这个实例的 Java 参数</span>
          </div>
          <div className="set-control wide">
            <input className="input" placeholder="留空 = 跟随全局" value={vs.jvmArgs ?? ''} onChange={(e) => setVs({ ...vs, jvmArgs: e.target.value })} />
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">全屏启动</div>
          <div className="set-control">
            <Switch checked={Boolean(vs.fullscreen)} onChange={(v) => void save({ fullscreen: v })} />
          </div>
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="primary-btn" onClick={() => void save({ maxMemory: vs.maxMemory, minMemory: vs.minMemory, jvmArgs: vs.jvmArgs })}>
          保存
        </button>
        <button
          className="ghost-btn"
          onClick={() => {
            setVs({})
            void save({ maxMemory: undefined, minMemory: undefined, jvmArgs: undefined })
          }}
        >
          全部恢复全局
        </button>
      </div>
    </>
  )
}

// ---------------- 修改 ----------------

function ModifyPane({ versionId, components, onChanged }: { versionId: string; components: VersionComponent[]; onChanged: () => void }) {
  const { toast, setPage, openInstance, reloadLocal } = useApp()
  const [confirm, setConfirm] = useState<VersionComponent | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameErr, setRenameErr] = useState<string | null>(null)

  const doRename = async (): Promise<void> => {
    setRenameErr(null)
    const target = newName.trim()
    if (!target || target === versionId) return
    try {
      const id = await window.api.instance.rename(versionId, target)
      toast(`已改名成 ${id}`, 'ok')
      await reloadLocal()
      openInstance(id)
    } catch (e) {
      setRenameErr((e as Error).message)
    }
  }

  const retire = async (c: VersionComponent): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.instance.retire(versionId, c.kind)
      toast(`已把 ${r.moved.length} 个文件挪到 ${r.target}`, 'ok')
      setConfirm(null)
      onChanged()
    } catch (e) {
      toast(`移除失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="inst-card">
        <div className="inst-card-title">已安装组件</div>
        {components.map((c) => (
          <div key={`${c.kind}-${c.name}`} className="comp-row">
            <div>
              <span className="comp-name">{c.name}</span>
              <span className="comp-ver">{c.version}</span>
            </div>
            <div className="comp-actions">
              <Tag tone={c.removable ? 'warn' : 'ok'}>{c.removable ? '可移除' : '基础'}</Tag>
              {c.kind === 'api' && (
                <button className="ghost-btn" onClick={() => setConfirm(c)}>
                  移除
                </button>
              )}
            </div>
          </div>
        ))}
        <p className="muted tiny">
          加载器本体（Fabric / Forge / NeoForge / OptiFine）拆不掉——它就是这个版本的骨架。要换加载器或换版本，去「下载」页对着同一个 Minecraft 版本重装一次，会把实例覆盖成新的组合。
        </p>
        <div className="btn-row">
          <button className="ghost-btn" onClick={() => setPage('downloads')}>
            <Icon name="download" size={14} /> 去下载页换加载器
          </button>
          <button className="ghost-btn" onClick={() => void window.api.instance.openFolder(versionId, 'mods')}>
            <Icon name="folder" size={14} /> 打开实例目录
          </button>
        </div>
      </div>

      <div className="inst-card">
        <div className="inst-card-title">重命名实例</div>
        <p className="muted tiny">
          改的是版本 id（目录名、版本 json、jar 一起改）。模组、存档、配置都跟着走，不会掉。已经被别的实例继承的名字别改。
        </p>
        <div className="server-add" style={{ marginTop: 10, marginBottom: 0 }}>
          <input
            className="input"
            placeholder="新的实例名字"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void doRename()}
          />
          <button className="primary-btn" disabled={!newName.trim() || newName.trim() === versionId} onClick={() => void doRename()}>
            改名
          </button>
        </div>
        {renameErr && <p className="err small" style={{ marginTop: 8 }}>{renameErr}</p>}
      </div>

      <div className="inst-card">
        <div className="inst-card-title">重置</div>
        <p className="muted tiny">重置 = 删掉这个实例目录后重新安装（模组和存档会没），需要二次确认。</p>
        <div className="btn-row">
          <button className="ghost-btn" onClick={() => setPage('downloads')}>
            <Icon name="download" size={14} /> 去下载页重装
          </button>
          <button
            className="danger-btn"
            onClick={async () => {
              if (!window.confirm(`确定重置 ${versionId}？实例目录会被删掉。`)) return
              await window.api.versions.remove(versionId)
              toast('已删除，请重新安装')
              setPage('downloads')
            }}
          >
            重置实例
          </button>
        </div>
      </div>

      {confirm && (
        <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="modal" style={{ width: 460 }}>
            <h3>移除「{confirm.name}」？</h3>
            <p className="muted">
              不真删：文件会被挪进实例目录下的 <code>_removed\&lt;时间&gt;\</code> 备份文件夹，想恢复自己拖回 mods 就行。移完游戏里就看不到这个组件了。
            </p>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setConfirm(null)}>
                取消
              </button>
              <button className="primary-btn" disabled={busy} onClick={() => void retire(confirm)}>
                {busy ? '处理中…' : '移到备份'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------- 导出 ----------------

function ExportPane({ versionId, components }: { versionId: string; components: VersionComponent[] }) {
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<{ versionId: string; files: number } | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.instance.export(versionId)
      setResult(r.file)
      toast(`导出完成，共 ${r.entries} 个文件`, 'ok')
    } catch (e) {
      toast(`导出失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const r = await window.api.instance.importPackage()
      if (!r) return
      setImported({ versionId: r.versionId, files: r.files })
      toast(`已导入成实例 ${r.versionId}（${r.files} 个文件）`, 'ok')
    } catch (e) {
      toast(`导入失败：${(e as Error).message}`, 'err')
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <div className="inst-card">
        <div className="inst-card-title">导出内容</div>
        <div className="export-list">
          <div>✓ 版本信息（{versionId}）</div>
          <div>✓ 实例目录下的全部文件（模组、存档、配置、截图）</div>
          <div>✓ 组件清单：{components.map((c) => `${c.name} ${c.version}`).join('、')}</div>
          <div className="muted tiny">✗ 公共库（libraries）和游戏资源（assets）不打包，导入方自己下</div>
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="primary-btn" disabled={busy} onClick={() => void run()}>
            {busy ? <Spinner size={12} /> : <Icon name="download" size={14} />} 开始导出
          </button>
        </div>
        {result && (
          <p className="ok small" style={{ marginTop: 10 }}>
            已保存：{result}
            <button className="ghost-btn" style={{ marginLeft: 8, height: 24 }} onClick={() => void window.api.openPath(result)}>
              打开
            </button>
          </p>
        )}
      </div>

      <div className="inst-card">
        <div className="inst-card-title">导入实例</div>
        <p className="muted tiny">
          选别人（或者你自己之前导出）的实例包 .zip 解回来。同名版本已存在时会自动改名成 <code>xxx-imported</code>，不会覆盖现成的实例；解出来的是一份独立副本。
        </p>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="ghost-btn" disabled={importing} onClick={() => void doImport()}>
            {importing ? <Spinner size={12} /> : <Icon name="folder" size={14} />} 选择实例包导入
          </button>
        </div>
        {imported && (
          <p className="ok small" style={{ marginTop: 10 }}>
            已导入成实例「{imported.versionId}」（{imported.files} 个文件）→ 去「版本」页能看到它
          </p>
        )}
      </div>
    </>
  )
}

// ---------------- 文件列表 ----------------

const KIND_LABEL: Record<InstanceFileKind, string> = {
  mods: '模组',
  saves: '存档',
  screenshots: '截图',
  resourcepacks: '资源包',
  shaderpacks: '光影包'
}

function FilePane({ versionId, kind }: { versionId: string; kind: InstanceFileKind }) {
  const { toast } = useApp()
  const requestRef = useRef(0)
  const [files, setFiles] = useState<InstanceFile[]>([])
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<InstanceFile | null>(null)

  const load = async (): Promise<void> => {
    const request = ++requestRef.current
    setLoading(true)
    try {
      const next = await window.api.instance.files(versionId, kind)
      if (request === requestRef.current) setFiles(next)
    } catch (e) {
      if (request === requestRef.current) toast(`读取${KIND_LABEL[kind]}失败：${(e as Error).message}`, 'err')
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, kind])

  const fmt = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

  return (
    <div className="inst-card">
      <div className="inst-card-title">
        {KIND_LABEL[kind]}（{files.length}）
        <button className="ghost-btn" style={{ marginLeft: 10, height: 24 }} onClick={() => void window.api.instance.openFolder(versionId, kind)}>
          打开文件夹
        </button>
      </div>

      {loading && (
        <div className="center-box">
          <Spinner size={18} />
        </div>
      )}

      {!loading && files.length === 0 && <div className="center-box muted">这里是空的。把 {KIND_LABEL[kind]} 放进对应文件夹就能看到。</div>}

      {!loading && files.length > 0 && (
        <div className="file-list">
          {files.map((f) => (
            <div key={f.path} className="file-row">
              <div className="file-main">
                <div className={`file-name ${f.enabled ? '' : 'off'}`}>{f.name}</div>
                <div className="file-meta">
                  {fmt(f.size)} · {new Date(f.mtime).toLocaleDateString('zh-CN')}
                </div>
              </div>
              <div className="file-actions">
                {kind === 'mods' && (
                  <button
                    className="ghost-btn"
                    onClick={async () => {
                      await window.api.instance.toggle(f.path)
                      toast(f.enabled ? '已禁用' : '已启用')
                      await load()
                    }}
                  >
                    {f.enabled ? '禁用' : '启用'}
                  </button>
                )}
                <button className="ghost-btn" onClick={() => void window.api.openPath(f.path)}>
                  打开
                </button>
                <button className="icon-btn danger" onClick={() => setConfirm(f)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirm && (
        <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="modal" style={{ width: 430 }}>
            <h3>删除「{confirm.name}」？</h3>
            <p className="muted">文件会直接从磁盘删掉。</p>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setConfirm(null)}>
                取消
              </button>
              <button
                className="danger-btn"
                onClick={async () => {
                  await window.api.instance.deleteFiles([confirm.path])
                  setConfirm(null)
                  toast('已删除')
                  await load()
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- 服务器列表（servers.dat） ----------------

function ServerPane({ versionId }: { versionId: string }) {
  const { toast, settings } = useApp()
  const isolated = settings?.versionIsolation ?? true
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [ip, setIp] = useState('')
  const [confirm, setConfirm] = useState<ServerEntry | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setServers(await window.api.servers.list(versionId))
    } catch (e) {
      toast(`读取服务器列表失败：${(e as Error).message}`, 'err')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId])

  const add = async (): Promise<void> => {
    const addr = ip.trim()
    if (!addr) {
      toast('地址不能为空', 'err')
      return
    }
    try {
      const next = await window.api.servers.add(versionId, isolated, { name: name.trim() || addr, ip: addr })
      setServers(next)
      setName('')
      setIp('')
      toast('已添加，重启游戏后生效', 'ok')
    } catch (e) {
      toast(`添加失败：${(e as Error).message}`, 'err')
    }
  }

  return (
    <div className="inst-card">
      <div className="inst-card-title">服务器（{servers.length}）</div>

      <div className="server-add">
        <input className="input" placeholder="名称（可留空）" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="地址，例如 play.example.com" value={ip} onChange={(e) => setIp(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <button className="primary-btn" onClick={() => void add()}>
          <Icon name="plus" size={14} /> 添加
        </button>
      </div>

      {loading && (
        <div className="center-box">
          <Spinner size={18} />
        </div>
      )}

      {!loading && servers.length === 0 && (
        <div className="center-box muted">servers.dat 里还没有服务器。加一个，或者进游戏里自己存。</div>
      )}

      {!loading && servers.length > 0 && (
        <div className="file-list">
          {servers.map((s) => (
            <div key={s.ip} className="file-row">
              {s.icon ? (
                <img className="server-icon" src={s.icon} alt="" />
              ) : (
                <div className="server-icon server-icon-empty">
                  <Icon name="grid" size={16} />
                </div>
              )}
              <div className="file-main">
                <div className="file-name">{s.name}</div>
                <div className="file-meta">{s.ip}</div>
              </div>
              <div className="file-actions">
                <button className="icon-btn danger" onClick={() => setConfirm(s)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="muted tiny">
        改动直接写进这个实例的 servers.dat（第一次写之前会留一份 servers.dat.bak）。游戏正在跑的时候别改，退出后再改才生效。
      </p>

      {confirm && (
        <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="modal" style={{ width: 430 }}>
            <h3>删除服务器「{confirm.name}」？</h3>
            <p className="muted">
              只从 servers.dat 里去掉这一条（{confirm.ip}），不会动别的记录；原文件会留一份 .bak。
            </p>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setConfirm(null)}>
                取消
              </button>
              <button
                className="danger-btn"
                onClick={async () => {
                  try {
                    const next = await window.api.servers.remove(versionId, isolated, confirm.ip)
                    setServers(next)
                    setConfirm(null)
                    toast('已移除')
                  } catch (e) {
                    toast(`移除失败：${(e as Error).message}`, 'err')
                  }
                }}
              >
                移除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
