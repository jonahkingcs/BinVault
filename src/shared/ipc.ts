export const ipc = {
  getLibrary: 'binwise:get-library',
  getFolders: 'binwise:get-folders',
  getAssets: 'binwise:get-assets',
  importFolder: 'binwise:import-folder',
  rescan: 'binwise:rescan',
  updateAsset: 'binwise:update-asset',
  revealAsset: 'binwise:reveal-asset',
  copyPath: 'binwise:copy-path',
  startDrag: 'binwise:start-drag',
  dragError: 'binwise:drag-error',
} as const

export const mediaScheme = 'binwise-media'
