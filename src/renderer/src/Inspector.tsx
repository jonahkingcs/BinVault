import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Box, Copy, ExternalLink, Plus, Star, Tag, X } from 'lucide-react'
import { categories, previewKind } from '../../shared/formats'
import type { Category } from '../../shared/formats'
import { maxNoteLength, maxTagLength } from '../../shared/library'
import type { Asset, AssetPatch } from '../../shared/library'
import {
  assetFolder, AssetIcon, dimensionsText, durationText, fileDate, fileSize, mediaUrl, playbackDetails,
} from './ui'
import type { MediaDetails } from './ui'

type SaveAsset = (id: number, patch: AssetPatch) => Promise<boolean>

function Preview({ asset, checkerboard, onDetails }: {
  asset: Asset; checkerboard: boolean; onDetails: (details: MediaDetails) => void
}) {
  const [failed, setFailed] = useState(false)
  const kind = previewKind(asset.extension)
  const fallback = !asset.available || !kind || failed
  const onError = () => setFailed(true)

  return (
    <div className={'preview-surface' + (checkerboard && !fallback && kind === 'image' ? ' checkerboard' : '')}>
      {fallback ? (
        <div className="preview-fallback">
          <AssetIcon asset={asset} size={33} />
          <strong>{asset.extension.toUpperCase()}</strong>
          <span>{!asset.available ? 'File missing' : failed ? 'This file couldn’t be previewed' : 'Preview unavailable for this format'}</span>
        </div>
      ) : kind === 'image' ? (
        <img src={mediaUrl(asset)} alt={asset.name} draggable={false} onError={onError}
          onLoad={event => onDetails({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
      ) : kind === 'video' ? (
        <video src={mediaUrl(asset)} aria-label={asset.name} preload="metadata" controls onError={onError}
          onLoadedMetadata={event => onDetails(playbackDetails(event.currentTarget))}
          onDurationChange={event => onDetails(playbackDetails(event.currentTarget))} />
      ) : (
        <div className="audio-preview">
          <AssetIcon asset={asset} size={38} />
          <audio src={mediaUrl(asset)} aria-label={asset.name} preload="metadata" controls onError={onError}
            onLoadedMetadata={event => onDetails(playbackDetails(event.currentTarget))}
            onDurationChange={event => onDetails(playbackDetails(event.currentTarget))} />
        </div>
      )}
    </div>
  )
}

function AssetNotes({ id, notes, onSave }: { id: number; notes: string; onSave: SaveAsset }) {
  const [draft, setDraft] = useState(notes)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const text = useRef(notes)
  const lastSubmitted = useRef<string | undefined>(notes)
  const saved = useRef(notes)
  const timer = useRef<number | undefined>(undefined)
  const request = useRef(0)
  const mounted = useRef(false)

  useEffect(() => {
    if (text.current === saved.current && lastSubmitted.current === saved.current) {
      text.current = notes
      lastSubmitted.current = notes
      setDraft(notes)
    }
    saved.current = notes
  }, [notes])

  const commit = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    const value = text.current
    if (value === lastSubmitted.current) return
    lastSubmitted.current = value
    const attempt = ++request.current
    if (mounted.current) setStatus('saving')
    void onSave(id, { notes: value }).then(ok => {
      if (attempt !== request.current) return
      if (!ok) lastSubmitted.current = undefined
      if (mounted.current && text.current === value) setStatus(ok ? 'saved' : 'error')
    })
  }, [id, onSave])

  useEffect(() => {
    mounted.current = true
    window.addEventListener('blur', commit)
    return () => {
      window.removeEventListener('blur', commit)
      mounted.current = false
      if (timer.current !== undefined) commit()
    }
  }, [commit])

  return (
    <section className="inspector-section">
      <div className="inspector-section-header">
        <label htmlFor="asset-notes">Notes</label>
        {status === 'error'
          ? <button className="text-button missing" type="button" onClick={commit}>Retry save</button>
          : <span className="note-status" role="status">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}</span>}
      </div>
      <textarea id="asset-notes" placeholder="Add a note..." value={draft} rows={3} maxLength={maxNoteLength}
        onChange={event => {
          const value = event.currentTarget.value
          text.current = value
          setDraft(value)
          setStatus('idle')
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(commit, 450)
        }}
        onBlur={commit}
        onKeyDown={event => {
          if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return
          event.preventDefault()
          commit()
        }} />
    </section>
  )
}

export function Inspector({ asset, checkerboard, onSave, onAction }: {
  asset: Asset | null
  checkerboard: boolean
  onSave: SaveAsset
  onAction: (id: number, action: 'reveal' | 'copy') => void
}) {
  const [tag, setTag] = useState('')
  const [saving, setSaving] = useState(false)
  const [media, setMedia] = useState<{ version: string; details: MediaDetails }>()
  if (!asset) {
    return (
      <div className="inspector">
        <h2 className="inspector-title">Inspector</h2>
        <div className="inspector-empty"><Box size={27} strokeWidth={1.5} />
          <h3>No asset selected</h3><p>Select a thumbnail or file row to preview it.</p>
        </div>
      </div>
    )
  }

  const { id } = asset
  async function save(patch: AssetPatch): Promise<boolean> {
    setSaving(true)
    try { return await onSave(id, patch) } finally { setSaving(false) }
  }
  async function submitTag(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (tag.trim() && await save({ addTag: tag })) setTag('')
  }

  const version = asset.modifiedAt + ':' + asset.size + ':' + asset.available
  const details = media?.version === version ? media.details : {}
  const dimensions = dimensionsText(details)
  const duration = durationText(details.duration)
  const folderPath = asset.absolutePath.slice(0, -asset.name.length)
  const type = { image: 'Image', audio: 'Audio', video: 'Video', editing: 'Editing file' }[asset.kind]

  return (
    <div className="inspector">
      <h2 className="inspector-title inspector-filename" title={asset.name}>
        <AssetIcon asset={asset} size={17} /><span className="truncate">{asset.name}</span>
      </h2>
      <div className="inspector-scroll">
        <Preview key={version} asset={asset} checkerboard={checkerboard}
          onDetails={value => setMedia({ version, details: value })} />
        <div className="preview-actions">
          <button className="button favourite-button" aria-pressed={asset.favourite} disabled={saving}
            aria-label={asset.favourite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => void save({ favourite: !asset.favourite })}>
            <Star size={15} fill={asset.favourite ? 'currentColor' : 'none'} />
            {asset.favourite ? 'Favourited' : 'Favourite'}
          </button>
        </div>
        <section className="inspector-section">
          <h3 className="inspector-section-header">File Details</h3>
          <dl className="file-details">
            <dt>Type</dt><dd>{asset.extension.toUpperCase()} ({type})</dd>
            <dt>Size</dt><dd>{fileSize(asset.size)}</dd>
            {dimensions && <><dt>Dimensions</dt><dd>{dimensions}</dd></>}
            {duration && <><dt>Duration</dt><dd>{duration}</dd></>}
            <dt><label htmlFor="asset-category">Category</label></dt>
            <dd><select className="select category-select" id="asset-category" value={asset.category} disabled={saving}
              onChange={event => void save({ category: event.currentTarget.value as Category })}>
              {categories.map(category => <option key={category}>{category}</option>)}
            </select></dd>
            <dt>Folder</dt><dd title={folderPath}>{assetFolder(asset)}</dd>
            <dt>Added</dt><dd>{fileDate(asset.addedAt, true)}</dd>
            <dt>Modified</dt><dd>{fileDate(asset.modifiedAt, true)}</dd>
            {!asset.available && <><dt>Status</dt><dd className="missing">Missing</dd></>}
          </dl>
        </section>
        <section className="inspector-section">
          <h3 className="inspector-section-header"><Tag size={14} />Tags</h3>
          {asset.tags.length > 0 && (
            <ul className="tag-list">
              {asset.tags.map(name => (
                <li className="tag" key={name}>
                  <span>{name}</span>
                  <button aria-label={'Remove tag ' + name} title={'Remove tag ' + name} disabled={saving}
                    onClick={() => void save({ removeTag: name })}><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <form className="tag-form" onSubmit={event => void submitTag(event)}>
            <input type="text" value={tag} onChange={event => setTag(event.currentTarget.value)}
              placeholder="Add a tag…" aria-label="New tag" maxLength={maxTagLength} />
            <button className="icon-button" type="submit" title="Add tag" aria-label="Add tag" disabled={saving || !tag.trim()}>
              <Plus size={15} />
            </button>
          </form>
        </section>
        <AssetNotes id={id} notes={asset.notes} onSave={onSave} />
      </div>
      <div className="inspector-actions">
        <button className="button" disabled={!asset.available} onClick={() => onAction(id, 'reveal')}>
          <ExternalLink size={14} />Open in Explorer
        </button>
        <button className="button" onClick={() => onAction(id, 'copy')}><Copy size={14} />Copy Path</button>
      </div>
    </div>
  )
}

