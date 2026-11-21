import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { resolve } from 'node:path'
import type { LibrarySyncStatus, RefreshReport, ScanReport } from '../shared/library.ts'
import type { Library } from './library.ts'
import { containsPath, pathKey, readRootIdentity } from './paths.ts'

interface RootWatch {
  path: string
  identity: string
  handle: FSWatcher
}

const stabilityMs = 1000
const eventDelay = 1200
const batchWindow = 100
const recoveryDelay = 30_000

export class FolderSync {
  private readonly library: Library
  private readonly onStatus: (status: LibrarySyncStatus) => void
  private readonly healthInterval: number
  private readonly watchers = new Map<string, RootWatch>()
  private readonly connected = new Map<number, string>()
  private readonly offline = new Set<number>()
  private readonly retryAt = new Map<number, number>()
  private readonly pending = new Map<string, { path: string; due: number }>()
  private readonly abort = new AbortController()
  private healthTimer?: NodeJS.Timeout
  private batchTimer?: NodeJS.Timeout
  private batchAt = Infinity
  private tail = Promise.resolve()
  private running = false
  private checkingHealth = false
  private closed = false
  private previousStatus?: LibrarySyncStatus

  constructor(library: Library, onStatus: (status: LibrarySyncStatus) => void, healthInterval = 5000) {
    this.library = library
    this.onStatus = onStatus
    this.healthInterval = healthInterval
  }

  start(): Promise<RefreshReport> {
    this.healthTimer ??= setInterval(() => {
      if (this.checkingHealth) return
      this.checkingHealth = true
      void this.enqueue(async () => {
        const roots = await this.configureWatches()
        const now = Date.now()
        for (const [id, due] of this.retryAt) {
          if (due <= now && this.connected.has(id)) roots.add(id)
        }
        if (roots.size) {
          this.running = true
          this.publish()
          await this.scan([...roots])
        }
      }, false).catch(error => this.reportError(error)).finally(() => { this.checkingHealth = false })
    }, this.healthInterval).unref()
    return this.refresh()
  }

  async stop(): Promise<void> {
    this.closed = true
    this.abort.abort()
    clearInterval(this.healthTimer)
    clearTimeout(this.batchTimer)
    this.pending.clear()
    for (const key of this.watchers.keys()) this.closeWatch(key)
    await this.tail
  }

  getStatus(): LibrarySyncStatus {
    const limited = new Set([...this.offline, ...this.retryAt.keys()])
    for (const [id, path] of this.connected) {
      if (!this.covered(path)) limited.add(id)
    }
    return {
      syncing: this.running || this.pending.size > 0,
      limitedRoots: limited.size,
      revision: this.library.revision,
      folderRevision: this.library.folderRevision,
    }
  }

  importFolder(path: string): Promise<ScanReport> {
    return this.enqueue(async () => {
      const report = await this.library.importFolder(path, this.abort.signal)
      const roots = await this.configureWatches()
      roots.add(report.rootId)
      // Cover filesystem changes between the import snapshot and watch registration.
      for (const root of this.library.getLinkedRoots()) {
        if (roots.has(root.id) && this.connected.has(root.id)) this.queuePath(root.path)
      }
      if (report.skipped) this.retryAt.set(report.rootId, Date.now() + recoveryDelay)
      return report
    })
  }

  rescan(rootId: number): Promise<ScanReport> {
    return this.enqueue(async () => {
      const recovered = await this.configureWatches()
      const result = await this.scan([...new Set([rootId, ...recovered])])
      const report = result.reports.find(item => item.rootId === rootId)
      if (!report) throw new Error('Could not rescan this folder. Check that the original location is connected and accessible.')
      return report
    })
  }

  refresh(): Promise<RefreshReport> {
    return this.enqueue(async () => {
      await this.configureWatches()
      return this.scan(this.library.getLinkedRoots().map(root => root.id))
    })
  }

  unlinkFolder(rootId: number): Promise<void> {
    return this.enqueue(async () => {
      this.library.unlinkFolder(rootId)
      const roots = await this.configureWatches()
      if (roots.size) await this.scan([...roots])
    })
  }

  private async scan(ids: number[]): Promise<RefreshReport> {
    const result = await this.library.rescanRoots(ids, this.abort.signal)
    for (const report of result.reports) {
      if (!report.skipped) this.retryAt.delete(report.rootId)
    }
    for (const id of ids) {
      if (result.failed.includes(id) || result.reports.some(report => report.rootId === id && report.skipped) ||
          !this.covered(this.connected.get(id))) this.retryAt.set(id, Date.now() + recoveryDelay)
    }
    return result
  }

  private covered(path?: string): boolean {
    return path !== undefined && [...this.watchers.values()].some(watcher => containsPath(watcher.path, path))
  }

  private async configureWatches(): Promise<Set<number>> {
    const roots = this.library.getLinkedRoots().sort((a, b) => a.path.length - b.path.length)
    const ids = new Set(roots.map(root => root.id))
    const needed = new Set<string>()
    const recovered = new Set<number>()
    const previouslyCovered = new Set([...this.connected].filter(([, path]) => this.covered(path)).map(([id]) => id))
    for (const id of this.connected.keys()) {
      if (!ids.has(id)) this.connected.delete(id)
    }
    for (const id of this.offline) {
      if (!ids.has(id)) this.offline.delete(id)
    }
    for (const id of this.retryAt.keys()) {
      if (!ids.has(id)) this.retryAt.delete(id)
    }
    const watchedPaths: string[] = []
    for (const root of roots) {
      const identity = await readRootIdentity(root.path).catch(() => undefined)
      if (this.closed) break
      if (identity === undefined) {
        this.connected.delete(root.id)
        this.offline.add(root.id)
        this.library.markRootUnavailable(root.id)
        continue
      }
      if (this.connected.get(root.id) !== root.path || !previouslyCovered.has(root.id)) recovered.add(root.id)
      this.connected.set(root.id, root.path)
      this.offline.delete(root.id)
      if (watchedPaths.some(path => containsPath(path, root.path))) continue
      const key = pathKey(root.path)
      if (this.watchers.get(key)?.identity !== identity) {
        this.closeWatch(key)
        this.openWatch(root.path, identity, key)
        if (this.watchers.has(key)) {
          for (const linked of roots) {
            if (containsPath(root.path, linked.path)) recovered.add(linked.id)
          }
        }
      }
      if (this.watchers.has(key)) {
        needed.add(key)
        watchedPaths.push(root.path)
      } else if (!this.retryAt.has(root.id)) {
        this.retryAt.set(root.id, Date.now() + recoveryDelay)
      }
    }
    for (const key of this.watchers.keys()) {
      if (!needed.has(key)) this.closeWatch(key)
    }
    for (const id of recovered) {
      if (!this.connected.has(id) || !this.covered(this.connected.get(id))) recovered.delete(id)
    }
    return recovered
  }

  private openWatch(path: string, identity: string, key: string): void {
    try {
      const handle = watch(path, { recursive: true, persistent: false }, (_event, filename) => {
        if (this.watchers.get(key)?.handle !== handle) return
        const changed = filename ? resolve(path, filename) : path
        if (containsPath(path, changed)) this.queuePath(changed)
      })
      const lost = () => {
        if (this.watchers.get(key)?.handle !== handle) return
        this.closeWatch(key)
        this.publish()
      }
      handle.on('error', lost)
      handle.on('close', lost)
      this.watchers.set(key, { path, identity, handle })
    } catch {
      // The health check retries registration and falls back to occasional scans.
    }
  }

  private closeWatch(key: string): void {
    const watcher = this.watchers.get(key)
    this.watchers.delete(key)
    watcher?.handle.close()
  }

  private queuePath(path: string): void {
    if (this.closed) return
    const wasIdle = !this.running && this.pending.size === 0
    const due = Date.now() + eventDelay
    this.pending.set(pathKey(path), { path, due })
    this.scheduleBatch(due)
    if (wasIdle) this.publish()
  }

  private scheduleBatch(due: number): void {
    if (this.closed || due >= this.batchAt) return
    clearTimeout(this.batchTimer)
    this.batchAt = due
    this.batchTimer = setTimeout(() => {
      void this.enqueue(async () => {
        this.batchAt = Infinity
        const now = Date.now()
        const paths: string[] = []
        for (const [key, item] of this.pending) {
          if (item.due > now) {
            this.scheduleBatch(item.due)
            continue
          }
          this.pending.delete(key)
          paths.push(item.path)
        }
        if (!paths.length) return
        paths.sort((a, b) => a.length - b.length)
        const { pending, incomplete } = await this.library.reconcilePaths(paths, stabilityMs, this.abort.signal)
        for (const path of pending) {
          if (!this.pending.has(pathKey(path))) this.queuePath(path)
        }
        for (const id of incomplete) {
          if (!this.retryAt.has(id)) this.retryAt.set(id, Date.now() + recoveryDelay)
        }
      }).catch(error => this.reportError(error))
    }, Math.max(0, due - Date.now()) + batchWindow).unref()
  }

  private enqueue<T>(work: () => Promise<T>, visible = true): Promise<T> {
    const operation = this.tail.then(async () => {
      if (this.closed) throw new Error('Library synchronisation is shutting down.')
      this.running = visible
      this.publish()
      try {
        return await work()
      } finally {
        this.running = false
        this.publish()
      }
    })
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private publish(): void {
    if (this.closed) return
    const status = this.getStatus()
    const previous = this.previousStatus
    if (previous && previous.revision === status.revision && previous.folderRevision === status.folderRevision &&
        previous.syncing === status.syncing && previous.limitedRoots === status.limitedRoots) return
    this.previousStatus = status
    this.onStatus(status)
  }

  private reportError(error: unknown): void {
    if (!this.closed) console.error('Binwise folder synchronisation failed', error)
  }
}
