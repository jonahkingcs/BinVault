import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export function usePreference<T extends string | number>(
  key: string, initial: T, valid: (value: unknown) => value is T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (valid(stored)) return stored
    } catch {
      // An unavailable or outdated preference falls back to its default.
    }
    return initial
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* optional display preference */ }
  }, [key, value])
  return [value, setValue]
}

export function between(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function inRange(min: number, max: number): (value: unknown) => value is number {
  return (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

const sidebarMin = 198
const sidebarMax = 400
const inspectorMin = 246
const inspectorMax = 490
const browserMin = 385

export function usePanelWidths() {
  const [sidebar, setSidebar] = usePreference('binwise.sidebarWidth', 290, inRange(sidebarMin, sidebarMax))
  const [inspector, setInspector] = usePreference('binwise.inspectorWidth', 340, inRange(inspectorMin, inspectorMax))
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const flexibleSpace = Math.max(0, width - browserMin - sidebarMin - inspectorMin)
  const wantedSpace = (sidebar - sidebarMin) + (inspector - inspectorMin)
  const scale = wantedSpace > flexibleSpace ? flexibleSpace / wantedSpace : 1
  const sidebarWidth = Math.floor(sidebarMin + (sidebar - sidebarMin) * scale)
  const inspectorWidth = Math.floor(inspectorMin + (inspector - inspectorMin) * scale)
  return {
    sidebar: {
      value: sidebarWidth, min: sidebarMin,
      max: between(width - browserMin - inspectorWidth, sidebarMin, sidebarMax),
      onChange: (value: number) => { setInspector(inspectorWidth); setSidebar(value) },
    },
    inspector: {
      value: inspectorWidth, min: inspectorMin,
      max: between(width - browserMin - sidebarWidth, inspectorMin, inspectorMax),
      onChange: (value: number) => { setSidebar(sidebarWidth); setInspector(value) },
    },
  }
}

export function ResizeHandle({ label, controls, value, min, max, axis, sign = 1, onChange }: {
  label: string
  controls: string
  value: number
  min: number
  max: number
  axis: 'horizontal' | 'vertical'
  sign?: 1 | -1
  onChange: (value: number) => void
}) {
  const xAxis = axis === 'horizontal'
  const drag = useRef<{ start: number; value: number; scale: number; max: number } | null>(null)
  const change = (next: number) => onChange(between(Math.round(next), min, max))
  return (
    <div className={xAxis ? 'panel-resizer' : 'split-resizer'} role="separator" tabIndex={0}
      aria-label={label} aria-controls={controls} aria-orientation={xAxis ? 'vertical' : 'horizontal'}
      aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}
      onPointerDown={event => {
        if (event.button !== 0) return
        const scale = xAxis ? 1 : 100 / Math.max(1, (event.currentTarget.parentElement?.clientHeight ?? 100) - 6)
        drag.current = { start: xAxis ? event.clientX : event.clientY, value, scale, max }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        const origin = drag.current
        if (!origin) return
        const coordinate = xAxis ? event.clientX : event.clientY
        onChange(between(Math.round(origin.value + sign * (coordinate - origin.start) * origin.scale), min, origin.max))
      }}
      onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={event => {
        const previous = xAxis ? 'ArrowLeft' : 'ArrowUp'
        const next = xAxis ? 'ArrowRight' : 'ArrowDown'
        const delta = xAxis ? 12 : 4
        if (![previous, next, 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        if (event.key === 'Home') change(min)
        else if (event.key === 'End') change(max)
        else change(value + (event.key === next ? delta : -delta) * sign)
      }}
    />
  )
}
