export const ipc = {
  getLibrary: 'binwise:get-library',
  getFolders: 'binwise:get-folders',
  getAssets: 'binwise:get-assets',
  getAsset: 'binwise:get-asset',
  importFolder: 'binwise:import-folder',
  rescan: 'binwise:rescan',
  refreshLibrary: 'binwise:refresh-library',
  unlinkFolder: 'binwise:unlink-folder',
  getSyncStatus: 'binwise:get-sync-status',
  syncStatus: 'binwise:sync-status',
  updateAsset: 'binwise:update-asset',
  revealAsset: 'binwise:reveal-asset',
  copyPath: 'binwise:copy-path',
  startDrag: 'binwise:start-drag',
  dragError: 'binwise:drag-error',
} as const

export const mediaScheme = 'binwise-media'
