import { memo, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Clock3, Folder, FolderOpen, LibraryBig, Settings2, Star } from 'lucide-react'
import { categories } from '../../shared/formats'
import type { ReactNode } from 'react'
import type { FolderNode, LibraryScope, LibrarySummary } from '../../shared/library'
import { categoryIcons, errorMessage } from './ui'

export const collectionNames = { all: 'All Assets', favourites: 'Favourites', recent: 'Recently Added' }
const collectionIcons = { all: LibraryBig, favourites: Star, recent: Clock3 }

interface FolderBranchProps {
  folder: FolderNode
  depth: number
  revision: number
  rootId: number
  activeId?: number
  rootPath?: string
  parentTrail?: string
  onSelect: (scope: LibraryScope, label: string, rootId?: number) => void
  onError: (message: string) => void
}

const FolderBranch = memo(function FolderBranchView({ folder, depth, revision, rootId, activeId, rootPath, parentTrail, onSelect, onError }: FolderBranchProps) {
  const [open, setOpen] = useState(depth === 0)
  const [children, setChildren] = useState<FolderNode[]>([])
  const expanded = folder.hasChildren && open
  useEffect(() => {
    if (!expanded) return
    let current = true
    void window.binwise.getFolders(folder.id).then(result => {
      if (current) setChildren(result)
    }, error => { if (current) onError(errorMessage(error)) })
    return () => { current = false }
  }, [expanded, folder.id, revision, onError])
  const active = activeId === folder.id
  const FolderIcon = expanded ? FolderOpen : Folder
  const trail = parentTrail ? parentTrail + ' / ' + folder.name : folder.name
  return (
    <li>
      <div className={`folder-row ${active ? 'active' : ''}`} style={{ paddingLeft: 8 + Math.min(depth, 7) * 13 }}>
        {folder.hasChildren ? (
          <button
            className="tree-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${folder.name}`}
            aria-expanded={open} onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : <span className="tree-spacer" />}
        <button
          className="folder-link" title={rootPath ?? folder.relativePath} aria-current={active ? 'page' : undefined}
          onClick={() => onSelect({ type: 'folder', folderId: folder.id }, trail, rootId)}
        >
          <FolderIcon size={15} />
          <span className="truncate">{folder.name}</span>
        </button>
      </div>
      {expanded && (
        <ul className="m-0 list-none p-0">
          {children.map(child => (
            <FolderBranch
              key={child.id} folder={child} depth={depth + 1} activeId={activeId} rootId={rootId}
              revision={revision} parentTrail={trail} onSelect={onSelect} onError={onError}
            />
          ))}
        </ul>
      )}
    </li>
  )
})

interface SidebarProps {
  summary: LibrarySummary | null
  scope: LibraryScope
  folderRevision: number
  onSelect: (scope: LibraryScope, label: string, rootId?: number) => void
  onOpenSettings: () => void
  onError: (message: string) => void
  quickSearch: ReactNode
  resizeHandle: ReactNode
}

export function Sidebar({ summary, scope, folderRevision, onSelect, onOpenSettings, onError, quickSearch, resizeHandle }: SidebarProps) {
  const [categoriesOpen, setCategoriesOpen] = useState(true)
  const collection = scope.type === 'collection' ? scope.collection : undefined
  const category = scope.type === 'category' ? scope.category : undefined
  const activeId = scope.type === 'folder' ? scope.folderId : undefined
  return (
    <aside className="sidebar" id="library-sidebar" aria-label="Library navigation">
      {quickSearch}
      <nav className="sidebar-content">
        <section className="primary-navigation" aria-label="Library collections">
          {Object.entries(collectionNames).map(([key, label]) => {
            const id = key as keyof typeof collectionNames
            const Icon = collectionIcons[id]
            return (
              <button
                className={`nav-row ${collection === id ? 'active' : ''}`} key={id}
                aria-current={collection === id ? 'page' : undefined}
                onClick={() => onSelect({ type: 'collection', collection: id }, label)}
              >
                <Icon size={16} /><span>{label}</span>
                {summary && <span className="nav-count">{summary.counts[id].toLocaleString()}</span>}
              </button>
            )
          })}
        </section>
        <section className="sidebar-categories">
          <h2><button className="section-toggle" aria-expanded={categoriesOpen}
            aria-controls="category-navigation" onClick={() => setCategoriesOpen(!categoriesOpen)}>
            {categoriesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Categories
          </button></h2>
          <div id="category-navigation" className="category-navigation" hidden={!categoriesOpen}>
          {categories.filter(name => Boolean(summary?.categories[name]) || name === category).map(name => {
            const Icon = categoryIcons[name]
            return (
              <button
                className={`nav-row ${category === name ? 'active' : ''}`} key={name}
                aria-current={category === name ? 'page' : undefined}
                onClick={() => onSelect({ type: 'category', category: name }, name)}
              >
                <Icon size={15} /><span>{name}</span>
                {!!summary?.categories[name] && <span className="nav-count">{summary.categories[name].toLocaleString()}</span>}
              </button>
            )
          })}
          {summary && !Object.values(summary.categories).some(Boolean) && <p className="sidebar-empty">No assets categorised yet</p>}
          </div>
        </section>
        <section className="sidebar-folders">
          <h2 className="sidebar-heading">Linked Folders</h2>
          <div className="folders-scroll">
            {summary && !summary.roots.length && <p className="sidebar-empty">No folders linked</p>}
            <ul className="m-0 list-none p-0">
              {summary?.roots.map(root => (
                <FolderBranch key={root.id} folder={root.folder} rootId={root.id} rootPath={root.path} depth={0}
                  revision={folderRevision} activeId={activeId} onSelect={onSelect} onError={onError} />
              ))}
            </ul>
          </div>
        </section>
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-row" onClick={onOpenSettings}><Settings2 size={16} /><span>Settings</span></button>
      </div>
      {resizeHandle}
    </aside>
  )
}
