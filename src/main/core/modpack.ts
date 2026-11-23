import { existsSync, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { downloadFile, ensureDir, pool } from './http'
import { installLoader, type LoaderType } from './loaders'
import { installVersion, type InstallContext } from './install'
import { P, safeJoin } from './paths'

interface MrpackIndex {
  formatVersion: number
  name: string
  versionId: string
  dependencies: Record<string, string>
  files: { path: string; downloads: string[]; hashes?: Record<string, string>; fileSize?: number }[]
}

export interface ModpackInstallResult {
  versionId: string
  name: string
  files: number
  loader?: LoaderType
  loaderVersion?: string
}

/**
 * 安装 Modrinth 整合包（.mrpack）：
 * 1. 读 index 里的 dependencies，装对应的原版 + 加载器
 * 2. 按 files 列表下载 mod / 资源包到版本目录
 * 3. 解压 overrides/ 覆盖到版本目录
 */
export async function installModpack(mrpackPath: string, ctx: InstallContext): Promise<ModpackInstallResult> {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(mrpackPath)
  const entry = zip.getEntry('modrinth.index.json')
  if (!entry) throw new Error('不是合法的 .mrpack：缺少 modrinth.index.json')
  const idx = JSON.parse(entry.getData().toString('utf8')) as MrpackIndex

  const mc = idx.dependencies?.minecraft
  if (!mc) throw new Error('整合包没写支持的 Minecraft 版本')

  const fabricVer = idx.dependencies['fabric-loader']
  const quiltVer = idx.dependencies['quilt-loader']
  const forgeVer = idx.dependencies['forge']
  const neoVer = idx.dependencies['neoforge']

  // 1) 原版
  if (!existsSync(P.versionJson(mc))) {
    ctx.onProgress({ taskId: ctx.taskId, phase: '安装整合包基底', current: 0, total: 1, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: `Minecraft ${mc}` })
    await installVersion(mc, ctx)
  }

  // 2) 加载器
  let versionId = mc
  let loader: LoaderType | undefined
  let loaderVersion: string | undefined
  if (fabricVer) {
    loader = 'fabric'
    loaderVersion = fabricVer
  } else if (quiltVer) {
    loader = 'quilt'
    loaderVersion = quiltVer
  } else if (forgeVer) {
    loader = 'forge'
    loaderVersion = forgeVer
  } else if (neoVer) {
    loader = 'neoforge'
    loaderVersion = neoVer
  }
  if (loader && loaderVersion) {
    const r = await installLoader(loader, mc, loaderVersion, ctx)
    versionId = r.versionId
  }

  const vdir = join(P.versions, versionId)

  // 3) 文件
  const files = idx.files ?? []
  let done = 0
  ctx.onProgress({ taskId: ctx.taskId, phase: '下载整合包文件', current: 0, total: files.length, bytesDone: 0, bytesTotal: 0, finished: false })
  await pool(files, 6, async (f) => {
    if (ctx.isCancelled()) throw new Error('已取消')
    const dest = safeJoin(vdir, f.path)
    if (dest) {
      const url = f.downloads?.[0]
      if (url) {
        await downloadFile(url, dest, {
          sha1: f.hashes?.sha1,
          size: f.fileSize,
          retries: 3,
          timeout: 180000
        }).catch((e) => {
          throw new Error(`整合包文件 ${f.path} 下载失败: ${(e as Error).message}`)
        })
      }
    }
    done++
    ctx.onProgress({ taskId: ctx.taskId, phase: '下载整合包文件', current: done, total: files.length, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: f.path })
  })

  // 4) overrides
  const ovEntries = zip.getEntries().filter((e) => e.entryName.startsWith('overrides/') && !e.isDirectory)
  ctx.onProgress({ taskId: ctx.taskId, phase: '展开整合包配置', current: 0, total: ovEntries.length, bytesDone: 0, bytesTotal: 0, finished: false })
  const madeDirs = new Set<string>()
  for (let i = 0; i < ovEntries.length; i++) {
    const e = ovEntries[i]
    const rel = e.entryName.slice('overrides/'.length)
    const dest = safeJoin(vdir, rel)
    if (dest) {
      const dir = dirname(dest)
      if (!madeDirs.has(dir)) {
        ensureDir(dir)
        madeDirs.add(dir)
      }
      await fs.writeFile(dest, e.getData())
    }
    if (i % 20 === 0) {
      ctx.onProgress({ taskId: ctx.taskId, phase: '展开整合包配置', current: i + 1, total: ovEntries.length, bytesDone: 0, bytesTotal: 0, finished: false, currentFile: rel })
    }
  }

  // 5) 记一笔
  await fs.writeFile(
    join(vdir, '.modpack.json'),
    JSON.stringify({ name: idx.name, versionId: idx.versionId, mc, loader, loaderVersion, installedAt: Date.now() }, null, 2)
  )

  return { versionId, name: idx.name, files: files.length, loader, loaderVersion }
}
