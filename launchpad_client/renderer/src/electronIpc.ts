export type ElectronIpcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void
  removeListener: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void
}

/** Returns the Electron IPC bridge when running inside the desktop shell; otherwise null. */
export function getElectronIpc(): ElectronIpcRenderer | null {
  try {
    return require('electron').ipcRenderer as ElectronIpcRenderer
  } catch {
    return null
  }
}
