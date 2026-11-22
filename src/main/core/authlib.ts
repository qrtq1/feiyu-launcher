import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Account } from '../../shared/types'
import { downloadFile, ensureDir, fetchJson } from './http'
import { P } from './paths'
import { addAccount, listAccounts, updateAccount } from './store'

/** 外置登录（authlib-injector / Yggdrasil API） */

export interface AuthlibMeta {
  serverName: string
  implementationName?: string
  implementationVersion?: string
  signaturePublickey?: string
}

interface AuthenticateResponse {
  accessToken: string
  clientToken: string
  availableProfiles?: { id: string; name: string }[]
  selectedProfile?: { id: string; name: string }
  user?: { id: string; username?: string }
}

const UA = 'FeiyuLauncher/0.1.0'

/** 规范化服务器地址：去掉末尾斜杠，允许用户直接粘 yggdrasil 根地址 */
export function normalizeApiUrl(input: string): string {
  let url = input.trim()
  if (!url) throw new Error('服务器地址不能为空')
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  url = url.replace(/\/+$/, '')
  // 有人会直接粘 /authserver 或 /sessionserver，去掉
  url = url.replace(/\/authserver$/, '').replace(/\/sessionserver$/, '')
  return url
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20000)
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON */
  }
  if (!res.ok) {
    const err = json as { error?: string; errorMessage?: string } | null
    const msg = err?.errorMessage ?? err?.error ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json as T
}

/** 读服务器元数据，顺便验证地址是否有效 */
export async function fetchAuthlibMeta(apiUrl: string): Promise<AuthlibMeta> {
  const url = normalizeApiUrl(apiUrl)
  const meta = await apiFetch<{ meta?: AuthlibMeta } & AuthlibMeta>(url)
  const m = meta?.meta ?? meta
  return {
    serverName: m?.serverName || '未命名验证服务器',
    implementationName: m?.implementationName,
    implementationVersion: m?.implementationVersion,
    signaturePublickey: m?.signaturePublickey
  }
}

/** 用户名密码登录，返回可直接用来启动的账号 */
export async function loginAuthlib(apiUrl: string, username: string, password: string): Promise<Account> {
  const url = normalizeApiUrl(apiUrl)
  if (!username.trim()) throw new Error('用户名不能为空')
  if (!password) throw new Error('密码不能为空')

  const meta = await fetchAuthlibMeta(url).catch(() => ({ serverName: '外置登录' }))
  const clientToken = randomUUID()

  const body = {
    username: username.trim(),
    password,
    clientToken,
    agent: { name: 'Minecraft', version: 1 },
    requestUser: false
  }
  const res = await apiFetch<AuthenticateResponse>(`${url}/authserver/authenticate`, {
    method: 'POST',
    body: JSON.stringify(body)
  })
  if (!res.accessToken) throw new Error('服务器没有返回 accessToken')
  const profile = res.selectedProfile ?? res.availableProfiles?.[0]
  if (!profile) throw new Error('这个账号没有已创建的角色（先去服务器网页建一个）')

  const acc: Account = {
    id: `authlib-${url}-${profile.id}`,
    type: 'authlib',
    name: profile.name,
    uuid: profile.id,
    accessToken: res.accessToken,
    clientToken: res.clientToken ?? clientToken,
    apiUrl: url,
    serverName: meta.serverName
  }
  return addAccount(acc)
}

/** 用 accessToken 续期 */
export async function refreshAuthlib(acc: Account): Promise<Account> {
  if (!acc.apiUrl) throw new Error('账号缺少服务器地址')
  const body = { accessToken: acc.accessToken, clientToken: acc.clientToken, requestUser: false }
  const res = await apiFetch<{ accessToken: string; clientToken: string; selectedProfile?: { id: string; name: string } }>(
    `${acc.apiUrl}/authserver/refresh`,
    { method: 'POST', body: JSON.stringify(body) }
  )
  const fresh: Account = {
    ...acc,
    accessToken: res.accessToken,
    clientToken: res.clientToken ?? acc.clientToken,
    name: res.selectedProfile?.name ?? acc.name,
    uuid: res.selectedProfile?.id ?? acc.uuid
  }
  await updateAccount(fresh)
  return fresh
}

export async function findAuthlibAccount(id: string): Promise<Account | null> {
  return (await listAccounts()).find((a) => a.id === id) ?? null
}

// ---------------- authlib-injector ----------------

interface InjectorLatest {
  build_number: number
  version: string
  download_url: string
  checksums?: { sha256?: string }
}

const INJECTOR_MIRROR = 'https://bmclapi2.bangbang93.com/mirrors/authlib-injector'
const INJECTOR_DIR = () => join(P.libraries, 'authlib-injector')

let cachedInjector: string | null = null

/**
 * 确保 authlib-injector 存在，返回 jar 路径。
 * 走 BMCLAPI 镜像（官方源在国内可能很慢）。
 */
export async function ensureAuthlibInjector(onProgress?: (done: number, total: number) => void): Promise<string> {
  if (cachedInjector && existsSync(cachedInjector)) return cachedInjector
  ensureDir(INJECTOR_DIR())

  let latest: InjectorLatest
  try {
    latest = await fetchJson<InjectorLatest>(`${INJECTOR_MIRROR}/artifact/latest.json`, { timeout: 15000 })
  } catch {
    latest = await fetchJson<InjectorLatest>('https://authlib-injector.yushi.moe/artifact/latest.json', { timeout: 20000 })
  }

  // 先找本地已有的版本
  const existing = (await fs.readdir(INJECTOR_DIR()).catch(() => []))
    .filter((f) => /^authlib-injector-.*\.jar$/.test(f))
    .sort()
    .pop()
  if (existing) {
    cachedInjector = join(INJECTOR_DIR(), existing)
    return cachedInjector
  }

  const dest = join(INJECTOR_DIR(), `authlib-injector-${latest.version}.jar`)
  const urls = [
    `${INJECTOR_MIRROR}/artifact/${latest.build_number}/authlib-injector-${latest.version}.jar`,
    latest.download_url
  ]
  let lastErr: Error | null = null
  for (const url of urls) {
    try {
      await downloadFile(url, dest, { retries: 3, timeout: 120000 })
      onProgress?.(1, 1)
      cachedInjector = dest
      return dest
    } catch (e) {
      lastErr = e as Error
    }
  }
  throw new Error(`authlib-injector 下载失败: ${lastErr?.message ?? '未知错误'}`)
}

export function authlibInjectorArg(jar: string, apiUrl: string): string {
  return `-javaagent:${jar}=${apiUrl}`
}
