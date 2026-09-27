/**
 * Preload: the ONLY surface the renderer can use. Everything is promise-based
 * via invoke; channels are validated and permission-gated in the main process.
 */
import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api = {
  invoke,
  on: (channel: string, cb: (payload: unknown) => void) => {
    const allowed = new Set(['app:locked', 'app:session-changed', 'app:navigate', 'app:notify']);
    if (!allowed.has(channel)) return () => undefined;
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  versions: {
    get electron() {
      return process.versions.electron ?? '';
    },
    get chrome() {
      return process.versions.chrome ?? '';
    },
    get node() {
      return process.versions.node ?? '';
    },
  },
};

contextBridge.exposeInMainWorld('dentiva', api);

export type DentivaApi = typeof api;
