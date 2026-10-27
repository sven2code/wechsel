import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type WechselApi } from '../shared/ipc';

// Schmale, typisierte Brücke – die Oberfläche erhält keinen Node-Zugriff.
const api: WechselApi = {
  snapshot: () => ipcRenderer.invoke(IPC.snapshot),
  send: (cmd) => ipcRenderer.invoke(IPC.command, cmd),
  onState: (fn) => {
    const listener = (_e: unknown, s: Parameters<typeof fn>[0]) => fn(s);
    ipcRenderer.on(IPC.state, listener);
    return () => ipcRenderer.removeListener(IPC.state, listener);
  },
  onNavigate: (fn) => {
    const listener = (_e: unknown, v: Parameters<typeof fn>[0]) => fn(v);
    ipcRenderer.on(IPC.navigate, listener);
    return () => ipcRenderer.removeListener(IPC.navigate, listener);
  },
};

contextBridge.exposeInMainWorld('wechsel', api);
