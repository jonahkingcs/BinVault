export const categories = [
  'Images', 'Music', 'Sound Effects', 'Video', 'Graphics',
  'Templates', 'Presets', 'LUTs', 'Other',
] as const

export type Category = typeof categories[number]
export const fileKinds = ['image', 'audio', 'video', 'editing'] as const
export type FileKind = typeof fileKinds[number]
export type PreviewKind = Exclude<FileKind, 'editing'>
export const quickFileTypes = ['audio', 'image', 'video', 'photoshop', 'other'] as const
export type QuickFileType = typeof quickFileTypes[number]
export const photoshopExtensions = ['psd', 'psb'] as const

export function isPhotoshop(extension: string): boolean {
  return photoshopExtensions.some(value => value === extension)
}

interface AssetFormat {
  kind: FileKind
  category: Category
  mime?: string
}

const formats: ReadonlyMap<string, AssetFormat> = new Map([
  ...group('image', 'Images', {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp',
    tif: undefined, tiff: undefined, heic: undefined,
  }),
  ...group('audio', 'Music', {
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
    opus: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
    aif: undefined, aiff: undefined, wma: undefined,
  }),
  ...group('video', 'Video', {
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
    mov: 'video/quicktime', mkv: 'video/x-matroska', avi: undefined, mxf: undefined,
    mts: undefined, m2ts: undefined, mpg: undefined, mpeg: undefined, wmv: undefined,
  }),
  ...group('editing', 'Graphics', { psd: undefined, psb: undefined, svg: undefined, ai: undefined, eps: undefined }),
  ...group('editing', 'Templates', { mogrt: undefined }),
  ...group('editing', 'Presets', { prfpset: undefined, ffx: undefined }),
  ...group('editing', 'LUTs', { cube: undefined, lut: undefined, '3dl': undefined, look: undefined }),
])

function group(
  kind: FileKind, category: Category, extensions: Record<string, string | undefined>,
): [string, AssetFormat][] {
  return Object.entries(extensions).map(([extension, mime]) => [extension, { kind, category, mime }])
}

export function formatFor(extension: string): AssetFormat | undefined {
  return formats.get(extension)
}

export function defaultCategory(format: AssetFormat, filePath: string): Category {
  if (format.kind === 'audio' && /\b(sfx|sound[ _-]?effects?|meme[ _-]?sounds?)\b/i.test(filePath)) {
    return 'Sound Effects'
  }
  return format.category
}

export function previewKind(extension: string): PreviewKind | null {
  const format = formatFor(extension)
  return format?.mime && format.kind !== 'editing' ? format.kind : null
}
