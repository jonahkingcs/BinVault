import { basename, dirname, join, relative, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import { categories, photoshopExtensions } from '../shared/formats.ts'
import type { Category, FileKind } from '../shared/formats.ts'
import { maxTagsPerAsset, pageSize } from '../shared/library.ts'
import type {
  Asset, AssetPage, AssetPatch, AssetQuery, AssetSort, FolderNode,
  LibrarySummary, ScanReport,
} from '../shared/library.ts'
import { migrate } from './schema.ts'
import { containsPath, pathKey, readRootIdentity, relativeKey, scanFolder } from './paths.ts'
import type { FolderSnapshot } from './paths.ts'

const recentWindow = 30 * 24 * 60 * 60 * 1000
const sortSql: Record<AssetSort, string> = {
  relevance: 'a.name COLLATE NOCASE ASC',
  'name-asc': 'a.name COLLATE NOCASE ASC',
  'name-desc': 'a.name COLLATE NOCASE DESC',
  'added-desc': 'a.added_at DESC',
  'added-asc': 'a.added_at ASC',
  'modified-desc': 'a.modified_at DESC',
  'size-desc': 'a.size DESC',
  'size-asc': 'a.size ASC',
  'type-asc': 'a.extension ASC, a.name COLLATE NOCASE ASC',
}

interface AssetRow {
  id: number
  name: string
  absolute_path: string
  root_path: string
  relative_path: string
  extension: string
  kind: FileKind
  category: Category
  size: number
  added_at: number
  modified_at: number
  favourite: number
  available: number
  tags_json: string
  notes: string
}

interface FolderRow {
  id: number
  name: string
  relative_path: string
  has_children: number
}

interface RootRow {
  id: number
  path: string
  name: string
}

interface ScopedScan {
  root: RootRow
  snapshot: FolderSnapshot
}

const activeAsset = 'EXISTS (SELECT 1 FROM locations active WHERE active.asset_id = a.id AND active.available = 1)'

function descendants(key: string, separator: string): [string, string] {
  return [key + separator, key + String.fromCharCode(separator.charCodeAt(0) + 1)]
}

const selectAsset = `
  SELECT a.*, r.path AS root_path, f.relative_path, l.available,
    (SELECT json_group_array(name) FROM (
      SELECT t.name FROM asset_tags at JOIN tags t ON t.id = at.tag_id
      WHERE at.asset_id = a.id ORDER BY t.name_key
    )) AS tags_json
  FROM assets a
  JOIN locations l ON l.asset_id = a.id AND l.root_id = (
    SELECT root_id FROM locations WHERE asset_id = a.id
    ORDER BY available DESC, root_id LIMIT 1
  )
  JOIN roots r ON r.id = l.root_id
  JOIN folders f ON f.id = l.folder_id
`

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id, name: row.name, absolutePath: row.absolute_path, rootPath: row.root_path,
    relativeFolder: row.relative_path, extension: row.extension, kind: row.kind,
    category: row.category, size: row.size, addedAt: row.added_at, modifiedAt: row.modified_at,
    favourite: Boolean(row.favourite), available: Boolean(row.available), tags: JSON.parse(row.tags_json), notes: row.notes,
  }
}

function toFolder(row: FolderRow): FolderNode {
  return {
    id: row.id, name: row.name, relativePath: row.relative_path, hasChildren: Boolean(row.has_children),
  }
}

function searchText(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

export class Library {
  private readonly db: DatabaseSync
  private scanning = false
  revision = 0
  folderRevision = 0

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath)
    try {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
      migrate(this.db)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close(): void {
    this.db.close()
  }

  getLibrary(): LibrarySummary {
    const roots = this.db.prepare(`
      SELECT r.id AS root_id, r.name AS root_name, r.path, r.scanned_at,
        f.id, f.name, f.relative_path,
        EXISTS (SELECT 1 FROM folders WHERE parent_id = f.id AND present = 1) AS has_children
      FROM roots r JOIN folders f ON f.root_id = r.id AND f.parent_id IS NULL
      ORDER BY r.name COLLATE NOCASE, r.id
    `).all() as unknown as (FolderRow & {
      root_id: number; root_name: string; path: string; scanned_at: number
    })[]
    const totals = this.db.prepare(`
      SELECT count(*) AS total, coalesce(sum(favourite), 0) AS favourites,
        coalesce(sum(added_at >= ?), 0) AS recent FROM assets a WHERE ${activeAsset}
    `).get(Date.now() - recentWindow)!
    const categoryCounts = Object.fromEntries(categories.map(category => [category, 0])) as Record<Category, number>
    for (const row of this.db.prepare(`SELECT category, count(*) AS total FROM assets a WHERE ${activeAsset} GROUP BY category`).all()) {
      categoryCounts[row.category as Category] = Number(row.total)
    }
    return {
      roots: roots.map(row => ({
        id: row.root_id, name: row.root_name, path: row.path,
        lastScannedAt: row.scanned_at, folder: toFolder(row),
      })),
      counts: { all: Number(totals.total), favourites: Number(totals.favourites), recent: Number(totals.recent) },
      categories: categoryCounts,
    }
  }

  getFolders(folderId: number): FolderNode[] {
    const rows = this.db.prepare(`
      SELECT f.id, f.name, f.relative_path,
        EXISTS (SELECT 1 FROM folders WHERE parent_id = f.id AND present = 1) AS has_children
      FROM folders f WHERE f.parent_id = ? AND f.present = 1 ORDER BY f.name COLLATE NOCASE, f.id
    `).all(folderId) as unknown as FolderRow[]
    return rows.map(toFolder)
  }

  getAssets(query: AssetQuery): AssetPage {
    const conditions: string[] = [activeAsset]
    const params: SQLInputValue[] = []
    let searchJoin = ''
    let order = sortSql[query.sort]
    const terms = [...new Set(searchText(query.search).trim().split(/\s+/u).filter(Boolean))]
    if (terms.length) {
      const long = terms.filter(term => [...term].length >= 3)
      const short = terms.filter(term => [...term].length < 3)
      if (long.length) {
        const expression = long.map(term => '"' + term.replaceAll('"', '""') + '"').join(' AND ')
        if (query.sort === 'relevance') {
          searchJoin = `JOIN asset_search(?, 'bm25(8.0, 2.0, 3.0, 6.0)') AS ranked ON ranked.rowid = a.id`
          order = 'ranked.rank, ' + order
        } else {
          conditions.push('a.id IN (SELECT rowid FROM asset_search WHERE asset_search MATCH ?)')
        }
        params.push(expression)
      }
      if (short.length) {
        const matches = short.map(() =>
          '(instr(s.name, ?) OR instr(s.folder_path, ?) OR instr(s.category, ?) OR instr(s.tags, ?))')
        conditions.push(`EXISTS (SELECT 1 FROM asset_search s WHERE s.rowid = a.id AND ${matches.join(' AND ')})`)
        params.push(...short.flatMap(term => [term, term, term, term]))
      }
    }
    if (query.searchWithinFolder || !terms.length) {
      const scope = query.scope
      if (scope.type === 'folder') {
        conditions.push(`EXISTS (
          SELECT 1 FROM folders target
          JOIN locations loc ON loc.root_id = target.root_id AND loc.asset_id = a.id
          JOIN folders f ON f.id = loc.folder_id
          WHERE target.id = ? AND target.present = 1 AND loc.available = 1 AND (
            target.path_key = '' OR f.path_key = target.path_key OR
            substr(f.path_key, 1, length(target.path_key) + 1) = target.path_key || '/'
          )
        )`)
        params.push(scope.folderId)
      } else if (scope.type === 'category') {
        conditions.push('a.category = ?')
        params.push(scope.category)
      } else if (scope.collection === 'favourites') {
        conditions.push('a.favourite = 1')
      } else if (scope.collection === 'recent') {
        conditions.push('a.added_at >= ?')
        params.push(Date.now() - recentWindow)
      }
    }
    if (query.category) {
      conditions.push('a.category = ?')
      params.push(query.category)
    }
    if (query.kind) {
      conditions.push('a.kind = ?')
      params.push(query.kind)
    }
    if (query.fileType === 'photoshop' || query.fileType === 'other') {
      const placeholders = photoshopExtensions.map(() => '?').join(', ')
      conditions.push(query.fileType === 'photoshop'
        ? `a.extension IN (${placeholders})`
        : `a.kind = 'editing' AND a.extension NOT IN (${placeholders})`)
      params.push(...photoshopExtensions)
    } else if (query.fileType) {
      conditions.push('a.kind = ?')
      params.push(query.fileType)
    }
    if (query.favouritesOnly) conditions.push('a.favourite = 1')
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    const total = Number(this.db.prepare(`SELECT count(*) AS count FROM assets a ${searchJoin} ${where}`).get(...params)?.count)
    const rows = this.db.prepare(`
      ${selectAsset} ${searchJoin} ${where} ORDER BY ${order}, a.id LIMIT ? OFFSET ?
    `).all(...params, pageSize, query.offset) as unknown as AssetRow[]
    return { assets: rows.map(toAsset), total }
  }

  getAsset(id: number): Asset {
    const asset = this.findAsset(id)
    if (!asset) throw new Error('This asset is no longer in the library.')
    return asset
  }

  findAsset(id: number): Asset | null {
    const row = this.db.prepare(`${selectAsset} WHERE a.id = ?`).get(id) as unknown as AssetRow | undefined
    return row ? toAsset(row) : null
  }

  updateAsset(id: number, patch: AssetPatch): Asset {
    return this.transaction(() => {
      this.getAsset(id)
      if (patch.notes !== undefined) {
        this.db.prepare('UPDATE assets SET notes = ? WHERE id = ?').run(patch.notes, id)
      }
      if (patch.category !== undefined) {
        this.db.prepare('UPDATE assets SET category = ? WHERE id = ?').run(patch.category, id)
      }
      if (patch.favourite !== undefined) {
        this.db.prepare('UPDATE assets SET favourite = ? WHERE id = ?').run(Number(patch.favourite), id)
      }
      if (patch.removeTag !== undefined) {
        this.db.prepare(`
          DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = (SELECT id FROM tags WHERE name_key = ?)
        `).run(id, searchText(patch.removeTag))
      }
      if (patch.addTag !== undefined) {
        const key = searchText(patch.addTag)
        const existing = this.db.prepare(`
          SELECT count(*) AS count, max(t.name_key = ?) AS already_tagged
          FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = ?
        `).get(key, id)!
        if (!existing.already_tagged) {
          if (Number(existing.count) >= maxTagsPerAsset) throw new Error(`An asset can have up to ${maxTagsPerAsset} tags.`)
          this.db.prepare('INSERT INTO tags (name, name_key) VALUES (?, ?) ON CONFLICT DO NOTHING')
            .run(patch.addTag, key)
          this.db.prepare(`INSERT INTO asset_tags (asset_id, tag_id) SELECT ?, id FROM tags WHERE name_key = ?`)
            .run(id, key)
        }
      }
      const updated = this.getAsset(id)
      if (patch.category !== undefined || patch.addTag !== undefined || patch.removeTag !== undefined) {
        this.db.prepare('UPDATE asset_search SET category = ?, tags = ? WHERE rowid = ?')
          .run(searchText(updated.category), updated.tags.map(searchText).join('\n'), id)
      }
      return updated
    })
  }

  getLinkedRoots(): RootRow[] {
    return this.db.prepare('SELECT id, path, name FROM roots').all() as unknown as RootRow[]
  }

  async importFolder(selectedPath: string, signal?: AbortSignal): Promise<ScanReport> {
    return this.runScan(async () => {
      const path = await realpath(selectedPath).catch(() => {
        throw new Error('The selected folder could not be opened.')
      })
      const snapshot = await scanFolder(path, { signal })
      const root = this.getLinkedRoots().find(root => pathKey(root.path) === pathKey(path)) ??
        { id: 0, path, name: basename(path) || path }
      return this.saveFullScan(root, snapshot)
    })
  }

  async rescan(rootId: number): Promise<ScanReport> {
    const { reports } = await this.rescanRoots([rootId])
    if (!reports[0]) throw new Error('Could not rescan this folder. Check that the original location is connected and accessible.')
    return reports[0]
  }

  async rescanRoots(rootIds: number[], signal?: AbortSignal): Promise<{ reports: ScanReport[]; failed: number[] }> {
    return this.runScan(async () => {
      const roots = new Map(this.getLinkedRoots().map(root => [root.id, root]))
      const scans: ScopedScan[] = []
      const failed: number[] = []
      for (const id of rootIds) {
        const root = roots.get(id)
        if (!root) {
          failed.push(id)
          continue
        }
        try {
          scans.push({ root, snapshot: await scanFolder(root.path, { signal }) })
        } catch {
          signal?.throwIfAborted()
          this.markRootUnavailable(id)
          failed.push(id)
        }
      }
      this.saveScans(scans, true)
      return { reports: scans.map(({ root, snapshot }) => this.scanReport(root, snapshot)), failed }
    })
  }

  async reconcilePaths(paths: string[], stabilityMs: number, signal?: AbortSignal): Promise<{ pending: string[]; incomplete: number[] }> {
    return this.runScan(async () => {
      const roots = this.getLinkedRoots()
      const scans: ScopedScan[] = []
      const incomplete = new Set<number>()
      const stableBefore = Date.now() - stabilityMs
      for (const root of roots) {
        const targets = paths.flatMap(path =>
          containsPath(root.path, path) ? [path] : containsPath(path, root.path) ? [root.path] : [])
        if (!targets.length) continue
        try {
          await readRootIdentity(root.path)
        } catch {
          signal?.throwIfAborted()
          this.markRootUnavailable(root.id)
          incomplete.add(root.id)
          continue
        }
        const covered = new Set<string>()
        const rootKey = pathKey(root.path)
        for (const target of targets) {
          const key = pathKey(target)
          let ancestor = key
          while (!covered.has(ancestor) && ancestor !== rootKey && dirname(ancestor) !== ancestor) {
            ancestor = dirname(ancestor)
          }
          if (covered.has(ancestor)) continue
          covered.add(key)
          try {
            const snapshot = await scanFolder(root.path, { target, stableBefore, signal })
            if (snapshot.skipped.length > snapshot.pending.length) incomplete.add(root.id)
            scans.push({ root, snapshot })
          } catch (error) {
            signal?.throwIfAborted()
            this.markRootUnavailable(root.id)
            incomplete.add(root.id)
          }
        }
      }
      this.saveScans(scans)
      return { pending: scans.flatMap(scan => scan.snapshot.pending), incomplete: [...incomplete] }
    })
  }

  markRootUnavailable(rootId: number): void {
    const result = this.db.prepare(`
      UPDATE locations SET available = 0 WHERE available = 1 AND
        asset_id IN (SELECT asset_id FROM locations WHERE root_id = ?)
    `).run(rootId)
    if (result.changes) this.revision++
  }

  unlinkFolder(rootId: number): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM locations WHERE root_id = ?').run(rootId)
      this.db.prepare('DELETE FROM folders WHERE root_id = ?').run(rootId)
      if (!this.db.prepare('DELETE FROM roots WHERE id = ?').run(rootId).changes) {
        throw new Error('This linked folder is no longer in the library.')
      }
    })
    this.revision++
    this.folderRevision++
  }

  private async runScan<T>(scan: () => Promise<T>): Promise<T> {
    if (this.scanning) throw new Error('A library scan is already running.')
    this.scanning = true
    try {
      return await scan()
    } finally {
      this.scanning = false
    }
  }

  private saveFullScan(root: RootRow, snapshot: FolderSnapshot): ScanReport {
    this.saveScans([{ root, snapshot }], true)
    return this.scanReport(root, snapshot)
  }

  private scanReport(root: RootRow, snapshot: FolderSnapshot): ScanReport {
    return { rootId: root.id, rootName: root.name, indexed: snapshot.files.length, skipped: snapshot.skipped.length }
  }

  private saveScans(scans: ScopedScan[], full = false): void {
    if (!scans.length) return
    const roots = this.getLinkedRoots()
    const when = Date.now()
    const observed = new Set(scans.flatMap(({ snapshot }) => snapshot.files.map(file => pathKey(file.absolutePath))))
    const identityPaths = new Map<string, string>()
    for (const { snapshot } of scans) {
      for (const file of snapshot.files) {
        if (!file.identity) continue
        const key = pathKey(file.absolutePath)
        const previous = identityPaths.get(file.identity)
        identityPaths.set(file.identity, previous === undefined || previous === key ? key : '')
      }
    }

    let changed = full
    let foldersChanged = false
    this.transaction(() => {
      for (const { root } of scans) {
        if (root.id) continue
        root.id = Number(this.db.prepare('INSERT INTO roots (path, path_key, name, scanned_at) VALUES (?, ?, ?, 0)')
          .run(root.path, pathKey(root.path), root.name).lastInsertRowid)
        roots.push(root)
      }
      const findFolder = this.db.prepare('SELECT id, relative_path, name, present FROM folders WHERE root_id = ? AND path_key = ?')
      const insertFolder = this.db.prepare(
        'INSERT INTO folders (root_id, parent_id, relative_path, path_key, name) VALUES (?, ?, ?, ?, ?)',
      )
      const updateFolder = this.db.prepare('UPDATE folders SET relative_path = ?, name = ?, present = 1 WHERE id = ?')
      const folderIds = new Map<string, number>()
      function ensureFolder(root: RootRow, path: string, name = basename(path) || root.name): number {
        const key = relativeKey(path)
        const cacheKey = root.id + ':' + key
        const cached = folderIds.get(cacheKey)
        if (cached !== undefined) return cached
        const existing = findFolder.get(root.id, key)
        const parent = path && !existing?.present ? ensureFolder(root, path.slice(0, Math.max(0, path.lastIndexOf('/')))) : null
        let id: number
        if (existing) {
          id = Number(existing.id)
          if (existing.relative_path !== path || existing.name !== name || !existing.present) {
            updateFolder.run(path, name, id)
            foldersChanged = true
          }
        } else {
          id = Number(insertFolder.run(root.id, parent, path, key, name).lastInsertRowid)
          foldersChanged = true
        }
        folderIds.set(cacheKey, id)
        return id
      }

      const selectKnownPaths = 'SELECT a.id, a.path_key, f.path_key AS folder_key, a.name'
      const assetScope = `
        JOIN folders f ON f.id = l.folder_id
        WHERE l.root_id = ? AND a.confirmed_missing = 0
      `
      const allAssets = this.db.prepare(`
        ${selectKnownPaths} FROM locations l JOIN assets a ON a.id = l.asset_id ${assetScope}
      `)
      // Start with the asset path index for scoped updates, even in large linked roots.
      const assetByPath = `
        ${selectKnownPaths} FROM assets a CROSS JOIN locations l ON l.asset_id = a.id ${assetScope}
      `
      const scopedAssets = this.db.prepare(`
        ${assetByPath} AND a.path_key = ?
        UNION ALL
        ${assetByPath} AND a.path_key >= ? AND a.path_key < ?
      `)
      const folderScope = 'SELECT id, path_key FROM folders WHERE root_id = ? AND present = 1'
      const allFolders = this.db.prepare(folderScope)
      const branchFolders = this.db.prepare(`
        ${folderScope} AND path_key = ?
        UNION ALL
        ${folderScope} AND path_key >= ? AND path_key < ?
      `)
      const hideFolder = this.db.prepare('UPDATE folders SET present = 0 WHERE id = ?')
      const markMissing = this.db.prepare('UPDATE assets SET confirmed_missing = 1 WHERE id = ?')
      const hideAsset = this.db.prepare('UPDATE locations SET available = 0 WHERE asset_id = ? AND available = 1')
      for (const { root, snapshot } of scans) {
        const scope = relativeKey(snapshot.scope)
        const skipped = new Set(snapshot.skipped.map(relativeKey))
        function wasSkipped(path: string): boolean {
          while (path) {
            if (skipped.has(path)) return true
            path = path.slice(0, Math.max(0, path.lastIndexOf('/')))
          }
          return skipped.has('')
        }
        const folderKeys = new Set(snapshot.folders.map(folder => relativeKey(folder.relativePath)))
        const scopedFolders = scope
          ? branchFolders.all(root.id, scope, root.id, ...descendants(scope, '/'))
          : allFolders.all(root.id)
        for (const folder of scopedFolders) {
          const key = String(folder.path_key)
          if (!folderKeys.has(key) && !wasSkipped(key)) {
            hideFolder.run(folder.id!)
            foldersChanged = true
          }
        }

        const scopeKey = pathKey(join(root.path, snapshot.scope))
        const rows = scope ? scopedAssets.all(root.id, scopeKey, root.id, ...descendants(scopeKey, sep)) : allAssets.all(root.id)
        for (const row of rows) {
          const folder = String(row.folder_key)
          const file = relativeKey((folder ? folder + '/' : '') + row.name)
          if (observed.has(String(row.path_key)) || wasSkipped(file)) continue
          markMissing.run(row.id!)
          changed = Boolean(hideAsset.run(row.id!).changes) || changed
        }
      }

      const findAsset = this.db.prepare('SELECT id, absolute_path, name FROM assets WHERE path_key = ?')
      const findMove = this.db.prepare(`
        SELECT id, path_key FROM assets WHERE file_identity = ? AND confirmed_missing = 1 AND file_identity <> '' LIMIT 2
      `)
      const insertAsset = this.db.prepare(`
        INSERT INTO assets (absolute_path, path_key, name, extension, kind, category, size, added_at, modified_at, file_identity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const updateAsset = this.db.prepare(`
        UPDATE assets SET absolute_path = ?, path_key = ?, name = ?, extension = ?, kind = ?,
          size = ?, modified_at = ?, file_identity = ?, confirmed_missing = 0
        WHERE id = ? AND (absolute_path <> ? OR size <> ? OR modified_at <> ? OR file_identity <> ? OR confirmed_missing = 1)
      `)
      const insertSearch = this.db.prepare(`
        INSERT INTO asset_search (rowid, name, folder_path, category, tags) VALUES (?, ?, ?, ?, '')
      `)
      const renameSearch = this.db.prepare('UPDATE asset_search SET name = ?, folder_path = ? WHERE rowid = ?')
      const clearLocations = this.db.prepare('DELETE FROM locations WHERE asset_id = ?')
      const upsertLocation = this.db.prepare(`
        INSERT INTO locations (asset_id, root_id, folder_id) VALUES (?, ?, ?)
        ON CONFLICT (asset_id, root_id) DO UPDATE SET folder_id = excluded.folder_id, available = 1
        WHERE locations.folder_id <> excluded.folder_id OR locations.available = 0
      `)
      for (const { root, snapshot } of scans) {
        for (const folder of snapshot.folders) ensureFolder(root, folder.relativePath, folder.name)
        for (const file of snapshot.files) {
          const key = pathKey(file.absolutePath)
          const existing = findAsset.get(key)
          const candidates = !existing && identityPaths.get(file.identity) === key ? findMove.all(file.identity) : []
          const candidate = candidates.length === 1 ? candidates[0] : undefined
          const moved = candidate && !observed.has(String(candidate.path_key)) ? candidate : undefined
          const path = searchText(dirname(file.absolutePath))
          const searchablePath = path.includes('\\') ? path + '\n' + path.replaceAll('\\', '/') : path
          let id: number
          if (existing || moved) {
            id = Number((existing ?? moved)!.id)
            const updated = updateAsset.run(
              file.absolutePath, key, file.name, file.extension, file.kind, file.size, file.modifiedAt, file.identity,
              id, file.absolutePath, file.size, file.modifiedAt, file.identity,
            )
            if (updated.changes) {
              changed = true
              if (moved || existing?.absolute_path !== file.absolutePath || existing?.name !== file.name) {
                renameSearch.run(searchText(file.name), searchablePath, id)
              }
            }
          } else {
            id = Number(insertAsset.run(
              file.absolutePath, key, file.name, file.extension, file.kind, file.category, file.size, when,
              file.modifiedAt, file.identity,
            ).lastInsertRowid)
            insertSearch.run(id, searchText(file.name), searchablePath, searchText(file.category))
            changed = true
          }
          if (moved) {
            clearLocations.run(id)
            for (const linked of roots) {
              if (!containsPath(linked.path, file.absolutePath)) continue
              const folder = relative(linked.path, dirname(file.absolutePath)).split(sep).join('/')
              upsertLocation.run(id, linked.id, ensureFolder(linked, folder))
            }
          } else {
            changed = Boolean(upsertLocation.run(id, root.id, ensureFolder(root, file.relativeFolder)).changes) || changed
          }
        }
        if (full) this.db.prepare('UPDATE roots SET scanned_at = ? WHERE id = ?').run(when, root.id)
      }
    })
    if (changed || foldersChanged) this.revision++
    if (foldersChanged) this.folderRevision++
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
