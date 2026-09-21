import type { AfilmoryFilter } from './afilmory-augment'
import type { AfilmoryManifestPhotoExif } from './use-afilmory-manifest'

export function formatShutter(s: string | number | undefined | null): string | null {
  if (s === undefined || s === null || s === '') return null
  if (typeof s === 'number') {
    if (!Number.isFinite(s)) return null
    return s >= 1 ? `${s}s` : `1/${Math.round(1 / s)}s`
  }
  const str = String(s)
  if (str.includes('/')) return `${str}s`
  const n = Number(str)
  if (!Number.isFinite(n)) return str
  return n >= 1 ? `${n}s` : `1/${Math.round(1 / n)}s`
}

export function formatCameraLine(
  exif: AfilmoryManifestPhotoExif | undefined,
): string | null {
  if (!exif) return null
  const camera = [exif.Make, exif.Model]
    .filter(Boolean)
    .map((s) => s!.trim())
    .filter(Boolean)
    .join(' ')
  const lens = exif.LensModel?.trim()
  const parts = [camera, lens].filter((p): p is string => Boolean(p))
  return parts.length > 0 ? parts.join(' · ') : null
}


export function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('//')
}

export function resolveAssetUrl(baseUrl: string, assetUrl: string): string {
  if (isAbsoluteUrl(assetUrl)) return assetUrl
  const base = baseUrl.replace(/\/$/, '')
  const path = assetUrl.startsWith('/') ? assetUrl : `/${assetUrl}`
  return `${base}${path}`
}

export function buildPhotoDetailHref(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/$/, '')}/photos/${encodeURIComponent(id)}`
}

export function buildFilterHref(
  baseUrl: string,
  filter: AfilmoryFilter,
): string {
  const sp = new URLSearchParams()
  if (filter.tags?.length) sp.set('tags', filter.tags.join(','))
  if (filter.cameras?.length) sp.set('cameras', filter.cameras.join(','))
  if (filter.lenses?.length) sp.set('lenses', filter.lenses.join(','))
  if (filter.dateFrom) sp.set('from', filter.dateFrom)
  if (filter.dateTo) sp.set('to', filter.dateTo)
  if (filter.tagMode && filter.tagMode !== 'union') {
    sp.set('tag_mode', filter.tagMode)
  }
  const qs = sp.toString()
  const base = baseUrl.replace(/\/$/, '')
  return qs ? `${base}/?${qs}` : `${base}/`
}

export function AfilmoryGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect height="12" rx="1.5" width="14" x="3" y="6" />
      <circle cx="10" cy="12" r="2.5" />
      <rect height="6" width="3" x="18" y="9" />
    </svg>
  )
}
