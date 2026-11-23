/** 共享类型：主进程与渲染进程都用这一份 */

export type VersionType = 'release' | 'snapshot' | 'old_beta' | 'old_alpha'

export interface VersionManifestEntry {
  id: string
  type: VersionType
  url: string
  time: string
  releaseTime: string
  sha1: string
  complianceLevel: number
}

export interface VersionManifest {
  latest: { release: string; snapshot: string }
  versions: VersionManifestEntry[]
}

/** 版本 JSON（只声明我们用到的字段） */
export interface VersionJson {
  id: string
  type: string
  mainClass: string
  assets: string
  assetIndex?: { id: string; sha1: string; size: number; totalSize: number; url: string }
  downloads?: {
    client?: { sha1: string; size: number; url: string }
    client_mappings?: { sha1: string; size: number; url: string }
    server?: { sha1: string; size: number; url: string }
  }
  libraries: Library[]
  javaVersion?: { component: string; majorVersion: number }
  logging?: {
    client?: { argument: string; file: { id: string; sha1: string; size: number; url: string }; type: string }
  }
  arguments?: { game: GameArgument[]; jvm: GameArgument[] }
  minecraftArguments?: string
  releaseTime: string
  time: string
  inheritsFrom?: string
  jar?: string
  minimumLauncherVersion?: number
}

export type GameArgument = string | ArgumentRule

export interface ArgumentRule {
  rules: Rule[]
  value: string | string[]
}

export interface Rule {
  action: 'allow' | 'disallow'
  os?: { name?: string; version?: string; arch?: string }
  features?: Record<string, boolean>
}

export interface Library {
  name: string
  downloads?: {
    artifact?: Artifact
    classifiers?: Record<string, Artifact>
  }
  natives?: Record<string, string>
  rules?: Rule[]
  extract?: { exclude: string[] }
  url?: string
}

export interface Artifact {
  path: string
  sha1: string
  size: number
  url: string
}

export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>
  virtual?: boolean
  map_to_resources?: boolean
}

export interface ResolvedLibrary {
  name: string
  path: string
  url: string
  sha1: string
  size: number
  isNative: boolean
  extractExclude?: string[]
}

export type AccountType = 'offline' | 'microsoft' | 'authlib'

export interface Account {
  id: string
  type: AccountType
  name: string
  uuid: string
  accessToken?: string
  refreshToken?: string
  /** ms 时间戳 */
  expiresAt?: number
  skinModel?: string
  /** 外置登录：验证服务器地址 */
  apiUrl?: string
  /** 外置登录：服务器显示名 */
  serverName?: string
  /** 外置登录：会话令牌（refresh 用） */
  clientToken?: string
}

export interface Settings {
  gameDir: string
  /** 版本目录；空字符串 = 用 <gameDir>/versions */
  versionsDir: string
  /** CurseForge API Key（地图下载用；空 = 走 MCIM 免 key 镜像） */
  curseforgeApiKey: string
  /** 额外扫描的版本文件夹（里面每个 <id>/<id>.json 算一个实例） */
  extraVersionDirs: string[]
  /** 用户手动添加的 Java 可执行文件路径，和自动探测的一起参与挑选 */
  extraJavaPaths: string[]
  javaPath: string | null
  maxMemory: number
  minMemory: number
  jvmArgs: string
  gameArgs: string
  downloadConcurrency: number
  downloadSource: 'official' | 'bmclapi' | 'auto'
  versionIsolation: boolean
  fullscreen: boolean
  closeOnLaunch: boolean
  msaClientId: string
  /** 启动器背景资源；支持图片、视频和 Wallpaper Engine 网页入口 */
  backgroundPath: string
  backgroundKind: 'image' | 'video' | 'wallpaper' | 'none'
  accentColor: string
}

export interface DownloadProgress {
  taskId: string
  phase: string
  current: number
  total: number
  bytesDone: number
  bytesTotal: number
  currentFile?: string
  finished: boolean
  error?: string
}

/** 启动过程进度（从点启动到进主菜单） */
export interface LaunchProgress {
  versionId: string
  launchId: string
  phase: string
  /** 0-100 */
  percent: number
}

export interface LaunchStatus {
  running: boolean
  versionId?: string
  pid?: number
  startedAt?: number
  exitCode?: number | null
  /** 每次启动单独一个 id：同一个实例可以开多份，靠它区分 */
  launchId?: string
}

export interface LocalVersion {
  id: string
  type: string
  installed: boolean
  /** 是否完整安装（有 .installed.json） */
  complete: boolean
  sizeBytes?: number
  installedAt?: number
  javaVersion?: number
  hasFabric?: boolean
  /** 来自「其他文件夹」而不是主 versions 目录 */
  external?: boolean
  /** 外部实例所在的文件夹（用于分组显示） */
  externalDir?: string
}

export interface JavaRuntimeInfo {
  path: string
  version: string
  major: number
  source: 'system' | 'mojang' | 'custom'
}

export interface LogLine {
  stream: 'stdout' | 'stderr' | 'launcher'
  line: string
  ts: number
}

export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  deviceCode: string
  expiresIn: number
  interval: number
  message: string
}

/** 单个版本（实例）的独立设置，覆盖全局 */
export interface VersionSettings {
  maxMemory?: number
  minMemory?: number
  jvmArgs?: string
  gameArgs?: string
  javaPath?: string | null
  windowTitle?: string
  fullscreen?: boolean
}

/** 实例里的一个文件（模组 / 存档 / 截图 …） */
export interface InstanceFile {
  name: string
  path: string
  size: number
  mtime: number
  isDir: boolean
  enabled: boolean
  /** 额外的说明，比如存档的版本号 */
  note?: string
}

export type InstanceFileKind = 'mods' | 'saves' | 'screenshots' | 'resourcepacks' | 'shaderpacks'

/** 实例装了什么（原版 / 加载器 / API） */
export interface VersionComponent {
  kind: 'minecraft' | 'fabric' | 'quilt' | 'legacyfabric' | 'forge' | 'neoforge' | 'optifine' | 'api' | 'other'
  name: string
  version: string
  removable: boolean
}

/** 实例统计 */
export interface VersionStats {
  launchCount: number
  installedAt?: number
  sizeBytes: number
  lastPlayedAt?: number
}

/** 版本目录里的 .installed.json 标记：判断「装完了没」以及统计口径 */
export interface InstalledMark {
  id: string
  installedAt: number
  sizeBytes: number
  files: number
  javaMajor?: number
  source: string
}

export interface ModFile {
  name: string
  size: number
  path: string
}

/** 本地世界存档 */
export interface WorldSave {
  name: string
  folder: string
  path: string
  sizeBytes: number
  lastPlayed?: number
  version?: string
  icon?: string
}

/** servers.dat 里的服务器条目 */
export interface ServerEntry {
  name: string
  ip: string
  /** 完整的 data:image/png;base64,... 图标 */
  icon?: string
  hidden?: boolean
}

/** CurseForge 上的地图（世界）项目 */
export interface WorldMapHit {
  id: number
  name: string
  slug: string
  summary: string
  iconUrl?: string
  downloads: number
  url: string
}

/** 地图项目的一个下载文件 */
export interface WorldMapFile {
  id: number
  name: string
  fileName: string
  size: number
  date: string
  gameVersions: string[]
  downloadUrl: string | null
}

/** MC百科搜索结果（只跳转，不下载） */
export interface McmodHit {
  id: string
  title: string
  enName?: string
  url: string
  desc: string
  category?: string
}

/** 收藏的社区资源 */
export interface FavoriteItem {
  id: string
  type: string
  title: string
  iconUrl?: string
  author: string
  addedAt: number
}

export type LoaderType = 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'optifine' | 'legacyfabric'

export interface LoaderVersionInfo {
  type: LoaderType
  mcVersion: string
  version: string
  versionId: string
  label: string
  stable: boolean
  kind?: string
}

export interface ResourceHit {
  id: string
  slug: string
  title: string
  description: string
  type: string
  downloads: number
  follows: number
  author: string
  iconUrl?: string
  categories: string[]
  versions: string[]
  loaders: string[]
  /** 这条结果来自哪个源；老数据缺省视为 modrinth */
  source?: 'modrinth' | 'curseforge'
}

export interface ResourceFileRef {
  name: string
  url: string
  size: number
  sha1?: string
}

export interface ResourceVersionLite {
  id: string
  name: string
  versionNumber: string
  gameVersions: string[]
  loaders: string[]
  datePublished: string
  files: ResourceFileRef[]
}
// ---------------- 陶瓦联机（Terracotta）----------------

/** 组件自身元信息（GET /meta） */
export interface TerracottaMeta {
  version: string
  [key: string]: unknown
}

/** 房间成员 */
export interface TerracottaProfile {
  machine_id: string
  name: string
  /** HOST / LOCAL / GUEST */
  kind: string
}

/** 房间状态（GET /state）；index 递增，用来丢弃乱序响应 */
export interface TerracottaState {
  index: number
  /** waiting / host-scanning / host-starting / host-ok / guest-connecting / guest-starting / guest-ok / exception */
  state: string
  /** 房间码 */
  room?: string
  /** 加入方直连地址 */
  url?: string
  /** EASIEST / SIMPLE / MEDIUM / TOUGH */
  difficulty?: string
  /** 异常类型序号 */
  type?: number
  profiles?: TerracottaProfile[]
}

/** 启动器侧的联机组件状态 */
export interface TerracottaStatus {
  /** 同意协议的时间戳；null = 还没同意 */
  agreedAt: number | null
  installed: boolean
  version?: string
  running: boolean
  /** true = 复用别的程序（如 HMCL）已启动的实例 */
  attached: boolean
  meta: TerracottaMeta | null
}

export interface Api {
  platform: () => Promise<{ os: string; arch: string; version: string; userData: string }>
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    pickDir(): Promise<string | null>
    pickJava(): Promise<string | null>
    pickBackground(): Promise<{ path: string; kind: 'image' | 'video' | 'wallpaper' } | null>
    resolveMedia(path: string): Promise<string | null>
  }
  versions: {
    manifest(force?: boolean): Promise<VersionManifest>
    local(): Promise<LocalVersion[]>
    install(id: string): Promise<void>
    remove(id: string): Promise<void>
    cancelInstall(): Promise<void>
    /** 弹选目录 → 扫描里面的实例 → 存进设置 */
    addFolder(): Promise<{ dir: string; dirs: string[]; found: number } | null>
    removeFolder(dir: string): Promise<string[]>
    extraDirs(): Promise<string[]>
    /** 克隆成新实例（只带版本本体，不带 mods/存档） */
    clone(srcId: string, newId: string): Promise<string>
  }
  accounts: {
    list(): Promise<Account[]>
    addOffline(name: string): Promise<Account>
    remove(id: string): Promise<void>
    setActive(id: string): Promise<void>
    active(): Promise<Account | null>
    /** 微软登录：返回设备码，随后轮询 */
    msStart(): Promise<DeviceCodeInfo>
    msPoll(deviceCode: string): Promise<{ status: 'pending' | 'done' | 'error'; account?: Account; message?: string }>
    msRefresh(id: string): Promise<Account>
    /** 外置登录：先验证服务器地址，再用户名密码登录 */
    authlibMeta(apiUrl: string): Promise<{ serverName: string; implementationName?: string; implementationVersion?: string }>
    addAuthlib(apiUrl: string, username: string, password: string): Promise<Account>
    refreshAuthlib(id: string): Promise<Account>
  }
  java: {
    list(): Promise<JavaRuntimeInfo[]>
    download(component: string, major: number): Promise<JavaRuntimeInfo>
    detect(major: number): Promise<JavaRuntimeInfo | null>
  }
  launch: {
    /** 返回这次的 launchId；同一个实例可以反复调用开多份 */
    start(versionId: string, accountId: string): Promise<string>
    /** 传 launchId 只停那一次启动；不传停全部 */
    stop(launchId?: string): Promise<void>
    status(): Promise<LaunchStatus[]>
  }
  mods: {
    list(versionId: string): Promise<ModFile[]>
    openFolder(versionId: string): Promise<void>
  }
  loaders: {
    list(type: string, mcVersion: string): Promise<LoaderVersionInfo[]>
    install(type: string, mcVersion: string, loaderVersion: string): Promise<{ versionId: string }>
    installed(): Promise<{ versionId: string; type: string; mcVersion: string }[]>
  }
  resources: {
    search(opts: { query: string; type: string; mcVersion?: string; loader?: string; tag?: string; sort?: string; limit?: number; offset?: number }): Promise<{ hits: ResourceHit[]; total: number }>
    versions(projectId: string, mcVersion?: string, loader?: string): Promise<ResourceVersionLite[]>
    download(opts: { type: string; file: ResourceFileRef; versionId?: string }): Promise<{ file: string; dir: string }>
    installModpack(projectId: string, mcVersion?: string): Promise<{ versionId: string; name: string; files: number }>
    searchMcmod(query: string, limit?: number): Promise<McmodHit[]>
  }
  worlds: {
    list(versionId?: string, isolated?: boolean): Promise<WorldSave[]>
    openFolder(versionId?: string, isolated?: boolean): Promise<void>
    remove(path: string): Promise<void>
  }
  servers: {
    list(versionId?: string, isolated?: boolean): Promise<ServerEntry[]>
    add(versionId: string | undefined, isolated: boolean, entry: ServerEntry): Promise<ServerEntry[]>
    remove(versionId: string | undefined, isolated: boolean, ip: string): Promise<ServerEntry[]>
  }
  maps: {
    search(query: string, index?: number): Promise<{ hits: WorldMapHit[]; total: number }>
    files(modId: number, gameVersion?: string): Promise<WorldMapFile[]>
    download(modId: number, file: WorldMapFile, versionId?: string): Promise<{ dir: string; world: string }>
    importZip(versionId?: string): Promise<{ world: string; dir: string } | null>
  }
  cf: {
    search(opts: { type: string; query: string; mcVersion?: string; loader?: string; index?: number }): Promise<{ hits: ResourceHit[]; total: number }>
    files(projectId: number, mcVersion?: string, loader?: string): Promise<WorldMapFile[]>
    download(type: string, file: WorldMapFile, versionId?: string): Promise<{ file: string; dir: string }>
    installModpack(projectId: number, fileId: number): Promise<{ versionId: string; name: string; files: number }>
  }
  favorites: {
    list(): Promise<FavoriteItem[]>
    add(item: FavoriteItem): Promise<FavoriteItem[]>
    remove(id: string): Promise<FavoriteItem[]>
  }
  instance: {
    components(versionId: string): Promise<VersionComponent[]>
    files(versionId: string, kind: InstanceFileKind): Promise<InstanceFile[]>
    stats(versionId: string): Promise<VersionStats>
    toggle(path: string): Promise<void>
    retire(versionId: string, kind: string): Promise<{ moved: string[]; target: string }>
    rename(versionId: string, newId: string): Promise<string>
    export(versionId: string): Promise<{ file: string; entries: number }>
    importPackage(): Promise<{ versionId: string; files: number; dir: string } | null>
    getSettings(versionId: string): Promise<VersionSettings>
    setSettings(versionId: string, patch: Partial<VersionSettings>): Promise<VersionSettings>
    openFolder(versionId: string, kind?: InstanceFileKind | 'root'): Promise<void>
    deleteFiles(paths: string[]): Promise<void>
  }
  multiplayer: {
    status(): Promise<TerracottaStatus>
    agree(): Promise<boolean>
    install(): Promise<{ version: string }>
    start(): Promise<void>
    host(): Promise<void>
    join(room: string): Promise<void>
    leave(): Promise<void>
    stop(): Promise<void>
    state(): Promise<TerracottaState | null>
    log(): Promise<string>
    openDir(): Promise<void>
  }
  onProgress(cb: (p: DownloadProgress) => void): () => void
  onLog(cb: (l: LogLine) => void): () => void
  onStatus(cb: (s: LaunchStatus) => void): () => void
  onLaunchProgress(cb: (p: LaunchProgress) => void): () => void
  openExternal(url: string): Promise<void>
  openPath(p: string): Promise<void>
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
  }
}
