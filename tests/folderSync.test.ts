import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtempDisposable, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { FolderSync } from '../src/main/folderSync.ts'
import { Library } from '../src/main/library.ts'
import type { AssetQuery, LibrarySyncStatus } from '../src/shared/library.ts'

const all: AssetQuery = { search: '', scope: { type: 'collection', collection: 'all' }, sort: 'name-asc', offset: 0 }

async function eventually(label: string, check: () => unknown): Promise<void> {
  const deadline = Date.now() + 9000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(30)
  }
  assert.fail('Timed out waiting for ' + label)
}

test('watches additions, nested folders, edits, renames and deletes in one live library', async t => {
  const temp = await mkdtempDisposable(join(tmpdir(), 'binwise-live-'))
  const root = join(temp.path, 'Assets')
  const effects = join(root, 'Sound Effects')
  const database = join(temp.path, 'library.sqlite')
  await mkdir(effects, { recursive: true })
  const library = new Library(database)
  const statuses: LibrarySyncStatus[] = []
  const sync = new FolderSync(library, status => statuses.push(status))
  t.after(async () => { await sync.stop(); library.close(); await temp.remove() })
  await sync.start()
  const { rootId } = await sync.importFolder(root)
  const rootFolder = library.getLibrary().roots.find(item => item.id === rootId)!.folder.id
  const effectsFolder = library.getFolders(rootFolder)[0]!.id
  const activeSearch = { ...all, scope: { type: 'folder', folderId: effectsFolder }, search: 'ps4', searchWithinFolder: true } as const
  const wav = join(effects, 'PS4 Startup.wav')
  const picture = join(root, 'Console.png')

  await Promise.all([writeFile(wav, 'audio'), writeFile(picture, 'image')])
  await eventually('both files in the index', () => library.getLibrary().counts.all === 2)
  assert.equal(library.getLibrary().counts.recent, 2)
  assert.equal(library.getAssets({ ...all, scope: activeSearch.scope }).total, 1)
  assert.equal(library.getAssets(activeSearch).assets[0]?.name, 'PS4 Startup.wav')
  const asset = library.getAssets(activeSearch).assets[0]!
  library.updateAsset(asset.id, { addTag: 'Console', favourite: true, notes: 'Keep this take', category: 'Music' })

  const nested = join(effects, 'New', 'Consoles', 'PlayStation')
  await mkdir(nested, { recursive: true })
  await writeFile(join(nested, 'Boot.mp4'), 'video')
  await eventually('nested folder and asset', () => {
    const levelOne = library.getFolders(effectsFolder)[0]
    const levelTwo = levelOne && library.getFolders(levelOne.id)[0]
    return levelTwo && library.getFolders(levelTwo.id)[0]?.name === 'PlayStation' &&
      library.getAssets({ ...all, search: 'playstation boot' }).total === 1 &&
      library.getAssets({ ...activeSearch, search: 'playstation boot' }).total === 1
  })

  await writeFile(wav, 'updated sound')
  for (let index = 0; index < 6; index++) {
    await delay(260)
    await appendFile(wav, '!')
  }
  assert.equal(library.getAsset(asset.id).size, asset.size)
  await eventually('stable size and modification date', () =>
    library.getAsset(asset.id).size === 19 && library.getAsset(asset.id).modifiedAt > asset.modifiedAt)

  let moved = join(nested, 'PlayStation Startup.WAV')
  await rename(wav, moved)
  await eventually('rename with the same record', () => library.getAsset(asset.id).absolutePath === moved)
  assert.equal(library.getAssets(activeSearch).total, 0)
  assert.deepEqual(library.getAsset(asset.id).tags, ['Console'])
  assert.equal(library.getAsset(asset.id).favourite, true)
  assert.equal(library.getAsset(asset.id).notes, 'Keep this take')
  assert.equal(library.getAsset(asset.id).category, 'Music')
  const lowerCase = join(nested, 'PlayStation Startup.wav')
  await rename(moved, lowerCase)
  moved = lowerCase
  await eventually('case-only rename', () => library.getAsset(asset.id).absolutePath === lowerCase)
  const inspect = new DatabaseSync(database, { readOnly: true })
  try {
    assert.equal(inspect.prepare('SELECT count(*) AS total FROM assets').get()?.total, 3)
  } finally {
    inspect.close()
  }

  await Promise.all([unlink(moved), unlink(join(nested, 'Boot.mp4'))])
  await rmdir(nested)
  await rmdir(join(effects, 'New', 'Consoles'))
  await rmdir(join(effects, 'New'))
  await eventually('deleted subtree and files disappear', () =>
    library.getFolders(effectsFolder).length === 0 && library.getLibrary().counts.all === 1)
  assert.equal(library.getAsset(asset.id).available, false)
  assert.equal(library.getAsset(asset.id).favourite, true)
  assert.equal(library.getAssets({ ...all, search: 'startup' }).total, 0)
  await eventually('sync status settles', () => statuses.at(-1)?.syncing === false)
  assert.ok(statuses.some(status => status.syncing))
  assert.ok(statuses.some(status => status.folderRevision > 1))
})

test('restores watchers and catches up on restart, reconnect, refresh and unlink', async t => {
  const temp = await mkdtempDisposable(join(tmpdir(), 'binwise-recover-'))
  const root = join(temp.path, 'Assets')
  const offline = join(temp.path, 'Disconnected')
  const database = join(temp.path, 'library.sqlite')
  await mkdir(root)
  const original = join(root, 'Original.png')
  await writeFile(original, 'image')
  let library = new Library(database)
  let sync = new FolderSync(library, () => {}, 200)
  t.after(async () => { await sync.stop(); library.close(); await temp.remove() })
  await sync.start()
  const { rootId } = await sync.importFolder(root)
  const asset = library.getAssets(all).assets[0]!
  library.updateAsset(asset.id, { favourite: true, addTag: 'graphics' })
  await sync.stop()
  library.close()

  const renamed = join(root, 'Renamed.png')
  await rename(original, renamed)
  library = new Library(database)
  sync = new FolderSync(library, () => {}, 200)
  await sync.start()
  assert.equal(library.getAsset(asset.id).absolutePath, renamed)
  assert.deepEqual(library.getAsset(asset.id).tags, ['graphics'])
  await writeFile(join(root, 'After startup.wav'), 'sample')
  await eventually('new file after restart', () => library.getAssets({ ...all, search: 'after startup' }).total === 1)

  await rename(root, offline)
  await eventually('unavailable root', () => sync.getStatus().limitedRoots === 1 && library.getLibrary().counts.all === 0)
  assert.deepEqual((await sync.refresh()).failed, [rootId])
  await writeFile(join(offline, 'While disconnected.mp4'), 'clip')
  await rename(offline, root)
  await eventually('reconnect reconciliation', () =>
    sync.getStatus().limitedRoots === 0 && library.getAssets({ ...all, search: 'while disconnected' }).total === 1)
  const refreshed = await sync.refresh()
  assert.equal(refreshed.reports[0]?.indexed, 3)
  assert.equal(library.getAsset(asset.id).favourite, true)
  assert.deepEqual(library.getAsset(asset.id).tags, ['graphics'])
  assert.equal(library.getLibrary().counts.all, 3)

  await sync.unlinkFolder(rootId)
  assert.equal(library.getLibrary().roots.length, 0)
  assert.equal(library.getAssets(all).total, 0)
  await writeFile(join(root, 'Unlinked.wav'), 'new file')
  await delay(1450)
  assert.equal(library.getLibrary().roots.length, 0)
  assert.equal(sync.getStatus().syncing, false)
  assert.equal(await readFile(renamed, 'utf8'), 'image')
  await sync.importFolder(root)
  assert.equal(library.getLibrary().counts.all, 4)
  assert.equal(library.getAsset(asset.id).favourite, true)
  assert.deepEqual(library.getAsset(asset.id).tags, ['graphics'])
})
