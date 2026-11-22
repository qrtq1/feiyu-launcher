import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, promises as fs, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const UA = 'FeiyuLauncher/0.1.0 (Electron; +https://github.com/feiyu-launcher)'

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

export async function sha1File(file: string): Promise<string> {
  const hash = createHash('sha1')
  const rs = await fs.open(file, 'r').then((h) => h.createReadStream())
  return new Promise((resolve, reject) => {
    rs.on('data', (c) => hash.update(c))
    rs.on('end', () => resolve(hash.digest('hex')))
    rs.on('error', reject)
  })
}

export async function sha1Buffer(buf: Buffer | string): Promise<string> {
  return createHash('sha1').update(buf).digest('hex')
}

/** 简单重试封装 */
export async function retry<T>(fn: () => Promise<T>, times = 3, delay = 800, onError?: (e: Error, i: number) => void): Promise<T> {
  let lastErr: Error = new Error('unknown')
  for (let i = 0; i < times; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e as Error
      onError?.(lastErr, i)
      if (i < times - 1) await sleep(delay * (i + 1))
    }
  }
  throw lastErr
}

export async function fetchJson<T>(url: string, opts: { timeout?: number; headers?: Record<string, string>; method?: string; body?: string } = {}): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 25000)
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers ?? {}) },
      body: opts.body,
      signal: ctrl.signal
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url} ${text.slice(0, 200)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export interface DownloadResult {
  ok: boolean
  skipped: boolean
  bytes: number
}

/**
 * 下载单个文件。先写 .part 再改名，校验 sha1，失败重试。
 * expectedSha1 为空则不做校验（仅限非关键文件）。
 */
export async function downloadFile(
  url: string,
  dest: string,
  opts: { sha1?: string; size?: number; timeout?: number; retries?: number; altUrl?: string; onBytes?: (n: number) => void } = {}
): Promise<DownloadResult> {
  ensureDir(dirname(dest))

  if (existsSync(dest)) {
    const st = statSync(dest)
    if (opts.size != null && st.size === opts.size) {
      if (opts.sha1) {
        const actual = await sha1File(dest).catch(() => '')
        if (actual === opts.sha1) return { ok: true, skipped: true, bytes: 0 }
      } else {
        return { ok: true, skipped: true, bytes: 0 }
      }
    } else if (opts.size == null && !opts.sha1 && st.size > 0) {
      // 第三方 maven 库没有 sha1/size，只能信文件存在且非空
      return { ok: true, skipped: true, bytes: 0 }
    }
  }

  const retries = opts.retries ?? 3
  let lastErr: Error = new Error('download failed')
  for (let attempt = 0; attempt < retries; attempt++) {
    const part = `${dest}.part`
    // 后半程换备用源再试（镜像 503 / 官方被墙都能兜住）
    const tryUrl = opts.altUrl && attempt >= Math.ceil(retries / 2) ? opts.altUrl : url
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 120000)
      let res: Response
      try {
        res = await fetch(tryUrl, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} @ ${tryUrl}`)

      const hash = opts.sha1 ? createHash('sha1') : null
      let bytes = 0
      const body = Readable.fromWeb(res.body as any)
      body.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        hash?.update(chunk)
        opts.onBytes?.(chunk.length)
      })
      await pipeline(body, createWriteStream(part))
      if (hash && opts.sha1 && hash.digest('hex') !== opts.sha1) {
        throw new Error(`sha1 mismatch @ ${tryUrl}`)
      }
      if (existsSync(dest)) unlinkSync(dest)
      renameSync(part, dest)
      return { ok: true, skipped: false, bytes }
    } catch (e) {
      lastErr = e as Error
      try {
        if (existsSync(`${dest}.part`)) unlinkSync(`${dest}.part`)
      } catch {
        /* ignore */
      }
      // 限流/服务端过载要等久一点，别硬撞
      const throttled = /HTTP (429|503|502|504)\b/.test(lastErr.message)
      if (attempt < retries - 1) await sleep(throttled ? 2500 * (attempt + 1) : 700 * (attempt + 1))
    }
  }
  throw lastErr
}

/** 并发池：同时最多 limit 个任务 */
export async function pool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
