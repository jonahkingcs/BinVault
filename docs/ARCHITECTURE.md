# Binwise architecture

Binwise runs locally on Windows. Electron owns the window, native dialogs, clipboard, file reveal, and native drag. React owns the searchable library interface. electron-vite bundles the main process, preload, and renderer separately. Tailwind CSS supplies renderer styling and electron-builder configures Windows packaging.

## Process boundaries

| Location | Responsibility |
| --- | --- |
| `src/main` | Electron lifecycle and IPC, linked-folder scanning, SQLite migrations and queries, read-only media streaming, desktop integration |
| `src/preload` | Sandboxed, typed bridge exposing named library operations through context isolation |
| `src/renderer` | Library navigation, search and filters, results, previews, metadata editing, and local display preferences |
| `src/shared` | Shared TypeScript contracts, IPC channel names, and category and file-format definitions |
| `tests` | Native filesystem/SQLite integration tests and targeted boundary tests |

The main window runs with context isolation, a sandboxed renderer, and Node integration disabled. The main process accepts IPC from the application’s top-level frame and validates payloads before acting. File access starts with an asset ID, with the path resolved against the index in the main process. Folder import uses a native picker. Preview streaming authorises only indexed regular files of a known preview type through a custom protocol. The main process checks the current canonical path before opening or revealing a file. Navigation, new windows, and Chromium permission requests are restricted.

## Persistence and indexing

Electron’s bundled Node runtime provides `node:sqlite` and FTS5. The database is stored in Electron’s per-user application data directory and uses foreign keys, WAL, and versioned schema migrations. Schema version 2 adds a notes column with an empty default to existing assets in a single transaction. Setting up the database requires no separate native addon build.

Linked roots own directory trees. Asset rows are keyed by canonical absolute path, with case-insensitive keys on Windows. Location rows associate an asset with each linked root where it was discovered, so overlapping roots share a single asset and its metadata. Categories, favourites, dates added, and notes belong to the asset. A many-to-many tag join supports reusable case-insensitive tags.

Scanning enumerates regular files asynchronously, without traversing junctions or symbolic links. It builds a filesystem snapshot before a single database transaction publishes the folder tree, file records, and search changes. One import or rescan runs at a time. An inaccessible branch retains its last known entries and contributes a warning. A file that disappears from a successfully scanned branch is marked missing, with its tags and favourites retained. Returning at the same path restores the existing entry. A move or rename to a different path is treated as a new entry and a missing old entry. Automatic relinking is a later feature.

## Search and previews

The renderer debounces Quick Search in the sidebar, shows paginated results, and keeps folder and category navigation distinct from the toolbar’s explicit filters. A non-empty search spans the library even when browsing a folder, category, or collection. The explicit toolbar filters still apply. Unfiltered browsing uses the selected collection or folder. The grid and table consume the same results page and selected ID. Panel dimensions, layout, and sort are renderer preferences stored separately from the SQLite library.

SQLite FTS5 indexes case-normalised filename, folder path, category, and tag text with the trigram tokenizer. Relevance sorting uses weighted BM25 for FTS matches, with preference for filename and tag matches. Queries that use only short substring terms fall back to alphabetical ordering for relevance. Bound SQL parameters and quoted FTS terms keep user input literal. Index updates share the transaction for changes to searchable metadata and scan results. Notes save through the metadata IPC on a short debounce or when focus leaves the editor. Notes remain outside the search index. [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html#sorting_by_auxiliary_function_results)

Previews use Chromium image, audio, and video elements. The custom media protocol streams the original files with byte ranges for seeking. It allows the app renderer origin to read image and video pixels for thumbnail generation. The grid and table share a viewport-driven queue and bounded in-memory cache for scaled thumbnails and decoder-reported metadata, keyed by asset ID, modification time, and size. Unknown metadata stays blank or uses an em dash in the table. [Electron protocol documentation](https://www.electronjs.org/docs/latest/api/protocol)

## Native drag

Ordinary image, audio, and video assets can initiate a Windows native file drag. The renderer sends an asset ID, then Electron uses the validated original path in `webContents.startDrag()`. Electron’s Windows implementation advertises copy and link effects. This is the basis for the proof of concept. Premiere Pro acceptance is tracked separately by media type and destination. [Electron native drag tutorial](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop) · [Electron 45 Windows drag implementation](https://github.com/electron/electron/blob/v45.0.0/shell/browser/ui/drag_util_views.cc)
