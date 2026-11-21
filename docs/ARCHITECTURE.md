# Binwise architecture

Binwise runs locally on Windows. Electron owns the window, native dialogs, clipboard, file reveal, and native drag. React owns the searchable library interface. electron-vite bundles the main process, preload, and renderer separately. Tailwind CSS supplies renderer styling and electron-builder configures Windows packaging.

## Process boundaries

| Location | Responsibility |
| --- | --- |
| `src/main` | Electron lifecycle and IPC, linked-folder monitoring and scanning, SQLite migrations and queries, read-only media streaming, desktop integration |
| `src/preload` | Sandboxed, typed bridge exposing named library operations through context isolation |
| `src/renderer` | Library navigation, search and filters, results, previews, metadata editing, and local display preferences |
| `src/shared` | Shared TypeScript contracts, IPC channel names, and category and file-format definitions |
| `tests` | Native filesystem/SQLite integration tests and targeted boundary tests |

The main window runs with context isolation, a sandboxed renderer, and Node integration disabled. The main process accepts IPC from the application’s top-level frame and validates payloads before acting. File access starts with an asset ID, with the path resolved against the index in the main process. Folder import uses a native picker. Preview streaming authorises only indexed regular files of a known preview type through a custom protocol. The main process checks the current canonical path before opening or revealing a file. Navigation, new windows, and Chromium permission requests are restricted.

## Persistence and indexing

Electron’s bundled Node runtime provides `node:sqlite` and FTS5. The database is stored in Electron’s per-user application data directory and uses foreign keys, WAL, and versioned schema migrations. Schema version 3 adds filesystem identity and confirmed-missing fields. A scan populates those fields for existing records. Setting up the database requires no separate native addon build.

Linked roots own directory trees. Asset rows are keyed by canonical absolute path, with case-insensitive keys on Windows. Location rows associate an asset with each linked root where it was discovered, so overlapping roots share a single asset and its metadata. Categories, favourites, dates added, and notes belong to the asset. A many-to-many tag join supports reusable case-insensitive tags.

Scanning enumerates regular files asynchronously and skips junctions and symbolic links. A SQLite transaction applies folder, asset, location, and search changes together. An inaccessible branch retains its last known entries. Missing files are omitted from browsing, search, and counts, while their records remain available for metadata recovery. If a single missing record matches a new path by volume, file ID, and creation time, the transaction updates its existing asset ID and FTS entry. A path match takes precedence. Unlinking removes the root and its folder and location records. A subsequent link at the same path can restore asset metadata.

The main process uses Node’s recursive `fs.watch` with one watcher for each outermost linked directory. Overlapping linked roots share coverage. The sync service deduplicates changed paths, batches related events, and waits briefly for recent writes to settle. It reconciles individual paths and newly discovered or removed subtrees, with full scans available on startup, reconnect, and explicit refresh. A lightweight root health check detects lost or replaced watches. When the native watcher cannot be installed, the service retries and periodically reconciles the affected root. The service serializes filesystem reconciliation and closes watches before shutting down SQLite. [Node.js filesystem watcher documentation](https://nodejs.org/docs/latest-v24.x/api/fs.html#fswatchfilename-options-listener)

The preload bridge subscribes to typed sync status events from main. A committed index revision refreshes the summary, active result query, and selected asset. A separate folder revision refreshes expanded branches only when the tree changes. React keeps navigation and search state in place across these reads.

## Search and previews

The renderer derives one debounced, paginated query from two input states. A non-empty sidebar Quick Search spans the library and takes precedence over the retained folder query. With Quick Search empty, Folder search applies to the selected linked folder and its descendants. The validated IPC query combines the shared text matcher with the same root and slash-delimited folder containment used for browsing. Both search modes apply the toolbar filters and refresh on committed index revisions. With neither query active, browsing follows the selected folder, category, or collection. The grid and table share the same results and selection. Panel dimensions, layout, and sort are renderer preferences stored separately from the SQLite library.

SQLite FTS5 indexes case-normalised filename, folder path, category, and tag text with the trigram tokenizer. Relevance sorting uses weighted BM25 for FTS matches, with preference for filename and tag matches. Queries that use only short substring terms fall back to alphabetical ordering for relevance. Bound SQL parameters and quoted FTS terms keep user input literal. Index updates share the transaction for changes to searchable metadata and scan results. Notes save through the metadata IPC on a short debounce or when focus leaves the editor. Notes remain outside the search index. [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html#sorting_by_auxiliary_function_results)

Previews use Chromium image, audio, and video elements. The custom media protocol streams the original files with byte ranges for seeking. It allows the app renderer origin to read image and video pixels for thumbnail generation. The grid and table share a viewport-driven queue and bounded in-memory cache for scaled thumbnails and decoder-reported metadata, keyed by asset ID, modification time, and size. Unknown metadata stays blank or uses an em dash in the table. [Electron protocol documentation](https://www.electronjs.org/docs/latest/api/protocol)

## Native drag

Ordinary image, audio, and video assets can initiate a Windows native file drag. The renderer sends an asset ID, then Electron uses the validated original path in `webContents.startDrag()`. Electron’s Windows implementation advertises copy and link effects. This is the basis for the proof of concept. Premiere Pro acceptance is tracked separately by media type and destination. [Electron native drag tutorial](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop) · [Electron 45 Windows drag implementation](https://github.com/electron/electron/blob/v45.0.0/shell/browser/ui/drag_util_views.cc)
