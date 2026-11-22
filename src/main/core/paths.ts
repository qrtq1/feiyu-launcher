import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * 目录约定（Minecraft 标准布局）：
 *   <gameDir>/
 *     versions/<id>/<id>.json  <id>.jar  natives/
 *     libraries/<group>/<artifact>/<version>/...
 *     assets/indexes/ assets/objects/ assets/log_configs/
 *     runtime/            <- 启动器自己下载的 Java
 *     logs/
 */
let gameDirOverride: string | null = null

export function dataRoot(): string {
  if (process.env.FEIYU_DATA_DIR) return process.env.FEIYU_DATA_DIR
  try {
    if (app?.getPath) return app.getPath('userData')
  } catch {
    /* 纯 node 环境（CLI 测试）下没有 electron app */
  }
  return join(homedir(), 'AppData', 'Roaming', 'feiyu-launcher')
}

/** 默认游戏目录：C:\Users\<user>\AppData\Roaming\feiyu-launcher\minecraft */
export function defaultGameDir(): string {
  return join(dataRoot(), 'minecraft')
}

export function setGameDir(dir: string | null): void {
  gameDirOverride = dir && dir.trim() ? dir.trim() : null
}

export function gameDir(): string {
  return gameDirOverride ?? defaultGameDir()
}

/**
 * 版本目录（versions）默认跟游戏目录走，但允许单独指定。
 * 指定后：安装、列举、启动、实例管理全用这个目录，libraries / assets 不受影响。
 */
let versionsDirOverride: string | null = null

export function defaultVersionsDir(): string {
  return join(gameDir(), 'versions')
}

export function setVersionsDir(dir: string | null): void {
  versionsDirOverride = dir && dir.trim() ? dir.trim() : null
}

export function versionsDir(): string {
  return versionsDirOverride ?? defaultVersionsDir()
}

/**
 * 「其他文件夹」里扫到的实例：id → 实际版本目录。
 * 注册后 P.versionDir() 会优先用这里，于是启动、实例管理、mod 目录全都自动指向那个文件夹。
 * 同 id 冲突时以主 versions 目录为准（下面 versionDir 里的顺序就是优先级）。
 */
const externalVersions = new Map<string, { dir: string; root: string }>()

/** entries: [版本id, 版本目录, 所属的「加入的文件夹」] */
export function setExternalVersions(entries: Iterable<[string, string, string]>): void {
  externalVersions.clear()
  for (const [id, dir, root] of entries) externalVersions.set(id, { dir, root })
}

export function externalVersionIds(): string[] {
  return [...externalVersions.keys()]
}

export function externalVersionDir(id: string): string | undefined {
  return externalVersions.get(id)?.dir
}

/** 这个实例属于哪个「加入的文件夹」（分组显示用） */
export function externalVersionRoot(id: string): string | undefined {
  return externalVersions.get(id)?.root
}

export const P = {
  get root(): string {
    return gameDir()
  },
  get versions(): string {
    return versionsDir()
  },
  get libraries(): string {
    return join(this.root, 'libraries')
  },
  get assets(): string {
    return join(this.root, 'assets')
  },
  get indexes(): string {
    return join(this.root, 'assets', 'indexes')
  },
  get objects(): string {
    return join(this.root, 'assets', 'objects')
  },
  get logConfigs(): string {
    return join(this.root, 'assets', 'log_configs')
  },
  get runtime(): string {
    return join(this.root, 'runtime')
  },
  get logs(): string {
    return join(this.root, 'logs')
  },
  versionDir(id: string): string {
    // 扫描阶段已经保证「主 versions 里有的不进映射」，所以这里先查映射，再回落到主目录
    return externalVersionDir(id) ?? join(this.versions, id)
  },
  versionJson(id: string): string {
    return join(this.versionDir(id), `${id}.json`)
  },
  versionJar(id: string): string {
    return join(this.versionDir(id), `${id}.jar`)
  },
  versionNatives(id: string): string {
    return join(this.versionDir(id), 'natives')
  },
  installedMark(id: string): string {
    return join(this.versionDir(id), '.installed.json')
  }
}

export function ensureGameDirs(): void {
  for (const d of [P.root, P.versions, P.libraries, P.assets, P.indexes, P.objects, P.logConfigs, P.runtime, P.logs]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  }
}
export function libPath(path: string): string {
  return join(P.libraries, path)
}

export function assetPath(hash: string): string {
  return join(P.objects, hash.slice(0, 2), hash)
}

/** p 是否落在 root 之内（root 自身也算） */
export function isInside(root: string, p: string): boolean {
  const rel = relative(resolve(root), resolve(p))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * 版本 id 会被直接拼进 versions/ 下的路径，再交给 fs.rm / mkdir。
 * 渲染进程传来的 id 必须先过这里，否则 `..\..\xxx` 就能删到游戏目录外面去。
 */
export function assertSafeVersionId(id: string): string {
  if (!id || id === '.' || id === '..' || /[\\/]/.test(id) || id.includes('..') || id !== id.trim()) {
    throw new Error(`非法的版本 id：${JSON.stringify(id)}`)
  }
  return id
}

/**
 * 渲染进程传来的路径一律先过这道闸，再交给 fs.rm / shell.openPath。
 * versionsDir 允许被用户指到游戏目录之外，所以两个根都放行。
 */
export function assertInsideData(p: string, action: string): string {
  if (!p || (!isInside(P.root, p) && !isInside(P.versions, p))) {
    throw new Error(`拒绝${action}游戏目录之外的路径：${p}`)
  }
  return p
}
