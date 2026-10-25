import { contextBridge, ipcRenderer } from 'electron'
import type { BuhoDocsApi } from '@shared/types'

function on<T>(channel: string, cb: (m: T) => void): () => void {
  const h = (_e: unknown, m: T): void => cb(m)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api: BuhoDocsApi = {
  appInfo: () => ipcRenderer.invoke('appInfo'),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (s) => ipcRenderer.invoke('saveSettings', s),
  setOverlay: (color, symbolColor) => ipcRenderer.invoke('overlay', color, symbolColor),
  recent: () => ipcRenderer.invoke('recent'),
  openDialog: () => ipcRenderer.invoke('openDialog'),
  open: (path) => ipcRenderer.invoke('open', path),
  create: (kind, estilo) => ipcRenderer.invoke('create', kind, estilo),
  bloques: () => ipcRenderer.invoke('bloques'),
  close: (path) => ipcRenderer.invoke('close', path),
  save: (path, content) => ipcRenderer.invoke('save', path, content),
  exportPdf: (path, choose) => ipcRenderer.invoke('exportPdf', path, choose),
  history: (path) => ipcRenderer.invoke('history', path),
  historyEntry: (path, id) => ipcRenderer.invoke('historyEntry', path, id),
  historyBefore: (path, id) => ipcRenderer.invoke('historyBefore', path, id),
  restore: (path, id) => ipcRenderer.invoke('restore', path, id),
  showInFolder: (path) => ipcRenderer.invoke('showInFolder', path),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  copy: (text) => ipcRenderer.invoke('copy', text),
  flushed: (id) => ipcRenderer.send('flushed', id),
  onDocChange: (cb) => on('doc-change', cb),
  onOpen: (cb) => on('open', cb),
  onShow: (cb) => on('show', cb),
  onFlush: (cb) => on('flush', cb)
}

contextBridge.exposeInMainWorld('buho', api)
