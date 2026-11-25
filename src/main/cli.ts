/**
 * 命令行冒烟测试工具（开发用，不参与打包）
 * 构建: pnpm run cli:build
 * 用法:
 *   node scripts/cli.cjs list
 *   node scripts/cli.cjs install 1.20.1
 *   node scripts/cli.cjs java
 *   node scripts/cli.cjs launch 1.20.1 --name Steve --java <path>
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { offlineUuid, pollDeviceCode, startDeviceCode } from './core/auth'
import { downloadJavaRuntime, findJava, listJava, probeJava, runtimeComponentFor } from './core/java'
import { installVersion, readInstalledMark, isInstalled, dirSize } from './core/install'
import { getResolvedVersionJson, getVersionJson, getVersionManifest, ensureEffectiveSource, setDownloadSource } from './core/manifest'
import { downloadFile } from './core/http'
import { ensureGameDirs, P, setExternalVersions, setVersionsDir } from './core/paths'
import { launchGame } from './core/launch'
import { installLoader, listLoaderVersions, type LoaderType } from './core/loaders'
import { downloadResource, getResourceVersions, searchResources } from './core/modrinth'
import { installModpack } from './core/modpack'
import { ensureAuthlibInjector } from './core/authlib'
import { addServer, listServers, removeServer, serversFile } from './core/servers'
import { downloadWorldMap, importWorldZip, installCfModpackZip, listWorldMapFiles, searchCfProjects, searchWorldMaps } from './core/curseforge'
import { cloneInstance, describeComponents, exportInstance, importInstance, renameInstance, retireComponent } from './core/instances'
import { buildCommand } from './core/launch'
import { promises as fs } from 'node:fs'
import type { Account, Settings } from '../shared/types'
import type { ResourceType } from '../shared/resources'

const DEFAULT_SETTINGS: Settings = {
  gameDir: P.root,
  versionsDir: process.env.FEIYU_VERSIONS_DIR ?? '',
  curseforgeApiKey: '',
  extraVersionDirs: [],
  extraJavaPaths: [],
  javaPath: null,
  memoryMode: 'manual',
  maxMemory: 2048,
  minMemory: 512,
  jvmArgs: '',
  gameArgs: '',
  downloadConcurrency: Number(process.env.FEIYU_CONCURRENCY ?? 12),
  downloadSource: (process.env.FEIYU_SOURCE as 'official' | 'bmclapi') || 'official',
  versionIsolation: true,
  fullscreen: false,
  closeOnLaunch: false,
  msaClientId: '',
  backgroundPath: '',
  backgroundKind: 'none',
  accentColor: '#1663bc'
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  setDownloadSource(DEFAULT_SETTINGS.downloadSource)
  if (DEFAULT_SETTINGS.versionsDir) setVersionsDir(DEFAULT_SETTINGS.versionsDir)
  if (process.env.FEIYU_EXTRA_DIRS) {
    // 测试用：FEIYU_EXTRA_DIRS="dir1;dir2"，把里面的 <id>/<id>.json 注册成外部实例
    const roots = process.env.FEIYU_EXTRA_DIRS.split(';').filter(Boolean)
    const found: [string, string, string][] = []
    for (const root of roots) {
      if (!existsSync(root)) continue
      for (const name of await fs.readdir(root)) {
        const dir = join(root, name)
        if (existsSync(join(dir, `${name}.json`))) found.push([name, dir, root])
      }
    }
    setExternalVersions(found)
    if (found.length) log(`外部实例: ${found.map(([id]) => id).join(', ')}`)
  }
  ensureGameDirs()
  log(`游戏目录: ${P.root}`)
  log(`版本目录: ${P.versions}`)

  if (cmd === 'list') {
    const m = await getVersionManifest()
    log(`最新正式版: ${m.latest.release} / 快照: ${m.latest.snapshot}`)
    for (const v of m.versions.slice(0, 12)) log(`  ${v.id.padEnd(18)} ${v.type.padEnd(10)} ${v.releaseTime.slice(0, 10)}`)
  } else if (cmd === 'install') {
    const id = rest[0]
    if (!id) throw new Error('需要一个版本号，例如 1.20.1')
    const started = Date.now()
    let lastPhase = ''
    let lastPct = -1
    const mark = await installVersion(id, {
      taskId: randomUUID(),
      isCancelled: () => false,
      concurrency: DEFAULT_SETTINGS.downloadConcurrency,
      onProgress: (p) => {
        const pct = p.bytesTotal > 0 ? Math.round((p.bytesDone / p.bytesTotal) * 100) : Math.round((p.current / Math.max(1, p.total)) * 100)
        if (p.phase !== lastPhase || pct !== lastPct) {
          lastPhase = p.phase
          lastPct = pct
          log(`[${p.phase}] ${p.current}/${p.total} ${pct}% ${(p.bytesDone / 1048576).toFixed(1)}/${(p.bytesTotal / 1048576).toFixed(1)} MB ${p.currentFile ?? ''}`)
        }
      }
    })
    log(`安装完成: ${JSON.stringify(mark)}  耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
    const vj = await getVersionJson(id)
    if (vj.javaVersion) {
      const all = await listJava()
      const hit = await findJava(vj.javaVersion.majorVersion)
      log(`需要 Java ${vj.javaVersion.majorVersion}(${vj.javaVersion.component})，本地可用: ${all.map((j) => j.major).join(',') || '无'}，匹配: ${hit ? hit.major + '@' + hit.source : '无'}`)
      if (!hit) {
        log('本地没有合适的 Java，开始下载 Mojang 运行时……')
        const j = await downloadJavaRuntime(
          vj.javaVersion.component || 'java-runtime-gamma',
          (d, t, bd, bt) => process.stdout.write(`\r  Java: ${d}/${t} ${(bd / 1048576).toFixed(1)}/${(bt / 1048576).toFixed(1)} MB   `),
          () => false
        )
        log(`\nJava 就绪: ${j.path} (${j.version})`)
      }
    }
  } else if (cmd === 'java-dl') {
    const component = rest[0] || runtimeComponentFor(Number(rest[1] ?? 17))
    const major = Number(rest[1] ?? 17)
    log(`下载 Java 运行时: ${component} (要求的 major=${major})`)
    const t0 = Date.now()
    const j = await downloadJavaRuntime(
      component,
      (d, t, bd, bt) => {
        if (d % 20 === 0 || d === t) process.stdout.write(`\r  ${d}/${t} 文件  ${(bd / 1048576).toFixed(1)}/${(bt / 1048576).toFixed(1)} MB`)
      },
      () => false
    )
    log(`\nJava 就绪: ${j.path}`)
    log(`版本: ${j.version} (major=${j.major})  耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    const again = await probeJava(j.path)
    log(`复检: ${again.version} / ${again.major} / arch=${again.arch ?? '?'}`)
  } else if (cmd === 'ms-test') {
    log('申请微软设备码（不登录，只验证 API 和 client_id）……')
    const info = await startDeviceCode('')
    log(`user_code    = ${info.userCode}`)
    log(`verify_uri   = ${info.verificationUri}`)
    log(`expires_in   = ${info.expiresIn}s  interval=${info.interval}s`)
    const r = await pollDeviceCode(info.deviceCode, '')
    log(`首次轮询返回 = ${JSON.stringify(r)}`)
  } else if (cmd === 'ms-login') {
    // 真实登录冒烟：打印设备码，等人去浏览器确认，成功后账号落盘
    log('申请微软设备码（请去浏览器输入下面的代码）……')
    const info = await startDeviceCode('')
    log(`user_code    = ${info.userCode}`)
    log(`verify_uri   = ${info.verificationUri}`)
    log(`有效期 ${info.expiresIn}s，登录完成后这里会自动继续。`)
    const deadline = Date.now() + info.expiresIn * 1000
    let wait = Math.max(1, info.interval || 5)
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, wait * 1000))
      let r: Awaited<ReturnType<typeof pollDeviceCode>>
      try {
        r = await pollDeviceCode(info.deviceCode, '')
      } catch (e) {
        // 网络抖动（代理 / 超时）别把整个登录弄死，接着轮询
        log(`  轮询失败，重试：${(e as Error).message}`)
        wait = Math.min(wait + 1, 15)
        continue
      }
      if (r.status === 'pending') {
        if (r.message === 'slow_down') wait += 2
        continue
      }
      if (r.status === 'error') throw new Error(r.message)
      log(`登录成功: ${r.account?.name} (${r.account?.uuid}) type=${r.account?.type}`)
      return
    }
    throw new Error('设备码过期，没等到登录')
  } else if (cmd === 'loader-list') {
    const [type, mc] = rest
    if (!type || !mc) throw new Error('用法: loader-list <fabric|quilt|forge|neoforge|optifine> <mcVersion>')
    const list = await listLoaderVersions(type as LoaderType, mc)
    log(`${type} @ ${mc}: ${list.length} 个可用版本`)
    for (const v of list.slice(0, 12)) log(`  ${v.version.padEnd(22)} ${v.label}  stable=${v.stable}`)
  } else if (cmd === 'loader-install') {
    const [type, mc, ver] = rest
    if (!type || !mc || !ver) throw new Error('用法: loader-install <type> <mcVersion> <loaderVersion>')
    let lastPhase = ''
    const ctx = {
      taskId: randomUUID(),
      isCancelled: () => false,
      concurrency: 10,
      onProgress: (p: { phase: string; current: number; total: number; currentFile?: string; bytesDone: number; bytesTotal: number }) => {
        const key = `${p.phase}|${p.current}|${p.currentFile}`
        if (key === lastPhase) return
        lastPhase = key
        log(`[${p.phase}] ${p.total > 0 ? `${p.current}/${p.total}` : ''} ${(p.bytesDone / 1048576).toFixed(1)}/${(p.bytesTotal / 1048576).toFixed(1)} MB ${p.currentFile ?? ''}`)
      }
    }
    const r = await installLoader(type as LoaderType, mc, ver, ctx)
    log(`安装完成: ${r.versionId}`)
  } else if (cmd === 'res') {
    const [sub, ...args] = rest
    const RES_TYPES = ['mod', 'resourcepack', 'shader', 'datapack', 'modpack'] as const
    const asType = (s: string | undefined): ResourceType =>
      (RES_TYPES as readonly string[]).includes(s ?? '') ? (s as ResourceType) : 'mod'
    if (sub === 'search') {
      const type = asType(args[1])
      const r = await searchResources({ query: args[0] ?? args.join(' '), type, limit: 6 })
      log(`共 ${r.total} 个结果（类型 ${type}）`)
      for (const h of r.hits) log(`  ${h.title.padEnd(28)} ${h.slug.padEnd(24)} ${(h.downloads / 1000).toFixed(0)}K  ${h.categories.slice(0, 2).join(',')}`)
    } else if (sub === 'download') {
      const dash = (s?: string): string | undefined => (!s || s === '-' ? undefined : s)
      const slug = args[0]
      const mcVer = dash(args[1])
      const loader = dash(args[2])
      const versionId = dash(args[3])
      const type = asType(args[4])
      const needsLoader = type === 'mod' || type === 'modpack'
      let versions = await getResourceVersions(slug, mcVer, needsLoader ? loader : undefined)
      if (!versions.length) versions = await getResourceVersions(slug, undefined, needsLoader ? loader : undefined)
      if (!versions.length) throw new Error(`没有匹配 ${mcVer}/${loader ?? '-'} 的文件`)
      const v = versions[0]
      const f = v.files[0]
      log(`选中: ${v.name} (${v.versionNumber}) 文件 ${f.name} ${(f.size / 1024).toFixed(0)}KB 版本支持 ${v.gameVersions.slice(0, 3).join(',')}`)
      const out = await downloadResource({
        type,
        file: { name: f.name, url: f.url, size: f.size, sha1: f.sha1 },
        versionId
      })
      log(`已保存: ${out.file} (${(out.size / 1024).toFixed(0)} KB)`)
    } else {
      log('用法: res search <关键词> [类型] | res download <slug> [mc] [loader] [versionId] [类型]')
    }
  } else if (cmd === 'modpack') {
    const slug = rest[0]
    if (!slug) throw new Error('用法: modpack <modrinth-slug> [mcVersion]')
    const mcVer = rest[1]
    const versions = await getResourceVersions(slug, mcVer, 'fabric')
    if (!versions.length) throw new Error(`没有找到 ${slug} 的可用版本`)
    const v = versions[0]
    const f = v.files[0]
    log(`选中整合包: ${v.name} (${v.versionNumber}) 文件 ${f.name} ${(f.size / 1048576).toFixed(1)}MB`)
    const tmp = join(P.root, 'installers', f.name.replace(/[\\/:*?"<>|]/g, '_'))
    await downloadFile(f.url, tmp, { size: f.size, sha1: f.sha1, retries: 3, timeout: 300000 })
    log(`已下载: ${tmp}`)
    const r = await installModpack(tmp, {
      taskId: randomUUID(),
      isCancelled: () => false,
      concurrency: 8,
      onProgress: (p) => log(`[${p.phase}] ${p.current}/${p.total} ${p.currentFile ?? ''}`)
    })
    log(`整合包安装完成: ${JSON.stringify(r)}`)
  } else if (cmd === 'injector') {
    log('准备 authlib-injector……')
    const jar = await ensureAuthlibInjector((d, t) => log(`  ${d}/${t}`))
    const st = await fs.stat(jar).catch(() => null)
    log(`就绪: ${jar} (${((st?.size ?? 0) / 1024).toFixed(0)} KB)`)
  } else if (cmd === 'cmdline') {
    const [id, type] = rest
    if (!id) throw new Error('用法: cmdline <versionId> [authlib]')
    const v = await getResolvedVersionJson(id)
    const java = (await findJava(17)) ?? (await listJava())[0]
    const acc: Account =
      type === 'authlib'
        ? {
            id: 'test-AuthlibPlayer',
            type: 'authlib',
            name: 'AuthlibPlayer',
            uuid: '00000000-0000-0000-0000-000000000000',
            accessToken: 'fake-token',
            apiUrl: 'https://littleskin.cn/api/yggdrasil',
            serverName: 'LittleSkin'
          }
        : { id: 'offline-test', type: 'offline', name: 'Steve', uuid: offlineUuid('Steve') }
    const injector = type === 'authlib' ? await ensureAuthlibInjector() : undefined
    const cmdObj = buildCommand({ version: v, versionId: id, account: acc, settings: DEFAULT_SETTINGS, java, authlibInjector: injector })
    log(`mainClass: ${cmdObj.mainClass}`)
    log(`javaagent: ${cmdObj.args.filter((a) => a.includes('javaagent')).join(' ') || '(无)'}`)
    log(`accessToken 参数: ${cmdObj.args[cmdObj.args.indexOf('--accessToken') + 1] ?? '(无)'}`)
    log(`参数总数: ${cmdObj.args.length}`)
    const cpIdx = Math.max(cmdObj.args.indexOf('-cp'), cmdObj.args.indexOf('-classpath'))
    const cp = cpIdx >= 0 ? (cmdObj.args[cpIdx + 1] ?? '') : ''
    const versionEntries = cp.split(';').filter((p) => p.startsWith(P.versionDir(id)))
    log(`版本 jar: ${versionEntries.join(' | ') || '(无)'}`)
    log(`gameDir: ${cmdObj.args[cmdObj.args.indexOf('--gameDir') + 1] ?? '(无)'}`)
  } else if (cmd === 'servers') {
    const [action, vId, ...more] = rest
    if (!action || action === 'list') {
      const list = await listServers(vId, true)
      log(`servers.dat: ${serversFile(vId, true)}`)
      log(`条目 ${list.length} 个`)
      for (const s of list) log(`  ${s.name}\t${s.ip}\t${s.icon ? `[icon ${s.icon.length} 字符]` : ''}`)
    } else if (action === 'add') {
      const [name, ip] = more
      if (!ip) throw new Error('用法: servers add <versionId> <name> <ip>')
      const list = await addServer(vId, true, { name: name ?? ip, ip })
      log(`添加后 ${list.length} 条`)
      for (const s of list) log(`  ${s.name}\t${s.ip}`)
    } else if (action === 'rm') {
      const [ip] = more
      if (!ip) throw new Error('用法: servers rm <versionId> <ip>')
      const list = await removeServer(vId, true, ip)
      log(`移除后 ${list.length} 条`)
      for (const s of list) log(`  ${s.name}\t${s.ip}`)
    } else {
      throw new Error('用法: servers [list|add|rm] <versionId> ...')
    }
  } else if (cmd === 'inst') {
    const [sub, a1, a2] = rest
    if (sub === 'components') {
      const list = await describeComponents(a1)
      for (const c of list) log(`  ${c.name.padEnd(14)} ${String(c.version).padEnd(24)} ${c.removable ? '可移除' : '基础'} (${c.kind})`)
    } else if (sub === 'retire') {
      const r = await retireComponent(a1, a2 ?? 'api')
      log(`已挪走 ${r.moved.length} 个文件 → ${r.target}`)
      for (const m of r.moved) log(`  ${m}`)
    } else if (sub === 'export') {
      const dir = join(P.root, 'exports')
      await fs.mkdir(dir, { recursive: true })
      const target = join(dir, `${a1}-${new Date().toISOString().slice(0, 10)}.zip`)
      const r = await exportInstance(a1, target)
      log(`已导出 ${r.entries} 个文件 → ${r.file}`)
    } else if (sub === 'clone') {
      const id = await cloneInstance(a1, a2)
      log(`已克隆: ${a1} → ${id}`)
    } else if (sub === 'rename') {
      const id = await renameInstance(a1, a2)
      log(`已改名: ${a1} → ${id}`)
    } else if (sub === 'import') {
      const r = await importInstance(a1)
      log(`已导入 ${r.files} 个文件 → ${r.versionId} (${r.dir})`)
    } else {
      log('用法: inst <components|retire|export|import> <versionId|zipPath> [kind]')
    }
  } else if (cmd === 'maps') {
    const [sub, a1, a2] = rest
    if (sub === 'search') {
      const r = await searchWorldMaps(a1 ?? '', process.env.FEIYU_CF_KEY ?? '')
      log(`CurseForge 地图 ${r.total} 个`)
      for (const h of r.hits) log(`  ${h.id}\t${h.name}`)
    } else if (sub === 'files') {
      const list = await listWorldMapFiles(Number(a1), process.env.FEIYU_CF_KEY ?? '', a2)
      for (const f of list) log(`  ${f.fileName}\t${(f.size / 1048576).toFixed(1)} MB\t${f.gameVersions.slice(0, 3).join(',')}`)
    } else if (sub === 'import') {
      const r = await importWorldZip(a1, a2, true)
      log(`已导入存档: ${r.world} -> ${r.dir}`)
    } else if (sub === 'get') {
      const modId = Number(a1)
      const list = await listWorldMapFiles(modId, process.env.FEIYU_CF_KEY ?? '')
      const f = list.find((x) => x.downloadUrl) ?? list[0]
      if (!f) throw new Error('这个项目没有可下载文件')
      log(`选中: ${f.fileName} (${(f.size / 1024).toFixed(0)} KB)`)
      const r = await downloadWorldMap({ file: f, versionId: a2, isolated: true })
      log(`已下载并解压: ${r.world} -> ${r.dir}`)
    } else {
      log('用法: maps search <关键词> | maps files <modId> [mc] | maps import <zip> [versionId]')
    }
  } else if (cmd === 'cf') {
    const [sub, a1, a2] = rest
    if (sub === 'search') {
      const r = await searchCfProjects({ type: a1 ?? 'mod', query: a2 ?? '', apiKey: process.env.FEIYU_CF_KEY ?? '' })
      log(`CurseForge ${r.total} 个结果`)
      for (const h of r.hits.slice(0, 8)) log(`  ${h.id}\t${h.title}`)
    } else if (sub === 'modpack') {
      const ctx = {
        taskId: 'cli-cf',
        isCancelled: () => false,
        onProgress: (p: { phase: string; current: number; total: number }) => log(`[${p.phase}] ${p.current}/${p.total}`)
      }
      const r = await installCfModpackZip(a1, { apiKey: process.env.FEIYU_CF_KEY ?? '', ctx })
      log(`整合包装好: ${r.name} → ${r.versionId}（${r.loader ?? 'vanilla'} ${r.loaderVersion ?? ''}，${r.files} 个文件）`)
    } else {
      log('用法: cf search <type> <关键词> | cf modpack <本地 manifest zip>')
    }
  } else if (cmd === 'probe') {
    setDownloadSource('auto')
    const t0 = Date.now()
    const picked = await ensureEffectiveSource()
    log(`自动测速：${picked}（耗时 ${Date.now() - t0}ms）`)
  } else if (cmd === 'java') {
    const all = await listJava()
    if (!all.length) log('没找到任何 Java')
    for (const j of all) log(`  Java ${j.major}\t${j.version}\t${j.source}\t${j.path}`)
  } else if (cmd === 'launch') {
    const id = rest[0]
    if (!id) throw new Error('需要一个版本号')
    const nameArg = rest.indexOf('--name')
    const name = nameArg >= 0 ? rest[nameArg + 1] : 'Steve'
    const javaArg = rest.indexOf('--java')
    let javaPath = javaArg >= 0 ? rest[javaArg + 1] : null

    const mark = await readInstalledMark(id)
    // 外部文件夹里扫来的实例没有 .installed.json，只要 json/jar 在就算可用
    if (!mark && !(await isInstalled(id))) throw new Error(`版本 ${id} 还没安装`)
    const vj = await getResolvedVersionJson(id)
    const major = vj.javaVersion?.majorVersion ?? 8

    if (!javaPath) {
      const cand = await listJava()
      const hit = cand.filter((j) => j.major >= major).sort((a, b) => a.major - b.major)[0]
      if (!hit) throw new Error(`没有满足 Java ${major} 的运行时`)
      javaPath = hit.path
    }
    const info = await probeJava(javaPath)
    log(`使用 Java ${info.major} (${info.version}) @ ${javaPath}`)

    const account: Account = {
      id: `offline-${randomUUID()}`,
      type: 'offline',
      name,
      uuid: offlineUuid(name)
    }

    const handle = await launchGame({
      versionId: id,
      account,
      settings: DEFAULT_SETTINGS,
      java: { path: javaPath, version: info.version, major: info.major, source: 'custom' },
      onLog: (l) => {
        if (l.stream === 'launcher') log(`[启动器] ${l.line}`)
        else log(`[${l.stream}] ${l.line}`)
      },
      onExit: (code) => {
        log(`\n=== 游戏退出 code=${code} ===`)
        void dirSize(join(P.versionDir(id))).then((s) => log(`版本目录: ${(s / 1048576).toFixed(1)} MB`))
        process.exit(code ?? 0)
      }
    })
    log(`进程 PID: ${handle.child.pid}`)
    // 60 秒后如果还活着，说明启动成功，主动结束
    setTimeout(
      () => {
        log('\n=== 60 秒无崩溃，判定启动成功，主动结束 ===')
        handle.stop()
      },
      Number(process.env.FEIYU_KILL_AFTER ?? 60000)
    )
  } else {
    log('用法: list | install <id> | java | launch <id> [--name 名字] [--java 路径]')
  }
}

main().catch((e) => {
  console.error('错误:', e)
  process.exit(1)
})

void existsSync
void join
