import { open } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { formatFor } from '../shared/formats.ts'
import type { Asset } from '../shared/library.ts'
import { mediaScheme } from '../shared/ipc.ts'
import { checkedFilePath } from './paths.ts'

interface ByteRange {
  start: number
  end: number
}

export function parseByteRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || size === 0) return null
  const [, first = '', last = ''] = match
  if (!first) {
    const suffixLength = Number(last)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }
  const start = Number(first)
  const end = last ? Number(last) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return null
  return { start, end: Math.min(end, size - 1) }
}

export async function serveMedia(request: Request, lookup: (id: number) => Asset, rendererOrigin?: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  const url = new URL(request.url)
  const id = Number(/^\/(\d+)$/.exec(url.pathname)?.[1])
  if (url.protocol !== mediaScheme + ':' || url.host !== 'asset' || url.username || url.password ||
      !Number.isSafeInteger(id) || id < 1) {
    return new Response(null, { status: 404 })
  }

  try {
    const asset = lookup(id)
    const mime = formatFor(asset.extension)?.mime
    if (!asset.available || !mime) return new Response(null, { status: 404 })
    const file = await open(await checkedFilePath(asset.absolutePath), 'r')
    let streaming = false
    try {
      const stats = await file.stat()
      if (!stats.isFile()) return new Response(null, { status: 404 })
      const size = stats.size
      const rangeHeader = request.headers.get('range')
      const range = rangeHeader === null ? null : parseByteRange(rangeHeader, size)
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Content-Type': mime,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Origin',
      })
      const origin = request.headers.get('origin')
      if (origin && (origin === rendererOrigin || (origin === 'file://' && rendererOrigin === 'null'))) {
        headers.set('Access-Control-Allow-Origin', origin)
      }
      if (rangeHeader !== null && !range) {
        headers.set('Content-Range', `bytes */${size}`)
        return new Response(null, { status: 416, headers })
      }
      if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
      headers.set('Content-Length', String(range ? range.end - range.start + 1 : size))
      const status = range ? 206 : 200
      if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers })

      const stream = file.createReadStream(range ?? { start: 0, end: size - 1 })
      const body = Readable.toWeb(stream) as ReadableStream<Uint8Array<ArrayBuffer>>
      const response = new Response(body, { status, headers })
      streaming = true
      return response
    } finally {
      if (!streaming) await file.close()
    }
  } catch {
    return new Response(null, { status: 404 })
  }
}
