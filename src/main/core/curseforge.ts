import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { ResourceHit, WorldMapFile, WorldMapHit } from '../../shared/types'
import { downloadFile, ensureDir, fetchJson, pool } from './http'
import { installVersion, type InstallContext } from './install'
import { installLoader, type LoaderType } from './loaders'
import { P, safeJoin } from './paths'

/**
 * 地图（世界存档）下载：Modrinth 没有 world 这一类，只能走 CurseForge 的
 * classId=17（Worlds）。CurseForge 的公开 API 强制要 x-api-key，所以 key
 * 由用户在设置里自己填（console.curseforge.com 免费申请）。
 */

const OFFICIAL = 'https://api.curseforge.com/v1'
/**
 * CurseForge 官方 API 要申请 key（走 Overwolf 人工审核），对普通用户太麻烦。
 * MCIM 的国内镜像把同一套 v1 接口原样代理，不需要 key，实测可用。
 */
const MIRROR = 'https://mod.mcimirror.top/curseforge/v1'
const GAME_ID = 432
/** CurseForge 的「Worlds」分类 */
const CLASS_WORLDS = 17

function endpoint(apiKey: string): { url: string; headers: Record<string, string> } {
  const key = apiKey.trim()
  // 有 key 就走官方；没有就走免 key 的镜像
  return key ? { url: OFFICIAL, headers: { 'x-api-key': key } } : { url: MIRROR, headers: {} }
}

/** CurseForge 的 CDN 直链规则：文件 id 拆成 /files/<高位>/<低位>/<文件名> */
export function cdnUrlFor(file: { id: number; fileName: string }): string {
  const hi = Math.floor(file.id / 1000)
  const lo = file.id % 1000
  return `https://edge.forgecdn.net/files/${hi}/${lo}/${encodeURIComponent(file.fileName)}`
}

/** CfFile → 统一的 WorldMapFile（三处映射共用） */
function toWorldMapFile(f: CfFile): WorldMapFile {
  return {
    id: f.id,
    name: f.displayName || f.fileName,
    fileName: f.fileName,
    size: f.fileLength ?? 0,
    date: f.fileDate,
    gameVersions: f.gameVersions ?? [],
    // 官方 API 对普通 key 会把 downloadUrl 置空，那就按 CDN 规则自己拼
    downloadUrl: f.downloadUrl || cdnUrlFor({ id: f.id, fileName: f.fileName })
  }
}

export class MissingCurseforgeKey extends Error {
  constructor() {
    super('还没有配置 CurseForge API Key（设置 → 下载 → CurseForge API Key，免费申请：https://console.curseforge.com/#/api-keys）')
  }
}

interface CfPagination {
  index: number
  pageSize: number
  resultCount: number
  totalCount: number
}

interface CfMod {
  id: number
  name: string
  slug: string
  summary: string
  downloadCount: number
  logo?: { thumbnailUrl?: string; url?: string }
  links?: { websiteUrl?: string }
}

interface CfFile {
  id: number
  displayName: string
  fileName: string
  fileLength: number
  fileDate: string
  downloadUrl: string | null
  gameVersions: string[]
}

async function cfGet<T>(path: string, apiKey: string): Promise<T> {
  const { url, headers } = endpoint(apiKey)
  return fetchJson<T>(`${url}${path}`, { timeout: 25000, headers })
}

/** 搜地图；query 为空就是「最热」 */
export async function searchWorldMaps(
  query: string,
  apiKey: string,
  index = 0,
  pageSize = 20
): Promise<{ hits: WorldMapHit[]; total: number }> {
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(CLASS_WORLDS),
    index: String(index),
    pageSize: String(pageSize),
    sortField: '2', // 2 = Popularity
    sortOrder: 'desc'
  })
  if (query.trim()) params.set('searchFilter', query.trim())
  const res = await cfGet<{ data: CfMod[]; pagination: CfPagination }>(`/mods/search?${params.toString()}`, apiKey)
  return {
    total: res.pagination?.totalCount ?? 0,
    hits: (res.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      summary: m.summary ?? '',
      iconUrl: m.logo?.thumbnailUrl ?? m.logo?.url,
      downloads: m.downloadCount ?? 0,
      url: m.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/worlds/${m.slug}`
    }))
  }
}

/** 某个地图项目的文件列表（优先当前 MC 版本） */
export async function listWorldMapFiles(modId: number, apiKey: string, gameVersion?: string): Promise<WorldMapFile[]> {
  // 世界只是 CurseForge 的一个类目，逻辑与 listCfFiles 完全相同，直接委托
  return listCfFiles({ projectId: modId, apiKey, mcVersion: gameVersion })
}

/**
 * 把地图 zip 解到 <saves>/<世界名>/。
 * 地图包结构不统一：有的根目录直接是 level.dat，有的外面套一层文件夹。
 * 这里找到 level.dat 所在层级，把它下面那一层的所有文件铺进目标目录。
 */
export async function extractWorldZip(zipPath: string, savesDir: string, worldName: string): Promise<{ world: string; dir: string }> {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  if (!entries.length) throw new Error('这个压缩包是空的')

  // level.dat 可能在根，也可能在一层子目录里；取路径最短的那个
  const candidates = entries
    .map((e) => e.entryName.replace(/\\/g, '/'))
    .filter((n) => /(^|\/)level\.dat$/i.test(n))
    .sort((a, b) => a.split('/').length - b.split('/').length)
  if (!candidates.length) throw new Error('这不是地图存档（压缩包里找不到 level.dat）')

  const levelPath = candidates[0]
  const prefix = levelPath.slice(0, levelPath.length - 'level.dat'.length) // 含结尾斜杠或空串

  const safeName = worldName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'map'
  const root = join(savesDir, safeName)
  if (existsSync(root)) throw new Error(`存档目录里已经有「${safeName}」了，先删掉或者改个名字`)

  let files = 0
  const madeDirs = new Set<string>()
  for (const e of entries) {
    const full = e.entryName.replace(/\\/g, '/')
    if (prefix && !full.startsWith(prefix)) continue
    const rel = prefix ? full.slice(prefix.length) : full
    if (!rel || rel.startsWith('../') || rel.includes('/../') || rel.startsWith('/')) continue
    const dest = join(root, rel)
    if (!dest.startsWith(root)) continue
    const dir = dirname(dest)
    if (!madeDirs.has(dir)) {
      await fs.mkdir(dir, { recursive: true })
      madeDirs.add(dir)
    }
    await fs.writeFile(dest, e.getData())
    files++
  }
  if (!files) throw new Error('地图包里没有可解压的文件')
  return { world: safeName, dir: root }
}

/** 下载地图并解到当前实例的 saves/ */
export async function downloadWorldMap(opts: {
  file: WorldMapFile
  versionId?: string
  isolated: boolean
  worldName?: string
}): Promise<{ dir: string; world: string }> {
  if (!opts.file.downloadUrl) throw new Error('这个文件没有直接下载地址（作者可能关掉了第三方下载）')
  const tmpDir = join(P.root, 'downloads')
  ensureDir(tmpDir)
  const tmp = join(tmpDir, opts.file.fileName.replace(/[\\/:*?"<>|]/g, '_'))
  await downloadFile(opts.file.downloadUrl, tmp, { size: opts.file.size || undefined, retries: 3, timeout: 300000 })
  const savesDir = opts.versionId && opts.isolated ? join(P.versionDir(opts.versionId), 'saves') : join(P.root, 'saves')
  ensureDir(savesDir)
  const worldName = opts.worldName || basename(opts.file.fileName, '.zip')
  return extractWorldZip(tmp, savesDir, worldName)
}

/** 用户自己选的本地地图包 */
export async function importWorldZip(zipPath: string, versionId?: string, isolated = true): Promise<{ world: string; dir: string }> {
  const savesDir = versionId && isolated ? join(P.versionDir(versionId), 'saves') : join(P.root, 'saves')
  ensureDir(savesDir)
  const worldName = basename(zipPath, '.zip')
  return extractWorldZip(zipPath, savesDir, worldName)
}

// ---------------- 通用：mod / 资源包 / 光影 / 整合包 ----------------

/** CurseForge 的 classId */
const CLASS_OF: Record<string, number> = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552
}

/** CurseForge 的 modLoaderType */
const LOADER_TYPE: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6
}

interface CfModFull extends CfMod {
  authors?: { name: string }[]
  categories?: { name: string }[]
  latestFilesIndexes?: { gameVersion: string; fileId: number; modLoader?: number }[]
}

/** 搜任意类目的项目，结果转成统一的 ResourceHit（id 带 cf: 前缀） */
export async function searchCfProjects(opts: {
  type: string
  query: string
  apiKey: string
  mcVersion?: string
  loader?: string
  index?: number
  pageSize?: number
}): Promise<{ hits: ResourceHit[]; total: number }> {
  const classId = CLASS_OF[opts.type]
  if (!classId) throw new Error(`CurseForge 没有这个类目：${opts.type}`)
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(classId),
    index: String(opts.index ?? 0),
    pageSize: String(opts.pageSize ?? 20),
    sortField: '6', // 6 = TotalDownloads
    sortOrder: 'desc'
  })
  if (opts.query.trim()) params.set('searchFilter', opts.query.trim())
  if (opts.mcVersion) params.set('gameVersion', opts.mcVersion)
  const loaderType = opts.loader ? LOADER_TYPE[opts.loader] : undefined
  if (loaderType) params.set('modLoaderType', String(loaderType))

  const res = await cfGet<{ data: CfModFull[]; pagination: CfPagination }>(`/mods/search?${params.toString()}`, opts.apiKey)
  return {
    total: res.pagination?.totalCount ?? 0,
    hits: (res.data ?? []).map((m) => ({
      id: `cf:${m.id}`,
      slug: m.slug,
      title: m.name,
      description: m.summary ?? '',
      type: opts.type,
      downloads: m.downloadCount ?? 0,
      follows: 0,
      author: m.authors?.[0]?.name ?? 'CurseForge',
      iconUrl: m.logo?.thumbnailUrl ?? m.logo?.url,
      categories: (m.categories ?? []).map((c) => c.name),
      versions: [],
      loaders: [],
      source: 'curseforge' as const
    }))
  }
}

/** 拿某个项目的文件列表（可按 MC 版本 / 加载器过滤） */
export async function listCfFiles(opts: {
  projectId: number
  apiKey: string
  mcVersion?: string
  loader?: string
}): Promise<WorldMapFile[]> {
  const params = new URLSearchParams({ pageSize: '50' })
  if (opts.mcVersion) params.set('gameVersion', opts.mcVersion)
  const loaderType = opts.loader ? LOADER_TYPE[opts.loader] : undefined
  if (loaderType) params.set('modLoaderType', String(loaderType))
  const res = await cfGet<{ data: CfFile[] }>(`/mods/${opts.projectId}/files?${params.toString()}`, opts.apiKey)
  return (res.data ?? []).map(toWorldMapFile)
}

/** 单个文件信息（整合包 manifest 里只有 fileID，需要回查文件名） */
export async function getCfFile(opts: { projectId: number; fileId: number; apiKey: string }): Promise<WorldMapFile> {
  const res = await cfGet<{ data: CfFile }>(`/mods/${opts.projectId}/files/${opts.fileId}`, opts.apiKey)
  const f = res.data
  if (!f) throw new Error(`找不到文件 ${opts.fileId}`)
  return toWorldMapFile(f)
}

// ---------------- CurseForge 整合包 ----------------

interface CfManifest {
  minecraft: { version: string; modLoaders: { id: string; primary?: boolean }[] }
  name: string
  version: string
  files: { projectID: number; fileID: number; required?: boolean }[]
  overrides?: string
}

/** `forge-47.2.0` / `fabric-0.15.11` / `neoforge-21.1.0` / `quilt-0.24.0` → { type, version } */
function parseLoaderId(id: string): { type: LoaderType; version: string } | null {
  const m = id.match(/^(forge|fabric|neoforge|quilt)-(.+)$/i)
  if (!m) return null
  const raw = m[1].toLowerCase()
  const type = (raw === 'neoforge' ? 'neoforge' : raw) as LoaderType
  return { type, version: m[2] }
}

/**
 * 安装 CurseForge 整合包：
 * 1. 下 zip，读 manifest.json
 * 2. 按 manifest.minecraft 装原版 + 加载器
 * 3. 按 files[] 回查每个文件并下到对应目录
 * 4. 解 overrides/ 覆盖过去
 */
export async function installCfModpack(opts: {
  projectId: number
  fileId: number
  apiKey: string
  ctx: InstallContext
}): Promise<{ versionId: string; name: string; files: number; loader?: LoaderType; loaderVersion?: string }> {
  const file = await getCfFile({ projectId: opts.projectId, fileId: opts.fileId, apiKey: opts.apiKey })
  const tmpDir = join(P.root, 'downloads')
  ensureDir(tmpDir)
  const zipPath = join(tmpDir, file.fileName.replace(/[\\/:*?"<>|]/g, '_'))
  opts.ctx.onProgress({ taskId: opts.ctx.taskId, phase: '下载整合包', current: 0, total: 1, bytesDone: 0, bytesTotal: file.size, finished: false, currentFile: file.fileName })
  await downloadFile(file.downloadUrl!, zipPath, { size: file.size || undefined, retries: 3, timeout: 600000 })
  return installCfModpackZip(zipPath, opts)
}

/** 从本地的 CurseForge 整合包 zip 安装（manifest.json + overrides） */
export async function installCfModpackZip(
  zipPath: string,
  opts: { apiKey: string; ctx: InstallContext }
): Promise<{ versionId: string; name: string; files: number; loader?: LoaderType; loaderVersion?: string }> {
  const { ctx } = opts
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry('manifest.json')
  if (!entry) throw new Error('不是合法的 CurseForge 整合包：缺少 manifest.json')
  const manifest = JSON.parse(entry.getData().toString('utf8')) as CfManifest
  const mc = manifest.minecraft?.version
  if (!mc) throw new Error('整合包没写 Minecraft 版本')

  // 2) 原版 + 加载器
  if (!existsSync(P.versionJson(mc))) {
    ctx.onProgress({ taskId: ctx.taskId, phase: '安装整合包基底', current: 0, total: 1, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: `Minecraft ${mc}` })
    await installVersion(mc, ctx)
  }
  const primary = manifest.minecraft.modLoaders?.find((l) => l.primary) ?? manifest.minecraft.modLoaders?.[0]
  let versionId = mc
  let loader: LoaderType | undefined
  let loaderVersion: string | undefined
  if (primary) {
    const parsed = parseLoaderId(primary.id)
    if (parsed) {
      loader = parsed.type
      loaderVersion = parsed.version
      const r = await installLoader(loader, mc, loaderVersion, ctx)
      versionId = r.versionId
    }
  }

  const vdir = P.versionDir(versionId)

  // 3) 逐个文件：回查文件名再按 CDN 规则下载
  const list = manifest.files ?? []
  let done = 0
  ctx.onProgress({ taskId: ctx.taskId, phase: '下载整合包文件', current: 0, total: list.length, bytesDone: 0, bytesTotal: 0, finished: false })
  const failed: string[] = []
  // 并发回查+下载：几百个 mod 串行就是几百个 RTT。并发压 4 防 CF 限流；
  // 错误按 manifest 原顺序收集，failed 列表与串行版一致
  const errors = new Array<string | null>(list.length).fill(null)
  await pool(list, 4, async (item, i) => {
    if (ctx.isCancelled()) throw new Error('已取消')
    try {
      const f = await getCfFile({ projectId: item.projectID, fileId: item.fileID, apiKey: opts.apiKey })
      const rel = f.fileName.endsWith('.zip') && /resourcepack|shader/i.test(f.fileName) ? `resourcepacks/${f.fileName}` : `mods/${f.fileName}`
      const dest = safeJoin(vdir, rel)
      if (dest && f.downloadUrl) {
        await downloadFile(f.downloadUrl, dest, { size: f.size || undefined, retries: 3, timeout: 300000 })
      }
    } catch (e) {
      errors[i] = `${item.projectID}/${item.fileID}: ${(e as Error).message}`
    }
    done++
    if (done % 5 === 0 || done === list.length) {
      ctx.onProgress({ taskId: ctx.taskId, phase: '下载整合包文件', current: done, total: list.length, bytesDone: 0, bytesTotal: 0, finished: false })
    }
  })
  for (const e of errors) if (e) failed.push(e)

  // 4) overrides
  const ovPrefix = `${manifest.overrides ?? 'overrides'}/`
  const ovEntries = zip.getEntries().filter((e) => e.entryName.startsWith(ovPrefix) && !e.isDirectory)
  for (let i = 0; i < ovEntries.length; i++) {
    const e = ovEntries[i]
    const rel = e.entryName.slice(ovPrefix.length)
    const dest = safeJoin(vdir, rel)
    if (dest) {
      ensureDir(dirname(dest))
      await fs.writeFile(dest, e.getData())
    }
    if (i % 20 === 0) {
      ctx.onProgress({ taskId: ctx.taskId, phase: '展开整合包配置', current: i + 1, total: ovEntries.length, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: rel })
    }
  }

  await fs.writeFile(
    join(vdir, '.modpack.json'),
    JSON.stringify({ name: manifest.name, version: manifest.version, mc, loader, loaderVersion, installedAt: Date.now(), failed }, null, 2)
  )

  return { versionId, name: manifest.name, files: list.length - failed.length, loader, loaderVersion }
}
