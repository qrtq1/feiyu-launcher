import { useEffect, useState } from 'react'
import type { JavaRuntimeInfo } from '../../../shared/types'
import { useApp } from '../store'
import { Icon, Switch } from '../components/ui'

export default function Settings() {
  const { settings, saveSettings, toast } = useApp()
  const [javas, setJavas] = useState<JavaRuntimeInfo[]>([])
  const [loadingJava, setLoadingJava] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickingBackground, setPickingBackground] = useState(false)

  const reloadJava = async (): Promise<void> => {
    setLoadingJava(true)
    try {
      setJavas(await window.api.java.list())
    } finally {
      setLoadingJava(false)
    }
  }

  useEffect(() => {
    void reloadJava()
  }, [])

  if (!settings) return <div className="page" />

  const set = (patch: Parameters<typeof saveSettings>[0]): void => {
    void saveSettings(patch)
  }

  const pickDir = async (): Promise<void> => {
    const dir = await window.api.settings.pickDir()
    if (dir) set({ gameDir: dir })
  }

  const effectiveVersionsDir = settings.versionsDir
    ? settings.versionsDir
    : `${settings.gameDir.replace(/[\\/]+$/, '')}\\versions`
  const customVersionsDir = settings.versionsDir !== ''

  const pickVersionsDir = async (): Promise<void> => {
    const dir = await window.api.settings.pickDir()
    if (dir) {
      set({ versionsDir: dir })
      toast('版本目录已切换', 'ok')
    }
  }

  const addVersionFolder = async (): Promise<void> => {
    try {
      const r = await window.api.versions.addFolder()
      if (!r) return
      await saveSettings({ extraVersionDirs: r.dirs })
      toast(r.found > 0 ? `已加入，扫到 ${r.found} 个实例` : '已加入，但里面没找到实例', r.found > 0 ? 'ok' : 'err')
    } catch (e) {
      toast(`加入失败：${(e as Error).message}`, 'err')
    }
  }

  const removeVersionFolder = async (dir: string): Promise<void> => {
    const dirs = await window.api.versions.removeFolder(dir)
    await saveSettings({ extraVersionDirs: dirs })
    toast(dirs.length ? '已移除' : '已移除最后一个文件夹')
  }

  const pickJava = async (): Promise<void> => {
    setPicking(true)
    try {
      const p = await window.api.settings.pickJava()
      if (p) {
        set({ javaPath: p })
        toast('已指定 Java 路径', 'ok')
      }
    } finally {
      setPicking(false)
    }
  }

  const addJavaToPool = async (): Promise<void> => {
    const p = await window.api.settings.pickJava()
    if (!p) return
    const cur = settings.extraJavaPaths ?? []
    if (cur.some((x) => x.toLowerCase() === p.toLowerCase())) {
      toast('这个 Java 已经在列表里了')
      return
    }
    await saveSettings({ extraJavaPaths: [...cur, p] })
    await reloadJava()
    toast('已添加，启动时会一起参与挑选', 'ok')
  }

  const removeJavaFromPool = async (p: string): Promise<void> => {
    const cur = settings.extraJavaPaths ?? []
    await saveSettings({ extraJavaPaths: cur.filter((x) => x !== p) })
    await reloadJava()
    toast('已移除')
  }

  const pickBackground = async (): Promise<void> => {
    setPickingBackground(true)
    try {
      const picked = await window.api.settings.pickBackground()
      if (!picked) return
      await saveSettings({ backgroundPath: picked.path, backgroundKind: picked.kind })
      toast(picked.kind === 'wallpaper' ? '网页壁纸已启用' : '背景已启用', 'ok')
    } catch (e) {
      toast(`设置背景失败：${(e as Error).message}`, 'err')
    } finally {
      setPickingBackground(false)
    }
  }

  const clearBackground = (): void => {
    set({ backgroundPath: '', backgroundKind: 'none' })
    toast('已恢复默认背景')
  }

  const downloadJava = async (): Promise<void> => {
    toast('开始下载 Java 17 运行时，可能需要几分钟……')
    try {
      const j = await window.api.java.download('java-runtime-gamma', 17)
      toast(`Java ${j.major} 已就绪（${j.version}）`, 'ok')
      await reloadJava()
    } catch (e) {
      toast(`下载失败：${(e as Error).message}`, 'err')
    }
  }

  return (
    <div className="page settings">
      <div className="page-head">
        <div>
          <h2>设置</h2>
          <p className="page-sub">改完立刻生效，不用保存按钮</p>
        </div>
      </div>

      <section className="set-group">
        <div className="set-title">界面外观</div>
        <div className="set-row">
          <div className="set-label">
            自定义背景
            <span className="set-desc">支持 PNG / JPG / WebP / GIF、MP4 / WebM，以及 Wallpaper Engine 的 HTML 网页壁纸入口</span>
          </div>
          <div className="set-control wide">
            <div className="path-box" title={settings.backgroundPath || '默认浅色背景'}>
              {settings.backgroundPath || '默认浅色背景'}
            </div>
            <button className="ghost-btn" disabled={pickingBackground} onClick={() => void pickBackground()}>
              <Icon name="image" size={14} /> 选择背景
            </button>
            {settings.backgroundKind !== 'none' && <button className="ghost-btn" onClick={clearBackground}>恢复默认</button>}
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">
            强调色
            <span className="set-desc">用于按钮、进度条、选中状态和焦点提示</span>
          </div>
          <div className="set-control">
            <input className="color-input" type="color" value={settings.accentColor} onChange={(e) => set({ accentColor: e.target.value })} aria-label="选择强调色" />
            <span className="path-box color-value">{settings.accentColor}</span>
            <button className="ghost-btn" onClick={() => set({ accentColor: '#1663bc' })}>恢复默认</button>
          </div>
        </div>
      </section>

      <section className="set-group">
        <div className="set-title">游戏目录</div>
        <div className="set-row">
          <div className="set-label">
            数据目录
            <span className="set-desc">libraries / assets / 日志都放这里</span>
          </div>
          <div className="set-control wide">
            <div className="path-box" title={settings.gameDir}>
              {settings.gameDir}
            </div>
            <button className="ghost-btn" onClick={() => void pickDir()}>
              <Icon name="folder" size={14} /> 选择
            </button>
            <button className="ghost-btn" onClick={() => void window.api.openPath(settings.gameDir)}>
              打开
            </button>
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">
            版本目录
            <span className="set-desc">
              装好的版本（含 mods / 存档）单独放这里；{customVersionsDir ? '已自定义' : '默认跟随数据目录'}
            </span>
          </div>
          <div className="set-control wide">
            <div className="path-box" title={effectiveVersionsDir}>
              {effectiveVersionsDir}
            </div>
            <button className="ghost-btn" onClick={() => void pickVersionsDir()}>
              <Icon name="folder" size={14} /> 选择
            </button>
            <button className="ghost-btn" onClick={() => void window.api.openPath(effectiveVersionsDir)}>
              打开
            </button>
            {customVersionsDir && (
              <button className="ghost-btn" onClick={() => set({ versionsDir: '' })}>
                恢复默认
              </button>
            )}
          </div>
        </div>
        {customVersionsDir && (
          <div className="set-row">
            <div className="set-label">
              <span className="set-desc" style={{ color: 'var(--warn, #f0a020)' }}>
                切换目录不会搬动已有版本：旧目录里的版本仍留在原处，切回去才能看到。
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="set-group">
        <div className="set-title">其他版本文件夹</div>
        <div className="set-row">
          <div className="set-label">
            扫描这些文件夹
            <span className="set-desc">每个「版本名/版本名.json」算一个实例，列表里标「外部」</span>
          </div>
          <div className="set-control">
            <button className="ghost-btn" onClick={() => void addVersionFolder()}>
              <Icon name="folder" size={14} /> 加入文件夹
            </button>
          </div>
        </div>
        {(settings.extraVersionDirs ?? []).length === 0 && (
          <div className="set-row">
            <div className="set-label">
              <span className="set-desc">还没有加入其他文件夹。</span>
            </div>
          </div>
        )}
        {(settings.extraVersionDirs ?? []).map((dir) => (
          <div className="set-row" key={dir}>
            <div className="set-label">
              <span className="path-box" title={dir}>
                {dir}
              </span>
            </div>
            <div className="set-control">
              <button className="ghost-btn" onClick={() => void window.api.openPath(dir)}>
                打开
              </button>
              <button className="danger-btn" onClick={() => void removeVersionFolder(dir)}>
                移除
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="set-group">
        <div className="set-title">Java</div>
        <div className="set-row">
          <div className="set-label">
            Java 运行时
            <span className="set-desc">留空则自动挑最合适的（优先内置）</span>
          </div>
          <div className="set-control wide">
            <select className="select" value={settings.javaPath ?? ''} onChange={(e) => set({ javaPath: e.target.value || null })}>
              <option value="">自动选择</option>
              {javas.map((j) => (
                <option key={j.path} value={j.path}>
                  Java {j.major} · {j.version} · {j.source === 'mojang' ? '内置' : '系统'} · {j.path}
                </option>
              ))}
            </select>
            <button className="ghost-btn" disabled={loadingJava} onClick={() => void reloadJava()}>
              <Icon name="refresh" size={14} /> 重新探测
            </button>
            <button className="ghost-btn" onClick={() => void pickJava()} disabled={picking}>
              指定…
            </button>
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">
            已检测到的 Java
            <span className="set-desc">
              {javas.length ? `共 ${javas.length} 个，启动时按版本自动挑最合适的` : '一个都没找到，可以添加或下载'}
            </span>
          </div>
          <div className="set-control">
            <button className="ghost-btn" disabled={picking} onClick={() => void addJavaToPool()}>
              <Icon name="plus" size={14} /> 添加 Java 文件
            </button>
          </div>
        </div>
        {javas.length === 0 && (
          <div className="set-row">
            <div className="set-label">
              <span className="set-desc" style={{ color: 'var(--warn, #8d570b)' }}>
                没检测到 Java。可以点上面的「添加 Java 文件」指向你自己的 java.exe，或者下载一份内置的。
              </span>
            </div>
          </div>
        )}
        {javas.map((j) => (
          <div className="set-row" key={j.path}>
            <div className="set-label">
              <span>
                Java {j.major}
                <span className="set-desc" style={{ marginLeft: 8 }}>
                  {j.version} · {j.source === 'mojang' ? '内置' : j.source === 'custom' ? '手动添加' : '系统'}
                </span>
              </span>
              <span className="path-box" title={j.path}>
                {j.path}
              </span>
            </div>
            <div className="set-control">
              {settings.javaPath === j.path && <span className="tag ok">当前指定</span>}
              {j.source === 'custom' && (
                <button className="ghost-btn" onClick={() => void removeJavaFromPool(j.path)}>
                  移除
                </button>
              )}
            </div>
          </div>
        ))}
        <div className="set-row">
          <div className="set-label">
            下载内置 Java
            <span className="set-desc">从 Mojang 拉一份 Java 17 放进 runtime 目录（可选，不下载也能用系统 Java）</span>
          </div>
          <div className="set-control">
            <button className="ghost-btn" onClick={() => void downloadJava()}>
              <Icon name="download" size={14} /> 下载 Java 17
            </button>
          </div>
        </div>
      </section>

      <section className="set-group">
        <div className="set-title">内存</div>
        <div className="set-row">
          <div className="set-label">最大内存</div>
          <div className="set-control">
            <input
              className="input num"
              type="number"
              min={512}
              max={65536}
              step={256}
              value={settings.maxMemory}
              onChange={(e) => set({ maxMemory: Math.max(512, Number(e.target.value) || 512) })}
            />
            <span className="unit">MB</span>
            <span className="set-desc">建议 4096 以上，装了模组再加</span>
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">最小内存</div>
          <div className="set-control">
            <input
              className="input num"
              type="number"
              min={0}
              max={65536}
              step={256}
              value={settings.minMemory}
              onChange={(e) => set({ minMemory: Math.max(0, Number(e.target.value) || 0) })}
            />
            <span className="unit">MB</span>
          </div>
        </div>
      </section>

      <section className="set-group">
        <div className="set-title">启动参数</div>
        <div className="set-row">
          <div className="set-label">
            JVM 参数
            <span className="set-desc">附加给 Java 的参数，空格分隔</span>
          </div>
          <div className="set-control wide">
            <input className="input" value={settings.jvmArgs} placeholder="-XX:+UseZGC" onChange={(e) => set({ jvmArgs: e.target.value })} />
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">
            游戏参数
            <span className="set-desc">附加给 Minecraft 的参数</span>
          </div>
          <div className="set-control wide">
            <input className="input" value={settings.gameArgs} placeholder="--width 1280 --height 720" onChange={(e) => set({ gameArgs: e.target.value })} />
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">全屏启动</div>
          <div className="set-control">
            <Switch checked={settings.fullscreen} onChange={(v) => set({ fullscreen: v })} />
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">
            版本隔离
            <span className="set-desc">每个版本用独立的 mods / 存档目录</span>
          </div>
          <div className="set-control">
            <Switch checked={settings.versionIsolation} onChange={(v) => set({ versionIsolation: v })} />
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">启动后最小化启动器</div>
          <div className="set-control">
            <Switch checked={settings.closeOnLaunch} onChange={(v) => set({ closeOnLaunch: v })} />
          </div>
        </div>
      </section>

      <section className="set-group">
        <div className="set-title">下载</div>
        <div className="set-row">
          <div className="set-label">
            下载源
            <span className="set-desc">官方源最稳；BMCLAPI 是社区镜像</span>
          </div>
          <div className="set-control">
            <div className="segmented">
              <button className={settings.downloadSource === 'auto' ? 'active' : ''} onClick={() => set({ downloadSource: 'auto' })}>
                自动
              </button>
              <button className={settings.downloadSource === 'official' ? 'active' : ''} onClick={() => set({ downloadSource: 'official' })}>
                官方
              </button>
              <button className={settings.downloadSource === 'bmclapi' ? 'active' : ''} onClick={() => set({ downloadSource: 'bmclapi' })}>
                BMCLAPI
              </button>
            </div>
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">
            CurseForge API Key
            <span className="set-desc">下载地图（世界存档）要用；在 console.curseforge.com 免费申请</span>
          </div>
          <div className="set-control wide">
            <input
              className="input"
              type="password"
              value={settings.curseforgeApiKey}
              placeholder="留空 = 不用在线地图下载（仍可导入本地地图包）"
              onChange={(e) => set({ curseforgeApiKey: e.target.value })}
            />
            <button className="ghost-btn" onClick={() => void window.api.openExternal('https://console.curseforge.com/#/api-keys')}>
              申请
            </button>
          </div>
        </div>
        <div className="set-row">
          <div className="set-label">并发下载数</div>
          <div className="set-control">
            <input
              className="input num"
              type="number"
              min={1}
              max={64}
              value={settings.downloadConcurrency}
              onChange={(e) => set({ downloadConcurrency: Math.max(1, Math.min(64, Number(e.target.value) || 8)) })}
            />
          </div>
        </div>
      </section>

      <section className="set-group">
        <div className="set-title">微软登录</div>
        <div className="set-row">
          <div className="set-label">
            Azure 客户端 ID
            <span className="set-desc">留空用内置公共 ID；用自己的应用更稳</span>
          </div>
          <div className="set-control wide">
            <input className="input" value={settings.msaClientId} placeholder="Application (client) ID" onChange={(e) => set({ msaClientId: e.target.value })} />
          </div>
        </div>
      </section>

      <div className="about-box">
        <Icon name="fish" size={16} />
        <div>
          <div>肥鱼启动器 0.1.0</div>
          <div className="muted tiny">从零写起的 Minecraft 启动器 · Electron + React + TypeScript</div>
        </div>
      </div>
    </div>
  )
}
