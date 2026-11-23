import type { McmodHit } from '../../shared/types'

/** MC百科（mcmod.cn）站内搜索，只拿资料条目，不下载 */
const SEARCH_URL = 'https://search.mcmod.cn/s?key='
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 分析一个标题：MC百科的格式是「中文名 (English Name)」
 */
function splitTitle(raw: string): { title: string; enName?: string } {
  const text = stripTags(raw)
  const m = text.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (m) return { title: m[1].trim(), enName: m[2].trim() }
  return { title: text }
}

export async function searchMcmod(query: string, limit = 12): Promise<McmodHit[]> {
  const q = query.trim()
  if (!q) return []
  const res = await fetch(`${SEARCH_URL}${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`MC百科搜索失败 HTTP ${res.status}`)
  const html = await res.text()

  // 页面结构：<div class="search-result-list"><div class="result-item">…</div>…
  const blocks = html.split('<div class="result-item">').slice(1)
  const out: McmodHit[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    if (out.length >= limit) break
    const link = block.match(/<a[^>]+href="(https:\/\/www\.mcmod\.cn\/class\/(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    const [, url, id, rawTitle] = link
    if (seen.has(id)) continue
    seen.add(id)

    const bodyMatch = block.match(/<div class="body">([\s\S]*?)<\/div>/)
    const desc = bodyMatch ? stripTags(bodyMatch[1]).replace(/^\[[^\]]*\]\s*/, '') : ''
    const { title, enName } = splitTitle(rawTitle)

    out.push({
      id,
      title,
      enName,
      url,
      desc: desc.slice(0, 160),
      category: /<a class="c_\d+"/.test(block) ? 'mcmod' : undefined
    })
  }
  return out
}

