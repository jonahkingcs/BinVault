import { clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { ipc } from '../shared/ipc'
import { checkedFilePath } from './paths'
import { validateId, validatePatch, validateQuery } from './validation'
import type { Library } from './library'

function createDragIcon() {
  const size = 32
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 4; y < 28; y++) {
    for (let x = 4; x < 28; x++) {
      const mark = x >= 10 && x < 22 && ((y >= 11 && y < 14) || (y >= 18 && y < 21))
      pixels.writeUInt32LE(mark ? 0xfffaf8ff : 0xff865ee8, (y * size + x) * 4)
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size })
}

export function registerLibraryIpc(library: Library, getWindow: () => BrowserWindow | null, pageUrl: string): void {
  const dragIcon = createDragIcon()
  let importing = false

  function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const window = getWindow()
    return Boolean(window && event.sender === window.webContents &&
      event.senderFrame === event.sender.mainFrame && event.senderFrame?.url === pageUrl)
  }

  function handle<T>(channel: string, operation: (...args: unknown[]) => T): void {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Invalid library request origin.')
      return operation(...args)
    })
  }

  handle(ipc.getLibrary, () => library.getLibrary())
  handle(ipc.getFolders, id => library.getFolders(validateId(id)))
  handle(ipc.getAssets, query => library.getAssets(validateQuery(query)))
  handle(ipc.importFolder, async () => {
    const window = getWindow()
    if (!window || importing) return null
    importing = true
    try {
      const result = await dialog.showOpenDialog(window, {
        title: 'Link an asset folder',
        buttonLabel: 'Link Folder',
        properties: ['openDirectory', 'dontAddToRecent'],
      })
      const folder = result.filePaths[0]
      return result.canceled || !folder ? null : await library.importFolder(folder)
    } finally {
      importing = false
    }
  })
  handle(ipc.rescan, id => library.rescan(validateId(id)))
  handle(ipc.updateAsset, (id, patch) => library.updateAsset(validateId(id), validatePatch(patch)))
  handle(ipc.revealAsset, async id => {
    const asset = library.getAsset(validateId(id))
    shell.showItemInFolder(await checkedFilePath(asset.absolutePath))
  })
  handle(ipc.copyPath, id => {
    const asset = library.getAsset(validateId(id))
    clipboard.writeText(asset.absolutePath)
  })

  ipcMain.on(ipc.startDrag, async (event, id: unknown) => {
    if (process.platform !== 'win32' || !trusted(event)) return
    try {
      const asset = library.getAsset(validateId(id))
      if (!asset.available || asset.kind === 'editing') return
      const file = await checkedFilePath(asset.absolutePath)
      if (!event.sender.isDestroyed() && trusted(event)) event.sender.startDrag({ file, icon: dragIcon })
    } catch (error) {
      if (!event.sender.isDestroyed() && trusted(event)) {
        const message = error instanceof Error ? error.message : 'The file could not be dragged.'
        event.sender.send(ipc.dragError, message)
      }
    }
  })
}
