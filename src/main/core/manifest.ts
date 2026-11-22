import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { VersionJson, VersionManifest } from '../../shared/types'
import { dataRoot, P } from './paths'
import { downloadFile, fetchJson, retry } from './http'

export const OFFICIAL_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
/** 镜像站上同一个 manifest 的地址（测速用） */
export const MIRROR_MANIFEST = 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'

export type DownloadSource = 'official' | 'bmclapi' | 'auto'

let sourceMode: DownloadSource = 'official'
/** auto 模式下测速选出来的实际源 */
let effective: 'official' | 'bmclapi' = 'official'
let probedAt = 0
const PROBE_TTL_MS = 10 * 60_000

export function setDownloadSource(s: DownloadSource): void {
  sourceMode = s
  if (s !== 'auto') effective = s
  else probedAt = 0 // 切到 auto 时强制重新测一次
}
export function getDownloadSource(): DownloadSource {
  return sourceMode
}
export function getEffectiveSource(): 'official' | 'bmclapi' {
  return effective
}

interface ProbeResult {
  ok: boolean
  ms: number
  kbps: number
}

/**
 * 实打实下载一次 manifest 量出吞吐（不是只看首包延迟）。
 * 两边下的是同一个文件，所以 KB/s 可以直接横向比。
 */
async function probe(url: string): Promise<ProbeResult> {
  const t0 = Date.now()
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!r.ok) return { ok: false, ms: Number.POSITIVE_INFINITY, kbps: 0 }
    const buf = await r.arrayBuffer()
    const ms = Math.max(1, Date.now() - t0)
    return { ok: true, ms, kbps: buf.byteLength / 1024 / (ms / 1000) }
  } catch {
    return { ok: false, ms: Number.POSITIVE_INFINITY, kbps: 0 }
  }
}

/**
 * auto 模式下实测两边吞吐，谁快用谁。
 * - 一边挂了就用另一边；都挂了先用官方（官方挂了下载时还有镜像兜底）
 * - 吞吐差 15% 以内视为持平，改比响应延迟，避免来回抖
 * - 结果缓存 10 分钟
 */
export async function ensureEffectiveSource(): Promise<'official' | 'bmclapi'> {
  if (sourceMode !== 'auto') return sourceMode
  if (Date.now() - probedAt < PROBE_TTL_MS) return effective
  const [off, mir] = await Promise.all([probe(OFFICIAL_MANIFEST), probe(MIRROR_MANIFEST)])
  let picked: 'official' | 'bmclapi'
  if (off.ok && !mir.ok) picked = 'official'
  else if (!off.ok && mir.ok) picked = 'bmclapi'
  else if (!off.ok && !mir.ok) picked = 'official'
  else {
    const ratio = mir.kbps / Math.max(1, off.kbps)
    if (ratio > 1.15) picked = 'bmclapi'
    else if (ratio < 0.87) picked = 'official'
    else picked = off.ms <= mir.ms ? 'official' : 'bmclapi'
  }
  effective = picked
  probedAt = Date.now()
  const fmt = (p: ProbeResult): string => (p.ok ? `${p.kbps.toFixed(0)} KB/s (${p.ms}ms)` : '失败')
  console.log(`[下载源] 实测吞吐 官方 ${fmt(off)} / 镜像 ${fmt(mir)} → 用 ${effective}`)
  return effective
}

/** 按指定的源改写 URL（不传就用当前生效的源） */
export function rewriteUrlAs(url: string, which: 'official' | 'bmclapi' = effective): string {
  if (which !== 'bmclapi') return url
  const map: [RegExp, string][] = [
    [/^https:\/\/launchermeta\.mojang\.com/, 'https://bmclapi2.bangbang93.com'],
    [/^https:\/\/piston-meta\.mojang\.com/, 'https://bmclapi2.bangbang93.com'],
    [/^https:\/\/piston-data\.mojang\.com/, 'https://bmclapi2.bangbang93.com'],
    [/^https:\/\/launcher\.mojang\.com/, 'https://bmclapi2.bangbang93.com'],
    [/^https:\/\/resources\.download\.minecraft\.net/, 'https://bmclapi2.bangbang93.com/assets'],
    [/^https:\/\/libraries\.minecraft\.net/, 'https://bmclapi2.bangbang93.com/maven'],
    [/^https:\/\/files\.minecraftforge\.net\/maven/, 'https://bmclapi2.bangbang93.com/maven'],
    [/^https:\/\/maven\.fabricmc\.net/, 'https://bmclapi2.bangbang93.com/maven']
  ]
  for (const [re, rep] of map) if (re.test(url)) return url.replace(re, rep)
  return url
}

/** 把官方 URL 改写为镜像 URL（BMCLAPI） */
export function rewriteUrl(url: string): string {
  return rewriteUrlAs(url, effective)
}

/** 同一个文件的「另一个源」地址，用于失败回退 */
export function alternateUrl(url: string): string {
  const other: 'official' | 'bmclapi' = effective === 'bmclapi' ? 'official' : 'bmclapi'
  return rewriteUrlAs(url, other)
}

function cacheDir(): string {
  const d = join(dataRoot(), 'cache')
  if (!existsSync(d)) fs.mkdir(d, { recursive: true }).catch(() => {})
  return d
}

interface CachedManifest {
  fetchedAt: number
  data: VersionManifest
}

const MANIFEST_TTL = 10 * 60 * 1000

export async function getVersionManifest(force = false): Promise<VersionManifest> {
  const file = join(cacheDir(), 'version_manifest_v2.json')
  if (!force && existsSync(file)) {
    try {
      const cached = JSON.parse(await fs.readFile(file, 'utf8')) as CachedManifest
      if (Date.now() - cached.fetchedAt < MANIFEST_TTL && cached.data?.versions?.length) return cached.data
    } catch {
      /* 缓存坏了就重新拉 */
    }
  }
  const data = await retry(async () => {
    const url = rewriteUrl(OFFICIAL_MANIFEST)
    return fetchJson<VersionManifest>(url, { timeout: 30000 })
  }, 3, 1000)
  await fs.writeFile(file, JSON.stringify({ fetchedAt: Date.now(), data })).catch(() => {})
  return data
}

export async function findVersionEntry(id: string): Promise<{ url: string; sha1: string } | null> {
  const manifest = await getVersionManifest()
  const v = manifest.versions.find((x) => x.id === id)
  return v ? { url: v.url, sha1: v.sha1 } : null
}

/** 拿到版本 JSON：优先本地（已安装/已缓存），否则下载 */
export async function getVersionJson(id: string, opts: { force?: boolean } = {}): Promise<VersionJson> {
  const local = P.versionJson(id)
  if (!opts.force && existsSync(local)) {
    try {
      return JSON.parse(await fs.readFile(local, 'utf8')) as VersionJson
    } catch {
      /* 破损则重下 */
    }
  }
  const entry = await findVersionEntry(id)
  if (!entry) throw new Error(`版本 ${id} 不在版本清单里`)
  const dir = P.versionDir(id)
  await fs.mkdir(dir, { recursive: true })
  await downloadFile(rewriteUrl(entry.url), local, { sha1: entry.sha1, retries: 3 })
  return JSON.parse(await fs.readFile(local, 'utf8')) as VersionJson
}

/** 解析 inheritsFrom 链，合并出最终可用的版本 JSON（为 Forge/Fabric 预留） */
export async function getResolvedVersionJson(id: string): Promise<VersionJson> {
  const chain: VersionJson[] = []
  let cur: VersionJson | null = await getVersionJson(id)
  const seen = new Set<string>()
  while (cur) {
    chain.unshift(cur) // 父在前
    if (!cur.inheritsFrom) break
    if (seen.has(cur.inheritsFrom)) throw new Error('版本继承链出现循环')
    seen.add(cur.inheritsFrom)
    cur = await getVersionJson(cur.inheritsFrom)
  }
  if (chain.length === 1) return chain[0]

  // 从最抽象的（父版本）开始，逐层被子版本覆盖
  const merged: VersionJson = JSON.parse(JSON.stringify(chain[0]))
  for (const part of chain.slice(1)) {
    if (part.id) merged.id = part.id
    if (part.type) merged.type = part.type
    if (part.mainClass) merged.mainClass = part.mainClass
    if (part.assets) merged.assets = part.assets
    if (part.assetIndex) merged.assetIndex = part.assetIndex
    if (part.minecraftArguments) merged.minecraftArguments = part.minecraftArguments
    if (part.javaVersion) merged.javaVersion = part.javaVersion
    if (part.logging) merged.logging = part.logging
    if (part.jar) merged.jar = part.jar
    if (part.inheritsFrom) merged.inheritsFrom = part.inheritsFrom
    if (part.downloads?.client) merged.downloads = { ...(merged.downloads ?? {}), client: part.downloads.client }
    if (part.libraries?.length) merged.libraries = [...(merged.libraries ?? []), ...part.libraries]
    if (part.arguments) {
      merged.arguments = {
        game: [...(merged.arguments?.game ?? []), ...(part.arguments.game ?? [])],
        jvm: [...(merged.arguments?.jvm ?? []), ...(part.arguments.jvm ?? [])]
      }
    }
  }
  return merged
}
