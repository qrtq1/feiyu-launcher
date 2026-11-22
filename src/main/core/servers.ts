import { existsSync, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ServerEntry } from '../../shared/types'
import { P } from './paths'

/**
 * servers.dat 是未压缩的 NBT（TAG_Compound 根，里面一个 "servers" 的 TAG_List）。
 * 这里只做够用的最小实现：读 name / ip / icon / hidden，写回时保留这几个字段。
 */

export function serversFile(versionId?: string, isolated = true): string {
  if (versionId && isolated) return join(P.versionDir(versionId), 'servers.dat')
  return join(P.root, 'servers.dat')
}

class Reader {
  off = 0
  constructor(private buf: Buffer) {}

  private need(n: number): void {
    if (this.off + n > this.buf.length) throw new Error('servers.dat 结构不完整')
  }
  u8(): number {
    this.need(1)
    return this.buf[this.off++]
  }
  i16(): number {
    this.need(2)
    const v = this.buf.readInt16BE(this.off)
    this.off += 2
    return v
  }
  i32(): number {
    this.need(4)
    const v = this.buf.readInt32BE(this.off)
    this.off += 4
    return v
  }
  str(): string {
    const n = this.i16()
    this.need(n)
    const s = this.buf.subarray(this.off, this.off + n).toString('utf8')
    this.off += n
    return s
  }
  skip(n: number): void {
    this.need(n)
    this.off += n
  }

  payload(type: number): unknown {
    switch (type) {
      case 1:
        return this.u8()
      case 2:
        return this.i16()
      case 3:
        return this.i32()
      case 4:
        this.skip(8)
        return null
      case 5:
        this.skip(4)
        return null
      case 6:
        this.skip(8)
        return null
      case 7: {
        const n = this.i32()
        this.skip(n)
        return null
      }
      case 8:
        return this.str()
      case 9: {
        const elem = this.u8()
        const n = this.i32()
        const arr: unknown[] = []
        for (let i = 0; i < n; i++) arr.push(this.payload(elem))
        return arr
      }
      case 10:
        return this.compound()
      case 11: {
        const n = this.i32()
        this.skip(n * 4)
        return null
      }
      case 12: {
        const n = this.i32()
        this.skip(n * 8)
        return null
      }
      default:
        throw new Error(`未知的 NBT 标签类型 ${type}`)
    }
  }

  compound(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (;;) {
      const type = this.u8()
      if (type === 0) break
      const name = this.str()
      out[name] = this.payload(type)
    }
    return out
  }
}

/** 解析 servers.dat 内容 */
export function parseServers(buf: Buffer): ServerEntry[] {
  const r = new Reader(buf)
  const rootType = r.u8()
  if (rootType !== 10) throw new Error('servers.dat 根标签不是 Compound')
  r.str() // 根名字，通常是空串
  const root = r.compound()
  const list = root.servers
  if (!Array.isArray(list)) return []
  const out: ServerEntry[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const ip = typeof rec.ip === 'string' ? rec.ip : ''
    if (!ip) continue
    out.push({
      name: typeof rec.name === 'string' && rec.name ? rec.name : ip,
      ip,
      icon: typeof rec.icon === 'string' ? rec.icon : undefined,
      hidden: rec.hidden === 1
    })
  }
  return out
}

function str(s: string): Buffer {
  const body = Buffer.from(s, 'utf8')
  const head = Buffer.alloc(2)
  head.writeUInt16BE(body.length, 0)
  return Buffer.concat([head, body])
}

function named(type: number, name: string, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([type]), str(name), payload])
}

function i32(v: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeInt32BE(v, 0)
  return b
}

/** 生成 servers.dat 内容 */
export function buildServers(list: ServerEntry[]): Buffer {
  const parts: Buffer[] = []
  // 根 TAG_Compound，名字是空串
  parts.push(Buffer.from([10, 0, 0]))
  parts.push(named(9, 'servers', Buffer.concat([Buffer.from([10]), i32(list.length)])))
  for (const s of list) {
    const body: Buffer[] = []
    body.push(named(8, 'name', str(s.name || s.ip)))
    body.push(named(8, 'ip', str(s.ip)))
    if (s.icon) body.push(named(8, 'icon', str(s.icon)))
    if (s.hidden) body.push(named(1, 'hidden', Buffer.from([1])))
    body.push(Buffer.from([0]))
    parts.push(Buffer.concat(body))
  }
  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}

export async function listServers(versionId?: string, isolated = true): Promise<ServerEntry[]> {
  const file = serversFile(versionId, isolated)
  if (!existsSync(file)) return []
  const buf = await fs.readFile(file).catch(() => null)
  if (!buf) return []
  try {
    return parseServers(buf)
  } catch {
    return []
  }
}

/** 写回；第一次写之前把原文件留一份 .bak（已存在就不覆盖，保住最初备份） */
async function writeServers(file: string, list: ServerEntry[]): Promise<void> {
  if (existsSync(file)) {
    const bak = `${file}.bak`
    if (!existsSync(bak)) await fs.copyFile(file, bak).catch(() => undefined)
  }
  await fs.mkdir(dirname(file), { recursive: true }).catch(() => undefined)
  await fs.writeFile(file, buildServers(list))
}

export async function addServer(
  versionId: string | undefined,
  isolated: boolean,
  entry: ServerEntry
): Promise<ServerEntry[]> {
  const ip = entry.ip.trim()
  if (!ip) throw new Error('地址不能为空')
  const list = await listServers(versionId, isolated)
  const next = list.filter((s) => s.ip !== ip)
  next.push({ name: entry.name.trim() || ip, ip, icon: entry.icon, hidden: entry.hidden })
  await writeServers(serversFile(versionId, isolated), next)
  return next
}

export async function removeServer(
  versionId: string | undefined,
  isolated: boolean,
  ip: string
): Promise<ServerEntry[]> {
  const list = await listServers(versionId, isolated)
  const next = list.filter((s) => s.ip !== ip)
  await writeServers(serversFile(versionId, isolated), next)
  return next
}
