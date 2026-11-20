import { basename, extname, join, normalize, relative, sep } from 'node:path'
import { lstat, realpath, readdir } from 'node:fs/promises'
import { defaultCategory, formatFor } from '../shared/formats.ts'
import type { Category, FileKind } from '../shared/formats.ts'

export interface ScannedFile {
  name: string
  absolutePath: string
  relativeFolder: string
  extension: string
  kind: FileKind
  category: Category
  size: number
  modifiedAt: number
}

export interface FolderSnapshot {
  rootPath: string
  folders: { relativePath: string; parentPath: string | null; name: string }[]
  files: ScannedFile[]
  skipped: string[]
}

export function pathKey(path: string): string {
  const normalised = normalize(path)
  return process.platform === 'win32' ? normalised.toLowerCase() : normalised
}

export function relativeKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

export async function scanFolder(rootPath: string): Promise<FolderSnapshot> {
  const snapshot: FolderSnapshot = { rootPath, folders: [], files: [], skipped: [] }

  async function visit(absolutePath: string, relativePath: string, parentPath: string | null): Promise<void> {
    let entries
    try {
      if (pathKey(await realpath(absolutePath)) !== pathKey(absolutePath)) {
        if (parentPath === null) throw new Error('The linked folder now points to another location.')
        snapshot.skipped.push(relativePath)
        return
      }
      entries = await readdir(absolutePath, { withFileTypes: true })
    } catch (error) {
      if (parentPath === null) throw error
      // The entry was present when its parent was read. Retry on the next scan
      // before declaring anything under it missing.
      snapshot.skipped.push(relativePath)
      return
    }

    snapshot.folders.push({ relativePath, parentPath, name: basename(absolutePath) || absolutePath })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const entryPath = join(absolutePath, entry.name)
      const entryRelativePath = relative(rootPath, entryPath).split(sep).join('/')
      if (entry.isDirectory()) {
        await visit(entryPath, entryRelativePath, relativePath)
        continue
      }

      const extension = extname(entry.name).slice(1).toLowerCase()
      const format = entry.isFile() && formatFor(extension)
      if (!format) continue
      try {
        const stats = await lstat(entryPath)
        if (!stats.isFile()) continue
        snapshot.files.push({
          name: entry.name,
          absolutePath: entryPath,
          relativeFolder: relativePath,
          extension,
          kind: format.kind,
          category: defaultCategory(format, entryPath),
          size: stats.size,
          modifiedAt: Math.trunc(stats.mtimeMs),
        })
      } catch {
        snapshot.skipped.push(entryRelativePath)
      }
    }
  }

  await visit(rootPath, '', null)
  return snapshot
}

export async function checkedFilePath(absolutePath: string): Promise<string> {
  try {
    const currentPath = await realpath(absolutePath)
    if (pathKey(currentPath) === pathKey(absolutePath) && (await lstat(currentPath)).isFile()) {
      return currentPath
    }
  } catch {
    // Files may be removed or disconnected between scans.
  }
  throw new Error('This file is missing or inaccessible. Reconnect its drive or rescan the linked folder.')
}
