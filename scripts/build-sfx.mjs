/**
 * 用 electron-builder 缓存里的 NSIS 编译「自解压器」。
 * 产物：dist/FeiyuLauncher-SelfExtract.exe
 * 双击后会在它自己所在的目录建一个「肥鱼启动器」文件夹，把程序解压进去再启动。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** electron-builder 把 NSIS 缓存在 %LOCALAPPDATA%\electron-builder\Cache\nsis-*\*\Bin\makensis.exe */
function findMakensis() {
  const base = join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache')
  if (!existsSync(base)) return null
  // 多版本缓存时按版本号取最大，别依赖 readdir 的顺序
  const names = readdirSync(base)
    .filter((n) => n.startsWith('nsis-') && !n.startsWith('nsis-resources'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .reverse()
  for (const name of names) {
    const dir = join(base, name)
    for (const inner of readdirSync(dir)) {
      const exe = join(dir, inner, 'Bin', 'makensis.exe')
      if (existsSync(exe)) return exe
    }
  }
  return null
}

const makensis = findMakensis()
if (!makensis) {
  console.error('[sfx] 找不到 makensis.exe。先跑一次 electron-builder（它会下载 NSIS），或手动装 NSIS。')
  process.exit(1)
}

const script = join(root, 'build', 'sfx.nsi')
if (!existsSync(script)) {
  console.error('[sfx] 找不到 build/sfx.nsi')
  process.exit(1)
}
if (!existsSync(join(root, 'dist', 'win-unpacked'))) {
  console.error('[sfx] 找不到 dist/win-unpacked，先跑 electron-builder --dir')
  process.exit(1)
}

console.log(`[sfx] 用 ${makensis} 编译…`)
execFileSync(makensis, ['/INPUTCHARSET', 'UTF8', script], { stdio: 'inherit' })
console.log('[sfx] 完成：dist\\FeiyuLauncher-SelfExtract.exe')
