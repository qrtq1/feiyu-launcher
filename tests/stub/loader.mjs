import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const STUB_URL = new URL('./electron.mjs', import.meta.url).href
const TS_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: STUB_URL, shortCircuit: true }
  }
  if (!specifier.startsWith('.') && !specifier.startsWith('file:')) {
    return nextResolve(specifier, context)
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    // 源码是 bundler 风格的不带扩展名导入，Node ESM 需要手动补上 .ts
    const base = specifier.startsWith('file:') ? specifier : new URL(specifier, context.parentURL).href
    for (const ext of TS_SUFFIXES) {
      const candidate = base + ext
      try {
        if (existsSync(fileURLToPath(candidate))) {
          // 显式声明格式：package.json 里没有 "type": "module"（主进程产物是 CJS，不能加），
          // 不声明的话 Node 会对每个 .ts 源文件报 MODULE_TYPELESS_PACKAGE_JSON
          return { url: candidate, shortCircuit: true, format: 'module-typescript' }
        }
      } catch {
        /* 不是合法文件路径就继续试下一个后缀 */
      }
    }
    throw err
  }
}
