import { createHash, randomUUID } from 'node:crypto'
import type { Account, DeviceCodeInfo } from '../../shared/types'
import { fetchJson } from './http'
import { addAccount, listAccounts, updateAccount } from './store'

/** 微软账号登录有两套端点：
 *  - Live Connect（login.live.com/oauth20_*）：Minecraft 官方启动器用的老端点，
 *    默认 client_id 就是走这条，实测可用
 *  - Azure AD v2.0（login.microsoftonline.com/consumers/oauth2/v2.0）：用户自己注册应用时用
 *  传进来的 clientId 是 GUID 就按 Azure 处理，否则按 Live Connect 处理。
 */
const LIVE_HOST = 'https://login.live.com'
const AZURE_HOST = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
const SCOPE = 'XboxLive.signin offline_access'

/** Minecraft 官方启动器的 Live Connect 公共客户端 ID */
export const DEFAULT_CLIENT_ID = '00000000402b5328'

interface AuthEndpoint {
  host: string
  clientId: string
  mode: 'live' | 'azure'
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function resolveAuthEndpoint(clientId: string): AuthEndpoint {
  const cid = (clientId ?? '').trim()
  if (!cid) return { host: LIVE_HOST, clientId: DEFAULT_CLIENT_ID, mode: 'live' }
  if (GUID_RE.test(cid)) return { host: AZURE_HOST, clientId: cid, mode: 'azure' }
  return { host: LIVE_HOST, clientId: cid, mode: 'live' }
}

/** 离线玩家 UUID（和原版离线模式一致：md5("OfflinePlayer:"+name) 打成 v3 UUID） */
export function offlineUuid(name: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function addOfflineAccount(name: string): Promise<Account> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('名字不能为空')
  if (trimmed.length > 16) throw new Error('名字最长 16 个字符')
  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) throw new Error('只能用字母、数字和下划线')
  const existing = (await listAccounts()).find((a) => a.type === 'offline' && a.name.toLowerCase() === trimmed.toLowerCase())
  if (existing) return existing
  const acc: Account = {
    id: `offline-${randomUUID()}`,
    type: 'offline',
    name: trimmed,
    uuid: offlineUuid(trimmed)
  }
  return addAccount(acc)
}

// ---------------- 微软登录 ----------------

interface MsTokenResponse {
  token_type: string
  scope: string
  expires_in: number
  access_token: string
  refresh_token: string
  id_token?: string
  user_id?: string
}

interface XblResponse {
  Token: string
  DisplayClaims: { xui: { uhs: string }[] }
}

interface McLoginResponse {
  username: string
  roles: string[]
  access_token: string
  token_type: string
  expires_in: number
}

interface McProfile {
  id: string
  name: string
  skins?: { id: string; state: string; url: string; variant: string }[]
  capes?: unknown[]
}

async function getXblToken(msAccessToken: string): Promise<XblResponse> {
  return fetchJson<XblResponse>('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    }),
    timeout: 20000
  })
}

async function getXstsToken(xblToken: string): Promise<XblResponse> {
  const res = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    }),
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { XErr?: number }
    const xerr = body.XErr
    const msg =
      xerr === 2148916233
        ? '这个微软账号还没有 Xbox 账号，先去 xbox.com 创建'
        : xerr === 2148916235
          ? '该账号所在地区不支持 Xbox Live'
          : xerr === 2148916238
            ? '未成年人账号需要家长同意'
            : `XSTS 认证失败 (XErr=${xerr ?? res.status})`
    throw new Error(msg)
  }
  return (await res.json()) as XblResponse
}

async function loginWithXbox(xblToken: string, uhs: string): Promise<McLoginResponse> {
  return fetchJson<McLoginResponse>('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xblToken}` }),
    timeout: 20000
  })
}

async function getProfile(mcAccessToken: string): Promise<McProfile> {
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mcAccessToken}` },
    signal: AbortSignal.timeout(20000)
  })
  if (res.status === 404) throw new Error('这个账号没有购买 Minecraft: Java Edition')
  if (!res.ok) throw new Error(`获取玩家档案失败: HTTP ${res.status}`)
  return (await res.json()) as McProfile
}

/** 用微软 access token 走完整条链，返回账号 */
async function msTokenToAccount(msToken: MsTokenResponse): Promise<Account> {
  const xbl = await getXblToken(msToken.access_token)
  const xsts = await getXstsToken(xbl.Token)
  const uhs = xsts.DisplayClaims?.xui?.[0]?.uhs
  if (!uhs) throw new Error('XSTS 响应缺少用户哈希')
  const mc = await loginWithXbox(xsts.Token, uhs)
  const profile = await getProfile(mc.access_token)
  const acc: Account = {
    id: `ms-${profile.id}`,
    type: 'microsoft',
    name: profile.name,
    uuid: profile.id,
    accessToken: mc.access_token,
    refreshToken: msToken.refresh_token,
    expiresAt: Date.now() + mc.expires_in * 1000,
    skinModel: profile.skins?.find((s) => s.state === 'ACTIVE')?.variant ?? 'classic'
  }
  return acc
}

/** 开启设备码登录：返回给界面展示的 user_code */
export async function startDeviceCode(clientId: string): Promise<DeviceCodeInfo> {
  const ep = resolveAuthEndpoint(clientId)
  const url = ep.mode === 'live' ? `${ep.host}/oauth20_connect.srf` : `${ep.host}/devicecode`
  const body =
    ep.mode === 'live'
      ? new URLSearchParams({ client_id: ep.clientId, scope: SCOPE, response_type: 'device_code' })
      : new URLSearchParams({ client_id: ep.clientId, scope: SCOPE })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`获取设备码失败 HTTP ${res.status}: ${t.slice(0, 300)}`)
  }
  const j = (await res.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
    message?: string
  }
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri,
    expiresIn: j.expires_in,
    interval: j.interval || 5,
    message: j.message ?? `在浏览器打开 ${j.verification_uri} 并输入代码 ${j.user_code}`
  }
}

/** 轮询一次设备码状态 */
export async function pollDeviceCode(deviceCode: string, clientId: string): Promise<{ status: 'pending' | 'done' | 'error'; account?: Account; message?: string }> {
  const ep = resolveAuthEndpoint(clientId)
  const url = ep.mode === 'live' ? `${ep.host}/oauth20_token.srf` : `${ep.host}/token`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: ep.clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode
    }).toString(),
    signal: AbortSignal.timeout(20000)
  })
  const body = (await res.json().catch(() => null)) as (MsTokenResponse & { error?: string; error_description?: string }) | null
  // 网关/代理可能返回非 JSON 错误页：按契约返回结构化错误，别抛异常打断轮询状态机
  if (!body) return { status: 'error', message: `HTTP ${res.status}` }
  if (body.error === 'authorization_pending') return { status: 'pending' }
  if (body.error === 'slow_down') return { status: 'pending', message: 'slow_down' }
  if (body.error === 'expired_token') return { status: 'error', message: '设备码已过期，请重新获取' }
  if (body.error === 'authorization_declined' || body.error === 'access_denied') return { status: 'error', message: '你取消了登录' }
  if (body.error || !body.access_token) return { status: 'error', message: body.error_description ?? body.error ?? '未知错误' }
  try {
    const acc = await msTokenToAccount(body)
    await addAccount(acc)
    return { status: 'done', account: acc }
  } catch (e) {
    return { status: 'error', message: (e as Error).message }
  }
}

/** 用 refresh token 续期（启动前自动调用）。
 *  同一账号的并发续期合并成一次：Azure AD 会轮换 refresh_token，并发两份会让后到者 invalid_grant */
const refreshing = new Map<string, Promise<Account>>()
export function refreshMicrosoftAccount(id: string, clientId: string): Promise<Account> {
  const inflight = refreshing.get(id)
  if (inflight) return inflight
  const p = doRefreshMicrosoftAccount(id, clientId).finally(() => { refreshing.delete(id) })
  refreshing.set(id, p)
  return p
}

async function doRefreshMicrosoftAccount(id: string, clientId: string): Promise<Account> {
  const accounts = await listAccounts()
  const acc = accounts.find((a) => a.id === id)
  if (!acc) throw new Error('账号不存在')
  if (acc.type !== 'microsoft') return acc
  if (!acc.refreshToken) throw new Error('缺少 refresh_token，请重新登录')
  const ep = resolveAuthEndpoint(clientId)
  const url = ep.mode === 'live' ? `${ep.host}/oauth20_token.srf` : `${ep.host}/token`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: ep.clientId,
      grant_type: 'refresh_token',
      refresh_token: acc.refreshToken,
      scope: SCOPE
    }).toString(),
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`刷新登录失败 HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  const tok = (await res.json()) as MsTokenResponse
  const fresh = await msTokenToAccount(tok)
  const merged: Account = { ...fresh, id: acc.id }
  await updateAccount(merged)
  return merged
}

export async function ensureFreshAccount(id: string, clientId: string): Promise<Account> {
  const acc = (await listAccounts()).find((a) => a.id === id)
  if (!acc) throw new Error('账号不存在')
  if (acc.type !== 'microsoft') return acc
  // DPAPI 解密失败会得到空令牌：不能带着空 token 启动，走续期（refreshToken 也空时会明确提示重新登录）
  if (acc.accessToken && acc.expiresAt && acc.expiresAt - Date.now() > 5 * 60 * 1000) return acc
  return refreshMicrosoftAccount(id, clientId)
}
