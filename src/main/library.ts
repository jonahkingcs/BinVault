import { basename, dirname } from 'node:path'
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
import { hasErrorCode, pathKey, relativeKey, scanFolder } from './paths.ts'
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
        coalesce(sum(added_at >= ?), 0) AS recent FROM assets
    `).get(Date.now() - recentWindow)!
    const categoryCounts = Object.fromEntries(categories.map(category => [category, 0])) as Record<Category, number>
    for (const row of this.db.prepare('SELECT category, count(*) AS total FROM assets GROUP BY category').all()) {
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
    const conditions: string[] = []
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
    } else {
      const scope = query.scope
      if (scope.type === 'folder') {
        conditions.push(`EXISTS (
          SELECT 1 FROM folders target
          JOIN locations loc ON loc.root_id = target.root_id AND loc.asset_id = a.id
          JOIN folders f ON f.id = loc.folder_id
          WHERE target.id = ? AND (
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
    const row = this.db.prepare(`${selectAsset} WHERE a.id = ?`).get(id) as unknown as AssetRow | undefined
    if (!row) throw new Error('This asset is no longer in the library.')
    return toAsset(row)
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

  async importFolder(selectedPath: string): Promise<ScanReport> {
    return this.runScan(async () => {
      const rootPath = await realpath(selectedPath).catch(() => {
        throw new Error('The selected folder could not be opened.')
      })
      return this.saveSnapshot(await scanFolder(rootPath))
    })
  }

  async rescan(rootId: number): Promise<ScanReport> {
    return this.runScan(async () => {
      const root = this.db.prepare('SELECT path, name FROM roots WHERE id = ?').get(rootId)
      if (!root) throw new Error('This linked folder is no longer in the library.')
      let snapshot
      try {
        snapshot = await scanFolder(String(root.path))
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')) {
          this.db.prepare(`
            UPDATE locations SET available = 0 WHERE asset_id IN (SELECT asset_id FROM locations WHERE root_id = ?)
          `).run(rootId)
        }
        throw new Error('Could not rescan this folder. Check that the original location is connected and accessible.')
      }
      return this.saveSnapshot(snapshot)
    })
  }

  private async runScan(scan: () => Promise<ScanReport>): Promise<ScanReport> {
    if (this.scanning) throw new Error('A library scan is already running.')
    this.scanning = true
    try {
      return await scan()
    } finally {
      this.scanning = false
    }
  }

  private saveSnapshot(snapshot: FolderSnapshot): ScanReport {
    return this.transaction(() => {
      const when = Date.now()
      const rootName = basename(snapshot.rootPath) || snapshot.rootPath
      const root = this.db.prepare(`
        INSERT INTO roots (path, path_key, name, scanned_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (path_key) DO UPDATE SET path = excluded.path, name = excluded.name, scanned_at = excluded.scanned_at
        RETURNING id
      `).get(snapshot.rootPath, pathKey(snapshot.rootPath), rootName, when)!
      const rootId = Number(root.id)
      const upsertFolder = this.db.prepare(`
        INSERT INTO folders (root_id, parent_id, relative_path, path_key, name) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (root_id, path_key) DO UPDATE SET
          relative_path = excluded.relative_path, name = excluded.name, present = 1
        RETURNING id
      `)
      const folderIds = new Map<string, number>()
      for (const folder of snapshot.folders) {
        const key = relativeKey(folder.relativePath)
        const parentId = folder.parentPath === null ? null : folderIds.get(relativeKey(folder.parentPath))!
        const row = upsertFolder.get(rootId, parentId, folder.relativePath, key, folder.name)!
        folderIds.set(key, Number(row.id))
      }

      const insertAsset = this.db.prepare(`
        INSERT INTO assets (absolute_path, path_key, name, extension, kind, category, size, added_at, modified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(path_key) DO NOTHING RETURNING id
      `)
      const updateAsset = this.db.prepare(`
        UPDATE assets SET absolute_path = ?, name = ?, size = ?, modified_at = ? WHERE path_key = ? RETURNING id
      `)
      const insertSearch = this.db.prepare(`
        INSERT INTO asset_search (rowid, name, folder_path, category, tags) VALUES (?, ?, ?, ?, '')
      `)
      const upsertLocation = this.db.prepare(`
        INSERT INTO locations (asset_id, root_id, folder_id) VALUES (?, ?, ?)
        ON CONFLICT (asset_id, root_id) DO UPDATE SET folder_id = excluded.folder_id, available = 1
      `)
      const found = new Set<number>()
      for (const file of snapshot.files) {
        const key = pathKey(file.absolutePath)
        const inserted = insertAsset.get(
          file.absolutePath, key, file.name, file.extension, file.kind, file.category, file.size, when, file.modifiedAt,
        )
        const row = inserted ?? updateAsset.get(file.absolutePath, file.name, file.size, file.modifiedAt, key)!
        const id = Number(row.id)
        if (inserted) {
          const folderPath = searchText(dirname(file.absolutePath))
          // Both slash conventions work when searching for pasted folder paths.
          const searchablePath = folderPath.includes('\\') ? folderPath + '\n' + folderPath.replaceAll('\\', '/') : folderPath
          insertSearch.run(id, searchText(file.name), searchablePath, searchText(file.category))
        }
        upsertLocation.run(id, rootId, folderIds.get(relativeKey(file.relativeFolder))!)
        found.add(id)
      }

      const skipped = new Set(snapshot.skipped.map(relativeKey))
      function wasSkipped(relativePath: string): boolean {
        let path = relativeKey(relativePath)
        while (path) {
          if (skipped.has(path)) return true
          path = path.slice(0, Math.max(0, path.lastIndexOf('/')))
        }
        return false
      }
      const hideFolder = this.db.prepare('UPDATE folders SET present = 0 WHERE id = ?')
      for (const folder of this.db.prepare('SELECT id, path_key FROM folders WHERE root_id = ? AND present = 1').all(rootId)) {
        const key = String(folder.path_key)
        if (!folderIds.has(key) && !wasSkipped(key)) hideFolder.run(folder.id!)
      }
      // Every location of this asset refers to the same absolute path.
      const markMissing = this.db.prepare('UPDATE locations SET available = 0 WHERE asset_id = ?')
      const existing = this.db.prepare(`
        SELECT a.id, a.name, f.relative_path FROM locations l
        JOIN assets a ON a.id = l.asset_id JOIN folders f ON f.id = l.folder_id
        WHERE l.root_id = ? AND EXISTS (
          SELECT 1 FROM locations current WHERE current.asset_id = l.asset_id AND current.available = 1
        )
      `).all(rootId)
      for (const row of existing) {
        const filePath = row.relative_path ? row.relative_path + '/' + row.name : String(row.name)
        if (!found.has(Number(row.id)) && !wasSkipped(filePath)) markMissing.run(row.id!)
      }
      return { rootId, rootName, indexed: found.size, skipped: skipped.size }
    })
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
