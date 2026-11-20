import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, protocol, session } from 'electron'
import { mediaScheme } from '../shared/ipc'
import { registerLibraryIpc } from './desktop'
import { Library } from './library'
import { serveMedia } from './media'

protocol.registerSchemesAsPrivileged([{
  scheme: mediaScheme,
  privileges: { standard: true, secure: true, stream: true, corsEnabled: true },
}])
app.setName('Binwise')

let window: BrowserWindow | null = null
let library: Library | undefined
const rendererFile = join(__dirname, '../renderer/index.html')
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const pageUrl = devUrl ? new URL(devUrl).href : pathToFileURL(rendererFile).href
const rendererOrigin = new URL(pageUrl).origin

function createWindow(): void {
  window = new BrowserWindow({
    title: 'Binwise',
    width: 1440,
    height: 920,
    minWidth: 860,
    minHeight: 580,
    backgroundColor: '#11141d',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#11141d', symbolColor: '#a4adbe', height: 40 },
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-redirect', event => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => { window = null })
  const loaded = devUrl ? window.loadURL(pageUrl) : window.loadFile(rendererFile)
  void loaded.catch(error => {
    dialog.showErrorBox('Unable to open Binwise', String(error))
    app.quit()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  void app.whenReady().then(() => {
    const storage = new Library(join(app.getPath('userData'), 'library.sqlite'))
    library = storage
    session.defaultSession.setPermissionCheckHandler(() => false)
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    protocol.handle(mediaScheme, request => serveMedia(request, id => storage.getAsset(id), rendererOrigin))
    registerLibraryIpc(storage, () => window, pageUrl)
    createWindow()
    app.on('activate', () => { if (!window) createWindow() })
  }).catch(error => {
    dialog.showErrorBox('Unable to start Binwise', String(error))
    app.quit()
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', () => {
    library?.close()
    library = undefined
  })
}
