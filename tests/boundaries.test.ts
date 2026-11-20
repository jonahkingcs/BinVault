import assert from 'node:assert/strict'
import { mkdtempDisposable, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Library } from '../src/main/library.ts'
import { parseByteRange, serveMedia } from '../src/main/media.ts'
import { validateId, validatePatch, validateQuery } from '../src/main/validation.ts'

test('validates renderer data and treats paths and SQL as outside the IPC contract', () => {
  assert.throws(() => validateId('C:\\test.wav'))
  assert.throws(() => validateId(1.5))
  assert.throws(() => validateQuery({
    search: '', scope: { type: 'folder', folderId: '../' }, offset: 0, sort: 'name-asc',
  }))
  assert.throws(() => validateQuery({
    search: '', scope: { type: 'collection', collection: 'all' }, offset: 0, sort: 'a.name; DROP TABLE assets',
  }))
  assert.throws(() => validatePatch({ addTag: 'line\nbreak' }))
  assert.throws(() => validatePatch({ absolutePath: 'C:\\test.wav' }))
  assert.throws(() => validatePatch({ notes: 'embedded\0null' }))
  assert.throws(() => validatePatch({ notes: 'x'.repeat(8001) }))
  assert.deepEqual(validatePatch({ notes: '\nKeep note whitespace\n' }), { notes: '\nKeep note whitespace\n' })
  assert.deepEqual(validatePatch({ addTag: '  A Tag  ', favourite: false }), { addTag: 'A Tag', favourite: false })
})

test('handles bounded, open-ended and suffix byte ranges', () => {
  assert.deepEqual(parseByteRange('bytes=0-0', 10), { start: 0, end: 0 })
  assert.deepEqual(parseByteRange('bytes=4-', 10), { start: 4, end: 9 })
  assert.deepEqual(parseByteRange('bytes=3-100', 10), { start: 3, end: 9 })
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.equal(parseByteRange('bytes=10-', 10), null)
  assert.equal(parseByteRange('bytes=-', 10), null)
  assert.equal(parseByteRange('bytes=2-3,5-6', 10), null)
  assert.equal(parseByteRange('bytes=0-', 0), null)
})

test('serves only authorised media and supports byte-range streaming from disk', async t => {
  const temp = await mkdtempDisposable(join(tmpdir(), 'binwise-media-'))
  t.after(() => temp.remove())
  const wavPath = join(temp.path, 'sound.wav')
  await writeFile(wavPath, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))
  await writeFile(join(temp.path, 'template.mogrt'), 'unsupported')
  const library = new Library(':memory:')
  t.after(() => library.close())
  await library.importFolder(temp.path)
  const query = { search: '', scope: { type: 'collection', collection: 'all' }, sort: 'name-asc', offset: 0 } as const
  const [sound, template] = library.getAssets(query).assets
  assert.ok(sound && template)
  const soundUrl = `binwise-media://asset/${sound.id}`
  const preview = (url: string, init?: RequestInit) => serveMedia(new Request(url, init), id => library.getAsset(id))
  const response = await preview(soundUrl, { headers: { Range: 'bytes=2-5' } })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-type'), 'audio/wav')
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/8')
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2, 3, 4, 5])
  const head = await preview(soundUrl, { method: 'HEAD' })
  assert.equal(head.headers.get('content-length'), '8')
  assert.equal(head.body, null)
  const lookup = (id: number) => library.getAsset(id)
  const allowed = await serveMedia(new Request(soundUrl, { method: 'HEAD', headers: { Origin: 'null' } }), lookup, 'null')
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'null')
  const denied = await serveMedia(new Request(soundUrl, { method: 'HEAD', headers: { Origin: 'https://example.com' } }), lookup, 'null')
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
  assert.equal((await preview(soundUrl, { headers: { Range: 'bytes=8-' } })).status, 416)
  assert.equal((await preview(`binwise-media://asset/${template.id}`)).status, 404)
  assert.equal((await preview('binwise-media://asset/9999')).status, 404)
  assert.equal((await preview('binwise-media://asset/%2e%2e%2fx.wav')).status, 404)
  assert.equal((await preview(soundUrl, { method: 'POST' })).status, 405)
  await unlink(wavPath)
  assert.equal((await preview(soundUrl)).status, 404)
})
