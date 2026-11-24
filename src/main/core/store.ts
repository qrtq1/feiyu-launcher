import { safeStorage } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { BUILTIN_MSA_CLIENT_ID, DEFAULT_SETTINGS } from '../../shared/api'
import type { Account, FavoriteItem, Settings, VersionSettings } from '../../shared/types'
import { setExtraJavaPaths } from './java'
import { dataRoot, defaultGameDir, setGameDir, setVersionsDir } from './paths'

/**
 * 账号令牌落盘加密。
 * launcher-store.json 是明文 JSON，refreshToken 一旦泄露等于账号被完整接管，
 * 所以写盘前用 safeStorage（Windows 上是 DPAPI，绑定当前用户账户）过一遍。
 * 内存里的 cache 始终保持明文，业务代码不用感知。
 */
const ENC_PREFIX = 'enc:v1:'
type SecretField = 'accessToken' | 'refreshToken' | 'clientToken'
const SECRET_FIELDS: SecretField[] = ['accessToken', 'refreshToken', 'clientToken']

function encryptionAvailable(): boolean {
  try {
    // 纯 node 环境（CLI 冒烟测试）下 safeStorage 是 undefined
    return Boolean(safeStorage?.isEncryptionAvailable?.())
  } catch {
    return false
  }
}

function encryptSecret(value: string): string {
  try {
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
  } catch {
    return value
  }
}

function decryptSecret(value: string): string {
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    // 换了 Windows 用户、或 DPAPI 主键变了。宁可当成没登录，也不能把密文当令牌发出去
    return ''
  }
}

/** 返回新数组，绝不改动传进来的 cache */
function encodeAccounts(list: Account[]): Account[] {
  if (!encryptionAvailable()) return list
  return list.map((a) => {
    const out: Account = { ...a }
    for (const f of SECRET_FIELDS) {
      const v = out[f]
      if (typeof v === 'string' && v && !v.startsWith(ENC_PREFIX)) out[f] = encryptSecret(v)
    }
    return out
  })
}

/** 没有前缀的就是历史明文档，原样放行 —— 下次保存时会自动升级成密文 */
function decodeAccounts(list: Account[]): Account[] {
  return list.map((a) => {
    const out: Account = { ...a }
    for (const f of SECRET_FIELDS) {
      const v = out[f]
      if (typeof v === 'string' && v.startsWith(ENC_PREFIX)) out[f] = decryptSecret(v)
    }
    return out
  })
}

interface StoreShape {
  settings: Settings
  accounts: Account[]
  activeAccountId: string | null
  favorites: FavoriteItem[]
  versionSettings: Record<string, VersionSettings>
  launchCount: Record<string, number>
  lastPlayedAt: Record<string, number>
  /** 同意陶瓦联机协议的时间戳 */
  multiplayerAgreedAt: number | null
}

let cache: StoreShape | null = null
/** 进行中的加载：并发调用共享同一次读盘，避免重复初始化 */
let loading: Promise<StoreShape> | null = null
/** 临时文件序号：并发 save 各写各的 tmp，不会互相踩 */
let saveSeq = 0
/** 落盘串行化：并发 save 排队执行，避免交错 rename 互相覆盖 */
let saving: Promise<void> = Promise.resolve()

function storeFile(): string {
  return join(dataRoot(), 'launcher-store.json')
}

function defaults(): StoreShape {
  return {
    settings: { gameDir: defaultGameDir(), ...DEFAULT_SETTINGS },
    accounts: [],
    activeAccountId: null,
    favorites: [],
    versionSettings: {},
    launchCount: {},
    lastPlayedAt: {},
    multiplayerAgreedAt: null
  }
}

export function loadStore(): Promise<StoreShape> {
  if (cache) return Promise.resolve(cache)
  if (!loading) loading = readStore().finally(() => { loading = null })
  return loading
}

async function readStore(): Promise<StoreShape> {
  const file = storeFile()
  let raw: Partial<StoreShape> = {}
  if (existsSync(file)) {
    const text = await fs.readFile(file, 'utf8')
    try {
      // 有些编辑器 / 旧版本会带 BOM，直接 parse 会炸
      raw = JSON.parse(text.replace(/^\uFEFF/, '')) as Partial<StoreShape>
    } catch {
      // 存档坏了绝不能静默回退成空：先留一份副本，否则一次写坏
      // 就会让用户的全部账号和设置凭空消失，还查无对证
      const backup = `${file}.corrupt-${Date.now()}`
      await fs.copyFile(file, backup).catch(() => undefined)
      raw = {}
    }
  }
  const base = defaults()
  const store: StoreShape = {
    settings: { ...base.settings, ...(raw.settings ?? {}) },
    accounts: decodeAccounts(raw.accounts ?? []),
    activeAccountId: raw.activeAccountId ?? (raw.accounts?.[0]?.id ?? null),
    favorites: raw.favorites ?? [],
    versionSettings: raw.versionSettings ?? {},
    launchCount: raw.launchCount ?? {},
    lastPlayedAt: raw.lastPlayedAt ?? {},
    multiplayerAgreedAt: raw.multiplayerAgreedAt ?? null
  }
  if (!store.settings.gameDir) store.settings.gameDir = defaultGameDir()
  setGameDir(store.settings.gameDir)
  setVersionsDir(store.settings.versionsDir || null)
  setExtraJavaPaths(store.settings.extraJavaPaths ?? [])
  cache = store
  return store
}

function save(): Promise<void> {
  const run = async (): Promise<void> => {
    if (!cache) return
    const file = storeFile()
    await fs.mkdir(dirname(file), { recursive: true })
    // 落盘用密文快照，内存里的 cache 不动
    const snapshot: StoreShape = { ...cache, accounts: encodeAccounts(cache.accounts) }
    const tmp = `${file}.${process.pid}.${++saveSeq}.tmp`
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2))
    await fs.rename(tmp, file)
  }
  // 串行落盘：前一次失败也不挡后一次；调用方拿到的是自己这次的完成/失败
  saving = saving.then(run, run)
  return saving
}

export async function getSettings(): Promise<Settings> {
  const s = await loadStore()
  const settings = { ...s.settings }
  // 老配置里是空串：界面显示内置的登录应用，而不是一片空白
  if (!settings.msaClientId) settings.msaClientId = BUILTIN_MSA_CLIENT_ID
  return settings
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const s = await loadStore()
  s.settings = { ...s.settings, ...patch }
  if (patch.gameDir) setGameDir(patch.gameDir)
  if (patch.versionsDir !== undefined) setVersionsDir(patch.versionsDir || null)
  if (patch.extraJavaPaths !== undefined) setExtraJavaPaths(patch.extraJavaPaths || [])
  await save()
  return { ...s.settings }
}

export async function listAccounts(): Promise<Account[]> {
  // 返回副本，与 getSettings 的口径一致，调用方改不到 cache 内部
  return [...(await loadStore()).accounts]
}

export async function activeAccount(): Promise<Account | null> {
  const s = await loadStore()
  if (!s.activeAccountId) return null
  return s.accounts.find((a) => a.id === s.activeAccountId) ?? null
}

export async function setActiveAccount(id: string): Promise<void> {
  const s = await loadStore()
  if (!s.accounts.some((a) => a.id === id)) throw new Error('账号不存在')
  s.activeAccountId = id
  await save()
}

export async function addAccount(acc: Account, makeActive = true): Promise<Account> {
  const s = await loadStore()
  const idx = s.accounts.findIndex((a) => a.id === acc.id)
  if (idx >= 0) s.accounts[idx] = acc
  else s.accounts.push(acc)
  if (makeActive) s.activeAccountId = acc.id
  await save()
  return acc
}

export async function removeAccount(id: string): Promise<void> {
  const s = await loadStore()
  s.accounts = s.accounts.filter((a) => a.id !== id)
  if (s.activeAccountId === id) s.activeAccountId = s.accounts[0]?.id ?? null
  await save()
}

export async function updateAccount(acc: Account): Promise<Account> {
  return addAccount(acc, false)
}

// ---------------- 收藏 ----------------

export async function listFavorites(): Promise<FavoriteItem[]> {
  return (await loadStore()).favorites
}
export async function addFavorite(item: FavoriteItem): Promise<FavoriteItem[]> {
  const s = await loadStore()
  if (!s.favorites.some((f) => f.id === item.id)) s.favorites.push(item)
  await save()
  return s.favorites
}

export async function removeFavorite(id: string): Promise<FavoriteItem[]> {
  const s = await loadStore()
  s.favorites = s.favorites.filter((f) => f.id !== id)
  await save()
  return s.favorites
}

// ---------------- 实例（版本）级设置 ----------------

export async function getVersionSettings(versionId: string): Promise<VersionSettings> {
  return (await loadStore()).versionSettings[versionId] ?? {}
}

export async function setVersionSettings(versionId: string, patch: Partial<VersionSettings>): Promise<VersionSettings> {
  const s = await loadStore()
  const next = { ...(s.versionSettings[versionId] ?? {}), ...patch }
  // 传 null 表示清掉这一项，回退到全局
  for (const k of Object.keys(next) as (keyof VersionSettings)[]) {
    if (next[k] === null || next[k] === undefined) delete next[k]
  }
  s.versionSettings[versionId] = next
  await save()
  return next
}

/** 实例改名后把按版本 id 存的设置一起搬过去 */
export async function migrateVersionData(oldId: string, newId: string): Promise<void> {
  const s = await loadStore()
  const move = <T>(rec: Record<string, T>): void => {
    if (rec[oldId] === undefined) return
    rec[newId] = rec[oldId]
    delete rec[oldId]
  }
  move(s.versionSettings)
  move(s.launchCount)
  move(s.lastPlayedAt)
  await save()
}

export async function bumpLaunchCount(versionId: string): Promise<void> {
  const s = await loadStore()
  s.launchCount[versionId] = (s.launchCount[versionId] ?? 0) + 1
  s.lastPlayedAt[versionId] = Date.now()
  await save()
}

export async function getLaunchStats(versionId: string): Promise<{ launchCount: number; lastPlayedAt?: number }> {
  const s = await loadStore()
  return { launchCount: s.launchCount[versionId] ?? 0, lastPlayedAt: s.lastPlayedAt[versionId] }
}

/** 记录用户同意陶瓦联机协议的时间 */
export async function agreeMultiplayer(): Promise<number> {
  const s = await loadStore()
  s.multiplayerAgreedAt = Date.now()
  await save()
  return s.multiplayerAgreedAt
}

export type { StoreShape }
