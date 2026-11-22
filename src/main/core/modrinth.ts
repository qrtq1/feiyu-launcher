import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ResourceHit, ResourceType, ResourceVersionLite } from '../../shared/resources'
import { downloadFile, ensureDir, fetchJson } from './http'
import { P } from './paths'

const API = 'https://api.modrinth.com/v2'
const UA = 'FeiyuLauncher/0.1.0 (feiyu-launcher; contact: local)'

interface SearchResponse {
  hits: {
    project_id: string
    slug: string
    title: string
    description: string
    project_type: ResourceType
    downloads: number
    follows: number
    author: string
    icon_url?: string
    categories: string[]
    versions: string[]
    display_categories?: string[]
  }[]
  total_hits: number
}

export interface SearchOptions {
  query: string
  type: ResourceType
  mcVersion?: string
  loader?: string
  /** 分类标签，比如 optimization / adventure */
  tag?: string
  /** relevance | downloads | updated | newest */
  sort?: string
  limit?: number
  offset?: number
}

/** Modrinth 的加载器过滤走 categories facet */
export async function searchResources(opts: SearchOptions): Promise<{ hits: ResourceHit[]; total: number }> {
  const facets: string[][] = [[`project_type:${opts.type}`]]
  if (opts.mcVersion) facets.push([`versions:${opts.mcVersion}`])
  if (opts.loader) facets.push([`categories:${opts.loader}`])
  if (opts.tag) facets.push([`categories:${opts.tag}`])

  const params = new URLSearchParams({
    query: opts.query ?? '',
    facets: JSON.stringify(facets),
    limit: String(opts.limit ?? 20),
    offset: String(opts.offset ?? 0),
    index: opts.sort || 'relevance'
  })
  const res = await fetchJson<SearchResponse>(`${API}/search?${params.toString()}`, { timeout: 20000, headers: { 'User-Agent': UA } })
  return {
    total: res.total_hits,
    hits: (res.hits ?? []).map((h) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      type: h.project_type,
      downloads: h.downloads,
      follows: h.follows,
      author: h.author,
      iconUrl: h.icon_url,
      categories: h.display_categories ?? h.categories ?? [],
      versions: h.versions ?? [],
      loaders: h.display_categories ?? []
    }))
  }
}

interface RawVersion {
  id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  date_published: string
  files: { filename?: string; url: string; size: number; hashes?: { sha1?: string }; primary?: boolean }[]
  dependencies?: { project_id?: string; version_id?: string; dependency_type: string }[]
}

export async function getResourceVersions(projectId: string, mcVersion?: string, loader?: string): Promise<ResourceVersionLite[]> {
  const params = new URLSearchParams()
  if (mcVersion) params.set('game_versions', JSON.stringify([mcVersion]))
  if (loader) params.set('loaders', JSON.stringify([loader]))
  const url = `${API}/project/${encodeURIComponent(projectId)}/version${params.toString() ? `?${params.toString()}` : ''}`
  const arr = await fetchJson<RawVersion[]>(url, { timeout: 20000, headers: { 'User-Agent': UA } })
  return arr.map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    datePublished: v.date_published,
    files: (v.files ?? []).map((f) => ({
      name: f.filename ?? f.url.split('/').pop() ?? 'file',
      url: f.url,
      size: f.size,
      sha1: f.hashes?.sha1
    })),
    dependencies: (v.dependencies ?? []).map((d) => ({ projectId: d.project_id, versionId: d.version_id, dependencyType: d.dependency_type }))
  }))
}

/** 资源类型 → 游戏目录里的子目录 */
export function targetDirFor(type: ResourceType, versionDir?: string): string {
  const base = versionDir ?? P.root
  switch (type) {
    case 'mod':
      return join(base, 'mods')
    case 'resourcepack':
      return join(base, 'resourcepacks')
    case 'shader':
      return join(base, 'shaderpacks')
    case 'datapack':
      return join(base, 'datapacks')
    case 'modpack':
      return join(base, 'modpacks')
    default:
      return base
  }
}

export interface DownloadOutcome {
  file: string
  dir: string
  size: number
}

export async function downloadResource(opts: {
  type: ResourceType
  file: { name: string; url: string; size: number; sha1?: string }
  versionId?: string
  onProgress?: (bytes: number) => void
  isCancelled?: () => boolean
}): Promise<DownloadOutcome> {
  const dir = targetDirFor(opts.type, opts.versionId ? join(P.versions, opts.versionId) : undefined)
  ensureDir(dir)
  // 防目录穿越：只取文件名
  const safeName = opts.file.name.replace(/[\\/:*?"<>|]/g, '_')
  const dest = join(dir, safeName)
  if (opts.isCancelled?.()) throw new Error('已取消')
  const r = await downloadFile(opts.file.url, dest, {
    size: opts.file.size,
    sha1: opts.file.sha1,
    retries: 3,
    onBytes: (n) => opts.onProgress?.(n)
  })
  void existsSync
  void fs
  return { file: dest, dir, size: r.bytes }
}

/** 把 .mrpack 里的 modrinth.index.json 读出来（整合包安装用） */
export async function readMrpackIndex(mrpackPath: string): Promise<{ files: { path: string; downloads: string[]; hashes?: Record<string, string> }[]; name: string } | null> {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(mrpackPath)
  const entry = zip.getEntry('modrinth.index.json')
  if (!entry) return null
  const json = JSON.parse(entry.getData().toString('utf8')) as {
    name?: string
    files: { path: string; downloads: string[]; hashes?: Record<string, string> }[]
  }
  return { files: json.files ?? [], name: json.name ?? 'modpack' }
}

/**
 * 按项目 slug 拿一个匹配 mc 版本/加载器的文件，直接落到版本的 mods 目录。
 * 用于「装 Fabric 顺手装 Fabric API」这种场景。找不到返回 null。
 */
export async function downloadProjectMod(opts: {
  projectSlug: string
  mcVersion: string
  versionId?: string
  loader?: string
}): Promise<{ file: string; name: string } | null> {
  const versions = await getResourceVersions(opts.projectSlug, opts.mcVersion, opts.loader)
  const v = versions[0]
  const f = v?.files?.[0]
  if (!f) return null
  const dir = opts.versionId ? join(P.versions, opts.versionId, 'mods') : join(P.root, 'mods')
  ensureDir(dir)
  const safeName = f.name.replace(/[\\/:*?"<>|]/g, '_')
  const dest = join(dir, safeName)
  await downloadFile(f.url, dest, { size: f.size, sha1: f.sha1, retries: 3, timeout: 180000 })
  return { file: dest, name: safeName }
}
