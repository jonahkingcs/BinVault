import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { ipc } from '../shared/ipc'
import type { BinwiseApi } from '../shared/library'

const binwise: BinwiseApi = {
  getLibrary: () => ipcRenderer.invoke(ipc.getLibrary),
  getFolders: folderId => ipcRenderer.invoke(ipc.getFolders, folderId),
  getAssets: query => ipcRenderer.invoke(ipc.getAssets, query),
  importFolder: () => ipcRenderer.invoke(ipc.importFolder),
  rescan: rootId => ipcRenderer.invoke(ipc.rescan, rootId),
  updateAsset: (id, patch) => ipcRenderer.invoke(ipc.updateAsset, id, patch),
  revealAsset: id => ipcRenderer.invoke(ipc.revealAsset, id),
  copyPath: id => ipcRenderer.invoke(ipc.copyPath, id),
  startDrag: id => ipcRenderer.send(ipc.startDrag, id),
  onDragError: listener => {
    const handler = (_event: IpcRendererEvent, message: string) => listener(message)
    ipcRenderer.on(ipc.dragError, handler)
    return () => { ipcRenderer.removeListener(ipc.dragError, handler) }
  },
  nativeDragAvailable: process.platform === 'win32',
}

contextBridge.exposeInMainWorld('binwise', binwise)
