import { memo, useLayoutEffect, useRef } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, FileSearch, FolderOpen, FolderPlus, Images, List, Star } from 'lucide-react'
import { pageSize } from '../../shared/library'
import type { Asset, AssetPage } from '../../shared/library'
import type { BrowserLayout } from './AssetToolbar'
import { ResizeHandle } from './layout'
import { useMediaDetails } from './mediaDetails'
import { assetFolder, AssetIcon, dimensionsText, durationText, fileDate, fileSize } from './ui'

type SelectAsset = (asset: Asset) => void

function canDrag(asset: Asset): boolean {
  return window.binwise.nativeDragAvailable && asset.available && asset.kind !== 'editing'
}

function startDrag(event: DragEvent, asset: Asset): void {
  event.preventDefault()
  if (canDrag(asset)) window.binwise.startDrag(asset.id)
}

const AssetCard = memo(function AssetCard({ asset, selected, tabStop, onSelect, onFavourite }: {
  asset: Asset; selected: boolean; tabStop: boolean; onSelect: SelectAsset; onFavourite: SelectAsset
}) {
  const ref = useRef<HTMLElement>(null)
  const details = useMediaDetails(asset, ref)
  const dimensions = dimensionsText(details)
  const duration = durationText(details.duration)
  const descriptor = asset.kind === 'audio' ? duration : dimensions
  const size = asset.available ? fileSize(asset.size) : 'Missing'
  return (
    <article ref={ref} className={'asset-card' + (selected ? ' selected' : '')}>
      <button className="card-select" type="button" aria-label={asset.available ? asset.name : asset.name + ', missing'}
        aria-pressed={selected} title={asset.name} data-asset-entry={asset.id} tabIndex={tabStop ? 0 : -1}
        draggable={canDrag(asset)} onDragStart={event => startDrag(event, asset)} onClick={() => onSelect(asset)}>
        <div className="thumbnail">
          {details.thumbnail
            ? <img src={details.thumbnail} alt="" draggable={false} />
            : <AssetIcon asset={asset} size={29} />}
          <span className="file-chip">{asset.extension.toUpperCase()}</span>
          {asset.kind === 'video' && duration && <span className="duration-chip">{duration}</span>}
        </div>
        <div className="card-copy">
          <span className="asset-name truncate">{asset.name}</span>
          <span className={'card-secondary truncate' + (asset.available ? '' : ' missing')}>
            {[descriptor, size].filter(Boolean).join(' · ')}
          </span>
        </div>
      </button>
      <button className="card-star" aria-pressed={asset.favourite}
        aria-label={(asset.favourite ? 'Unfavourite ' : 'Favourite ') + asset.name}
        title={asset.favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => onFavourite(asset)}>
        <Star size={14} fill={asset.favourite ? 'currentColor' : 'none'} />
      </button>
    </article>
  )
})

const AssetTableRow = memo(function AssetTableRow({ asset, selected, tabStop, onSelect }: {
  asset: Asset; selected: boolean; tabStop: boolean; onSelect: SelectAsset
}) {
  const ref = useRef<HTMLTableRowElement>(null)
  const details = useMediaDetails(asset, ref)
  const location = assetFolder(asset)
  const tags = asset.tags.join(', ')
  const format = [durationText(details.duration), dimensionsText(details)].filter(Boolean).join(' · ')
  return (
    <tr ref={ref} className={selected ? 'selected' : undefined} aria-selected={selected}
      data-asset-entry={asset.id} tabIndex={tabStop ? 0 : -1} draggable={canDrag(asset)}
      onDragStart={event => startDrag(event, asset)} onClick={() => onSelect(asset)}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect(asset)
      }}>
      <td title={asset.name}>
        <span className="table-filename">
          <span className="file-icon"><AssetIcon asset={asset} size={15} /></span>
          <span className="truncate">{asset.name}</span>
          {asset.favourite && <Star className="row-star" size={12} fill="currentColor" aria-label="Favourite" />}
          {!asset.available && <span className="missing">Missing</span>}
        </span>
      </td>
      <td>{asset.extension.toUpperCase()}</td>
      <td title={asset.category}>{asset.category}</td>
      <td title={format}>{format || '—'}</td>
      <td className="table-size">{fileSize(asset.size)}</td>
      <td>{fileDate(asset.addedAt)}</td>
      <td title={location}>{location}</td>
      <td title={tags}>{tags || '—'}</td>
    </tr>
  )
})

interface AssetResultsProps {
  page: AssetPage | null
  resultKey: string
  selectedId?: number
  loading: boolean
  failed: boolean
  emptyLibrary: boolean
  searchTerm: string
  searchWithinFolder: boolean
  layout: BrowserLayout
  split: number
  offset: number
  onSelect: SelectAsset
  onFavourite: SelectAsset
  onImport: () => void
  onPage: (offset: number) => void
  onRetry: () => void
  onSplit: (value: number) => void
}

export const minSplit = 25
export const maxSplit = 80

export const AssetResults = memo(function AssetResults({
  page, resultKey, selectedId, loading, failed, emptyLibrary, searchTerm, searchWithinFolder, layout, split, offset,
  onSelect, onFavourite, onImport, onPage, onRetry, onSplit,
}: AssetResultsProps) {
  const gallery = useRef<HTMLDivElement>(null)
  const details = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const previousResult = useRef('')
  const assets = page?.assets ?? []
  const splitView = layout === 'split'
  const showGrid = layout !== 'table'
  const showTable = layout !== 'grid'
  const tabId = assets.some(asset => asset.id === selectedId) ? selectedId : assets[0]?.id

  useLayoutEffect(() => {
    const pageChanged = previousResult.current !== resultKey
    previousResult.current = resultKey
    for (const pane of [gallery.current, details.current]) {
      if (pageChanged) pane?.scrollTo({ top: 0 })
      if (selectedId !== undefined) pane?.querySelector('[data-asset-entry="' + selectedId + '"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [selectedId, resultKey, layout, page?.assets.length])

  function navigate(event: KeyboardEvent<HTMLDivElement>, galleryMode: boolean): void {
    if (!(event.target instanceof HTMLElement) || !event.target.dataset.assetEntry) return
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-asset-entry]')]
    const index = entries.indexOf(event.target)
    const columns = galleryMode && grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(' ').length : 1
    const steps: Record<string, number> = { ArrowUp: -columns, ArrowDown: columns }
    if (galleryMode) {
      steps.ArrowLeft = -1
      steps.ArrowRight = 1
    }
    const step = steps[event.key]
    if (step === undefined && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? assets.length - 1
      : Math.max(0, Math.min(assets.length - 1, index + (step ?? 0)))
    const asset = assets[next]
    if (asset) {
      onSelect(asset)
      entries[next]?.focus()
    }
  }

  if (failed) {
    return <div className="empty-view" role="status"><FileSearch size={27} /><h2>Couldn’t load assets</h2>
      <button className="button" onClick={onRetry}>Try again</button></div>
  }
  if (!page || (!assets.length && loading)) return <div className="empty-view" role="status">Loading assets…</div>
  if (!assets.length) {
    const link = emptyLibrary && !searchTerm
    return (
      <div className="empty-view">
        {link ? <FolderOpen size={30} /> : <FileSearch size={29} />}
        <h2>{link ? 'Link your first asset folder' : searchTerm ? 'No matching assets' : 'No assets in this view'}</h2>
        <p>{link ? 'Browse the editing assets you already keep on this PC.'
          : searchTerm ? 'No assets matching “' + searchTerm + '” found in ' +
            (searchWithinFolder ? 'this folder or its subfolders.' : 'this library.')
            : 'Change the filters or choose another folder.'}</p>
        {link && <button className="button primary" onClick={onImport}><FolderPlus size={15} />Import Folder</button>}
      </div>
    )
  }

  return (
    <>
      <div className={'browser-split' + (splitView ? ' split-view' : '') + (loading ? ' results-updating' : '')}
        aria-busy={loading} style={splitView ? { gridTemplateRows: 'minmax(0, ' + split + 'fr) 6px minmax(0, ' + (100 - split) + 'fr)' } : undefined}>
        {showGrid && (
          <section className="grid-pane" id="asset-grid-pane" aria-label="Asset thumbnails">
            <div className="results-scroll" ref={gallery} onKeyDown={event => navigate(event, true)}>
              <div className="asset-grid" ref={grid}>
                {assets.map(asset => (
                  <AssetCard key={asset.id} asset={asset} selected={asset.id === selectedId}
                    tabStop={asset.id === tabId} onSelect={onSelect} onFavourite={onFavourite} />
                ))}
              </div>
            </div>
          </section>
        )}
        {splitView && <ResizeHandle axis="vertical" controls="asset-grid-pane" value={split} min={minSplit} max={maxSplit}
          label="Resize grid and table" onChange={onSplit} />}
        {showTable && (
          <section className="table-pane" aria-label="Detailed file table">
            <div className="details-bar"><List size={14} /><h2>Details</h2></div>
            <div className="results-scroll table-scroll" ref={details} onKeyDown={event => navigate(event, false)}>
              <table className="asset-table" role="grid" aria-label="Asset details" aria-multiselectable={false}>
                <colgroup><col className="name-column" /><col className="type-column" /><col className="category-column" />
                  <col className="media-column" /><col className="size-column" /><col className="date-column" />
                  <col className="folder-column" /><col className="tags-column" /></colgroup>
                <thead><tr><th scope="col">Filename</th><th scope="col">Type</th><th scope="col">Category</th>
                  <th scope="col">Duration / Dimensions</th><th scope="col" className="table-size">File Size</th>
                  <th scope="col">Date Added</th><th scope="col">Folder</th><th scope="col">Tags</th></tr></thead>
                <tbody>{assets.map(asset => (
                  <AssetTableRow key={asset.id} asset={asset} selected={asset.id === selectedId}
                    tabStop={asset.id === tabId} onSelect={onSelect} />
                ))}</tbody>
              </table>
            </div>
          </section>
        )}
      </div>
      <div className="browser-footer">
        <span><Images size={13} />{(offset + 1).toLocaleString()}–{(offset + assets.length).toLocaleString()} of {page.total.toLocaleString()}</span>
        {page.total > pageSize && <>
          <button className="icon-button" aria-label="Previous results page" disabled={loading || offset === 0}
            onClick={() => onPage(offset - pageSize)}><ChevronLeft size={15} /></button>
          <button className="icon-button" aria-label="Next results page" disabled={loading || offset + pageSize >= page.total}
            onClick={() => onPage(offset + pageSize)}><ChevronRight size={15} /></button>
        </>}
      </div>
    </>
  )
})

