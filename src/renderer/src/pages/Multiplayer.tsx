import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { Icon, Modal, ProgressBar, Spinner } from '../components/ui'
import type { TerracottaState, TerracottaStatus } from '../../../shared/types'

const EXCEPTION_TEXT: Record<number, string> = {
  0: '无法连接房主（房间已关闭或网络不稳定）',
  1: '与房主的连接中断',
  2: '加入方网络组件崩溃',
  3: '房主网络组件崩溃',
  4: '房主退出了存档，房间已自动关闭',
  5: '脚手架协议错误（请向开发者反馈）'
}

const DIFFICULTY_TEXT: Record<string, string> = {
  UNKNOWN: '正在评估网络环境',
  EASIEST: '网络环境极佳',
  SIMPLE: '网络环境良好',
  MEDIUM: '网络环境一般，连接可能稍慢',
  TOUGH: '网络环境较差，连接可能失败'
}

const KIND_LABEL: Record<string, string> = { HOST: '房主', LOCAL: '本机', GUEST: '玩家' }

export default function Multiplayer() {
  const { toast, active, setPage, progress, installing } = useApp()
  const [status, setStatus] = useState<TerracottaStatus | null>(null)
  const [room, setRoom] = useState<TerracottaState | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logText, setLogText] = useState<string | null>(null)
  const indexRef = useRef(0)
  const failsRef = useRef(0)

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await window.api.multiplayer.status())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // 服务在跑就轮询房间状态（约 500ms）；index 不增的响应忽略；连续 5 次失败视为服务已退出
  const running = Boolean(status?.running)
  useEffect(() => {
    if (!running) return
    let on = true
    failsRef.current = 0
    const tick = async (): Promise<void> => {
      try {
        const s = await window.api.multiplayer.state()
        if (!on) return
        if (!s) {
          failsRef.current++
          if (failsRef.current >= 5) {
            setError('联机服务无响应，可能已退出')
            setRoom(null)
            void refreshStatus()
          }
          return
        }
        failsRef.current = 0
        if (s.index > indexRef.current) {
          indexRef.current = s.index
          setRoom(s)
        }
      } catch {
        /* 单次失败交给计数兜底 */
      }
    }
    const timer = setInterval(() => void tick(), 500)
    return () => {
      on = false
      clearInterval(timer)
    }
  }, [running, refreshStatus])

  const act = async (name: string, fn: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(name)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const agree = (): Promise<void> =>
    act('agree', async () => {
      await window.api.multiplayer.agree()
      await refreshStatus()
    })

  const install = (): Promise<void> =>
    act('install', async () => {
      const r = await window.api.multiplayer.install()
      toast(`陶瓦联机 ${r.version} 已就绪`, 'ok')
      await refreshStatus()
    })

  const start = (): Promise<void> =>
    act('start', async () => {
      await window.api.multiplayer.start()
      indexRef.current = 0
      setRoom(null)
      await refreshStatus()
    })

  const host = (): Promise<void> =>
    act('host', async () => {
      await window.api.multiplayer.host()
    })

  const join = (): Promise<void> =>
    act('join', async () => {
      if (!joinCode.trim()) {
        toast('请先输入房间码', 'err')
        return
      }
      await window.api.multiplayer.join(joinCode.trim())
    })

  const leave = (): Promise<void> =>
    act('leave', async () => {
      await window.api.multiplayer.leave()
      indexRef.current = 0
      setRoom(null)
    })

  const stop = (): Promise<void> =>
    act('stop', async () => {
      await window.api.multiplayer.stop()
      indexRef.current = 0
      setRoom(null)
      await refreshStatus()
      toast('联机服务已停止')
    })

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      toast(`已复制${label}`, 'ok')
    } catch {
      toast('复制失败，请手动复制', 'err')
    }
  }

  const showLog = (): Promise<void> =>
    act('log', async () => {
      setLogText(await window.api.multiplayer.log())
    })

  const st = room?.state ?? 'waiting'
  const mpProgress = installing && progress && progress.phase.includes('陶瓦') ? progress : null

  const members = (room?.profiles ?? []).map((p) => (
    <div key={p.machine_id} className="mp-member">
      <Icon name="user" size={14} />
      <span className="mp-member-name">{p.name}</span>
      <span className={`mp-kind ${p.kind.toLowerCase()}`}>{KIND_LABEL[p.kind] ?? p.kind}</span>
    </div>
  ))

  return (
    <div className="pane mp">
      <div className="mp-head">
        <h2>联机</h2>
        <span className="muted tiny">陶瓦联机 · 房间码 P2P 联机</span>
        {running && (
          <span className="mp-live">
            <span className="pulse" /> 服务运行中{status?.attached ? '（复用已有实例）' : ''}
            {status?.meta ? ` · ${status.meta.version}` : ''}
          </span>
        )}
      </div>

      {error && (
        <div className="mp-error">
          <Icon name="alert" size={15} />
          <span>{error}</span>
          <button className="icon-btn" onClick={() => setError(null)} aria-label="关闭错误提示">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {!status ? (
        <div className="mp-loading"><Spinner size={20} /></div>
      ) : !status.agreedAt ? (
        <div className="mp-agree">
          <h3>陶瓦联机使用协议</h3>
          <div className="mp-agree-body">
            <p>
              联机功能由开源项目 <b>Terracotta | 陶瓦联机</b>（作者 Burning_TNT）提供，基于 EasyTier 的 P2P 组网。
              本启动器下载官方未经修改的组件，并通过其本机 HTTP 接口创建 / 加入房间。使用前请确认以下说明：
            </p>
            <ul>
              <li>房主启动游戏、进入存档并「对局域网开放」后创建房间；朋友输入房间码即可加入，如同置身同一局域网。</li>
              <li>P2P 联机的稳定性取决于双方网络，不如服务器中继方案；联机功能不能取代 Minecraft 服务器，不适合长时间对外开放。</li>
              <li>加入方通过游戏内「陶瓦联机大厅」进入房间时，游戏会忽略正版验证（陶瓦的局域网联机机制）。</li>
              <li>房间成员可以看到你的显示名与设备标识，请只把房间码分享给信任的朋友。</li>
              <li>陶瓦联机以 AGPL-3.0-or-later（附例外条款）许可；本启动器仅通过进程间接口与其交互，并在本页显著位置标注其版权信息。</li>
            </ul>
            <div className="mp-agree-links">
              <button className="ghost-btn" onClick={() => void window.api.openExternal('https://burningtnt.github.io/Terracotta/')}>项目主页</button>
              <button className="ghost-btn" onClick={() => void window.api.openExternal('https://github.com/burningtnt/Terracotta/blob/master/LICENSE')}>许可全文</button>
              <button className="ghost-btn" onClick={() => void window.api.openExternal('https://burningtnt.github.io/Terracotta/http-api/')}>接口文档</button>
            </div>
          </div>
          <div className="mp-agree-actions">
            <button className="ghost-btn" onClick={() => setPage('home')}>不同意</button>
            <button className="primary-btn" disabled={busy === 'agree'} onClick={() => void agree()}>
              {busy === 'agree' ? <Spinner size={13} /> : <Icon name="check" size={14} />} 同意并继续
            </button>
          </div>
        </div>
      ) : !status.installed ? (
        <div className="mp-card">
          <Icon name="download" size={26} />
          <h3>下载陶瓦联机组件</h3>
          <p className="muted">首次使用需要下载官方组件（约十几 MB，来自 GitHub / Gitee 发行版）。下载后即可离线使用。</p>
          {mpProgress && (
            <div className="mp-progress">
              <ProgressBar value={mpProgress.bytesDone} max={Math.max(1, mpProgress.bytesTotal)} />
              <span className="muted tiny">{mpProgress.bytesTotal > 0 ? `${(mpProgress.bytesDone / 1048576).toFixed(1)} / ${(mpProgress.bytesTotal / 1048576).toFixed(1)} MB` : '下载中…'}</span>
            </div>
          )}
          <div className="mp-card-actions">
            <button className="primary-btn" disabled={busy === 'install' || installing} onClick={() => void install()}>
              {busy === 'install' ? <Spinner size={13} /> : <Icon name="download" size={14} />} 下载组件
            </button>
            <button className="ghost-btn" onClick={() => void window.api.multiplayer.openDir()}>打开组件目录（手动安装）</button>
          </div>
        </div>
      ) : !running ? (
        <div className="mp-card">
          <Icon name="globe" size={26} />
          <h3>启动联机服务</h3>
          <p className="muted">组件已就绪（v{status.version}）。启动后即可创建或加入房间。</p>
          <div className="mp-card-actions">
            <button className="primary-btn" disabled={busy === 'start'} onClick={() => void start()}>
              {busy === 'start' ? <Spinner size={13} /> : <Icon name="play" size={14} />} 启动联机服务
            </button>
          </div>
        </div>
      ) : (
        <div className="mp-room">
          {st === 'waiting' && (
            <div className="mp-idle">
              <div className="mp-card">
                <Icon name="home" size={22} />
                <h3>创建房间</h3>
                <p className="muted">先启动游戏、进入存档，按 ESC 选「对局域网开放」，然后点这里开房。</p>
                <button className="primary-btn" disabled={busy !== null} onClick={() => void host()}>
                  {busy === 'host' ? <Spinner size={13} /> : <Icon name="plus" size={14} />} 创建房间
                </button>
              </div>
              <div className="mp-card">
                <Icon name="user" size={22} />
                <h3>加入房间</h3>
                <p className="muted">输入朋友分享的房间码。</p>
                <input
                  className="input mp-code-input"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="U/XXXX-XXXX-XXXX-XXXX"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void join() }}
                  aria-label="房间码"
                />
                <button className="primary-btn" disabled={busy !== null || !joinCode.trim()} onClick={() => void join()}>
                  {busy === 'join' ? <Spinner size={13} /> : <Icon name="play" size={14} />} 加入房间
                </button>
              </div>
              <div className="mp-name muted tiny">房间内的显示名：{active?.name ?? '未选择账号（将显示为匿名）'}</div>
            </div>
          )}

          {st === 'host-scanning' && (
            <div className="mp-card mp-state">
              <Spinner size={20} />
              <h3>正在扫描本机 Minecraft 端口…</h3>
              <p className="muted">请确认游戏已启动、已进入存档，并且「对局域网开放」。</p>
              <button className="ghost-btn" disabled={busy !== null} onClick={() => void leave()}>取消</button>
            </div>
          )}

          {st === 'host-starting' && (
            <div className="mp-card mp-state">
              <Spinner size={20} />
              <h3>正在创建房间…</h3>
            </div>
          )}

          {st === 'host-ok' && room?.room && (
            <div className="mp-card mp-state">
              <h3>房间已就绪</h3>
              <p className="muted">把房间码发给朋友，让他们在「联机」页加入：</p>
              <div className="mp-roomcode">
                <code>{room.room}</code>
                <button className="ghost-btn" onClick={() => void copy(room.room!, '房间码')}>
                  <Icon name="check" size={13} /> 复制
                </button>
              </div>
              <div className="mp-members">{members}</div>
              <p className="muted tiny">保持游戏运行；你退出存档后房间会自动关闭。</p>
              <button className="ghost-btn" disabled={busy !== null} onClick={() => void leave()}>关闭房间</button>
            </div>
          )}

          {(st === 'guest-connecting' || st === 'guest-starting') && (
            <div className="mp-card mp-state">
              <Spinner size={20} />
              <h3>{st === 'guest-connecting' ? '正在连接房主…' : '正在建立 P2P 连接…'}</h3>
              {room?.difficulty && <p className="muted">{DIFFICULTY_TEXT[room.difficulty] ?? room.difficulty}</p>}
              <button className="ghost-btn" disabled={busy !== null} onClick={() => void leave()}>取消</button>
            </div>
          )}

          {st === 'guest-ok' && (
            <div className="mp-card mp-state">
              <h3><Icon name="check" size={16} /> 加入成功</h3>
              <p className="muted">在游戏多人列表里双击「陶瓦联机大厅」即可进入；也可以用备用直连地址：</p>
              {room?.url && (
                <div className="mp-roomcode">
                  <code>{room.url}</code>
                  <button className="ghost-btn" onClick={() => void copy(room.url!, '直连地址')}>
                    <Icon name="check" size={13} /> 复制
                  </button>
                </div>
              )}
              <div className="mp-members">{members}</div>
              <button className="ghost-btn" disabled={busy !== null} onClick={() => void leave()}>离开房间</button>
            </div>
          )}

          {st === 'exception' && (
            <div className="mp-card mp-state mp-exception">
              <Icon name="alert" size={22} />
              <h3>联机中断</h3>
              <p className="muted">{EXCEPTION_TEXT[room?.type ?? -1] ?? '未知异常'}</p>
              <button className="primary-btn" disabled={busy !== null} onClick={() => void leave()}>返回待机</button>
            </div>
          )}
        </div>
      )}

      <footer className="mp-footer">
        <span className="muted tiny">
          联机功能由 Terracotta | 陶瓦联机 © Burning_TNT 提供 · AGPL-3.0-or-later（附例外条款）
        </span>
        <div className="mp-footer-actions">
          {status?.installed && (
            <button className="ghost-btn" onClick={() => void window.api.multiplayer.openDir()}>组件目录</button>
          )}
          {running && (
            <button className="ghost-btn" disabled={busy !== null} onClick={() => void showLog()}>日志</button>
          )}
          {running && (
            <button className="ghost-btn" disabled={busy !== null} onClick={() => void stop()}>
              {busy === 'stop' ? <Spinner size={12} /> : <Icon name="stop" size={12} />} 停止服务
            </button>
          )}
        </div>
      </footer>

      {logText !== null && (
        <Modal onClose={() => setLogText(null)} width={680}>
          <h3>陶瓦联机日志</h3>
          <pre className="mp-log">{logText || '（空）'}</pre>
          <div className="mp-agree-actions">
            <button className="ghost-btn" onClick={() => setLogText(null)}>关闭</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
