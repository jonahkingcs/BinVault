import assert from 'node:assert/strict'
import { mkdir, mkdtempDisposable, rename, rmdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { Library } from '../src/main/library.ts'
import { pageSize } from '../src/shared/library.ts'
import type { AssetQuery } from '../src/shared/library.ts'

const all: AssetQuery = { search: '', scope: { type: 'collection', collection: 'all' }, sort: 'name-asc', offset: 0 }

async function write(path: string, bytes = 'test fixture'): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}

test('indexes real files, exposes the folder tree and searches the entire library', async t => {
  const temp = await mkdtempDisposable(join(tmpdir(), 'binwise-search-'))
  t.after(() => temp.remove())
  const music = join(temp.path, 'Music')
  const effects = join(temp.path, 'Sound Effects')
  const images = join(temp.path, 'Images')
  await Promise.all([
    write(join(music, 'PlayStation', 'PS4 Menu Theme.MP3')),
    write(join(effects, 'Consoles', 'PS4 Startup.wav')),
    write(join(images, 'Minecraft', 'Minecraft PS4 Disc.png')),
    write(join(images, 'Photoshop Exports', 'Console Comparison.png')),
    write(join(images, 'Gráphics [v2]', 'Logo.webp')),
    write(join(images, 'Preset.prfpset')),
    write(join(images, 'Look.cube')),
    write(join(images, 'Title.mogrt')),
    write(join(images, 'Ignore.exe')),
    mkdir(join(images, 'Empty'), { recursive: true }),
  ])
  const library = new Library(':memory:')
  t.after(() => library.close())
  await library.importFolder(music)
  await library.importFolder(effects)
  await library.importFolder(images)
  const summary = library.getLibrary()
  assert.deepEqual(summary.counts, { all: 8, favourites: 0, recent: 8 })
  assert.equal(summary.categories['Sound Effects'], 1)
  assert.equal(summary.categories.Presets, 1)
  assert.equal(summary.categories.Templates, 1)
  assert.equal(summary.categories.LUTs, 1)
  const imageRoot = summary.roots.find(root => root.path === images)!
  const folders = library.getFolders(imageRoot.folder.id)
  assert.deepEqual(folders.map(folder => folder.name), ['Empty', 'Gráphics [v2]', 'Minecraft', 'Photoshop Exports'])
  const minecraft = folders.find(folder => folder.name === 'Minecraft')!
  const comparison = library.getAssets({ ...all, search: 'console comparison' }).assets[0]!
  library.updateAsset(comparison.id, { addTag: 'ps4' })
  const scope = { type: 'folder', folderId: minecraft.id } as const
  assert.equal(library.getAssets({ ...all, scope }).total, 1)
  const results = library.getAssets({ ...all, scope, search: 'PS4' })
  assert.deepEqual(results.assets.map(file => file.name), [
    'Console Comparison.png', 'Minecraft PS4 Disc.png', 'PS4 Menu Theme.MP3', 'PS4 Startup.wav',
  ])
  assert.equal(library.getAssets({ ...all, scope, search: 'PS4', category: 'Images' }).total, 2)
  assert.equal(library.getAssets({ ...all, scope, search: 'PS4', kind: 'audio' }).total, 2)
  const ranked = library.getAssets({ ...all, scope, search: 'PS4', sort: 'relevance' })
  assert.equal(ranked.total, results.total)
  assert.notEqual(ranked.assets[0]?.name, 'Console Comparison.png')
  assert.equal(library.getAssets({ ...all, search: 'PS4 co', sort: 'relevance', fileType: 'audio' }).total, 1)
  assert.equal(library.getAssets({ ...all, scope, search: 'start consoles effects' }).assets[0]?.name, 'PS4 Startup.wav')
  assert.equal(library.getAssets({ ...all, search: 'ystat' }).assets[0]?.name, 'PS4 Menu Theme.MP3')
  assert.equal(library.getAssets({ ...all, search: 'aph' }).total, 0)
  assert.equal(library.getAssets({ ...all, search: 'gra\u0301phics [v2]' }).assets[0]?.name, 'Logo.webp')
  assert.equal(library.getAssets({ ...all, search: 's4' }).total, 4)
  library.updateAsset(comparison.id, { addTag: 'a"b %_ OR' })
  assert.equal(library.getAssets({ ...all, search: 'a"b %_' }).assets[0]?.id, comparison.id)
  assert.equal(library.getAssets({ ...all, search: 'unknown" OR *' }).total, 0)
})

test('shares global matching and filters with recursive folder search', async t => {
  const temp = await mkdtempDisposable(join(tmpdir(), 'binwise-folder-search-'))
  const library = new Library(':memory:')
  t.after(async () => { library.close(); await temp.remove() })
  const root = join(temp.path, 'Assets')
  await Promise.all([
    write(join(root, 'PS4', 'Menu.wav')),
    write(join(root, 'PS4', 'Deep', 'Creative', 'Sweden.wav')),
    write(join(root, 'PS4_Backups', 'Menu Backup.wav')),
    write(join(temp.path, 'Other Root', 'Menu Outside.wav')),
  ])
  await library.importFolder(root)
  await library.importFolder(join(temp.path, 'Other Root'))
  const rootFolder = library.getLibrary().roots.find(item => item.name === 'Assets')!.folder.id
  const folders = library.getFolders(rootFolder)
  const folderId = folders.find(folder => folder.name === 'PS4')!.id
  const scope = { type: 'folder', folderId } as const
  const scoped = { ...all, scope, searchWithinFolder: true, sort: 'relevance' } as const
  const names = (query: AssetQuery) => library.getAssets(query).assets.map(asset => asset.name)
  assert.deepEqual(names({ ...all, scope, search: 'menu' }), ['Menu Backup.wav', 'Menu Outside.wav', 'Menu.wav'])
  assert.deepEqual(names({ ...scoped, search: 'menu' }), ['Menu.wav'])
  assert.deepEqual(names({ ...scoped, search: 'creative swed' }), ['Sweden.wav'])
  const sweden = library.getAssets({ ...scoped, search: 'sweden' }).assets[0]!
  library.updateAsset(sweden.id, { addTag: 'ambient', category: 'Music' })
  assert.deepEqual(names({ ...scoped, search: 'ambient music', category: 'Music', fileType: 'audio' }), ['Sweden.wav'])
  assert.deepEqual(names({ ...all, search: 'ambient music', category: 'Music', fileType: 'audio' }), ['Sweden.wav'])
  assert.equal(library.getAssets({ ...scoped, search: 'ambient', fileType: 'video' }).total, 0)
  assert.equal(library.getAssets({ ...scoped, search: 'ambient', category: 'Images' }).total, 0)
  const sibling = { type: 'folder', folderId: folders.find(folder => folder.name === 'PS4_Backups')!.id } as const
  assert.deepEqual(names({ ...scoped, scope: sibling, search: 'menu' }), ['Menu Backup.wav'])
  assert.deepEqual(names({ ...all, scope }), ['Menu.wav', 'Sweden.wav'])
})

test('applies each quick file type, additive filters and the new sorts before pagination', async t => {
  const temp = await mkdtempDisposable(join(tmpdir(), 'binwise-filters-'))
  t.after(() => temp.remove())
  const earlier = join(temp.path, 'Earlier')
  const later = join(temp.path, 'Later')
  await Promise.all([
    write(join(earlier, 'Alpha.wav'), 'abc'),
    write(join(earlier, 'Beta.psd'), 'abcd'),
    write(join(earlier, 'Gamma.mogrt'), 'abcde'),
    write(join(later, 'Delta.png'), 'abcdef'),
    write(join(later, 'Epsilon.psb'), 'abcdefg'),
    write(join(later, 'Zeta.mp4'), 'abcdefgh'),
  ])
  const library = new Library(':memory:')
  t.after(() => library.close())
  await library.importFolder(earlier)
  await delay(10)
  await library.importFolder(later)
  const names = (query: Partial<AssetQuery>) => library.getAssets({ ...all, ...query }).assets.map(asset => asset.name)
  assert.deepEqual(names({ fileType: 'photoshop' }), ['Beta.psd', 'Epsilon.psb'])
  assert.deepEqual(names({ fileType: 'other' }), ['Gamma.mogrt'])
  assert.deepEqual(names({ fileType: 'image' }), ['Delta.png'])
  assert.deepEqual(names({ fileType: 'audio' }), ['Alpha.wav'])
  assert.deepEqual(names({ fileType: 'video' }), ['Zeta.mp4'])
  const beta = library.getAssets({ ...all, search: 'beta' }).assets[0]!
  library.updateAsset(beta.id, { favourite: true })
  assert.deepEqual(names({ fileType: 'photoshop', favouritesOnly: true, category: 'Graphics' }), ['Beta.psd'])
  assert.deepEqual(names({ fileType: 'photoshop', category: 'Video' }), [])
  assert.equal(names({ sort: 'size-asc' })[0], 'Alpha.wav')
  assert.equal(names({ sort: 'size-desc' })[0], 'Zeta.mp4')
  assert.equal(names({ sort: 'added-asc' })[0], 'Alpha.wav')
  assert.equal(names({ sort: 'added-desc' })[0], 'Delta.png')
  assert.deepEqual(names({ sort: 'type-asc' }), ['Gamma.mogrt', 'Zeta.mp4', 'Delta.png', 'Epsilon.psb', 'Beta.psd', 'Alpha.wav'])
})

test('migrates a version-one library in place and preserves notes by asset across rescans and reopening', async t => {
  const temp = await mkdtempDisposable(join(tmpdir(), 'binwise-notes-'))
  let library: Library | undefined
  t.after(async () => { library?.close(); await temp.remove() })
  const root = join(temp.path, 'Assets')
  const source = join(root, 'Asset.png')
  const database = join(temp.path, 'library.sqlite')
  await write(source)
  await write(join(root, 'Second.png'))
  library = new Library(database)
  const { rootId } = await library.importFolder(root)
  const [asset, second] = library.getAssets(all).assets
  assert.ok(asset && second)
  const before = library.updateAsset(asset.id, { addTag: 'tagged', favourite: true, category: 'Graphics' })
  library.close()
  library = undefined
  const legacy = new DatabaseSync(database)
  legacy.exec(`
    DROP INDEX missing_identity;
    ALTER TABLE assets DROP COLUMN confirmed_missing;
    ALTER TABLE assets DROP COLUMN file_identity;
    ALTER TABLE assets DROP COLUMN notes;
    PRAGMA user_version = 1;
  `)
  legacy.close()

  library = new Library(database)
  assert.equal(library.getLibrary().roots[0]?.id, rootId)
  assert.deepEqual(library.getAsset(asset.id), before)
  const notes = 'Intro idea with startup audio.\nSecond line'
  library.updateAsset(asset.id, { notes })
  await write(source, 'new bytes after a rescan')
  await library.rescan(rootId)
  assert.equal(library.getAsset(asset.id).notes, notes)
  assert.equal(library.getAsset(second.id).notes, '')
  assert.equal(library.getAssets({ ...all, search: 'startup' }).total, 0)
  library.close()
  library = undefined
  library = new Library(database)
  assert.equal(library.getAssets({ ...all, search: 'tagged' }).assets[0]?.notes, notes)
  library.updateAsset(asset.id, { notes: '' })
  assert.equal(library.getAsset(asset.id).notes, '')
})

test('retains tags, category, favourites and identity across overlaps, rescans and reopen', async t => {
  const temp = await mkdtempDisposable(join(tmpdir(), 'binwise-persistence-'))
  let library: Library | undefined
  t.after(async () => {
    library?.close()
    await temp.remove()
  })
  const root = join(temp.path, 'Assets')
  const subfolder = join(root, 'Subfolder')
  const original = join(subfolder, 'clip.mp4')
  const moved = join(subfolder, 'clip renamed.mp4')
  await write(original)
  const database = join(temp.path, 'library.db')
  library = new Library(database)
  const first = await library.importFolder(root)
  const second = await library.importFolder(subfolder)
  const [asset] = library.getAssets(all).assets
  assert.ok(asset)
  library.updateAsset(asset.id, { addTag: 'Cutaway', category: 'Graphics', favourite: true })
  library.updateAsset(asset.id, { addTag: 'CUTAWAY' })
  await write(original, 'changed on disk')
  assert.equal((await library.importFolder(root)).rootId, first.rootId)
  assert.equal((await library.rescan(second.rootId)).indexed, 1)
  assert.equal(library.getAssets(all).total, 1)
  const updated = library.getAsset(asset.id)
  assert.equal(updated.size, 15)
  assert.equal(updated.addedAt, asset.addedAt)
  assert.equal(updated.category, 'Graphics')
  assert.equal(updated.favourite, true)
  assert.deepEqual(updated.tags, ['Cutaway'])
  library.close()
  library = undefined
  library = new Library(database)
  assert.equal(library.getLibrary().roots.length, 2)
  assert.deepEqual(library.getAssets({ ...all, search: 'tawa graphics' }).assets, [updated])
  assert.equal(library.getAssets({ ...all, scope: { type: 'collection', collection: 'favourites' } }).total, 1)

  await rename(original, moved)
  await library.rescan(first.rootId)
  await library.rescan(second.rootId)
  assert.equal(library.getAssets(all).total, 1)
  const renamed = library.getAssets({ ...all, search: 'renamed' }).assets[0]!
  assert.equal(renamed.id, asset.id)
  assert.deepEqual(renamed.tags, ['Cutaway'])
  assert.equal(renamed.favourite, true)
  assert.equal(renamed.category, 'Graphics')
  assert.equal(renamed.addedAt, asset.addedAt)
  assert.equal(renamed.available, true)
  await rename(moved, original)
  await library.rescan(first.rootId)
  assert.equal(library.getAsset(asset.id).absolutePath, original)
  await rename(original, moved)
  await library.rescan(second.rootId)
  assert.equal(library.getAsset(asset.id).absolutePath, moved)
  await rename(moved, original)
  await library.rescan(second.rootId)
  assert.equal(library.getAsset(asset.id).absolutePath, original)
  assert.equal(library.getAssets({ ...all, search: 'renamed' }).total, 0)
  library.updateAsset(asset.id, { removeTag: 'cutaway', favourite: false })
  assert.equal(library.getAssets({ ...all, search: 'cutaway' }).total, 0)
  assert.equal(library.getLibrary().counts.favourites, 0)

  await rename(original, join(temp.path, 'offline.mp4'))
  await rmdir(subfolder)
  await assert.rejects(library.rescan(second.rootId), /Could not rescan/)
  assert.equal(library.getAsset(asset.id).available, false)
  await library.rescan(first.rootId)
  assert.equal(library.getAsset(asset.id).available, false)
  assert.equal(library.getLibrary().roots.length, 2)
})

test('does not traverse junctions or symlinks', async t => {
  const temp = await mkdtempDisposable(join(tmpdir(), 'binwise-links-'))
  t.after(() => temp.remove())
  const root = join(temp.path, 'Assets')
  const external = join(temp.path, 'External')
  await write(join(root, 'real.png'))
  await write(join(external, 'elsewhere.png'))
  await symlink(external, join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir')
  await symlink(root, join(root, 'loop'), process.platform === 'win32' ? 'junction' : 'dir')
  const library = new Library(':memory:')
  t.after(() => library.close())
  assert.equal((await library.importFolder(root)).indexed, 1)
  assert.equal(library.getAssets({ ...all, search: 'elsewhere' }).total, 0)
})

test('paginates sorted results without duplicates', async t => {
  const temp = await mkdtempDisposable(join(tmpdir(), 'binwise-pages-'))
  t.after(() => temp.remove())
  await Promise.all(Array.from({ length: pageSize + 2 }, (_, index) =>
    writeFile(join(temp.path, `Asset ${String(index).padStart(3, '0')}.mp3`), 'sample')))
  const library = new Library(':memory:')
  t.after(() => library.close())
  await library.importFolder(temp.path)
  const first = library.getAssets({ ...all, sort: 'name-desc' })
  const second = library.getAssets({ ...all, sort: 'name-desc', offset: pageSize })
  assert.equal(first.total, pageSize + 2)
  assert.equal(first.assets.length, pageSize)
  assert.deepEqual(second.assets.map(asset => asset.name), ['Asset 001.mp3', 'Asset 000.mp3'])
  assert.equal(new Set([...first.assets, ...second.assets].map(asset => asset.id)).size, pageSize + 2)
})
