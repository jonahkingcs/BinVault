# Binwise v0.1

Binwise is a local-first Windows desktop library for reusable video-editing assets. Link the folders you already use, search them together, and preview files before bringing them into your editor.

## Run on Windows

Install a current Node.js 24 LTS release and npm. Open the repository in VS Code or a PowerShell terminal and run:

```powershell
npm ci
npm run dev
```

The initial dependency install and first Electron launch download the development dependencies and desktop runtime. Binwise itself works offline. Close its window to stop the development session.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Check main, preload, renderer, and tests with strict TypeScript |
| `npm test` | Run filesystem, SQLite, search, metadata, and media-boundary tests |
| `npm run build` | Build the Electron app into `out/` |
| `npm start` | Launch the build in `out/` |
| `npm run test:desktop` | Smoke-test the built app with two launches and a temporary library. Run `npm run build` first. |
| `npm run package:win` | Build an unpacked Windows app at `release/win-unpacked/Binwise.exe` on x64 Windows |

## Use the library

1. Choose **Import Folder** and select an existing assets folder. Repeat for additional folders. Binwise indexes the supported files in place.
2. Press **Ctrl+K** for global Quick Search, or select a linked folder and use **Folder search** above the results to include that folder and its subfolders. Both fields match filenames, categories, original folder paths, and tags, and respect toolbar filters. Global Quick Search takes priority. Clearing it resumes your folder query or returns to normal browsing. The folder query follows you when you select another linked folder.
3. Select a thumbnail or table row to preview the asset, edit its category, tags, or notes, or mark it as a favourite. Notes save automatically after a brief pause or when you leave the field. Use **Open in Explorer** to reveal the original file or **Copy Path** to copy its absolute path.
4. Binwise watches linked folders and their subfolders while it is open. The footer shows **Syncing**, **Synced**, or **Sync limited**. Use **Settings → Linked folders → Refresh Library** to reconcile all folders on demand, or **Rescan** for a single folder. Settings also controls the image preview checkerboard. **Recently Added** covers the last 30 days.

Drag the sidebar and inspector boundaries or the grid/table divider to resize the workspace. The dividers also support arrow keys when focused. Use the layout buttons to show both views, the grid alone, or the table alone. Arrow keys move between assets, and Enter selects the focused file for preview. Panel widths, split, layout, and sorting are remembered.

The library database is stored in `%APPDATA%\Binwise\library.sqlite`. Linked folders and metadata are restored from it on restart. Existing libraries migrate in place. Development and packaged builds use the same library by default. For an isolated run, use Electron’s `--user-data-dir` switch with a separate directory.

To verify synchronisation, link a disposable folder and leave a search open for a unique name. In Explorer, create a subfolder and copy an image, audio file, or video with that name into it. Check that the folder tree, active results, and counts update after the copy settles. Select the result, then rename or remove it in Explorer to check that the inspector follows the rename or shows the file as missing. Restart Binwise and repeat with another file. To check drive recovery, use a disposable library on a removable drive, disconnect it, and reconnect it before trying **Refresh Library**.

## Verify Windows native drag and Premiere Pro

Binwise passes the original path of an indexed ordinary media file to Electron’s native file-drag API. Electron’s Windows implementation allows copy and link effects. Presets, MOGRTs, LUTs, and other editing files have Explorer and path actions. [Electron drag tutorial](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop) · [Windows implementation](https://github.com/electron/electron/blob/v45.0.0/shell/browser/ui/drag_util_views.cc)

1. Link a test folder with a PNG, a WAV, and an MP4. Place Windows Explorer and Binwise alongside each other.
2. Drag one item from the grid or list into a separate empty test folder in Explorer. Check that the original still exists and the destination contains the expected copy.
3. In Premiere Pro, open a disposable project. Try each file separately in the **Project panel**, then try dropping it into a compatible track in a **Timeline**. Record the Premiere version, format, destination, and whether Premiere imported the original path, inserted the clip, or declined the drop.
4. If a destination declines the drop, use **Open in Explorer** or import using **Copy Path**.

Automated verification checks that the renderer reaches the native drag API with the validated original path and a non-empty drag image. Explorer drops and Premiere Pro drops require hands-on validation. No Premiere Pro destination or format has been verified for v0.1.

## Current limits

- Renames and moves preserve metadata when Binwise can match a single destination to a missing original using the filesystem’s file identity. A cross-volume copy followed by deletion, or a filesystem without stable file identities, may create a new entry. The original metadata is retained and restored if the file returns to its previous path. Missing files are excluded from active results and counts.
- Some removable and network filesystems may deliver limited notifications. Binwise retries unavailable watches and reconciles linked folders on startup and reconnection. **Refresh Library** can pick up missed changes on demand.
- Previews depend on the codecs bundled with Electron. The grid builds scaled thumbnails for supported images and videos and uses file-type icons for other formats. Thumbnails are cached for the session. Waveforms, sample rates, bitrates, and frame rates aren’t currently displayed.
- The Windows package is an unpacked build. Installer distribution, code signing, and automatic updates are deferred.
- The desktop smoke test substitutes the picker response and clipboard write and captures the native drag request. It exercises the actual app, disk files, SQLite, and Chromium media elements.

## Code layout

- `src/main` implements the library database, scanner, media protocol, and Windows integration.
- `src/preload` and `src/shared` provide the validated IPC boundary and shared contracts.
- `src/renderer` contains the React interface, library browsing, and previews.
- `tests` contains the automated library and desktop verification.
- [Product specification](docs/PRODUCT_SPEC.md) and [architecture](docs/ARCHITECTURE.md) describe requirements and implementation choices.
