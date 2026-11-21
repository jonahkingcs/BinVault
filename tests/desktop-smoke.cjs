const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdirSync, mkdtempDisposableSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

const searchOnly = process.argv.includes('--search-only')
if (!process.versions.electron) {
  const temp = mkdtempDisposableSync(join(tmpdir(), 'binwise-desktop-'))
  const desktopEnv = { ...process.env }
  delete desktopEnv.ELECTRON_RUN_AS_NODE
  try {
    for (const phase of searchOnly ? ['populate'] : ['populate', 'reopen']) {
      const result = spawnSync(require('electron'), [__filename, ...(searchOnly ? ['--search-only'] : []), temp.path, phase], {
        stdio: 'inherit',
        timeout: 45_000,
        env: desktopEnv,
      })
      if (result.error) throw result.error
      if (result.status !== 0) process.exitCode = result.status || 1
      if (process.exitCode) break
      if (phase === 'populate') {
        const images = join(temp.path, 'Image Fixtures')
        writeFileSync(join(images, 'While Closed.png'), readFileSync(join(images, 'Console Comparison.png')))
      }
    }
  } finally {
    temp.remove()
  }
} else {
  const { app, BrowserWindow, clipboard, dialog, nativeImage } = require('electron')
  const [directory, phase] = process.argv.slice(-2)
  const profile = join(directory, 'profile')
  const images = join(directory, 'Image Fixtures')
  const audio = join(directory, 'Sound Effects')
  const png = join(images, 'Console Comparison.png')
  const wav = join(audio, 'PS4 Startup.wav')
  const video = join(images, 'Fixture Video.webm')
  const notes = 'Use the console image for the PlayStation intro.\nPair with the startup audio.'
  const errors = []
  const folderSelections = [images, audio]
  let copiedPath

  function createWave() {
    const rate = 22050
    const samples = rate * 2
    const data = Buffer.alloc(44 + samples * 2)
    data.write('RIFF', 0)
    data.writeUInt32LE(data.length - 8, 4)
    data.write('WAVEfmt ', 8)
    data.writeUInt32LE(16, 16)
    data.writeUInt16LE(1, 20)
    data.writeUInt16LE(1, 22)
    data.writeUInt32LE(rate, 24)
    data.writeUInt32LE(rate * 2, 28)
    data.writeUInt16LE(2, 32)
    data.writeUInt16LE(16, 34)
    data.write('data', 36)
    data.writeUInt32LE(samples * 2, 40)
    for (let sample = 0; sample < samples; sample++) {
      data.writeInt16LE(Math.round(1500 * Math.sin(2 * Math.PI * 220 * sample / rate)), 44 + sample * 2)
    }
    return data
  }

  async function waitFor(description, check) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const value = await check()
      if (value) return value
      await delay(60)
    }
    throw new Error(`Timed out waiting for ${description}. ${errors.join('\n')}`)
  }

  async function testApp() {
    await app.whenReady()
    const win = await waitFor('the Binwise window', () => BrowserWindow.getAllWindows()[0])
    win.webContents.on('console-message', event => {
      if (event.level === 'error') errors.push(event.message)
    })
    const evaluate = (script, userGesture = false) => win.webContents.executeJavaScript(script, userGesture)
    const until = (description, script) => waitFor(description, () => evaluate(script))
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    const text = (selector, value) => evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)})
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
      setter.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    const card = name => `.card-select[aria-label="${name}"]`
    const waitForCard = name => until(name, `!!document.querySelector(${JSON.stringify(card(name))})`)
    const row = name => `[...document.querySelectorAll('.asset-table tbody tr')].find(row => row.querySelector('td').title === ${JSON.stringify(name)})`
    const clickRow = name => evaluate(row(name) + '.click()')
    const selectOption = (selector, value) => evaluate(`(() => {
      const select = document.querySelector(${JSON.stringify(selector)})
      select.value = ${JSON.stringify(value)}
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    const measure = selector => evaluate(`Math.round(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width)`)
    const key = (selector, name, ctrlKey = false) => evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(
      new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, ctrlKey: ${ctrlKey}, bubbles: true, cancelable: true }))`)
    const resizeByMouse = async (label, dx, dy) => {
      const selector = '[role="separator"][aria-label="' + label + '"]'
      const { x, y } = await evaluate(`(() => {
        const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
      })()`)
      const hit = await evaluate(`document.elementsFromPoint(${x}, ${y}).map(element => ({
        element: element.tagName, classes: element.getAttribute('class'), label: element.getAttribute('aria-label'),
      }))`)
      assert.equal(hit[0]?.label, label, JSON.stringify({ x, y, hit }))
      win.focus()
      const handle = 'document.querySelector(' + JSON.stringify(selector) + ')'
      const previousValue = await evaluate(handle + ".getAttribute('aria-valuenow')")
      await evaluate(handle + `.addEventListener('pointerdown', event => {
        event.currentTarget.dataset.testPointer = event.pointerId
      }, { once: true })`)
      win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
      win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      await until(label + ' pointer capture', handle + '.hasPointerCapture(Number(' + handle + '.dataset.testPointer))')
      win.webContents.sendInputEvent({ type: 'mouseMove', x: x + dx, y: y + dy, modifiers: ['leftButtonDown'] })
      await until(label + ' value change', handle + ".getAttribute('aria-valuenow') !== " +
        JSON.stringify(previousValue))
      win.webContents.sendInputEvent({ type: 'mouseUp', x: x + dx, y: y + dy, button: 'left', clickCount: 1 })
      await until(label + ' pointer release', '!' + handle + '.hasPointerCapture(Number(' + handle + '.dataset.testPointer))')
    }
    await until('library ready', `document.querySelector('.result-summary')?.textContent.includes('asset')`)
    assert.equal(await evaluate('typeof require'), 'undefined')
    assert.equal(await evaluate('window.binwise.nativeDragAvailable'), process.platform === 'win32')

    if (phase === 'populate') {
      mkdirSync(images, { recursive: true })
      mkdirSync(audio, { recursive: true })
      const pixels = Buffer.alloc(96 * 54 * 4)
      for (let y = 0; y < 54; y++) {
        for (let x = 0; x < 96; x++) {
          const colour = x > 11 && x < 83 && y > 9 && y < 44 ? 0xff945dca : 0xff283357
          pixels.writeUInt32LE(colour, (y * 96 + x) * 4)
        }
      }
      const pngBytes = nativeImage.createFromBitmap(pixels, { width: 96, height: 54 }).toPNG()
      writeFileSync(png, pngBytes)
      writeFileSync(join(images, 'Logo.png'), pngBytes)
      writeFileSync(join(images, 'Overlay.png'), pngBytes)
      writeFileSync(join(images, 'Editable.psd'), 'Photoshop type fixture')
      mkdirSync(join(images, 'Nested'))
      const audioBytes = createWave()
      writeFileSync(wav, audioBytes)
      writeFileSync(join(images, 'Title.mogrt'), 'Non-previewable template fixture')
      const clipBytes = await evaluate(`(async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 96
        canvas.height = 54
        const context = canvas.getContext('2d')
        const stream = canvas.captureStream(15)
        const chunks = []
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp8' })
        const done = new Promise(resolve => { recorder.onstop = resolve })
        recorder.ondataavailable = event => chunks.push(event.data)
        recorder.start()
        for (let i = 0; i < 14; i++) {
          context.fillStyle = i % 2 ? '#634699' : '#198c81'
          context.fillRect(0, 0, 96, 54)
          await new Promise(resolve => setTimeout(resolve, 70))
        }
        recorder.stop()
        await done
        stream.getTracks().forEach(track => track.stop())
        return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
      })()`)
      writeFileSync(video, Buffer.from(clipBytes))

      await click('.import-button')
      await waitForCard('Console Comparison.png')
      await click('.import-button')
      await waitForCard('PS4 Startup.wav')
      await click(card('Console Comparison.png'))
      await until('image decode', `document.querySelector('.preview-surface img')?.naturalWidth === 96`)
      if (!searchOnly) await until('scaled image thumbnail and dimensions', `
        document.querySelector(${JSON.stringify(card('Console Comparison.png') + ' .thumbnail img')})?.src.startsWith('data:image/webp') &&
        (${row('Console Comparison.png')})?.textContent.includes('96 × 54') &&
        document.querySelector('.file-details')?.textContent.includes('96 × 54')`)
      assert.equal(await evaluate(row('Console Comparison.png') + '.getAttribute("aria-selected")'), 'true')
      await text('[aria-label="New tag"]', 'ps4')
      await click('[aria-label="Add tag"]')
      await until('saved tag', `document.querySelector('.tag')?.textContent === 'ps4'`)
      await click('[aria-label="Add to favourites"]')
      await until('favourite saved', `!!document.querySelector('[aria-label="Remove from favourites"]')`)
      await selectOption('#asset-category', 'Graphics')
      await until('category saved', `(${row('Console Comparison.png')})?.textContent.includes('Graphics')`)
      await text('#asset-notes', notes)
      await clickRow('PS4 Startup.wav')
      await until('row selection updates inspector and matching thumbnail', `
        document.querySelector('.inspector-title')?.textContent.includes('PS4 Startup.wav') &&
        document.querySelector(${JSON.stringify(card('PS4 Startup.wav'))})?.getAttribute('aria-pressed') === 'true'`)
      assert.equal(await evaluate(`document.querySelector('#asset-notes').value`), '')
      await click(card('Console Comparison.png'))
      await until('notes saved for the original asset after selection changed', `document.querySelector('#asset-notes')?.value === ${JSON.stringify(notes)}`)
      if (process.platform === 'win32') {
        let dragged
        win.webContents.startDrag = item => { dragged = item }
        await evaluate(`document.querySelector(${JSON.stringify(card('Console Comparison.png'))})
          .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))`)
        await waitFor('native drag request', () => dragged)
        assert.equal(dragged.file, png)
        assert.equal(dragged.icon.isEmpty(), false)
      }
      await click('.inspector-actions button:last-child')
      await until('clipboard confirmation', `document.querySelector('.status-notice')?.textContent.includes('File path copied')`)
      assert.equal(copiedPath, png)
      await click('.folder-link[title$="Image Fixtures"]')
      await until('folder-scoped view', `document.querySelector('h1')?.textContent === 'Image Fixtures' &&
        !document.querySelector(${JSON.stringify(card('PS4 Startup.wav'))})`)
      await text('#folder-search', 'title')
      await until('folder search filters the current folder', `document.querySelector('.result-summary')?.textContent.includes('1 asset') &&
        document.querySelector('h1')?.textContent.includes('and subfolders') && !!(${row('Title.mogrt')})`)
      await click('.search-field')
      assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), 'Search all assets')
      await key('.app', 'k', true)
      assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), 'Search all assets')
      await text('[aria-label="Search all assets"]', 'ps4')
      await until('cross-folder search including the saved tag', `document.querySelector('h1')?.textContent.includes('Search results for') &&
        document.querySelector('.result-summary')?.textContent.includes('2 assets') &&
        !!document.querySelector(${JSON.stringify(card('Console Comparison.png'))}) &&
        !!document.querySelector(${JSON.stringify(card('PS4 Startup.wav'))})`)
      assert.equal(await evaluate(`document.querySelector('#folder-search').disabled && document.querySelector('#folder-search').value === 'title'`), true)
      await click('.quick-filters button:nth-child(2)')
      await until('Audio filter applies to both views', `document.querySelector('.asset-grid').children.length === 1 &&
        document.querySelector('.asset-table tbody').rows.length === 1 && !!(${row('PS4 Startup.wav')})`)
      assert.equal(await evaluate(`document.querySelector('.inspector-title').textContent`), 'Console Comparison.png')
      await click('[aria-label="Additional filters"]')
      await selectOption('[aria-label="Filter by category"]', 'Graphics')
      await until('additional category combines with Audio', `document.querySelector('.result-summary')?.textContent.includes('0 assets')`)
      await selectOption('[aria-label="Filter by category"]', '')
      await key('[aria-label="Additional filters"]', 'Escape')
      assert.equal(await evaluate(`document.querySelector('[aria-label="Additional filters"]').getAttribute('aria-expanded')`), 'false')
      await waitForCard('PS4 Startup.wav')
      await clickRow('PS4 Startup.wav')
      if (!searchOnly) {
        await until('WAV metadata', `document.querySelector('audio')?.duration === 2`)
        await evaluate(`document.querySelector('audio').play().then(() => true)`, true)
        await until('audio playback', `document.querySelector('audio')?.currentTime > 0.1`)
        await evaluate(`document.querySelector('audio').pause(); document.querySelector('audio').currentTime = 1.5`)
        await until('audio seek', `document.querySelector('audio')?.currentTime === 1.5 && !document.querySelector('audio').seeking`)
      }
      await key('[aria-label="Search all assets"]', 'Escape')
      await until('restored folder query retains the Audio filter', `document.querySelector('h1')?.textContent.includes('title') &&
        document.querySelector('.result-summary')?.textContent.includes('0 assets') &&
        document.querySelector('.empty-view')?.textContent.includes('this folder or its subfolders')`)
      await click('.folder-link[title$="Sound Effects"]')
      await until('folder query follows navigation', `document.querySelector('h1')?.textContent.includes('Sound Effects and subfolders') &&
        document.querySelector('#folder-search').value === 'title'`)
      await click('[aria-label="Library collections"] button:first-child')
      await until('All Assets ignores the saved folder query', `document.querySelector('h1')?.textContent === 'All Assets' &&
        document.querySelector('#folder-search').disabled && document.querySelector('.result-summary')?.textContent.includes('1 asset') &&
        !!(${row('PS4 Startup.wav')})`)
      await click('.folder-link[title$="Image Fixtures"]')
      await click('.quick-filters button:first-child')
      await until('clearing filters restores the saved folder match', `!!(${row('Title.mogrt')})`)
      await click('[aria-label="Clear folder search"]')
      await until('search restores folder view', `document.querySelector('h1')?.textContent === 'Image Fixtures'`)
      if (!searchOnly) {
        await waitForCard('Fixture Video.webm')
        await until('generated WebM thumbnail', `document.querySelector(${JSON.stringify(card('Fixture Video.webm') + ' .thumbnail img')})?.src.startsWith('data:image/webp')`)
        await click(card('Fixture Video.webm'))
        await until('video decode', `document.querySelector('video')?.videoWidth === 96`)
        await evaluate(`document.querySelector('video').play().then(() => true)`, true)
        await until('video playback', `document.querySelector('video')?.currentTime > 0.1`)
        await click(card('Title.mogrt'))
        await until('template fallback', `document.querySelector('.preview-fallback')?.textContent.includes('MOGRT')`)
      }

      const live = join(images, 'Sync Clips')
      const liveFile = join(live, 'Live Console.wav')
      const renamedFile = join(live, 'Live Console Renamed.wav')
      await text('#folder-search', 'live console')
      await click('.quick-filters button:nth-child(2)')
      await until('empty active search before adding media', `document.querySelector('.result-summary')?.textContent.includes('0 assets')`)
      mkdirSync(live)
      writeFileSync(liveFile, audioBytes)
      await until('new nested file appears in both active search views', `!!document.querySelector(${JSON.stringify(card('Live Console.wav'))}) &&
        !!(${row('Live Console.wav')}) && [...document.querySelectorAll('.folder-link')].some(button => button.textContent === 'Sync Clips')`)
      await clickRow('Live Console.wav')
      await text('[aria-label="Search all assets"]', 'live console')
      await until('global override uses the same live index', `document.querySelector('h1')?.textContent.endsWith('All Assets') &&
        document.querySelector('.result-summary')?.textContent.includes('1 asset')`)
      renameSync(liveFile, renamedFile)
      await until('rename refreshes the selected asset and active search', `
        document.querySelector('.inspector-title')?.textContent === 'Live Console Renamed.wav' &&
        document.querySelector('.result-summary')?.textContent.includes('1 asset') &&
        (${row('Live Console Renamed.wav')})?.getAttribute('aria-selected') === 'true'`)
      await key('[aria-label="Search all assets"]', 'Escape')
      await until('restored folder search sees the renamed file', `document.querySelector('h1')?.textContent.includes('and subfolders') &&
        document.querySelector('.result-summary')?.textContent.includes('1 asset')`)
      unlinkSync(renamedFile)
      rmdirSync(live)
      await until('deletion updates the selected inspector, results and tree', `
        document.querySelector('.preview-fallback')?.textContent.includes('File missing') &&
        document.querySelector('.result-summary')?.textContent.includes('0 assets') &&
        document.querySelector('#folder-search').value === 'live console' &&
        document.querySelector('.quick-filters button:nth-child(2)').getAttribute('aria-pressed') === 'true' &&
        ![...document.querySelectorAll('.folder-link')].some(button => button.textContent === 'Sync Clips')`)
      await until('sync indicator settles', `document.querySelector('.sync-status')?.textContent === 'Synced'`)
      await click('.quick-filters button:first-child')
      await key('#folder-search', 'Escape')
      await until('sync preserves the folder scope', `document.querySelector('h1')?.textContent === 'Image Fixtures'`)
      if (searchOnly) {
        console.log('Desktop dual search, filters, scope restoration and live index updates passed.')
        return
      }
      await click('.sidebar-bottom button')
      await click('.settings-root:first-child button')
      await until('rescan result', `document.querySelector('.settings-scan-status')?.textContent.includes('6 assets indexed')`)
      await evaluate(`[...document.querySelectorAll('.settings button')].find(button => button.textContent === 'Refresh Library').click()`)
      await until('manual refresh result', `document.querySelector('.settings-scan-status')?.textContent.includes('2 linked folders refreshed')`)
      await click('[aria-label="Close settings"]')
      assert.deepEqual(readFileSync(wav), audioBytes)
      assert.deepEqual(readFileSync(png), pngBytes)
      assert.equal(folderSelections.length, 0)
      await click('[aria-label="Library collections"] button:first-child')
      await waitForCard('PS4 Startup.wav')
      await click(card('Console Comparison.png'))
      await until('notes survived rescan', `document.querySelector('#asset-notes')?.value === ${JSON.stringify(notes)}`)
      await selectOption('[aria-label="Sort assets"]', 'size-desc')
      await until('size sort reorders both views', `document.querySelector('.card-select')?.getAttribute('aria-label') === 'PS4 Startup.wav' &&
        document.querySelector('.asset-table tbody td')?.title === 'PS4 Startup.wav'`)
      await key(card('PS4 Startup.wav'), 'ArrowRight')
      await until('arrow navigation selects the next thumbnail and table row', `
        document.querySelector('.inspector-title')?.textContent === 'Fixture Video.webm' &&
        (${row('Fixture Video.webm')})?.getAttribute('aria-selected') === 'true'`)
      await click(card('Console Comparison.png'))

      win.setContentSize(1920, 1080)
      await until('1920 × 1080 viewport', 'innerWidth === 1920 && innerHeight === 1080')
      const columns = () => evaluate(`getComputedStyle(document.querySelector('.asset-grid')).gridTemplateColumns.split(' ').length`)
      assert.equal(await columns(), 5)
      assert.equal(await measure('.sidebar'), 290)
      assert.equal(await measure('.inspector-pane'), 340)
      assert.equal(await evaluate(`document.querySelector('.table-scroll').clientWidth >= document.querySelector('.asset-table').offsetWidth`), true)
      assert.equal(await evaluate(`document.querySelector('.search-field').offsetHeight`), 256)
      if (process.env.BINWISE_SMOKE_SCREENSHOT) writeFileSync(process.env.BINWISE_SMOKE_SCREENSHOT, (await win.webContents.capturePage()).toPNG())

      win.setContentSize(960, 640)
      await until('960 × 640 viewport', 'innerWidth === 960 && innerHeight === 640')
      assert.ok(await columns() <= 3)
      assert.ok(await measure('.library-pane') >= 385)
      assert.ok(await evaluate(`document.querySelector('.table-scroll').scrollWidth > document.querySelector('.table-scroll').clientWidth`))
      assert.ok(await evaluate(`document.querySelector('.inspector-actions').getBoundingClientRect().bottom <= innerHeight`))
      assert.ok(await evaluate(`document.querySelector('.browser-toolbar').offsetHeight <= 89`))
      if (process.env.BINWISE_SMOKE_NARROW_SCREENSHOT) writeFileSync(process.env.BINWISE_SMOKE_NARROW_SCREENSHOT, (await win.webContents.capturePage()).toPNG())

      win.setContentSize(1440, 920)
      await until('restored test viewport', 'innerWidth === 1440 && innerHeight === 920')
      await waitFor('restored panel widths', async () =>
        await measure('.sidebar') === 290 && await measure('.inspector-pane') === 340)
      await resizeByMouse('Resize sidebar', 32, 0)
      await waitFor('sidebar pointer resize', async () => await measure('.sidebar') === 322)
      await key('[aria-label="Resize inspector"]', 'ArrowLeft')
      await waitFor('inspector keyboard resize', async () => await measure('.inspector-pane') === 352)
      await resizeByMouse('Resize inspector', -16, 0)
      await waitFor('inspector pointer resize', async () => await measure('.inspector-pane') > 352)
      assert.equal(await measure('.inspector-pane'), 368)
      await resizeByMouse('Resize grid and table', 0, -75)
      await until('grid/table pointer split', `Number(document.querySelector('[aria-label="Resize grid and table"]').getAttribute('aria-valuenow')) < 65`)
      await click('[aria-label="Grid only"]')
      await until('table collapses', `!document.querySelector('.table-pane')`)
      console.log('Desktop search, live folder and asset updates, selection, metadata, media, drag request, refresh and layout passed.')
    } else {
      await waitForCard('Console Comparison.png')
      await click(card('Console Comparison.png'))
      await until('persisted metadata', `document.querySelector('.tag')?.textContent === 'ps4' &&
        document.querySelector('#asset-category')?.value === 'Graphics' &&
        document.querySelector('#asset-notes')?.value === ${JSON.stringify(notes)} &&
        !!document.querySelector('[aria-label="Remove from favourites"]')`)
      assert.equal(await evaluate(`document.querySelector('[aria-label="Grid only"]').getAttribute('aria-pressed')`), 'true')
      assert.equal(await evaluate(`document.querySelectorAll('.sidebar-folders > .folders-scroll > ul > li').length`), 2)
      assert.equal(await evaluate(`document.querySelector('[aria-label="Sort assets"]').value`), 'size-desc')
      assert.equal(await measure('.sidebar'), 322)
      assert.equal(await measure('.inspector-pane'), 368)
      await click('[aria-label="Grid and table"]')
      await until('table reopens with its saved split', `Number(document.querySelector('[aria-label="Resize grid and table"]')?.getAttribute('aria-valuenow')) < 65 &&
        (${row('Console Comparison.png')})?.getAttribute('aria-selected') === 'true'`)
      await waitForCard('While Closed.png')
      writeFileSync(join(images, 'After Restart.png'), readFileSync(png))
      await waitForCard('After Restart.png')
      await until('restored watches settle', `document.querySelector('.sync-status')?.textContent === 'Synced'`)
      console.log('Desktop restart restored watchers, caught up on offline changes and preserved metadata and layout.')
    }
  }

  mkdirSync(profile, { recursive: true })
  app.setPath('userData', profile)
  dialog.showOpenDialog = async () => {
    const folder = folderSelections.shift()
    return folder ? { canceled: false, filePaths: [folder] } : { canceled: true, filePaths: [] }
  }
  clipboard.writeText = value => { copiedPath = value }
  require(resolve(__dirname, '../out/main/index.js'))
  void testApp().then(() => app.quit(), error => {
    console.error(error)
    app.exit(1)
  })
}
