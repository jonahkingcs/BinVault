import {
  AudioLines, Clapperboard, FileBox, FileImage, Film, Layers3, Music2, SlidersHorizontal, SwatchBook,
} from 'lucide-react'
import type { Category } from '../../shared/formats'
import { isPhotoshop } from '../../shared/formats'
import { mediaScheme } from '../../shared/ipc'
import type { Asset } from '../../shared/library'
import type { BinwiseApi } from '../../shared/library'

declare global {
  interface Window {
    binwise: BinwiseApi
  }
}

export const categoryIcons = {
  Images: FileImage,
  Music: Music2,
  'Sound Effects': AudioLines,
  Video: Film,
  Graphics: Layers3,
  Templates: Clapperboard,
  Presets: SlidersHorizontal,
  LUTs: SwatchBook,
  Other: FileBox,
} satisfies Record<Category, typeof FileBox>

const mediaIcons = { image: FileImage, audio: AudioLines, video: Film } as const

export function AssetIcon({ asset, size = 25 }: { asset: Asset; size?: number }) {
  if (isPhotoshop(asset.extension)) return <span className="ps-icon" aria-hidden="true">Ps</span>
  const Icon = asset.kind === 'editing' ? categoryIcons[asset.category] : mediaIcons[asset.kind]
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" />
}

export interface MediaDetails {
  width?: number
  height?: number
  duration?: number
  thumbnail?: string
}

export function dimensionsText(details: MediaDetails): string {
  return details.width && details.height ? `${details.width} × ${details.height}` : ''
}

export function durationText(duration?: number): string {
  if (duration === undefined || !Number.isFinite(duration) || duration < 0) return ''
  if (duration < 1) return `${sizeFormatter.format(duration)} s`
  const seconds = Math.round(duration)
  const minutes = Math.floor(seconds / 60)
  const padding = (value: number) => String(value).padStart(2, '0')
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${padding(minutes % 60)}:${padding(seconds % 60)}`
    : `${minutes}:${padding(seconds % 60)}`
}

export function playbackDetails(media: HTMLMediaElement): MediaDetails {
  const dimensions = media instanceof HTMLVideoElement && media.videoWidth > 0 && media.videoHeight > 0
    ? { width: media.videoWidth, height: media.videoHeight } : {}
  return { ...dimensions, duration: Number.isFinite(media.duration) ? media.duration : undefined }
}

export function assetFolder(asset: Asset): string {
  const root = asset.rootPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? asset.rootPath
  return [root, ...asset.relativeFolder.split('/').filter(Boolean)].join(' / ')
}

export function mediaUrl(asset: Pick<Asset, 'id' | 'modifiedAt'>): string {
  return `${mediaScheme}://asset/${asset.id}?v=${asset.modifiedAt}`
}

const sizeFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const detailDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const unit = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${sizeFormatter.format(bytes / 1024 ** unit)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`
}

export function fileDate(value: number, detailed = false): string {
  return (detailed ? detailDateFormatter : dateFormatter).format(value)
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'An unexpected error occurred.'
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
