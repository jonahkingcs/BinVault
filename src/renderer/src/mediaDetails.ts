import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { previewKind } from '../../shared/formats'
import type { Asset } from '../../shared/library'
import { mediaUrl, playbackDetails } from './ui'
import type { MediaDetails } from './ui'

const empty: MediaDetails = {}
const cacheLimit = 240
const maxActive = 3
type MediaSource = Pick<Asset, 'id' | 'modifiedAt' | 'extension'>
const cache = new Map<string, MediaDetails>()
const jobs = new Map<string, { asset: MediaSource; listeners: Set<(details: MediaDetails) => void>; started: boolean }>()
let active = 0

function makeThumbnail(source: CanvasImageSource, width: number, height: number): string | undefined {
  if (!width || !height) return
  try {
    const scale = Math.min(1, 384 / width, 216 / height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', 0.8)
  } catch {
    // A decoder can expose dimensions without providing pixels for thumbnails.
    return undefined
  }
}

function readDetails(asset: MediaSource): Promise<MediaDetails> {
  return new Promise(resolve => {
    const kind = previewKind(asset.extension)
    if (!kind) { resolve(empty); return }
    const media = kind === 'image' ? new Image() : document.createElement(kind)
    let details = empty
    const finish = () => {
      window.clearTimeout(timeout)
      media.onload = media.onerror = null
      if (media instanceof HTMLMediaElement) {
        media.onloadedmetadata = media.onloadeddata = null
        media.removeAttribute('src')
        media.load()
      } else {
        media.removeAttribute('src')
      }
      resolve(details)
    }
    const timeout = window.setTimeout(finish, 6500)
    media.onerror = finish
    if (media instanceof HTMLImageElement) {
      media.crossOrigin = 'anonymous'
      media.decoding = 'async'
      media.onload = () => {
        const { naturalWidth: width, naturalHeight: height } = media
        details = { width, height, thumbnail: makeThumbnail(media, width, height) }
        finish()
      }
    } else {
      if (kind === 'video') media.crossOrigin = 'anonymous'
      media.preload = kind === 'video' ? 'auto' : 'metadata'
      media.onloadedmetadata = () => {
        details = playbackDetails(media)
        if (kind === 'audio') finish()
      }
      media.onloadeddata = () => {
        details = playbackDetails(media)
        if (media instanceof HTMLVideoElement && details.width && details.height) {
          details.thumbnail = makeThumbnail(media, details.width, details.height)
        }
        finish()
      }
    }
    media.src = mediaUrl(asset)
  })
}

function advance(): void {
  for (const [key, job] of jobs) {
    if (active >= maxActive) break
    if (job.started) continue
    job.started = true
    active += 1
    void readDetails(job.asset).catch(() => empty).then(details => {
      cache.set(key, details)
      if (cache.size > cacheLimit) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      jobs.delete(key)
      active -= 1
      for (const listener of job.listeners) listener(details)
      advance()
    })
  }
}

function subscribe(key: string, asset: MediaSource, listener: (details: MediaDetails) => void): () => void {
  const available = cache.get(key)
  if (available) {
    cache.delete(key)
    cache.set(key, available)
    listener(available)
    return () => {}
  }
  let job = jobs.get(key)
  if (!job) {
    job = { asset, listeners: new Set(), started: false }
    jobs.set(key, job)
  }
  const { listeners } = job
  listeners.add(listener)
  advance()
  return () => {
    listeners.delete(listener)
    if (!job.started && listeners.size === 0) jobs.delete(key)
  }
}

const visibleCallbacks = new WeakMap<Element, () => void>()
const observer = new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) {
    if (!isIntersecting) continue
    visibleCallbacks.get(target)?.()
    visibleCallbacks.delete(target)
    observer.unobserve(target)
  }
})

export function useMediaDetails(asset: Asset, ref: RefObject<HTMLElement | null>): MediaDetails {
  const { id, modifiedAt, extension, size } = asset
  const key = id + ':' + modifiedAt + ':' + size
  const [current, setCurrent] = useState<{ key: string; details: MediaDetails }>()
  const canPreview = Boolean(asset.available && previewKind(extension))
  useEffect(() => {
    const node = ref.current
    if (!node || !canPreview) return
    const cached = cache.get(key)
    if (cached) {
      setCurrent({ key, details: cached })
      return
    }
    let release: (() => void) | undefined
    visibleCallbacks.set(node, () => {
      release = subscribe(key, { id, modifiedAt, extension }, details => setCurrent({ key, details }))
    })
    observer.observe(node)
    return () => {
      release?.()
      visibleCallbacks.delete(node)
      observer.unobserve(node)
    }
  }, [key, canPreview, ref, id, modifiedAt, extension])
  return canPreview && current?.key === key ? current.details : empty
}
