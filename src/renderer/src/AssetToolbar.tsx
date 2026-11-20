import { useRef, useState } from 'react'
import {
  ArrowDownUp, AudioLines, Clapperboard, Columns2, FileBox, FolderPlus, Image, LayoutGrid, List,
  LoaderCircle, PanelsTopLeft, SlidersHorizontal,
} from 'lucide-react'
import { categories, quickFileTypes } from '../../shared/formats'
import type { Category, QuickFileType } from '../../shared/formats'
import { assetSorts } from '../../shared/library'
import type { AssetSort } from '../../shared/library'

export const browserLayouts = ['split', 'grid', 'table'] as const
export type BrowserLayout = typeof browserLayouts[number]
export const isBrowserLayout = (value: unknown): value is BrowserLayout => browserLayouts.some(item => item === value)
export const isAssetSort = (value: unknown): value is AssetSort => assetSorts.some(item => item === value)

const fileFilters = {
  '': { label: 'All Assets', icon: Columns2 },
  audio: { label: 'Audio', icon: AudioLines },
  image: { label: 'Images', icon: Image },
  video: { label: 'Videos', icon: Clapperboard },
  photoshop: { label: 'Photoshop', icon: null },
  other: { label: 'Other', icon: FileBox },
}
const sortLabels: Record<AssetSort, string> = {
  relevance: 'Relevance', 'name-asc': 'Name A–Z', 'name-desc': 'Name Z–A',
  'added-desc': 'Recently Added', 'added-asc': 'Oldest Added',
  'size-desc': 'Largest File', 'size-asc': 'Smallest File',
  'type-asc': 'File Type', 'modified-desc': 'Last Modified',
}
const layoutModes = {
  split: { label: 'Grid and table', icon: PanelsTopLeft },
  grid: { label: 'Grid only', icon: LayoutGrid },
  table: { label: 'Table only', icon: List },
}

export function AssetToolbar({
  fileType, category, favouritesOnly, sort, layout, busy,
  onFileType, onCategory, onFavourites, onSort, onLayout, onImport,
}: {
  fileType: QuickFileType | ''
  category: Category | ''
  favouritesOnly: boolean
  sort: AssetSort
  layout: BrowserLayout
  busy: boolean
  onFileType: (value: QuickFileType | '') => void
  onCategory: (value: Category | '') => void
  onFavourites: (value: boolean) => void
  onSort: (value: AssetSort) => void
  onLayout: (value: BrowserLayout) => void
  onImport: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const activeFilters = Number(Boolean(category)) + Number(favouritesOnly)
  return (
    <div className="browser-toolbar" onKeyDown={event => {
      if (event.key !== 'Escape' || !expanded) return
      event.stopPropagation()
      setExpanded(false)
      moreRef.current?.focus()
    }}>
      <div className="toolbar-row">
        <div className="quick-filters" role="group" aria-label="File type filters">
          {(['', ...quickFileTypes] as const).map(type => {
            const { label, icon: Icon } = fileFilters[type]
            return (
              <button className="filter-pill" key={type} aria-pressed={fileType === type}
                onClick={() => onFileType(type)}>
                {Icon ? <Icon size={14} /> : <span className="ps-icon" aria-hidden="true">Ps</span>}
                {label}
              </button>
            )
          })}
        </div>
        <div className="toolbar-actions">
          <label className="sort-control" title="Sort assets">
            <ArrowDownUp size={14} aria-hidden="true" />
            <select aria-label="Sort assets" value={sort} onChange={event => onSort(event.currentTarget.value as AssetSort)}>
              {assetSorts.map(key => <option value={key} key={key}>{sortLabels[key]}</option>)}
            </select>
          </label>
          <button ref={moreRef} className="button more-filters" aria-label="Additional filters" title="Additional filters"
            aria-controls="browser-filters" aria-expanded={expanded} data-active={activeFilters > 0}
            onClick={() => setExpanded(!expanded)}>
            <SlidersHorizontal size={15} /><span className="filters-label">Filters</span>
            {activeFilters > 0 && <span className="filter-count">{activeFilters}</span>}
          </button>
          <div className="view-toggle" role="group" aria-label="Results layout">
            {browserLayouts.map(mode => {
              const { label, icon: Icon } = layoutModes[mode]
              return <button className="icon-button" key={mode} aria-label={label} title={label}
                aria-pressed={layout === mode} onClick={() => onLayout(mode)}><Icon size={15} /></button>
            })}
          </div>
          <button className="button primary import-button" disabled={busy} onClick={onImport}>
            {busy ? <LoaderCircle className="animate-spin" size={16} /> : <FolderPlus size={16} />}
            {busy ? 'Scanning…' : 'Import Folder'}
          </button>
        </div>
      </div>
      <div className="filter-tray" id="browser-filters" hidden={!expanded}>
        <label>
          Category
          <select className="select" aria-label="Filter by category" value={category}
            onChange={event => onCategory(event.currentTarget.value as Category | '')}>
            <option value="">All categories</option>
            {categories.map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={favouritesOnly}
          onChange={event => onFavourites(event.currentTarget.checked)} />Favourites only</label>
        {activeFilters > 0 && <button className="text-button" onClick={() => { onCategory(''); onFavourites(false) }}>Reset filters</button>}
      </div>
    </div>
  )
}
