/**
 * 把 src/main/cli.ts 打包成可直接 node 运行的 CJS 脚本（开发用冒烟测试）
 * 用法: node scripts/build-cli.mjs
 */
import { builtinModules } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rollup } from 'rollup'
import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(root, 'scripts/cli.cjs')
const NODE_EXTERNALS = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)]

// 纯 node 跑 CLI 时没有 electron 模块，用桩替换掉
const stubElectron = {
  name: 'stub-electron',
  resolveId(id) {
    if (id === 'electron') return '\0electron-stub'
    return null
  },
  load(id) {
    // CLI 是纯 node 环境：safeStorage 给 undefined，store 会自动回退到明文存储
    if (id === '\0electron-stub') return 'export const app = undefined\nexport const safeStorage = undefined\nexport default {}'
    return null
  }
}

const bundle = await rollup({
  input: join(root, 'src/main/cli.ts'),
  external: (id) => NODE_EXTERNALS.includes(id) || id.startsWith('node:'),
  plugins: [
    stubElectron,
    nodeResolve({ extensions: ['.mjs', '.js', '.json', '.node', '.ts', '.tsx'], preferBuiltins: true }),
    commonjs(),
    typescript({
      tsconfig: join(root, 'tsconfig.build.node.json'),
      noEmitOnError: true,
      compilerOptions: { outDir: join(root, 'scripts'), declaration: false, declarationMap: false }
    })
  ],
  onwarn(w, warn) {
    if (w.code === 'CIRCULAR_DEPENDENCY') return
    warn(w)
  }
})

await bundle.write({ file: outfile, format: 'cjs', sourcemap: false, exports: 'auto' })
await bundle.close()
console.log('打包完成: scripts/cli.cjs')
