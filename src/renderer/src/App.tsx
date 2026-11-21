import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Box, CircleAlert, CircleCheck, Database, LoaderCircle, Search, X } from 'lucide-react'
import type { Category, QuickFileType } from '../../shared/formats'
import { pageSize, searchMaxLength } from '../../shared/library'
import type {
  Asset, AssetPage, AssetPatch, AssetQuery, AssetSort, LibraryScope, LibrarySummary, LibrarySyncStatus, LinkedRoot,
} from '../../shared/library'
import { AssetResults, minSplit, maxSplit } from './AssetResults'
import { AssetToolbar, isAssetSort, isBrowserLayout } from './AssetToolbar'
import type { BrowserLayout } from './AssetToolbar'
import { Inspector } from './Inspector'
import { ResizeHandle, inRange, usePanelWidths, usePreference } from './layout'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { errorMessage } from './ui'

const initialScope: LibraryScope = { type: 'collection', collection: 'all' }

interface ResultsState {
  key: string
  offset: number
  data: AssetPage
}

export function App() {
  const [summary, setSummary] = useState<LibrarySummary | null>(null)
  const [scope, setScope] = useState<LibraryScope>(initialScope)
  const [scopeLabel, setScopeLabel] = useState('All Assets')
  const [scopeRootId, setScopeRootId] = useState<number>()
  const [search, setSearch] = useState('')
  const [folderSearch, setFolderSearch] = useState('')
  const [category, setCategory] = useState<Category | ''>('')
  const [fileType, setFileType] = useState<QuickFileType | ''>('')
  const [favouritesOnly, setFavouritesOnly] = useState(false)
  const [sort, setSort] = usePreference<AssetSort>('binwise.sort', 'relevance', isAssetSort)
  const [offset, setOffset] = useState(0)
  const [results, setResults] = useState<ResultsState | null>(null)
  const [selected, setSelected] = useState<Asset | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [syncStatus, setSyncStatus] = useState<LibrarySyncStatus | null>(null)
  const [layout, setLayout] = usePreference<BrowserLayout>('binwise.browserLayout', 'split', isBrowserLayout)
  const [split, setSplit] = usePreference('binwise.browserSplit', 65, inRange(minSplit, maxSplit))
  const [checkerboard, setCheckerboard] = useState(() => localStorage.getItem('binwise.checkerboard') !== 'off')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string; rescan?: boolean } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const settingsRef = useRef<HTMLDialogElement>(null)
  const { sidebar, inspector } = usePanelWidths()
  const globalTerm = search.trim()
  const folderSelected = scope.type === 'folder'
  const folderTerm = folderSelected ? folderSearch.trim() : ''
  const searchTerm = globalTerm || folderTerm
  const searchWithinFolder = Boolean(!globalTerm && folderTerm)
  const effectiveScope = globalTerm ? initialScope : scope
  const query = useMemo<AssetQuery>(() => ({
    search: searchTerm, scope: effectiveScope, searchWithinFolder: searchWithinFolder ? true : undefined,
    category: category || undefined, fileType: fileType || undefined, favouritesOnly, sort, offset,
  }), [searchTerm, effectiveScope, searchWithinFolder, category, fileType, favouritesOnly, sort, offset])
  const queryKey = JSON.stringify(query)
  const currentResults = results?.key === queryKey
  const resultCount = currentResults ? results.data.total : undefined
  const indexRevision = syncStatus?.revision ?? 0
  const selectedId = selected?.id
  const syncing = busy || syncStatus?.syncing
  const limited = syncStatus?.limitedRoots ?? 0

  const showError = useCallback((text: string) => setNotice({ tone: 'error', text }), [])
  useEffect(() => window.binwise.onDragError(showError), [showError])
  useEffect(() => {
    let current = true
    let receivedEvent = false
    const unsubscribe = window.binwise.onSyncStatus(status => {
      receivedEvent = true
      setSyncStatus(status)
    })
    void window.binwise.getSyncStatus().then(status => {
      if (current && !receivedEvent) setSyncStatus(status)
    }, error => { if (current) showError(errorMessage(error)) })
    return () => { current = false; unsubscribe() }
  }, [showError])
  useEffect(() => { localStorage.setItem('binwise.checkerboard', checkerboard ? 'on' : 'off') }, [checkerboard])
  useEffect(() => {
    if (notice?.tone !== 'success') return
    const timeout = window.setTimeout(() => setNotice(null), 5200)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const changeSearch = useCallback((value: string) => {
    setSearch(value)
    if (value.trim() !== globalTerm) setOffset(0)
  }, [globalTerm])

  function changeFolderSearch(value: string): void {
    setFolderSearch(value)
    if (value.trim() !== folderTerm) setOffset(0)
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (event.defaultPrevented || settingsRef.current?.open) return
      if ((event.ctrlKey || event.metaKey) && ['k', 'f'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
      if (event.key !== 'Escape' || !search) return
      const target = event.target
      if (target !== searchRef.current && target instanceof HTMLElement &&
        (target.matches('input, textarea, select') || target.isContentEditable)) return
      event.preventDefault()
      changeSearch('')
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [search, changeSearch])

  useEffect(() => {
    let current = true
    void window.binwise.getLibrary().then(result => {
      if (current) setSummary(result)
    }, error => { if (current) showError(errorMessage(error)) })
    return () => { current = false }
  }, [revision, indexRevision, showError])

  useEffect(() => {
    if (selectedId === undefined) return
    let current = true
    void window.binwise.getAsset(selectedId).then(asset => {
      if (current) setSelected(previous => previous?.id === selectedId ? asset : previous)
    }, error => { if (current) showError(errorMessage(error)) })
    return () => { current = false }
  }, [selectedId, indexRevision, showError])

  useEffect(() => {
    let current = true
    setLoading(true)
    setFailed(false)
    const timeout = window.setTimeout(() => {
      void window.binwise.getAssets(query).then(data => {
        if (!current) return
        const { offset } = query
        if (offset > 0 && offset >= data.total) {
          setOffset(Math.max(0, Math.floor((data.total - 1) / pageSize) * pageSize))
          return
        }
        setResults({ key: queryKey, offset, data })
        setSelected(previous => data.assets.find(asset => asset.id === previous?.id) ?? previous)
        setLoading(false)
      }, error => {
        if (!current) return
        setFailed(true)
        setLoading(false)
        showError(errorMessage(error))
      })
    }, query.search ? 125 : 0)
    return () => { current = false; window.clearTimeout(timeout) }
  }, [query, queryKey, revision, indexRevision, showError])

  const onSelectScope = useCallback((nextScope: LibraryScope, label: string, rootId?: number) => {
    setScope(nextScope)
    setScopeLabel(label)
    setScopeRootId(rootId)
    if (!globalTerm) setOffset(0)
  }, [globalTerm])

  const scan = useCallback(async (root?: LinkedRoot) => {
    if (busy) return
    setBusy(true)
    try {
      const report = root ? await window.binwise.rescan(root.id) : await window.binwise.importFolder()
      if (report) {
        const itemLabel = report.indexed === 1 ? 'asset' : 'assets'
        const skipped = report.skipped ? ' · ' + report.skipped + ' inaccessible entries skipped' : ''
        setNotice({
          tone: report.skipped ? 'error' : 'success',
          text: report.rootName + ' · ' + report.indexed.toLocaleString() + ' ' + itemLabel + ' indexed' + skipped,
          rescan: Boolean(root),
        })
        if (!root) onSelectScope(initialScope, 'All Assets')
      }
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error), rescan: Boolean(root) })
    } finally {
      setBusy(false)
    }
  }, [busy, onSelectScope])

  async function refreshLibrary(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const { reports, failed } = await window.binwise.refreshLibrary()
      const skipped = reports.reduce((total, report) => total + report.skipped, 0)
      const details = [failed.length && failed.length + ' unavailable', skipped && skipped + ' inaccessible entries skipped']
        .filter(Boolean).join(' · ')
      setNotice({
        tone: details ? 'error' : 'success', rescan: true,
        text: reports.length + (reports.length === 1 ? ' linked folder refreshed' : ' linked folders refreshed') +
          (details ? ' · ' + details : ''),
      })
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error), rescan: true })
    } finally {
      setBusy(false)
    }
  }

  async function unlinkFolder(root: LinkedRoot): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await window.binwise.unlinkFolder(root.id)
      if (scopeRootId === root.id) {
        setScope(initialScope)
        setScopeLabel('All Assets')
        setScopeRootId(undefined)
        if (!globalTerm) setOffset(0)
      }
      setNotice({ tone: 'success', text: root.name + ' unlinked', rescan: true })
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error), rescan: true })
    } finally {
      setBusy(false)
    }
  }

  const save = useCallback(async (id: number, patch: AssetPatch): Promise<boolean> => {
    try {
      const asset = await window.binwise.updateAsset(id, patch)
      setSelected(previous => previous?.id === id ? asset : previous)
      setResults(previous => previous?.data.assets.some(item => item.id === id) ? {
        ...previous, data: { ...previous.data, assets: previous.data.assets.map(item => item.id === id ? asset : item) },
      } : previous)
      if (patch.notes === undefined) setRevision(value => value + 1)
      return true
    } catch (error) {
      showError(errorMessage(error))
      return false
    }
  }, [showError])

  const onImport = useCallback(() => { void scan() }, [scan])
  const onFavourite = useCallback((asset: Asset) => { void save(asset.id, { favourite: !asset.favourite }) }, [save])
  const onRetry = useCallback(() => setRevision(value => value + 1), [])
  const openSettings = useCallback(() => { settingsRef.current?.showModal() }, [])

  async function assetAction(id: number, action: 'reveal' | 'copy'): Promise<void> {
    try {
      if (action === 'reveal') await window.binwise.revealAsset(id)
      else {
        await window.binwise.copyPath(id)
        setNotice({ tone: 'success', text: 'File path copied' })
      }
    } catch (error) { showError(errorMessage(error)) }
  }

  const heading = searchTerm
    ? 'Search results for “' + searchTerm + '” — ' + (searchWithinFolder ? scopeLabel + ' and subfolders' : 'All Assets')
    : scopeLabel
  const folderSearchDisabled = Boolean(globalTerm) || !folderSelected
  const folderSearchHint = globalTerm ? 'Paused while global search is active'
    : !folderSelected ? 'Select a linked folder to search within it' : ''
  return (
    <div className="app">
      <header className="titlebar">
        <div className="app-mark"><Box size={16} strokeWidth={2} /></div>
        <span className="wordmark">Binwise</span>
      </header>
      <div className="workspace" style={{
        '--sidebar-width': sidebar.value + 'px', '--inspector-width': inspector.value + 'px',
      } as CSSProperties}>
        <Sidebar summary={summary} scope={scope} folderRevision={syncStatus?.folderRevision ?? 0}
          onSelect={onSelectScope} onOpenSettings={openSettings} onError={showError}
          resizeHandle={<ResizeHandle {...sidebar} axis="horizontal" label="Resize sidebar" controls="library-sidebar" />}
          quickSearch={
            <div className="quick-search-wrap">
              <div className="search-field" onClick={() => searchRef.current?.focus()}>
                <Search size={20} aria-hidden="true" />
                <input ref={searchRef} type="search" aria-label="Search all assets" maxLength={searchMaxLength}
                  placeholder="Search all assets..." value={search} onChange={event => changeSearch(event.currentTarget.value)} />
                {search
                  ? <button className="icon-button clear-search" aria-label="Clear search" title="Clear search"
                    onClick={() => changeSearch('')}><X size={16} /></button>
                  : <kbd>Ctrl K</kbd>}
              </div>
            </div>
          } />
        <main className="library-pane" aria-label="Asset browser">
          <AssetToolbar fileType={fileType} category={category} favouritesOnly={favouritesOnly}
            sort={sort} layout={layout} busy={busy} onImport={onImport}
            onFileType={value => { setFileType(value); setOffset(0) }}
            onCategory={value => { setCategory(value); setOffset(0) }}
            onFavourites={value => { setFavouritesOnly(value); setOffset(0) }}
            onSort={value => { setSort(value); setOffset(0) }} onLayout={setLayout} />
          <div className="folder-search-bar">
            <label htmlFor="folder-search">Folder search</label>
            <div className="search-field folder-search-field" data-disabled={folderSearchDisabled}>
              <Search size={16} aria-hidden="true" />
              <input id="folder-search" type="search" maxLength={searchMaxLength}
                placeholder={folderSearchHint || 'Search this folder and subfolders...'}
                aria-describedby={folderSearchHint ? 'folder-search-hint' : undefined}
                value={folderSearch} disabled={folderSearchDisabled}
                onChange={event => changeFolderSearch(event.currentTarget.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape' && folderSearch) {
                    event.preventDefault()
                    changeFolderSearch('')
                  }
                }} />
              {folderSearch && <button className="icon-button clear-search" aria-label="Clear folder search"
                title="Clear folder search" disabled={folderSearchDisabled} onClick={() => {
                  changeFolderSearch('')
                  document.getElementById('folder-search')?.focus()
                }}><X size={15} /></button>}
            </div>
            {folderSearchHint && <span id="folder-search-hint" className={folderSearch ? 'folder-search-hint' : 'sr-only'}>
              {folderSearchHint}
            </span>}
          </div>
          <div className="library-heading">
            <h1 className="truncate" title={heading}>{heading}</h1>
            <span className="result-summary" role="status">
              {resultCount === undefined ? failed ? '' : 'Loading…'
                : '— ' + resultCount.toLocaleString() + (resultCount === 1 ? ' asset' : ' assets')}
            </span>
          </div>
          <AssetResults page={results?.data ?? null} resultKey={results?.key ?? ''} selectedId={selected?.id}
            loading={loading || (!currentResults && !failed)} failed={failed} layout={layout} split={split}
            emptyLibrary={summary?.roots.length === 0} searchTerm={searchTerm} searchWithinFolder={searchWithinFolder}
            offset={results?.offset ?? 0} onSelect={setSelected} onFavourite={onFavourite}
            onImport={onImport} onPage={setOffset} onRetry={onRetry} onSplit={setSplit} />
        </main>
        <aside className="inspector-pane" id="asset-inspector" aria-label="Asset inspector">
          <ResizeHandle {...inspector} axis="horizontal" sign={-1} label="Resize inspector" controls="asset-inspector" />
          <Inspector key={selected?.id} asset={selected} checkerboard={checkerboard} onSave={save}
            onAction={(id, action) => void assetAction(id, action)} />
        </aside>
      </div>
      <footer className="statusbar">
        <span><Database size={12} />Local library</span>
        <span>{summary ? summary.roots.length.toLocaleString() + ' linked ' + (summary.roots.length === 1 ? 'folder' : 'folders') : ''}</span>
        {(syncing || Boolean(syncStatus && summary?.roots.length)) && (
          <span className={'sync-status' + (limited && !syncing ? ' missing' : '')} role="status"
            title={limited ? limited + (limited === 1 ? ' linked folder needs attention' : ' linked folders need attention') : undefined}>
            {syncing ? <LoaderCircle className="animate-spin" size={12} aria-hidden="true" />
              : limited ? <CircleAlert size={12} aria-hidden="true" />
              : <CircleCheck size={12} aria-hidden="true" />}
            {syncing ? 'Syncing' : limited ? 'Sync limited' : 'Synced'}
          </span>
        )}
        {notice && (
          <span className={'status-notice ' + notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>
            {notice.tone === 'error' ? <CircleAlert size={14} /> : <CircleCheck size={14} />}
            <span className="truncate" title={notice.text}>{notice.text}</span>
            <button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={13} /></button>
          </span>
        )}
      </footer>
      <Settings dialogRef={settingsRef} roots={summary?.roots ?? []} checkerboard={checkerboard}
        busy={busy} onCheckerboard={setCheckerboard} onRescan={root => void scan(root)}
        onRefresh={() => void refreshLibrary()} onUnlink={root => void unlinkFolder(root)}
        scanNotice={notice?.rescan ? notice : undefined} />
    </div>
  )
}

