/**
 * 开发模式启动 Electron（本脚本只运行不构建；改了代码用 pnpm dev）
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
  console.error('out/ 不存在，先执行 pnpm build')
  process.exit(1)
}

let electronPath
try {
  electronPath = require('electron')
} catch {
  console.error('Electron 二进制没装好，先执行: node scripts/fetch-electron.mjs')
  process.exit(1)
}
if (typeof electronPath !== 'string') {
  console.error('没找到 Electron 可执行文件')
  process.exit(1)
}

const args = ['.']
const env = { ...process.env }
// 从某些宿主（比如被当成 node 跑的父进程）继承来的话，Electron 会退化成纯 node
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, args, { cwd: root, stdio: 'inherit', env })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
