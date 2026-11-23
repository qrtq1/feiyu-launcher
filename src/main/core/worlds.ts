import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { WorldSave } from '../../shared/types'
import { assertInsideData, P } from './paths'
import { dirSize } from './install'
import { pool } from './http'

async function scanDir(dir: string): Promise<WorldSave[]> {
  if (!existsSync(dir)) return []
  const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  // 只认带 level.dat 的目录
  const worlds = items.filter((it) => it.isDirectory() && existsSync(join(dir, it.name, 'level.dat')))
  // 存档可能很大，目录大小并发算；pool 保证按原顺序回填，排序规则不变
  const out = await pool(worlds, 4, async (it): Promise<WorldSave> => {
    const full = join(dir, it.name)
    const st = await fs.stat(full).catch(() => null)
    const size = await dirSize(full).catch(() => 0)
    return {
      name: it.name,
      folder: it.name,
      path: full,
      sizeBytes: size,
      lastPlayed: st?.mtimeMs
    }
  })
  return out.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
}

/** 列存档：优先版本隔离目录，同时把根目录的也算上 */
export async function listWorlds(versionId?: string, isolated = true): Promise<WorldSave[]> {
  const dirs: string[] = []
  if (versionId && isolated) dirs.push(join(P.versionDir(versionId), 'saves'))
  if (versionId && !isolated) dirs.push(join(P.root, 'saves'))
  if (!versionId) dirs.push(join(P.root, 'saves'))
  const listed: WorldSave[] = []
  const seen = new Set<string>()
  for (const d of dirs) {
    for (const w of await scanDir(d)) {
      if (seen.has(w.path)) continue
      seen.add(w.path)
      listed.push(w)
    }
  }
  return listed
}

export async function deleteWorld(path: string): Promise<void> {
  if (!path) return
  // IPC 层已有闸；这里复验一次做纵深防御，未来新增调用点也不漏
  assertInsideData(path, '删除')
  if (!existsSync(path)) return
  await fs.rm(path, { recursive: true, force: true })
}
