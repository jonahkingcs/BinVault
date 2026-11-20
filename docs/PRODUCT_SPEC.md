# Binwise product specification

Binwise is a local-first Windows desktop asset library for video editors and content creators, especially Adobe Premiere Pro users. It brings music, sound effects, images and Photoshop exports, logos, B-roll, green-screen clips, overlays, animations, MOGRTs, effect presets, LUTs, and transitions into one searchable library.

## Core workflow

Open Binwise → search for an asset → preview it → drag it into Premiere Pro.

Search must span every linked folder and match filenames, folder names and paths, categories, and custom tags. A search for `ps4` should find all four of these assets regardless of the folder currently selected in the sidebar.

| Original location | Why it matches |
| --- | --- |
| `Music/PlayStation/PS4 Menu Theme.mp3` | Filename |
| `Sound Effects/Consoles/PS4 Startup.wav` | Filename |
| `Images/Minecraft/Minecraft PS4 Disc.png` | Filename |
| `Photoshop Exports/Console Comparison.png` | Custom tag `ps4` |

## Library and metadata

- Linking an existing folder, such as `D:\Video Editing Assets`, recursively discovers supported assets and keeps the original folder hierarchy browsable. Files stay in their existing locations. Linking is the default workflow.
- Each asset has an ID, filename, absolute path, linked root, relative folder path, extension, category, file size, date added, last modified date, favourite flag, optional notes, and zero or more reusable custom tags.
- Store data in SQLite using normalised tables for assets and reusable tags. Use FTS5 with substring matching where needed. Preserve user metadata across rescans and restarts and avoid duplicate records on rescans.
- Handle renamed, moved, missing, and inaccessible files gracefully. Any future operation that deletes, moves, renames, or overwrites original files requires explicit confirmation.
- Managed folders are a future option for creating, renaming, and organising folders from Binwise, with optional management of the underlying files.

## Desktop experience

- Use a compact navy-grey theme, clear typography, subtle borders, and blue focus and selection states.
- The sidebar begins with a large universal Quick Search above All Assets, Favourites, Recently Added, collapsible categories, the independently scrolling linked folder tree, and Settings. Ctrl+K focuses search. Clearing search restores the current browsing scope.
- The central toolbar provides file-type shortcuts, additional filters, sorting, Import Folder, and layout controls. The default layout stacks a thumbnail grid above a detailed file table with independent scrolling and a resizable divider. Both views share the same results and selection. Either view can fill the browser.
- The inspector displays the selected file, its preview, known media dimensions and duration, original location, editable category, tags and notes, and persistent access to Explorer and path actions.
- The sidebar and inspector are resizable. The app remembers the preferred widths, split ratio, layout, and sort order.

## Media previews and Adobe integration

- Prioritise PNG, JPG/JPEG, WebP, and GIF images with an optional transparency checkerboard. Support runtime-decodable audio, including MP3, WAV, and OGG, and runtime-decodable video, including MP4 and WebM. Playback controls include play/pause for audio and seeking for video.
- Recognise presets, MOGRTs, LUTs, Photoshop documents, and other indexed formats without native previews. Show their file type and known metadata. Generate and cache compact image and video thumbnails lazily where the runtime supports decoding.
- Investigate Windows native file drag-out with Electron’s `webContents.startDrag()`. Test ordinary media against Premiere Pro and record the specific destinations and formats verified. Keep Open in Explorer and Copy File Path available.
- Native dragging must preserve the original assets. Templates, presets, and effects may need separate import or application workflows, potentially through an Adobe extension.

## Platform and development

Use Electron, React, strict TypeScript, Vite/electron-vite, Tailwind CSS, SQLite/FTS5, Node.js for filesystem work, npm, and electron-builder for Windows packaging. Document development in VS Code and keep the app usable entirely offline without an account or server.

Keep filesystem access, persistence, and desktop integration in the Electron main process. Use a typed, validated preload bridge with context isolation and keep the renderer focused on the interface. Share TypeScript contracts and organise indexing, search, metadata, and preview logic for reuse.

Implement incrementally, inspect files before changing them, test indexing and search with real files, run relevant checks, and document usage and manual verification. State clearly which Premiere Pro workflows were verified.

## MVP v0.1 acceptance criteria

1. A Windows developer can install dependencies, start the Electron app, run strict type checking and tests, and build it with npm.
2. The main window has a dark sidebar and folder browser, a universal search box, grid and list views, a preview/details pane, and an Import Folder action.
3. The native picker links existing folders. Recursive indexing records supported real files in SQLite and preserves the folder hierarchy.
4. Live search matches filenames, categories, paths, and tags across all linked folders, including when a folder is selected.
5. Users can select an asset, change its category, add or remove tags, toggle favourites, see its original location, reveal it in Windows Explorer, and copy its full path. Linked folders and metadata persist when Binwise closes and reopens.
6. Common images, audio, and video play or display through the runtime. Unsupported files have a meaningful fallback.
7. Include a minimal copy-safe native drag proof of concept for ordinary media if feasible. Record the limits and give reproducible instructions for testing with Premiere Pro.
8. Run type checks and tests, launch the app where the environment permits, and document development commands, structure, limitations, and the next milestone.

## Roadmap beyond v0.1

- Real-time folder watching and automatic updates
- Bulk tagging and category changes
- Automatic tags from folder and file names
- Duplicate detection
- Saved searches and cross-folder collections
- Recently used asset tracking
- Global search shortcut and compact always-on-top search window
- Audio waveforms and persistent thumbnail caching
- Additional keyboard shortcuts
- Missing-file relinking
- Portable backup and restore
- Optional AI-assisted tagging, preferably local
- Adobe Premiere Pro extension and dedicated preset import/application workflows
- Windows installer distribution and automatic updates
