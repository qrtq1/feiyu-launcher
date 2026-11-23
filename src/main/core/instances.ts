import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { InstanceFile, InstanceFileKind, VersionComponent, VersionStats } from '../../shared/types'
import { dirSize } from './install'
import { pool } from './http'
import { getResolvedVersionJson } from './manifest'
import { P } from './paths'
import { getLaunchStats } from './store'

/** 实例里各类资源的目录名 */
export function filesDir(versionId: string, kind: InstanceFileKind, isolated = true): string {
  const base = isolated ? P.versionDir(versionId) : P.root
  return join(base, kind)
}

/** 列实例里的文件；模组支持读 .disabled 后缀判断是否启用 */
export async function listInstanceFiles(versionId: string, kind: InstanceFileKind, isolated = true): Promise<InstanceFile[]> {
  const dir = filesDir(versionId, kind, isolated)
  if (!existsSync(dir)) return []
  const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  // stat / 目录大小并发算；pool 按原顺序回填，排序规则不变
  const out = (await pool(items, 8, async (it): Promise<InstanceFile | null> => {
    const full = join(dir, it.name)
    const st = await fs.stat(full).catch(() => null)
    if (!st) return null
    // 存档目录算一个整体
    const isDir = it.isDirectory()
    if (isDir && kind !== 'saves') return null
    const disabled = it.name.endsWith('.disabled')
    return {
      name: disabled ? it.name.replace(/\.disabled$/, '') : it.name,
      path: full,
      size: isDir ? await dirSize(full).catch(() => 0) : st.size,
      mtime: st.mtimeMs,
      isDir,
      enabled: !disabled
    }
  })).filter((f): f is InstanceFile => f !== null)
  return out.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
}

/** 启用 / 禁用模组（改 .disabled 后缀） */
export async function toggleInstanceFile(path: string): Promise<void> {
  if (!existsSync(path)) throw new Error('文件不存在')
  if (path.endsWith('.disabled')) {
    await fs.rename(path, path.replace(/\.disabled$/, ''))
  } else {
    await fs.rename(path, `${path}.disabled`)
  }
}

/** 解析一个实例实际装了什么 */
export async function describeComponents(versionId: string): Promise<VersionComponent[]> {
  // resolved 合并后已带 inheritsFrom，不必把同一份 json 读两遍
  const resolved = await getResolvedVersionJson(versionId).catch(() => null)
  if (!resolved) throw new Error(`找不到版本 ${versionId}`)

  const out: VersionComponent[] = []
  const mcVersion = resolved.inheritsFrom ?? versionId

  out.push({ kind: 'minecraft', name: 'Minecraft', version: mcVersion, removable: false })

  const libNames = (resolved.libraries ?? []).map((l) => ({ name: l.name, ver: l.name.split(':')[2] ?? '' }))
  const find = (re: RegExp) => libNames.find((l) => re.test(l.name))

  const fabric = find(/^net\.fabricmc:fabric-loader:/)
  if (fabric) out.push({ kind: 'fabric', name: 'Fabric', version: fabric.ver, removable: true })
  const quilt = find(/^org\.quiltmc:quilt-loader:/)
  if (quilt) out.push({ kind: 'quilt', name: 'Quilt', version: quilt.ver, removable: true })
  const forge = find(/^net\.minecraftforge:forge:/)
  if (forge) out.push({ kind: 'forge', name: 'Forge', version: forge.ver.replace(new RegExp(`^${mcVersion}-`), ''), removable: true })
  const neo = find(/^net\.neoforged:forge:/)
  if (neo) out.push({ kind: 'neoforge', name: 'NeoForge', version: neo.ver, removable: true })
  const opti = find(/^optifine:OptiFine:/)
  if (opti) out.push({ kind: 'optifine', name: 'OptiFine', version: opti.ver, removable: true })

  // Fabric API 是 mods 目录里的普通文件
  if (fabric) {
    const modsDir = join(P.versionDir(versionId), 'mods')
    const files = await fs.readdir(modsDir).catch(() => [] as string[])
    const api = files.find((f) => /^fabric-api.*\.jar$/i.test(f))
    if (api) {
      const m = api.match(/fabric-api-([\d.]+)/i)
      out.push({ kind: 'api', name: 'Fabric API', version: m?.[1] ?? '未知', removable: true })
    }
  }

  return out
}

/** 实例统计：启动次数 + 目录大小 + 安装时间 */
export async function instanceStats(versionId: string): Promise<VersionStats> {
  const mark = await fs
    .readFile(P.installedMark(versionId), 'utf8')
    .then((t) => JSON.parse(t) as { installedAt?: number })
    .catch(() => null)
  const launch = await getLaunchStats(versionId)
  const size = await dirSize(P.versionDir(versionId)).catch(() => 0)
  return {
    launchCount: launch.launchCount,
    installedAt: mark?.installedAt,
    sizeBytes: size,
    lastPlayedAt: launch.lastPlayedAt
  }
}

/** 导出实例为整合包（zip） */
export async function exportInstance(versionId: string, targetZip: string): Promise<{ file: string; entries: number }> {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip()
  const root = P.versionDir(versionId)
  if (!existsSync(root)) throw new Error('版本目录不存在')

  let entries = 0
  const walk = async (dir: string, rel = ''): Promise<void> => {
    const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const it of items) {
      const full = join(dir, it.name)
      const relPath = rel ? `${rel}/${it.name}` : it.name
      if (it.isDirectory()) {
        await walk(full, relPath)
      } else {
        // 跳过日志、natives 和移除备份
        if (relPath.startsWith('logs') || relPath.startsWith('natives') || relPath.startsWith('_removed')) continue
        const buf = await fs.readFile(full).catch(() => null)
        if (buf) {
          zip.addFile(relPath, buf)
          entries++
        }
      }
    }
  }
  await walk(root)

  const components = await describeComponents(versionId)
  zip.addFile(
    'feiyu-pack.json',
    Buffer.from(
      JSON.stringify(
        {
          launcher: 'feiyu-launcher',
          exportedAt: new Date().toISOString(),
          versionId,
          components: components.map((c) => ({ name: c.name, version: c.version }))
        },
        null,
        2
      )
    )
  )

  await fs.mkdir(dirname(targetZip), { recursive: true })
  zip.writeZip(targetZip)
  return { file: targetZip, entries }
}

/** 把实例里的某个组件文件挪进 _removed 备份目录（可逆，绝不真删） */
export async function retireComponent(
  versionId: string,
  kind: string
): Promise<{ moved: string[]; target: string }> {
  const root = P.versionDir(versionId)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(root, '_removed', stamp)
  const moved: string[] = []

  const moveMatching = async (dir: string, re: RegExp): Promise<void> => {
    const items = await fs.readdir(dir).catch(() => [] as string[])
    for (const n of items) {
      if (!re.test(n)) continue
      if (n.endsWith('.disabled')) continue
      await fs.mkdir(target, { recursive: true })
      const from = join(dir, n)
      const to = join(target, n)
      await fs.rename(from, to)
      // 同名的 .disabled 也一起挪走，免得留下半套
      const off = `${from}.disabled`
      if (existsSync(off)) await fs.rename(off, `${to}.disabled`).catch(() => undefined)
      moved.push(from)
    }
  }

  if (kind === 'api') {
    await moveMatching(join(root, 'mods'), /^(legacy-)?fabric-api.*\.jar$/i)
  }
  if (!moved.length) throw new Error('这个组件没有可拆的文件')
  return { moved, target }
}

/** 导入实例 zip（导出功能的逆操作）：解到 versions/<id>，id 冲突自动加后缀 */
export async function importInstance(zipPath: string): Promise<{ versionId: string; files: number; dir: string }> {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(zipPath)
  let pack: { versionId?: string } = {}
  const meta = zip.getEntry('feiyu-pack.json')
  if (meta) {
    try {
      pack = JSON.parse(meta.getData().toString('utf8')) as { versionId?: string }
    } catch {
      /* 元数据坏了就当没有 */
    }
  }
  const clean = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'imported'
  const base = clean(pack.versionId ?? basename(zipPath, extname(zipPath)))
  let id = base
  let n = 1
  let root = P.versionDir(id)
  await fs.mkdir(dirname(root), { recursive: true })
  // 不带 recursive 的 mkdir：EEXIST 就是撞名，换下一个后缀重试，避免检查与创建之间的 TOCTOU
  for (;;) {
    try {
      await fs.mkdir(root)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      n++
      id = `${base}-imported${n > 2 ? n : ''}`
      root = P.versionDir(id)
    }
  }

  let files = 0
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue
    const name = e.entryName.replace(/\\/g, '/')
    if (name === 'feiyu-pack.json') continue
    // 防目录穿越（含盘符 / 冒号路径）
    if (name.startsWith('/') || name.split('/').includes('..') || /^[a-z]:/i.test(name) || name.includes(':')) continue
    if (name.startsWith('_removed/')) continue

    // 版本 json / jar 的文件名必须跟目录名一致，id 变了就一起改名
    let rel = name
    if (base !== id && (name === `${base}.json` || name === `${base}.jar`)) {
      rel = name.replace(`${base}.`, `${id}.`)
    }
    const dest = join(root, rel)
    await fs.mkdir(dirname(dest), { recursive: true })
    let data = e.getData()
    if (rel === `${id}.json` && base !== id) {
      try {
        const raw = JSON.parse(data.toString('utf8')) as { id?: string }
        raw.id = id
        data = Buffer.from(JSON.stringify(raw, null, 2))
      } catch {
        /* 不是合法 json 就原样写 */
      }
    }
    await fs.writeFile(dest, data)
    files++
  }
  return { versionId: id, files, dir: root }
}

/** 重命名实例：目录、版本 json（含里面 id 字段）、jar 一起改；不删任何文件 */
export async function renameInstance(oldId: string, rawNewId: string): Promise<string> {
  const newId = rawNewId.replace(/[\\/:*?"<>|]/g, '').trim()
  if (!newId) throw new Error('名字不能为空')
  if (newId === oldId) return oldId
  if (newId.length > 64) throw new Error('名字太长了（最多 64 个字符）')
  const from = P.versionDir(oldId)
  if (!existsSync(from)) throw new Error(`找不到版本 ${oldId}`)
  if (existsSync(P.versionDir(newId))) throw new Error(`已经有叫 ${newId} 的版本了`)

  const to = P.versionDir(newId)
  await fs.rename(from, to)

  const jsonFrom = join(to, `${oldId}.json`)
  if (existsSync(jsonFrom)) {
    const jsonTo = join(to, `${newId}.json`)
    await fs.rename(jsonFrom, jsonTo)
    try {
      const raw = JSON.parse(await fs.readFile(jsonTo, 'utf8')) as { id?: string }
      raw.id = newId
      await fs.writeFile(jsonTo, JSON.stringify(raw, null, 2))
    } catch {
      /* json 坏了就保持原样 */
    }
  }
  const jarFrom = join(to, `${oldId}.jar`)
  if (existsSync(jarFrom)) await fs.rename(jarFrom, join(to, `${newId}.jar`))

  return newId
}

/**
 * 克隆一个版本目录成新实例（用于「同一个版本装两份、各玩各的」）。
 * 只复制版本本体（json / jar / natives / 安装标记），不复制 mods、存档、日志。
 */
export async function cloneInstance(srcId: string, rawNewId: string): Promise<string> {
  const newId = rawNewId.replace(/[\\/:*?"<>|]/g, '').trim()
  if (!newId) throw new Error('名字不能为空')
  if (newId === srcId) throw new Error('新名字不能和原来的一模一样')
  if (newId.length > 64) throw new Error('名字太长了（最多 64 个字符）')
  const srcDir = P.versionDir(srcId)
  if (!existsSync(srcDir)) throw new Error(`找不到版本 ${srcId}`)
  const dstDir = P.versionDir(newId)
  if (existsSync(dstDir)) throw new Error(`已经有叫 ${newId} 的版本了，换个名字`)

  await fs.mkdir(dstDir, { recursive: true })
  for (const name of await fs.readdir(srcDir)) {
    const full = join(srcDir, name)
    const st = await fs.stat(full).catch(() => null)
    if (!st) continue
    if (st.isDirectory()) {
      // natives 要带过去，其它目录（mods/saves/logs/配置）保持干净
      if (name === 'natives') await fs.cp(full, join(dstDir, name), { recursive: true })
      continue
    }
    const target =
      name === `${srcId}.json` ? `${newId}.json` : name === `${srcId}.jar` ? `${newId}.jar` : name
    await fs.copyFile(full, join(dstDir, target))
  }

  // 版本 json 里的 id 必须跟着改，否则启动器认不出来
  const jsonPath = join(dstDir, `${newId}.json`)
  if (existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as { id?: string }
      raw.id = newId
      await fs.writeFile(jsonPath, JSON.stringify(raw, null, 2))
    } catch {
      /* json 坏了就原样留着 */
    }
  }

  // 安装标记也带过去，但 id 要改
  const markSrc = P.installedMark(srcId)
  if (existsSync(markSrc)) {
    try {
      const mark = JSON.parse(await fs.readFile(markSrc, 'utf8')) as { id?: string }
      mark.id = newId
      await fs.writeFile(P.installedMark(newId), JSON.stringify(mark, null, 2))
    } catch {
      await fs.copyFile(markSrc, P.installedMark(newId)).catch(() => undefined)
    }
  }

  return newId
}

