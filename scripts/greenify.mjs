/**
 * 把 electron-builder 的 win-unpacked 整理成「绿色版」：
 *   dist/green/肥鱼启动器/肥鱼启动器.exe
 * 一个文件夹，双击即用，不解压、不安装、不碰 %TEMP%。
 */
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const src = join(root, 'dist', 'win-unpacked')
const dst = join(root, 'dist', 'green', '肥鱼启动器')

if (!existsSync(src)) {
  console.error('[green] 找不到 dist\\win-unpacked，先跑一次 electron-builder --dir')
  process.exit(1)
}

mkdirSync(dst, { recursive: true })
// force: true 覆盖同名文件；不先删目录，避免误删别的构建产物
cpSync(src, dst, { recursive: true, force: true })

const exe = join(dst, '肥鱼启动器.exe')
if (!existsSync(exe)) {
  console.error('[green] 复制完了但没找到主程序，检查 productName 是否被改了')
  process.exit(1)
}
const mb = statSync(exe).size / 1024 / 1024
console.log(`[green] 绿色版就绪: ${dst}`)
console.log(`[green] 主程序: ${exe} (${mb.toFixed(1)} MB)`)
console.log('[green] 整个文件夹拷到任何地方都能直接双击运行')
