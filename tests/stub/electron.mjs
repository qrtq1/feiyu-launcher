// 纯 node 环境下 `import { app } from 'electron'` 拿不到具名导出，
// 测试时用这个桩顶替，让源码模块可以脱离 Electron 被直接加载。
export const app = {
  isPackaged: false,
  getPath: (name) => process.env.FEIYU_TEST_DATA_DIR ?? `${process.cwd()}/.test-tmp`,
  whenReady: () => Promise.resolve(),
  on() {},
  quit() {},
  requestSingleInstanceLock: () => true
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(`stub:${s}`, 'utf8'),
  decryptString: (b) => b.toString('utf8').slice('stub:'.length)
}

export const ipcMain = { handle() {}, on() {} }
export const ipcRenderer = {
  invoke: async () => undefined,
  on: () => undefined,
  removeListener() {},
  send() {}
}
export const contextBridge = { exposeInMainWorld() {} }
export const shell = { openExternal: async () => undefined, openPath: async () => 0 }
export const BrowserWindow = class BrowserWindow {}
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
