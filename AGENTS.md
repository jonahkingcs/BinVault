
# Binwise — Agent Instructions

## Project overview

Binwise is a local-first Windows desktop application for video editors.

It provides a central library of reusable video editing assets, including music, sound effects, images, logos, animations, videos, LUTs, MOGRTs, and Premiere Pro presets.

The primary workflow is:
Search → Preview → Drag into Adobe Premiere Pro.

The most important feature is universal searching across all indexed files, folders, categories, and user-defined tags.

Read `docs/PRODUCT_SPEC.md` for the full product vision and feature roadmap, when available.

## Technology stack

- Electron for the desktop application
- React and TypeScript for the UI
- Vite / electron-vite for development
- Tailwind CSS for styling
- SQLite with FTS5 for storage and searching
- Node.js for filesystem operations
- npm for package management
- electron-builder for Windows distribution

Use strict TypeScript. Prefer well-maintained dependencies and straightforward solutions.

## Architectural principles

- Keep Electron main, preload, and renderer responsibilities separate.
- Access the filesystem and database through the main process.
- Expose only validated, typed IPC operations to the renderer.
- Use context isolation and secure Electron defaults.
- Build reusable services and components.
- Keep the application functional entirely offline.
- Avoid unnecessary servers, cloud services, subscriptions, or accounts.

## Critical product rules

1. Never modify, rename, move, or delete original user files without explicit confirmation.
2. Linked folders must remain in their existing filesystem locations.
3. Search must work across the entire library, not just the currently selected folder.
4. Tags and other user-defined metadata must survive rescanning and app restarts.
5. Rescanning must not create duplicate asset records.
6. Missing or inaccessible files must not crash the application.
7. Support real media files rather than hard-coded demonstration data.
8. Do not assume every asset format supports native previews or Premiere imports.
9. Treat Premiere Pro integration as a native desktop integration problem, not ordinary browser drag-and-drop.
10. Never claim Premiere integration works unless it has actually been validated.

## UI and UX standards

Binwise should look like polished professional creative software.

Use a dark theme, compact layouts, clear typography, subtle borders, and responsive panels.

Prioritise fast searching, keyboard accessibility, helpful previews, and minimal friction.

Avoid generic dashboard designs, oversized controls, excessive decoration, and unnecessary dialogs.

## Development workflow

- Inspect existing code before changing it.
- Work incrementally and preserve working functionality.
- Implement genuine functionality, not fake UI interactions.
- Keep changes focused and maintainable.
- Add appropriate tests for indexing, search, and metadata persistence.
- Run relevant checks after implementation.
- Fix errors rather than hiding them.
- Document significant architectural decisions.
- Keep README instructions accurate.
- Do not add unnecessary dependencies or abstractions.

## Task completion requirements

After completing a task, report:

- What changed
- Which files were added or modified
- Tests and checks performed
- How to run or verify the feature
- Known limitations
- Recommended next steps

## Documentation maintenance

Keep documentation aligned with the implementation.

Update `docs/ARCHITECTURE.md` when important architectural decisions change.

Update `docs/PRODUCT_SPEC.md` only when product requirements genuinely change.

Do not silently remove or redefine established product requirements.

## Long-term priorities

1. Reliable asset indexing and management
2. Powerful universal search and tagging
3. Fast media previews
4. Native Premiere Pro drag-and-drop
5. Efficient editing workflows and shortcuts
6. Advanced integrations and automation

Prioritise correctness, usability, and maintainability over feature quantity.
