import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { closeSync, existsSync, openSync, readSync, statSync, writeSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Account, GameArgument, LaunchStatus, LogLine, Settings, VersionJson } from '../../shared/types'
import type { JavaRuntimeInfo } from '../../shared/types'
import { buildClasspath, resolveLibraries, rulesAllow } from './install'
import { getResolvedVersionJson } from './manifest'
import { P } from './paths'

export const LAUNCHER_NAME = 'FeiyuLauncher'
export const LAUNCHER_VERSION = '0.3.0'

/** 把字符串参数按空格切开，支持双引号包住空格 */
export function splitArgs(raw: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"') {
      quote = !quote
      continue
    }
    if (!quote && /\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/**
 * 这几个参数的值是凭据或个人标识，写进日志文件就等于永久留在磁盘上。
 * 玩家遇到崩溃最常见的第一反应就是把 logs/ 里的日志贴出去求助，
 * 所以落盘前必须先打码。
 */
const SECRET_FLAGS = new Set(['--accessToken', '--session', '--uuid', '--xuid', '--clientId', '--userProperties'])

const REDACTED = '<已隐藏>'

/** 掩掉启动命令里的令牌类参数值，支持 `--flag value` 与 `--flag=value` 两种写法 */
export function redactArgs(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const eq = a.indexOf('=')
    if (eq > 0 && SECRET_FLAGS.has(a.slice(0, eq))) {
      out.push(`${a.slice(0, eq)}=${REDACTED}`)
      continue
    }
    out.push(a)
    if (!SECRET_FLAGS.has(a)) continue
    // 紧跟其后的那个才是值；下一个已经是参数了就说明这个 flag 没带值
    const next = args[i + 1]
    if (next !== undefined && !next.startsWith('-')) {
      out.push(REDACTED)
      i++
    }
  }
  return out
}

function pickArgs(list: GameArgument[] | undefined): string[] {
  if (!list) return []
  const out: string[] = []
  for (const a of list) {
    if (typeof a === 'string') {
      out.push(a)
      continue
    }
    if (!rulesAllow(a.rules)) continue
    // 带 features 的规则已在 rulesAllow 里按 false 处理
    if (Array.isArray(a.value)) out.push(...a.value)
    else out.push(a.value)
  }
  return out
}

export interface BuiltCommand {
  exe: string
  args: string[]
  cwd: string
  gameDir: string
  classpath: string
  mainClass: string
}

export interface BuildOptions {
  version: VersionJson
  versionId: string
  account: Account
  settings: Settings
  java: JavaRuntimeInfo
  width?: number
  height?: number
  /** 外置登录用的 authlib-injector jar 路径 */
  authlibInjector?: string
}

export function buildCommand(o: BuildOptions): BuiltCommand {
  const { version, versionId, account, settings, java } = o
  const gameDir = settings.versionIsolation ? P.versionDir(versionId) : P.root
  const nativesDir = P.versionNatives(versionId)
  // 继承版本（Fabric/Forge/OptiFine）没有自己的 client jar，回退到父版本
  const jarCandidates = [version.jar, versionId, version.inheritsFrom].filter((x): x is string => Boolean(x))
  const jarId = jarCandidates.find((c) => existsSync(P.versionJar(c))) ?? versionId
  const jarPath = P.versionJar(jarId)

  const libs = resolveLibraries(version.libraries ?? [])
  const classpath = buildClasspath(libs, jarPath)

  const assetIndexId = version.assetIndex?.id ?? version.assets ?? 'legacy'
  const sep = process.platform === 'win32' ? ';' : ':'

  const tokens: Record<string, string> = {
    auth_player_name: account.name,
    auth_uuid: account.uuid.replace(/-/g, ''),
    auth_access_token: account.accessToken ?? '0',
    auth_session: account.accessToken ?? '0',
    auth_xuid: '',
    clientid: '',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
    user_properties: '{}',
    version_name: versionId,
    version_type: version.type ?? 'release',
    game_directory: gameDir,
    assets_root: P.assets,
    assets_index_name: assetIndexId,
    game_assets: join(P.assets, 'virtual', 'legacy'),
    natives_directory: nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath,
    classpath_separator: sep,
    library_directory: P.libraries,
    primary_jar: jarPath,
    resolution_width: String(o.width ?? 854),
    resolution_height: String(o.height ?? 480)
  }

  const sub = (s: string): string => s.replace(/\$\{([a-z_0-9]+)\}/gi, (m, k: string) => (Object.hasOwn(tokens, k) ? tokens[k] : m))

  // ---- JVM 参数 ----
  const jvm: string[] = []
  if (settings.minMemory > 0) jvm.push(`-Xms${settings.minMemory}M`)
  if (settings.maxMemory > 0) jvm.push(`-Xmx${settings.maxMemory}M`)
  jvm.push('-XX:+UseG1GC', '-XX:+UnlockExperimentalVMOptions', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=16M')
  jvm.push(`-Djava.library.path=${nativesDir}`)
  jvm.push(`-Dminecraft.launcher.brand=${LAUNCHER_NAME}`, `-Dminecraft.launcher.version=${LAUNCHER_VERSION}`)

  if (version.arguments?.jvm?.length) {
    for (const a of pickArgs(version.arguments.jvm)) {
      const v = sub(a)
      if (!v) continue
      jvm.push(v)
    }
  }
  if (version.logging?.client) {
    const cfgId = version.logging.client.file.id
    const cfgPath = join(P.logConfigs, cfgId)
    if (existsSync(cfgPath)) {
      if (!version.arguments?.jvm || !version.arguments.jvm.some((a) => typeof a === 'string' && a.includes('log4j.configurationFile'))) {
        jvm.push(`-Dlog4j.configurationFile=${cfgPath}`)
      } else {
        jvm.push(...version.logging.client.argument.split(' ').map((s) => sub(s.replace('${path}', cfgPath))))
      }
    }
  }
  if (settings.jvmArgs.trim()) jvm.push(...splitArgs(settings.jvmArgs))

  // 外置登录：authlib-injector 通过 javaagent 注入，游戏就会去验证服务器认人
  if (account.type === 'authlib' && account.apiUrl) {
    if (o.authlibInjector) {
      jvm.push(`-javaagent:${o.authlibInjector}=${account.apiUrl}`)
    } else {
      throw new Error('外置登录缺少 authlib-injector，无法启动')
    }
  }

  // ---- 游戏参数 ----
  const game: string[] = []
  if (version.arguments?.game?.length) {
    for (const a of pickArgs(version.arguments.game)) game.push(sub(a))
  } else if (version.minecraftArguments) {
    for (const a of splitArgs(version.minecraftArguments)) game.push(sub(a))
  }
  if (settings.fullscreen) game.push('--fullscreen')
  if (settings.gameArgs.trim()) game.push(...splitArgs(settings.gameArgs))

  // 确保 -cp 一定存在（1.13 之前的版本没有 arguments.jvm）
  const hasCp = jvm.includes('-cp') || jvm.includes('-classpath')
  const jvmFinal = hasCp ? jvm : [...jvm, '-cp', classpath]
  // 顺序必须是: java <jvm 参数> <主类> <游戏参数>
  const args = [...jvmFinal, version.mainClass, ...game]

  return { exe: java.path, args, cwd: P.versionDir(versionId), gameDir, classpath, mainClass: version.mainClass }
}

export interface LaunchHandle {
  child: ChildProcess
  stop(): void
}

/** 启动游戏进程，日志写文件再增量读取（pipe 在受限环境下可能 EPERM） */
export async function launchGame(opts: {
  versionId: string
  account: Account
  settings: Settings
  java: JavaRuntimeInfo
  authlibInjector?: string
  onLog: (l: LogLine) => void
  onExit: (code: number | null, signal: string | null) => void
}): Promise<LaunchHandle> {
  const version = await getResolvedVersionJson(opts.versionId)
  const cmd = buildCommand({
    version,
    versionId: opts.versionId,
    account: opts.account,
    settings: opts.settings,
    java: opts.java,
    authlibInjector: opts.authlibInjector
  })

  if (!existsSync(P.logs)) mkdirSync(P.logs, { recursive: true })
  const logFile = join(P.logs, `${opts.versionId}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)

  const quoted = redactArgs(cmd.args)
    .map((a) => (a.includes(' ') ? `"${a}"` : a))
    .join(' ')

  const head =
    `[启动器] 版本: ${opts.versionId}\n` +
    `[启动器] Java: ${cmd.exe} (${opts.java.version})\n` +
    `[启动器] 游戏目录: ${cmd.gameDir}\n` +
    `[启动器] 命令: ${cmd.exe} ${quoted}\n` +
    `[启动器] ------------------------------------------------------------\n`

  let offset: number
  let child: ChildProcess
  const fd = openSync(logFile, 'w')
  try {
    offset = writeSync(fd, head)
    child = spawn(cmd.exe, cmd.args, {
      cwd: existsSync(cmd.cwd) ? cmd.cwd : P.root,
      windowsHide: true,
      stdio: ['ignore', fd, fd]
    })
  } finally {
    try {
      closeSync(fd)
    } catch {
      /* ignore */
    }
  }

  // spawn() 返回 ChildProcess 并不代表已启动；例如 ENOENT 会在稍后以 error 发出。
  // 确认启动成功后才创建日志定时器、交出可停止的进程句柄。
  try {
    await once(child, 'spawn')
  } catch (e) {
    opts.onLog({ stream: 'stderr', line: `进程启动失败: ${(e as Error).message}`, ts: Date.now() })
    throw e
  }

  opts.onLog({ stream: 'launcher', line: `日志文件: ${logFile}`, ts: Date.now() })

  let buf = ''
  // 中文日志一个汉字 3 字节，按 chunk 独立 toString 会把跨边界的字切成不可逆乱码
  const decoder = new StringDecoder('utf8')
  const drain = (): void => {
    let text = ''
    try {
      const st = statSync(logFile)
      if (st.size <= offset) return
      // 单次读取封顶：游戏刷屏时别一次性同步读几 MB 卡住主进程，剩余下个 tick 继续
      const len = Math.min(st.size - offset, 65536)
      const b = Buffer.allocUnsafe(len)
      const rfd = openSync(logFile, 'r')
      let got = 0
      try {
        while (got < len) {
          const n = readSync(rfd, b, got, len - got, offset + got)
          if (n <= 0) break
          got += n
        }
      } finally {
        closeSync(rfd)
      }
      offset += got
      text = decoder.write(b.subarray(0, got))
    } catch {
      return
    }
    buf += text
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      opts.onLog({ stream: 'stdout', line, ts: Date.now() })
    }
    if (buf.length > 16384) {
      opts.onLog({ stream: 'stdout', line: buf, ts: Date.now() })
      buf = ''
    }
  }

  const timer = setInterval(drain, 120)
  const killTimer: NodeJS.Timeout[] = []

  const stop = (): void => {
    // 进程已退出就别再 kill，也别留 8s 孤儿定时器
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    killTimer.push(
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 8000)
    )
  }

  child.on('error', (e) => {
    opts.onLog({ stream: 'stderr', line: `进程操作失败: ${e.message}`, ts: Date.now() })
  })

  child.once('exit', (code, signal) => {
    clearInterval(timer)
    for (const t of killTimer) clearTimeout(t)
    // 等最后一段日志落盘
    setTimeout(() => {
      // 退出时把剩余日志读完整（drain 有单次上限，循环到读不动为止）
      for (;;) {
        const before = offset
        drain()
        if (offset === before) break
      }
      const tail = decoder.end()
      if (tail) buf += tail
      if (buf.trim()) opts.onLog({ stream: 'stdout', line: buf.trim(), ts: Date.now() })
      buf = ''
      try {
        const fd2 = openSync(logFile, 'a')
        writeSync(fd2, `\n[启动器] 游戏退出 code=${code} signal=${signal}\n`)
        closeSync(fd2)
      } catch {
        /* ignore */
      }
      opts.onLog({ stream: 'launcher', line: `游戏进程退出，${signal ? `信号 ${signal}` : `退出码 ${code ?? '未知'}`}`, ts: Date.now() })
      opts.onExit(code, signal)
    }, 250)
  })

  return { child, stop }
}

export function makeStatus(patch: Partial<LaunchStatus>): LaunchStatus {
  return { running: false, ...patch }
}
