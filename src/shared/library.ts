import type { Category, FileKind, QuickFileType } from './formats.ts'

export const collections = ['all', 'favourites', 'recent'] as const
export const assetSorts = [
  'relevance', 'name-asc', 'name-desc', 'added-desc', 'added-asc', 'size-desc', 'size-asc', 'type-asc', 'modified-desc',
] as const
export const pageSize = 100
export const searchMaxLength = 240
export const maxTagsPerAsset = 50
export const maxTagLength = 64
export const maxNoteLength = 8000

export interface Asset {
  id: number
  name: string
  absolutePath: string
  rootPath: string
  relativeFolder: string
  extension: string
  kind: FileKind
  category: Category
  size: number
  addedAt: number
  modifiedAt: number
  favourite: boolean
  available: boolean
  tags: string[]
  notes: string
}

export interface LinkedRoot {
  id: number
  name: string
  path: string
  lastScannedAt: number
  folder: FolderNode
}

export interface FolderNode {
  id: number
  name: string
  relativePath: string
  hasChildren: boolean
}

export type Collection = typeof collections[number]
export type AssetSort = typeof assetSorts[number]
export type LibraryScope =
  | { type: 'collection'; collection: Collection }
  | { type: 'category'; category: Category }
  | { type: 'folder'; folderId: number }

export interface AssetQuery {
  search: string
  scope: LibraryScope
  searchWithinFolder?: true
  category?: Category
  kind?: FileKind
  fileType?: QuickFileType
  favouritesOnly?: boolean
  sort: AssetSort
  offset: number
}

export interface AssetPage {
  assets: Asset[]
  total: number
}

export interface LibrarySummary {
  roots: LinkedRoot[]
  counts: Record<Collection, number>
  categories: Record<Category, number>
}

export interface AssetPatch {
  category?: Category
  favourite?: boolean
  addTag?: string
  removeTag?: string
  notes?: string
}

export interface ScanReport {
  rootId: number
  rootName: string
  indexed: number
  skipped: number
}

export interface RefreshReport {
  reports: ScanReport[]
  failed: number[]
}

export interface LibrarySyncStatus {
  revision: number
  folderRevision: number
  syncing: boolean
  limitedRoots: number
}

export interface BinwiseApi {
  getLibrary(): Promise<LibrarySummary>
  getFolders(folderId: number): Promise<FolderNode[]>
  getAssets(query: AssetQuery): Promise<AssetPage>
  getAsset(id: number): Promise<Asset | null>
  importFolder(): Promise<ScanReport | null>
  rescan(rootId: number): Promise<ScanReport>
  refreshLibrary(): Promise<RefreshReport>
  unlinkFolder(rootId: number): Promise<void>
  getSyncStatus(): Promise<LibrarySyncStatus>
  onSyncStatus(listener: (status: LibrarySyncStatus) => void): () => void
  updateAsset(id: number, patch: AssetPatch): Promise<Asset>
  revealAsset(id: number): Promise<void>
  copyPath(id: number): Promise<void>
  startDrag(id: number): void
  onDragError(listener: (message: string) => void): () => void
  nativeDragAvailable: boolean
}
