import { useEffect, useRef, useState } from 'react'
import type { Account, DeviceCodeInfo } from '../../../shared/types'
import { useApp } from '../store'
import { Icon, Modal, Spinner } from '../components/ui'

export default function Accounts() {
  const { accounts, active, reloadAccounts, toast } = useApp()
  const [adding, setAdding] = useState(false)
  const [offlineName, setOfflineName] = useState('')
  const [msModal, setMsModal] = useState(false)
  const [authlibModal, setAuthlibModal] = useState(false)
  const [busy, setBusy] = useState(false)

  const addOffline = async (): Promise<void> => {
    setBusy(true)
    try {
      const acc = await window.api.accounts.addOffline(offlineName)
      await reloadAccounts()
      toast(`离线账号 ${acc.name} 已添加`, 'ok')
      setAdding(false)
      setOfflineName('')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: Account): Promise<void> => {
    await window.api.accounts.remove(a.id)
    await reloadAccounts()
    toast(`已移除 ${a.name}`)
  }

  const setActive = async (a: Account): Promise<void> => {
    await window.api.accounts.setActive(a.id)
    await reloadAccounts()
    toast(`当前账号切换为 ${a.name}`, 'ok')
  }

  const refreshMs = async (a: Account): Promise<void> => {
    setBusy(true)
    try {
      if (a.type === 'authlib') await window.api.accounts.refreshAuthlib(a.id)
      else await window.api.accounts.msRefresh(a.id)
      await reloadAccounts()
      toast('登录已刷新', 'ok')
    } catch (e) {
      toast(`刷新失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page accounts">
      <div className="page-head">
        <div>
          <h2>账号</h2>
          <p className="page-sub">正版账号走微软登录，离线账号纯本地生成 UUID</p>
        </div>
        <div className="btn-row">
          <button className="ghost-btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> 离线账号
          </button>
          <button className="ghost-btn" onClick={() => setAuthlibModal(true)}>
            <Icon name="box" size={15} /> 外置登录
          </button>
          <button className="primary-btn" onClick={() => setMsModal(true)}>
            <Icon name="user" size={15} /> 微软登录
          </button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="center-box">
          <Icon name="user" size={26} />
          <span>还没有账号。离线账号也能进单机/离线服务器。</span>
        </div>
      ) : (
        <div className="account-list">
          {accounts.map((a) => {
            const isActive = active?.id === a.id
            return (
              <div key={a.id} className={`account-card ${isActive ? 'active' : ''}`}>
                <div className={`avatar big ${a.type}`}>{a.name.slice(0, 1).toUpperCase()}</div>
                <div className="ac-main">
                  <div className="ac-name">
                    {a.name}
                    {isActive && <span className="active-badge">当前</span>}
                  </div>
                  <div className="ac-sub">
                    {a.type === 'microsoft' ? '微软账号' : a.type === 'authlib' ? `外置登录 · ${a.serverName ?? a.apiUrl?.replace(/^https?:\/\//, '')}` : '离线账号'} ·{' '}
                    {a.uuid.slice(0, 8)}…
                  </div>
                </div>
                <div className="ac-actions">
                  {(a.type === 'microsoft' || a.type === 'authlib') && (
                    <button className="ghost-btn" disabled={busy} onClick={() => void refreshMs(a)}>
                      刷新登录
                    </button>
                  )}
                  {!isActive && (
                    <button className="ghost-btn" onClick={() => void setActive(a)}>
                      设为当前
                    </button>
                  )}
                  <button className="icon-btn danger" onClick={() => void remove(a)} title="移除">
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <Modal onClose={() => setAdding(false)} width={400}>
          <h3>添加离线账号</h3>
          <p className="muted small">只影响本地，进不了需要正版验证的服务器。</p>
          <input
            className="input"
            autoFocus
            value={offlineName}
            maxLength={16}
            placeholder="玩家名（字母/数字/下划线）"
            onChange={(e) => setOfflineName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addOffline()}
          />
          <div className="modal-actions">
            <button className="ghost-btn" onClick={() => setAdding(false)}>
              取消
            </button>
            <button className="primary-btn" disabled={busy || !offlineName.trim()} onClick={() => void addOffline()}>
              {busy ? <Spinner /> : null} 添加
            </button>
          </div>
        </Modal>
      )}

      {msModal && <MicrosoftLogin onClose={() => setMsModal(false)} onDone={() => void reloadAccounts()} />}
      {authlibModal && <AuthlibLogin onClose={() => setAuthlibModal(false)} onDone={() => void reloadAccounts()} />}
    </div>
  )
}

/** 外置登录：填验证服务器地址 + 用户名密码，走 Yggdrasil API */
function AuthlibLogin({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useApp()
  const [apiUrl, setApiUrl] = useState('https://littleskin.cn/api/yggdrasil')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [serverName, setServerName] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = async (): Promise<void> => {
    setChecking(true)
    setError(null)
    setServerName(null)
    try {
      const meta = await window.api.accounts.authlibMeta(apiUrl)
      setServerName(meta.serverName)
      toast(`服务器可用：${meta.serverName}`, 'ok')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const acc = await window.api.accounts.addAuthlib(apiUrl, username, password)
      toast(`外置账号 ${acc.name} 登录成功`, 'ok')
      onDone()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} width={470}>
      <h3>外置登录</h3>
      <p className="muted small">第三方皮肤站 / 自建验证服务器，基于 Yggdrasil API。登录会通过 authlib-injector 注入游戏。</p>
      <div className="field">
        <span className="field-label">验证服务器地址</span>
        <div className="row-actions" style={{ marginTop: 0 }}>
          <input className="input" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://littleskin.cn/api/yggdrasil" />
          <button className="ghost-btn" onClick={() => void check()} disabled={checking || !apiUrl.trim()}>
            {checking ? <Spinner size={12} /> : null} 验证
          </button>
        </div>
        {serverName && <span className="ok tiny">✓ {serverName}</span>}
      </div>
      <div className="field">
        <span className="field-label">用户名 / 邮箱</span>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <span className="field-label">密码</span>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      </div>
      {error && <p className="err small">{error}</p>}
      <p className="muted tiny">密码只用于这一次登录请求，不保存在本地；本地只存服务器发回的令牌。</p>
      <div className="modal-actions">
        <button className="ghost-btn" onClick={onClose}>
          取消
        </button>
        <button className="primary-btn" disabled={busy || !username.trim() || !password} onClick={() => void submit()}>
          {busy ? <Spinner size={12} /> : null} 登录
        </button>
      </div>
    </Modal>
  )
}

function MicrosoftLogin({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [info, setInfo] = useState<DeviceCodeInfo | null>(null)
  const [state, setState] = useState<'starting' | 'waiting' | 'done' | 'error'>('starting')
  const [message, setMessage] = useState('')
  const timer = useRef<number | null>(null)
  const stopped = useRef(false)

  useEffect(() => {
    void (async () => {
      try {
        const d = await window.api.accounts.msStart()
        setInfo(d)
        setState('waiting')
        void window.api.openExternal(d.verificationUri)
      } catch (e) {
        setState('error')
        setMessage((e as Error).message)
      }
    })()
    return () => {
      stopped.current = true
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  useEffect(() => {
    if (!info || state !== 'waiting') return
    let delay = info.interval * 1000
    const tick = async (): Promise<void> => {
      if (stopped.current) return
      try {
        const r = await window.api.accounts.msPoll(info.deviceCode)
        if (r.status === 'done') {
          setState('done')
          setMessage(`欢迎，${r.account?.name ?? ''}`)
          onDone()
          setTimeout(onClose, 1600)
          return
        }
        if (r.status === 'error') {
          setState('error')
          setMessage(r.message ?? '登录失败')
          return
        }
        if (r.message === 'slow_down') delay += 5000
      } catch (e) {
        setState('error')
        setMessage((e as Error).message)
        return
      }
      timer.current = window.setTimeout(() => void tick(), delay)
    }
    timer.current = window.setTimeout(() => void tick(), delay)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [info, state, onDone, onClose])

  const copy = async (): Promise<void> => {
    if (!info) return
    await navigator.clipboard.writeText(info.userCode)
    setMessage('设备码已复制')
  }

  return (
    <Modal onClose={onClose} width={460}>
      <h3>微软账号登录</h3>
      {state === 'starting' && (
        <div className="ms-loading">
          <Spinner size={20} /> 正在申请设备码……
        </div>
      )}
      {info && state !== 'starting' && (
        <>
          <p className="muted small">浏览器已打开微软登录页。输入下面的代码，登录你的微软账号（需要有 Minecraft: Java Edition）。</p>
          <button className="device-code" onClick={() => void copy()} title="点击复制">
            {info.userCode}
          </button>
          <p className="muted tiny">
            没弹出浏览器？手动打开{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                void window.api.openExternal('https://www.microsoft.com/link')
              }}
            >
              microsoft.com/link
            </a>
          </p>
          <div className="ms-status">
            {state === 'waiting' && (
              <>
                <Spinner size={14} /> 等待你在浏览器里完成登录……
              </>
            )}
            {state === 'done' && (
              <span className="ok">
                <Icon name="check" size={15} /> {message}
              </span>
            )}
            {state === 'error' && (
              <span className="err">
                <Icon name="alert" size={15} /> {message}
              </span>
            )}
          </div>
        </>
      )}
      {state === 'error' && !info && <p className="err">{message}</p>}
      <div className="modal-actions">
        <button className="ghost-btn" onClick={onClose}>
          {state === 'done' ? '完成' : '关闭'}
        </button>
      </div>
    </Modal>
  )
}
