import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/api'
import type { Account, Api, DownloadProgress, FavoriteItem, LaunchProgress, LaunchStatus, LogLine, ServerEntry, Settings, WorldMapFile } from '../shared/types'

const api = {
  platform: () => ipcRenderer.invoke('platform:info'),
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(IPC.settingsSet, patch),
    pickDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickDir),
    pickJava: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickJava),
    pickBackground: (): Promise<{ path: string; kind: 'image' | 'video' | 'wallpaper' } | null> => ipcRenderer.invoke('dialog:pickBackground'),
    resolveMedia: (path: string): Promise<string | null> => ipcRenderer.invoke(IPC.resolveMedia, path)
  },
  versions: {
    manifest: (force?: boolean) => ipcRenderer.invoke(IPC.manifest, force),
    local: () => ipcRenderer.invoke(IPC.localVersions),
    install: (id: string) => ipcRenderer.invoke(IPC.installVersion, id),
    remove: (id: string) => ipcRenderer.invoke(IPC.removeVersion, id),
    cancelInstall: () => ipcRenderer.invoke(IPC.cancelInstall),
    addFolder: () => ipcRenderer.invoke(IPC.addVersionFolder),
    removeFolder: (dir: string) => ipcRenderer.invoke(IPC.removeVersionFolder, dir),
    extraDirs: () => ipcRenderer.invoke(IPC.extraVersionDirs),
    clone: (srcId: string, newId: string) => ipcRenderer.invoke(IPC.cloneVersion, srcId, newId)
  },
  accounts: {
    list: (): Promise<Account[]> => ipcRenderer.invoke(IPC.accountsList),
    addOffline: (name: string): Promise<Account> => ipcRenderer.invoke(IPC.accountsAddOffline, name),
    remove: (id: string) => ipcRenderer.invoke(IPC.accountsRemove, id),
    setActive: (id: string) => ipcRenderer.invoke(IPC.accountsSetActive, id),
    active: (): Promise<Account | null> => ipcRenderer.invoke(IPC.accountsActive),
    msStart: () => ipcRenderer.invoke(IPC.msStart),
    msPoll: (deviceCode: string) => ipcRenderer.invoke(IPC.msPoll, deviceCode),
    msRefresh: (id: string) => ipcRenderer.invoke(IPC.msRefresh, id),
    authlibMeta: (apiUrl: string) => ipcRenderer.invoke(IPC.accountsAuthlibMeta, apiUrl),
    addAuthlib: (apiUrl: string, username: string, password: string) => ipcRenderer.invoke(IPC.accountsAddAuthlib, apiUrl, username, password),
    refreshAuthlib: (id: string) => ipcRenderer.invoke(IPC.accountsRefreshAuthlib, id)
  },
  java: {
    list: () => ipcRenderer.invoke(IPC.javaList),
    download: (component: string, major: number) => ipcRenderer.invoke(IPC.javaDownload, component, major),
    detect: (major: number) => ipcRenderer.invoke(IPC.javaDetect, major)
  },
  launch: {
    start: (versionId: string, accountId: string) => ipcRenderer.invoke(IPC.launchStart, versionId, accountId),
    stop: (launchId?: string) => ipcRenderer.invoke(IPC.launchStop, launchId),
    status: (): Promise<LaunchStatus[]> => ipcRenderer.invoke(IPC.launchStatus)
  },
  mods: {
    list: (versionId: string) => ipcRenderer.invoke(IPC.modsList, versionId),
    openFolder: (versionId: string) => ipcRenderer.invoke(IPC.modsOpen, versionId)
  },
  loaders: {
    list: (type: string, mcVersion: string) => ipcRenderer.invoke(IPC.loaderList, type, mcVersion),
    install: (type: string, mcVersion: string, loaderVersion: string) => ipcRenderer.invoke(IPC.loaderInstall, type, mcVersion, loaderVersion),
    installed: () => ipcRenderer.invoke(IPC.loaderInstalled)
  },
  resources: {
    search: (opts: { query: string; type: string; mcVersion?: string; loader?: string; tag?: string; sort?: string; limit?: number; offset?: number }) => ipcRenderer.invoke(IPC.resSearch, opts),
    versions: (projectId: string, mcVersion?: string, loader?: string) => ipcRenderer.invoke(IPC.resVersions, projectId, mcVersion, loader),
    download: (opts: { type: string; file: { name: string; url: string; size: number; sha1?: string }; versionId?: string }) => ipcRenderer.invoke(IPC.resDownload, opts),
    installModpack: (projectId: string, mcVersion?: string) => ipcRenderer.invoke(IPC.resInstallModpack, projectId, mcVersion),
    searchMcmod: (query: string, limit?: number) => ipcRenderer.invoke(IPC.resSearchMcmod, query, limit)
  },
  worlds: {
    list: (versionId?: string, isolated?: boolean) => ipcRenderer.invoke(IPC.worldsList, versionId, isolated),
    openFolder: (versionId?: string, isolated?: boolean) => ipcRenderer.invoke(IPC.worldsOpen, versionId, isolated),
    remove: (path: string) => ipcRenderer.invoke(IPC.worldsDelete, path)
  },
  servers: {
    list: (versionId?: string, isolated?: boolean) => ipcRenderer.invoke(IPC.serversList, versionId, isolated),
    add: (versionId: string | undefined, isolated: boolean, entry: ServerEntry) =>
      ipcRenderer.invoke(IPC.serversAdd, versionId, isolated, entry),
    remove: (versionId: string | undefined, isolated: boolean, ip: string) =>
      ipcRenderer.invoke(IPC.serversRemove, versionId, isolated, ip)
  },
  maps: {
    search: (query: string, index?: number) => ipcRenderer.invoke(IPC.mapSearch, query, index),
    files: (modId: number, gameVersion?: string) => ipcRenderer.invoke(IPC.mapFiles, modId, gameVersion),
    download: (modId: number, file: WorldMapFile, versionId?: string) => ipcRenderer.invoke(IPC.mapDownload, modId, file, versionId),
    importZip: (versionId?: string) => ipcRenderer.invoke(IPC.mapImport, versionId)
  },
  cf: {
    search: (opts: { type: string; query: string; mcVersion?: string; loader?: string; index?: number }) => ipcRenderer.invoke(IPC.cfSearch, opts),
    files: (projectId: number, mcVersion?: string, loader?: string) => ipcRenderer.invoke(IPC.cfFiles, projectId, mcVersion, loader),
    download: (type: string, file: WorldMapFile, versionId?: string) => ipcRenderer.invoke(IPC.cfDownload, type, file, versionId),
    installModpack: (projectId: number, fileId: number) => ipcRenderer.invoke(IPC.cfInstallModpack, projectId, fileId)
  },
  favorites: {
    list: () => ipcRenderer.invoke(IPC.favList),
    add: (item: FavoriteItem) => ipcRenderer.invoke(IPC.favAdd, item),
    remove: (id: string) => ipcRenderer.invoke(IPC.favRemove, id)
  },
  instance: {
    components: (versionId: string) => ipcRenderer.invoke(IPC.instComponents, versionId),
    files: (versionId: string, kind: string) => ipcRenderer.invoke(IPC.instFiles, versionId, kind),
    stats: (versionId: string) => ipcRenderer.invoke(IPC.instStats, versionId),
    toggle: (path: string) => ipcRenderer.invoke(IPC.instToggle, path),
    retire: (versionId: string, kind: string) => ipcRenderer.invoke(IPC.instRetire, versionId, kind),
    rename: (versionId: string, newId: string) => ipcRenderer.invoke(IPC.instRename, versionId, newId),
    export: (versionId: string) => ipcRenderer.invoke(IPC.instExport, versionId),
    importPackage: () => ipcRenderer.invoke(IPC.instImport),
    getSettings: (versionId: string) => ipcRenderer.invoke(IPC.instSettingsGet, versionId),
    setSettings: (versionId: string, patch: Record<string, unknown>) => ipcRenderer.invoke(IPC.instSettingsSet, versionId, patch),
    openFolder: (versionId: string, kind?: string) => ipcRenderer.invoke(IPC.instOpenFolder, versionId, kind),
    deleteFiles: (paths: string[]) => ipcRenderer.invoke(IPC.instDeleteFiles, paths)
  },
  multiplayer: {
    status: () => ipcRenderer.invoke(IPC.mpStatus),
    agree: () => ipcRenderer.invoke(IPC.mpAgree),
    install: () => ipcRenderer.invoke(IPC.mpInstall),
    start: () => ipcRenderer.invoke(IPC.mpStart),
    host: () => ipcRenderer.invoke(IPC.mpHost),
    join: (room: string) => ipcRenderer.invoke(IPC.mpJoin, room),
    leave: () => ipcRenderer.invoke(IPC.mpLeave),
    stop: () => ipcRenderer.invoke(IPC.mpStop),
    state: () => ipcRenderer.invoke(IPC.mpState),
    log: () => ipcRenderer.invoke(IPC.mpLog),
    openDir: () => ipcRenderer.invoke(IPC.mpOpenDir)
  },
  onProgress: (cb: (p: DownloadProgress) => void) => {
    const h = (_e: unknown, p: DownloadProgress): void => cb(p)
    ipcRenderer.on(IPC.evProgress, h)
    return () => ipcRenderer.removeListener(IPC.evProgress, h)
  },
  onLaunchProgress: (cb: (p: LaunchProgress) => void) => {
    const h = (_e: unknown, p: LaunchProgress): void => cb(p)
    ipcRenderer.on(IPC.evLaunchProgress, h)
    return () => ipcRenderer.removeListener(IPC.evLaunchProgress, h)
  },
  onLog: (cb: (l: LogLine) => void) => {
    const h = (_e: unknown, l: LogLine): void => cb(l)
    ipcRenderer.on(IPC.evLog, h)
    return () => ipcRenderer.removeListener(IPC.evLog, h)
  },
  onStatus: (cb: (s: LaunchStatus) => void) => {
    const h = (_e: unknown, s: LaunchStatus): void => cb(s)
    ipcRenderer.on(IPC.evStatus, h)
    return () => ipcRenderer.removeListener(IPC.evStatus, h)
  },
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  openPath: (p: string) => ipcRenderer.invoke(IPC.openPath, p),
  reveal: (kind: 'data' | 'exports' | 'config' | 'log') => ipcRenderer.invoke(IPC.reveal, kind),
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMin),
    toggleMaximize: () => ipcRenderer.send(IPC.windowMax),
    close: () => ipcRenderer.send(IPC.windowClose)
  }
} satisfies Api

contextBridge.exposeInMainWorld('api', api)
