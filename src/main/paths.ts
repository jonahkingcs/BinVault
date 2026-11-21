import type { BigIntStats } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, sep } from 'node:path'
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
  identity: string
}

export interface FolderSnapshot {
  rootPath: string
  scope: string
  folders: { relativePath: string; name: string }[]
  files: ScannedFile[]
  skipped: string[]
  pending: string[]
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

export function containsPath(root: string, path: string): boolean {
  const child = relative(pathKey(root), pathKey(path))
  return child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child)
}

export function fileIdentity(stats: BigIntStats): string {
  return stats.ino && stats.nlink === 1n && stats.birthtimeNs > 0n ? [stats.dev, stats.ino, stats.birthtimeNs].join(':') : ''
}

export function isMissing(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')
}

export async function readRootIdentity(path: string): Promise<string> {
  const stats = await lstat(path, { bigint: true })
  if (!stats.isDirectory() || pathKey(await realpath(path)) !== pathKey(path)) {
    throw new Error('The linked folder now points to another location.')
  }
  return [stats.dev, stats.ino, stats.birthtimeNs].join(':')
}

export async function scanFolder(rootPath: string, { target = rootPath, stableBefore, signal }: {
  target?: string; stableBefore?: number; signal?: AbortSignal
} = {}): Promise<FolderSnapshot> {
  const observedAt = Date.now()
  const relativePathFor = (path: string) => relative(rootPath, path).split(sep).join('/')
  const scope = relativePathFor(target)
  const snapshot: FolderSnapshot = { rootPath, scope, folders: [], files: [], skipped: [], pending: [] }

  async function readFile(absolutePath: string, stats?: BigIntStats): Promise<void> {
    const name = basename(absolutePath)
    const extension = extname(name).slice(1).toLowerCase()
    const format = formatFor(extension)
    if (!format) return
    try {
      stats ??= await lstat(absolutePath, { bigint: true })
      if (!stats.isFile()) return
      if (stableBefore !== undefined &&
          [stats.mtimeMs, stats.ctimeMs, stats.birthtimeMs].some(time => Number(time) > stableBefore && Number(time) <= observedAt)) {
        snapshot.skipped.push(relativePathFor(absolutePath))
        snapshot.pending.push(absolutePath)
        return
      }
      snapshot.files.push({
        name, absolutePath, relativeFolder: relativePathFor(dirname(absolutePath)),
        extension, kind: format.kind, category: defaultCategory(format, absolutePath),
        size: Number(stats.size), modifiedAt: Number(stats.mtimeMs), identity: fileIdentity(stats),
      })
    } catch {
      snapshot.skipped.push(relativePathFor(absolutePath))
    }
  }

  async function visit(absolutePath: string, relativePath: string): Promise<void> {
    let entries
    try {
      if (pathKey(await realpath(absolutePath)) !== pathKey(absolutePath)) {
        if (!relativePath) throw new Error('The linked folder now points to another location.')
        snapshot.skipped.push(relativePath)
        return
      }
      entries = await readdir(absolutePath, { withFileTypes: true })
    } catch (error) {
      if (!relativePath) throw error
      // The entry was present when its parent was read. Retry on the next scan
      // before declaring anything under it missing.
      snapshot.skipped.push(relativePath)
      return
    }

    snapshot.folders.push({ relativePath, name: basename(absolutePath) || absolutePath })
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (entry.isSymbolicLink()) continue
      const entryPath = join(absolutePath, entry.name)
      const entryRelativePath = relativePathFor(entryPath)
      if (entry.isDirectory()) {
        await visit(entryPath, entryRelativePath)
        continue
      }

      if (entry.isFile()) await readFile(entryPath)
    }
  }

  signal?.throwIfAborted()
  if (!scope) {
    await visit(rootPath, '')
  } else {
    try {
      const stats = await lstat(target, { bigint: true })
      const currentPath = await realpath(target)
      if (pathKey(currentPath) !== pathKey(target)) return snapshot
      if (stats.isDirectory()) await visit(currentPath, relativePathFor(currentPath))
      if (stats.isFile()) await readFile(currentPath, stats)
    } catch (error) {
      signal?.throwIfAborted()
      if (!isMissing(error)) snapshot.skipped.push(scope)
    }
  }
  signal?.throwIfAborted()
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
