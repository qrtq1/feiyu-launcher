import { builtinModules } from 'node:module'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rollup } from 'rollup'
import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'out')

const NODE_EXTERNALS = [...builtinModules, ...builtinModules.map((m) => `node:${m}`), 'electron']

const resolveOpts = { extensions: ['.mjs', '.js', '.json', '.node', '.ts', '.tsx'], preferBuiltins: true }

/** 浏览器里没有 process，把 process.env.NODE_ENV 这类引用换成字面量 */
function replaceNodeEnv(mode = 'production') {
  return {
    name: 'replace-process-env',
    transform(code) {
      if (!code.includes('process.env') && !code.includes('process.')) return null
      let out = code
        .replace(/process\.env\.NODE_ENV/g, JSON.stringify(mode))
        .replace(/process\.env\.(\w+)/g, JSON.stringify(''))
      // 兜底：还有零散的 process.env / process 引用
      out = out.replace(/\bprocess\.env\b/g, '({})').replace(/\bprocess\.platform\b/g, JSON.stringify('browser'))
      if (out === code) return null
      return { code: out, map: null }
    }
  }
}

async function bundleNode(entry, outfile) {
  const bundle = await rollup({
    input: entry,
    external: (id) => NODE_EXTERNALS.includes(id) || id.startsWith('node:'),
    plugins: [
      nodeResolve(resolveOpts),
      commonjs(),
      typescript({
        tsconfig: join(root, 'tsconfig.build.node.json'),
        noEmitOnError: true,
        sourceMap: true,
        compilerOptions: { outDir: dirname(outfile), declaration: false, declarationMap: false }
      })
    ],
    onwarn(w, warn) {
      if (w.code === 'CIRCULAR_DEPENDENCY') return
      warn(w)
    }
  })
  await bundle.write({ file: outfile, format: 'cjs', sourcemap: true, exports: 'auto' })
  await bundle.close()
  console.log('  ->', outfile.replace(root + '\\', ''))
}

async function buildMain() {
  console.log('[1/3] main')
  await bundleNode(join(root, 'src/main/index.ts'), join(out, 'main/index.js'))
}

async function buildPreload() {
  console.log('[2/3] preload')
  await bundleNode(join(root, 'src/preload/index.ts'), join(out, 'preload/index.js'))
}

async function buildRenderer() {
  console.log('[3/3] renderer')
  const bundle = await rollup({
    input: join(root, 'src/renderer/src/main.tsx'),
    plugins: [
      nodeResolve({ ...resolveOpts, browser: true }),
      commonjs(),
      typescript({
        tsconfig: join(root, 'tsconfig.build.web.json'),
        noEmitOnError: true,
        sourceMap: true,
        compilerOptions: { outDir: join(out, 'renderer/assets'), declaration: false, declarationMap: false }
      }),
      replaceNodeEnv('production')
    ],
    onwarn(w, warn) {
      if (w.code === 'CIRCULAR_DEPENDENCY' || w.code === 'THIS_IS_UNDEFINED') return
      warn(w)
    }
  })
  await bundle.write({ file: join(out, 'renderer/assets/app.js'), format: 'iife', sourcemap: true })
  await bundle.close()

  // 样式表和 HTML
  await mkdir(join(out, 'renderer/assets'), { recursive: true })
  await cp(join(root, 'src/renderer/src/styles.css'), join(out, 'renderer/assets/styles.css'))

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>肥鱼启动器</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'" />
    <link rel="stylesheet" href="./assets/styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script>
      window.__lastError = null
      window.addEventListener('error', (e) => {
        window.__lastError = (e.message || '') + ' @ ' + (e.filename || '') + ':' + e.lineno
      })
      window.addEventListener('unhandledrejection', (e) => {
        window.__lastError = 'promise: ' + ((e.reason && e.reason.message) || String(e.reason))
      })
    </script>
    <script src="./assets/app.js"></script>
  </body>
</html>
`
  await writeFile(join(out, 'renderer/index.html'), html)
  console.log('  -> out/renderer/index.html')
}

const t0 = Date.now()
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await buildMain()
await buildPreload()
await buildRenderer()
console.log(`构建完成 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
void readFile
