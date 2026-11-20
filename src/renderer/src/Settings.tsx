import type { RefObject } from 'react'
import { Folder, RefreshCw, Settings2, X } from 'lucide-react'
import type { LinkedRoot } from '../../shared/library'
import { fileDate } from './ui'

export function Settings({ dialogRef, roots, checkerboard, busy, onCheckerboard, onRescan, scanNotice }: {
  dialogRef: RefObject<HTMLDialogElement | null>
  roots: LinkedRoot[]
  checkerboard: boolean
  busy: boolean
  onCheckerboard: (value: boolean) => void
  onRescan: (root: LinkedRoot) => void
  scanNotice?: { tone: 'error' | 'success'; text: string }
}) {
  return (
    <dialog ref={dialogRef} className="settings" aria-labelledby="settings-title">
      <div className="settings-header">
        <Settings2 size={19} /><h2 id="settings-title">Settings</h2>
        <form method="dialog"><button className="icon-button" title="Close settings" aria-label="Close settings"><X size={18} /></button></form>
      </div>
      <div className="settings-body">
        <section>
          <h3 className="section-label">Previews</h3>
          <label className="settings-option"><input type="checkbox" checked={checkerboard}
            onChange={event => onCheckerboard(event.currentTarget.checked)} />Show checkerboard behind images</label>
        </section>
        <section>
          <h3 className="section-label">Linked folders</h3>
          {roots.length === 0 ? <p className="settings-empty">Link a folder from the main toolbar.</p> : (
            <ul className="m-0 list-none p-0">
              {roots.map(root => (
                <li className="settings-root" key={root.id}>
                  <Folder size={18} />
                  <div className="min-w-0">
                    <strong className="block truncate">{root.name}</strong>
                    <span className="block truncate" title={root.path}>{root.path}</span>
                    <span className="block">Scanned {fileDate(root.lastScannedAt, true)}</span>
                  </div>
                  <button className="button" disabled={busy} onClick={() => onRescan(root)}>
                    <RefreshCw size={14} />Rescan<span className="sr-only"> {root.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {busy
            ? <p className="settings-scan-status" role="status">Scanning linked folder…</p>
            : scanNotice && <p className={`settings-scan-status status-notice ${scanNotice.tone}`}
              role={scanNotice.tone === 'error' ? 'alert' : 'status'}>{scanNotice.text}</p>}
        </section>
      </div>
    </dialog>
  )
}
