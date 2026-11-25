/**
 * 手动安装 Electron 二进制（install 用了 --ignore-scripts 时用这个补）
 * 用法: node scripts/fetch-electron.mjs
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const pkgPath = join(root, 'node_modules', 'electron', 'package.json')

if (!existsSync(pkgPath)) {
  console.error('没找到 node_modules/electron，先跑 pnpm install')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const version = pkg.version
const platform = (process.argv.slice(2).find((a) => a.startsWith('--platform=')) ?? '').split('=')[1] || process.platform
// --arch=ia32：下载 32 位 Electron，解到 .cache/electron-ia32，别覆盖本机那份 64 位的
const archArg = (process.argv.slice(2).find((a) => a.startsWith('--arch=')) ?? '').split('=')[1]
const platformArg = (process.argv.slice(2).find((a) => a.startsWith('--platform=')) ?? '').split('=')[1]
const arch = archArg || process.arch
const cross = arch !== process.arch || (platformArg ? platformArg !== process.platform : false)
const zipName = `electron-v${version}-${platform}-${arch}.zip`
const url = `https://npmmirror.com/mirrors/electron/${version}/${zipName}`
const cacheDir = join(root, '.cache')
const zipPath = join(cacheDir, zipName)
const crossDir = join(root, '.cache', `electron-${platform}-${arch}`)
const distDir = cross ? join(crossDir, 'dist') : join(root, 'node_modules', 'electron', 'dist')
const marker = cross ? join(crossDir, 'path.txt') : join(root, 'node_modules', 'electron', 'path.txt')

const exeName = platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'

if (existsSync(marker) && existsSync(join(distDir, exeName.split('/')[0]))) {
  console.log(`Electron ${arch} 已经装好了:`, distDir)
  process.exit(0)
}

mkdirSync(cacheDir, { recursive: true })

if (!existsSync(zipPath) || statSync(zipPath).size < 1024) {
  console.log('下载', url)
  const res = await fetch(url, { headers: { 'User-Agent': 'feiyu-launcher-setup' } })
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let got = 0
  const body = Readable.fromWeb(res.body)
  const t0 = Date.now()
  body.on('data', (c) => {
    got += c.length
    if (got % (8 * 1024 * 1024) < 65536) {
      const pct = total ? ((got / total) * 100).toFixed(1) : '?'
      process.stdout.write(`\r  ${(got / 1048576).toFixed(0)} MB / ${(total / 1048576).toFixed(0)} MB (${pct}%)`)
    }
  })
  const tmp = `${zipPath}.part`
  await pipeline(body, createWriteStream(tmp))
  renameSync(tmp, zipPath)
  console.log(`\n下载完成 ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(statSync(zipPath).size / 1048576).toFixed(0)} MB`)
} else {
  console.log('已有缓存 zip:', zipPath)
}

// 用 Windows 自带的 Expand-Archive 解压（比 JS 实现的 zip 快很多）
const { execFileSync } = await import('node:child_process')
if (existsSync(distDir)) {
  const { rmSync } = await import('node:fs')
  rmSync(distDir, { recursive: true, force: true })
}
mkdirSync(distDir, { recursive: true })

try {
  // 用宿主系统的方式解压：在 Windows 上给 Linux 目标解包也得走 Expand-Archive
  if (process.platform === 'win32') {
    console.log('解压中……')
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${distDir}' -Force`], { stdio: 'inherit' })
  } else {
    execFileSync('unzip', ['-oq', zipPath, '-d', distDir], { stdio: 'inherit' })
  }
} catch (e) {
  // 损坏的 zip 留在缓存里会让每次重试都命中缓存再失败；删掉让下次重新下载
  try { unlinkSync(zipPath) } catch { /* ignore */ }
  throw e
}

if (!existsSync(join(distDir, exeName.split('/')[0]))) {
  throw new Error('解压后没找到可执行文件: ' + join(distDir, exeName))
}
writeFileSync(marker, exeName)
if (existsSync(zipPath)) unlinkSync(zipPath)
console.log('Electron 安装完成:', join(distDir, exeName))
