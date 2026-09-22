'use client'

import clsx from 'clsx'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { usePrintFallback } from '../../../host'
import { ImagePlaceholder } from '../../../lib/image-placeholder'
import {
  AfilmoryGlyph,
  buildFilterHref,
  buildPhotoDetailHref,
  formatCameraLine,
  formatShutter,
  resolveAssetUrl,
} from './_shared'
import type {
  AfilmoryLayout,
  AfilmoryListItem,
  AfilmorySlotProps,
  AfilmorySource,
} from './afilmory-augment'
import { AfilmoryLightbox } from './afilmory-lightbox'
import type {
  AfilmoryManifestPhoto,
  AfilmoryManifestPhotoExif,
  AfilmorySearchParams,
} from './use-afilmory-manifest'
import {
  useAfilmoryPhotoDirect,
  useAfilmoryPhotosByIds,
  useAfilmoryPhotosSearch,
} from './use-afilmory-manifest'

const DEFAULT_LIMIT_FILTER = 12
const DEFAULT_LIMIT_LIST = 24

export function AfilmoryRenderer(props: AfilmorySlotProps) {
  const printFallback = usePrintFallback('afilmory', {
    title: 'title' in props && typeof props.title === 'string' ? props.title : '',
  })
  if (printFallback !== null) {
    return <p className="print-block-fallback">{printFallback}</p>
  }
  const isSingle =
    props.source.kind === 'list' && props.source.items.length === 1
  if (isSingle && props.source.kind === 'list') {
    return (
      <AfilmoryPolaroidView
        accent={props.accent}
        alt={props.alt}
        baseUrl={props.baseUrl}
        caption={props.caption}
        item={props.source.items[0]!}
      />
    )
  }
  return <AfilmoryGalleryView {...props} />
}

// ────────────────────────────────────────────────────────────────────────────
// Single-photo polaroid view (source.kind === 'list' && ids.length === 1)
// ────────────────────────────────────────────────────────────────────────────

function aspectFromDims(w: number, h: number): string {
  if (w > 0 && h > 0) return `${w} / ${h}`
  return '3 / 2'
}

function ratioFromDims(w: number, h: number): number {
  if (w > 0 && h > 0) return w / h
  return 3 / 2
}

function getDisplayAspect(photo: AfilmoryManifestPhoto): string {
  return aspectFromDims(photo.width, photo.height)
}



function formatExifParams(
  exif: AfilmoryManifestPhotoExif | undefined,
): string | null {
  if (!exif) return null
  const focal = exif.FocalLength?.replace(/\s*mm$/i, 'mm')
  const aperture = typeof exif.FNumber === 'number' ? `f/${exif.FNumber}` : null
  const shutter = formatShutter(exif.ExposureTime)
  const iso = typeof exif.ISO === 'number' ? `ISO ${exif.ISO}` : null
  const parts = [focal, aperture, shutter, iso].filter((p): p is string =>
    Boolean(p && p.trim()),
  )
  return parts.length > 0 ? parts.join(' · ') : null
}

function formatStaticCaption(
  id: string,
  exif: AfilmoryManifestPhotoExif | undefined,
): string {
  const model = exif?.Model?.trim()
  const focal = exif?.FocalLength?.replace(/\s*mm$/i, 'mm')
  if (model && focal) return `${id} · ${model} @ ${focal}`
  if (model) return `${id} · ${model}`
  return id
}

const polaroidShellClass = clsx(
  'group/afilmory relative mx-auto my-8 block w-full max-w-[440px] font-sans',
  'cursor-pointer overflow-hidden no-underline',
  'bg-white dark:bg-neutral-2',
  'shadow-[0_3px_14px_rgba(0,0,0,0.10)] dark:shadow-[0_3px_18px_rgba(0,0,0,0.45)]',
  'transition-[translate,rotate,box-shadow] duration-[260ms] ease-out',
  'hover:-translate-y-[3px] hover:-rotate-[0.4deg]',
  'hover:shadow-[0_8px_24px_rgba(0,0,0,0.14)] dark:hover:shadow-[0_8px_28px_rgba(0,0,0,0.55)]',
  'p-[12px] pb-[52px]',
)

function PolaroidShell({
  accent,
  asLink,
  children,
  href,
  onNavigate,
}: {
  accent?: string
  asLink: boolean
  children: React.ReactNode
  href?: string
  onNavigate?: (event: React.MouseEvent) => void
}) {
  const style = accent
    ? ({ '--afilmory-accent': accent } as React.CSSProperties)
    : undefined
  if (asLink && href) {
    return (
      <a
        className={polaroidShellClass}
        href={href}
        rel="noopener noreferrer"
        style={style}
        target="_blank"
        onClick={onNavigate}
      >
        {children}
      </a>
    )
  }
  return (
    <div className={polaroidShellClass} role="figure" style={style}>
      {children}
    </div>
  )
}

function PolaroidHoverOverlay({
  cameraLine,
  caption,
  paramsLine,
}: {
  cameraLine: string | null
  caption: string | null
  paramsLine: string | null
}) {
  return (
    <div
      className={clsx(
        'pointer-events-none absolute inset-0 flex flex-col justify-end p-4',
        'bg-gradient-to-b from-transparent via-black/55 to-black/85',
        'opacity-0 transition-opacity duration-[220ms] ease-out',
        'group-hover/afilmory:opacity-100',
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-[4px] px-2 py-[3px]',
            'border border-white/12 bg-black/55',
            'font-mono text-[9px] tracking-[0.12em] text-white',
          )}
        >
          <AfilmoryGlyph className="size-[11px]" />
          AFILMORY
        </span>
        <span className="font-mono text-[9px] tracking-[0.12em] text-white/85">
          View ↗
        </span>
      </div>
      {caption ? (
        <div className="mb-1 text-sm leading-snug text-white/95">{caption}</div>
      ) : null}
      {cameraLine ? (
        <div className="font-mono text-[11px] text-white/90">{cameraLine}</div>
      ) : null}
      {paramsLine ? (
        <div className="mt-0.5 font-mono text-[10px] text-white/60">
          {paramsLine}
        </div>
      ) : null}
    </div>
  )
}

function PolaroidFootStatic({
  caption,
  watermark = false,
}: {
  caption: string
  watermark?: boolean
}) {
  return (
    <div className="absolute right-[18px] bottom-[14px] left-[18px] flex items-baseline justify-between gap-2">
      <span className="font-mono text-[13px] text-neutral-7 dark:text-neutral-7">
        {caption}
      </span>
      {watermark ? (
        <span className="font-mono text-[9px] tracking-[0.15em] text-neutral-5 dark:text-neutral-6">
          AFILMORY
        </span>
      ) : null}
    </div>
  )
}

function AfilmoryPolaroidView({
  accent,
  alt,
  baseUrl,
  caption,
  item,
}: {
  accent?: string
  alt?: string
  baseUrl: string
  caption?: string
  item: AfilmoryListItem
}) {
  const { id } = item
  const aspectRatio = aspectFromDims(item.w, item.h)
  const detailHref = buildPhotoDetailHref(baseUrl, id)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const {
    data: photo,
    error,
    isError,
    isLoading,
  } = useAfilmoryPhotoDirect(baseUrl, id)

  const handleNavigate = useCallback(
    (event: React.MouseEvent) => {
      // Same bargain as the deck: a modified click still opens the gallery,
      // and an unresolved photo falls back to following the link.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }
      if (!photo) return
      event.preventDefault()
      setLightboxOpen(true)
    },
    [photo],
  )

  const closeLightbox = useCallback(() => setLightboxOpen(false), [])

  if (isError) {
    const hint =
      error instanceof Error ? error.message : 'Manifest fetch failed'
    return (
      <PolaroidShell accent={accent} asLink={false}>
        <div
          className="relative flex w-full items-center justify-center bg-neutral-3 px-6 text-center dark:bg-neutral-1"
          style={{ aspectRatio }}
        >
          <div className="font-mono text-caption-12 text-neutral-7">{hint}</div>
        </div>
        <PolaroidFootStatic caption={id} />
      </PolaroidShell>
    )
  }

  const cameraLine = photo ? formatCameraLine(photo.exif) : null
  const paramsLine = photo ? formatExifParams(photo.exif) : null
  const renderedCaption = caption ?? photo?.description ?? null
  const altText = alt ?? renderedCaption ?? photo?.title ?? id
  const staticCap = photo ? formatStaticCaption(id, photo.exif) : id
  const thumbnailSrc = photo
    ? resolveAssetUrl(baseUrl, photo.thumbnailUrl)
    : undefined

  return (
    <>
      <PolaroidShell
        asLink
        accent={accent}
        href={detailHref}
        onNavigate={handleNavigate}
      >
      <div
        className="relative w-full overflow-hidden bg-neutral-1 dark:bg-neutral-1"
        style={{ aspectRatio }}
      >
        {item.hash ? (
          <ImagePlaceholder
            accent={accent}
            className="absolute inset-0 size-full object-cover"
            thumbhash={item.hash}
          />
        ) : (
          <div
            aria-hidden
            className={clsx(
              'absolute inset-0',
              isLoading
                ? 'animate-pulse bg-neutral-2 dark:bg-neutral-3'
                : 'bg-neutral-3 dark:bg-neutral-1',
            )}
          />
        )}
        {thumbnailSrc ? (
          <img
            alt={altText}
            className="absolute inset-0 size-full object-cover"
            decoding="async"
            draggable={false}
            loading="lazy"
            src={thumbnailSrc}
            style={{ borderRadius: 0, width: '100%', height: '100%' }}
          />
        ) : null}
        <PolaroidHoverOverlay
          cameraLine={cameraLine}
          caption={renderedCaption}
          paramsLine={paramsLine}
        />
      </div>
        <PolaroidFootStatic watermark caption={staticCap} />
      </PolaroidShell>
      {/* Outside the anchor on purpose: React bubbles synthetic events through
          the component tree, so a portal nested inside the link would route
          every click in the lightbox back into the link's own handler. */}
      {lightboxOpen && photo && thumbnailSrc ? (
        <AfilmoryLightbox
          detailHref={detailHref}
          photo={photo}
          thumbnailSrc={thumbnailSrc}
          onClose={closeLightbox}
        />
      ) : null}
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Multi-photo / filter gallery view
// ────────────────────────────────────────────────────────────────────────────

function useCollectionPhotos(
  baseUrl: string,
  source: AfilmorySource,
  limit: number | undefined,
) {
  const ids = source.kind === 'list' ? source.items.map((i) => i.id) : []
  const listQuery = useAfilmoryPhotosByIds(baseUrl, ids)

  const searchParams = useMemo<AfilmorySearchParams>(() => {
    if (source.kind !== 'filter') return {}
    return { ...source.filter, limit: limit ?? DEFAULT_LIMIT_FILTER }
  }, [source, limit])
  const filterQuery = useAfilmoryPhotosSearch(baseUrl, searchParams, {
    enabled: source.kind === 'filter',
  })

  if (source.kind === 'list') {
    const photos = listQuery.data ?? []
    const cap = limit ?? DEFAULT_LIMIT_LIST
    return {
      error: listQuery.error,
      isError: listQuery.isError,
      isLoading: listQuery.isLoading,
      photos: cap && photos.length > cap ? photos.slice(0, cap) : photos,
    }
  }
  return {
    error: filterQuery.error,
    isError: filterQuery.isError,
    isLoading: filterQuery.isLoading,
    photos: filterQuery.data?.data ?? [],
  }
}

interface GalleryTile {
  aspect: string
  hash?: string
  id: string
  photo?: AfilmoryManifestPhoto
  ratio: number
}

function tilesFromSource(
  source: AfilmorySource,
  photos: AfilmoryManifestPhoto[],
  limit: number | undefined,
): GalleryTile[] {
  if (source.kind === 'list') {
    const cap = limit ?? DEFAULT_LIMIT_LIST
    const items = source.items.slice(0, cap)
    const photoById = new Map(photos.map((p) => [p.id, p] as const))
    return items.map((item) => ({
      id: item.id,
      aspect: aspectFromDims(item.w, item.h),
      hash: item.hash,
      photo: photoById.get(item.id),
      ratio: ratioFromDims(item.w, item.h),
    }))
  }
  return photos.map((p) => ({
    id: p.id,
    aspect: getDisplayAspect(p),
    hash: p.thumbHash,
    photo: p,
    ratio: ratioFromDims(p.width, p.height),
  }))
}

function summarizeSource(source: AfilmorySource, total: number): string {
  const count = `${total} ${total === 1 ? 'photo' : 'photos'}`
  if (source.kind === 'list') return count
  const f = source.filter
  const parts: string[] = []
  if (f.tags?.length) {
    const sep = f.tagMode === 'intersection' ? ' ∧ ' : ', '
    parts.push(f.tags.map((t) => `#${t}`).join(sep))
  }
  if (f.cameras?.length) parts.push(`📷 ${f.cameras.join(', ')}`)
  if (f.lenses?.length) parts.push(`🔭 ${f.lenses.join(', ')}`)
  if (f.dateFrom || f.dateTo) {
    parts.push(`${f.dateFrom ?? '∞'} → ${f.dateTo ?? '∞'}`)
  }
  if (f.search) parts.push(`"${f.search}"`)
  const filterSummary = parts.join(' · ')
  return filterSummary ? `${count} · ${filterSummary}` : count
}

function frameStyle(
  accent: string | undefined,
): React.CSSProperties | undefined {
  return accent
    ? ({ '--afilmory-accent': accent } as React.CSSProperties)
    : undefined
}

const frameOuterClass = clsx(
  'not-prose mx-auto my-8 font-sans',
  'bg-neutral-1 ring-1 ring-border dark:bg-neutral-2',
)

const headerClass = clsx(
  'flex items-center justify-between gap-4 px-4 py-3',
  'border-b border-border bg-paper',
)

function CollectionHeader({
  source,
  title,
  total,
  viewAllHref,
}: {
  source: AfilmorySource
  title: string | undefined
  total: number
  viewAllHref: string
}) {
  const summary = summarizeSource(source, total)
  return (
    <header className={headerClass}>
      <div className="min-w-0 flex-1">
        {title ? (
          <div className="truncate text-sm leading-tight font-semibold text-neutral-9">
            {title}
          </div>
        ) : null}
        <div className="mt-0.5 truncate font-mono text-[10px] leading-tight text-neutral-6">
          {summary}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.12em] text-neutral-6">
          <AfilmoryGlyph className="size-[11px]" />
          AFILMORY
        </span>
        <span aria-hidden className="h-3 w-px bg-neutral-4" />
        <a
          className="font-mono text-[10px] tracking-[0.12em] text-neutral-7 uppercase transition-colors hover:text-(--afilmory-accent,--color-accent)"
          href={viewAllHref}
          rel="noopener noreferrer"
          target="_blank"
        >
          View All ↗
        </a>
      </div>
    </header>
  )
}

// 'grid' used to return a multi-column flow too, differing from masonry only
// by 2px of gutter — the editor's two options rendered the same thing. Grid is
// now an actual grid of equal square cells; masonry keeps the ragged flow.
function collectionBodyClassFor(layout: AfilmoryLayout): string {
  if (layout === 'masonry') {
    return 'columns-2 gap-1 sm:columns-3 md:columns-4'
  }
  return 'grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4'
}

function PhotoTile({
  accent,
  baseUrl,
  onOpen,
  tile,
  variant,
}: {
  accent?: string
  baseUrl: string
  onOpen: (tile: GalleryTile, event: React.MouseEvent) => void
  tile: GalleryTile
  variant: 'grid' | 'masonry'
}) {
  const { photo } = tile
  const thumb = photo ? resolveAssetUrl(baseUrl, photo.thumbnailUrl) : undefined
  const href = buildPhotoDetailHref(baseUrl, tile.id)

  return (
    <a
      href={href}
      rel="noopener noreferrer"
      style={variant === 'masonry' ? { aspectRatio: tile.aspect } : undefined}
      target="_blank"
      className={clsx(
        'group/tile relative block overflow-hidden bg-neutral-2 no-underline',
        variant === 'masonry'
          ? 'mb-1 break-inside-avoid'
          : 'aspect-square',
      )}
      onClick={(event) => onOpen(tile, event)}
    >
      {tile.hash ? (
        <ImagePlaceholder
          accent={accent}
          className="absolute inset-0 size-full object-cover"
          thumbhash={tile.hash}
        />
      ) : null}
      {thumb ? (
        <img
          alt={photo?.title ?? tile.id}
          className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover/tile:scale-[1.04]"
          decoding="async"
          draggable={false}
          loading="lazy"
          src={thumb}
          style={{ borderRadius: 0 }}
        />
      ) : null}
      <div
        className={clsx(
          'absolute inset-0 flex items-end p-2',
          'bg-gradient-to-t from-black/55 via-transparent to-transparent',
          'opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100',
        )}
      >
        <span className="font-mono text-[10px] tracking-[0.06em] text-white/90">
          {tile.id}
        </span>
      </div>
    </a>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Stacked deck view (layout === 'carousel')
// ────────────────────────────────────────────────────────────────────────────

// Top card plus three behind it. A fifth card would only add visual noise, so
// everything deeper shares the last slot's transform and sits fully hidden.
const DECK_VISIBLE_CARDS = 4
const DECK_SWIPE_THRESHOLD = 40

// A square card is the one shape that treats 3:2 and 2:3 identically — a photo
// inscribed either way covers exactly the same area — so a deck of mixed
// orientations needs no cropping and still keeps one silhouette. The paper
// showing around the photo is the mount, not wasted space.
const DECK_CARD_RATIO = 1

// Placement and tilt are kept apart because they ride different elements and
// different clocks: paper lands flat a moment after it lands in place, and a
// card whose slide and rotation stop on the same frame reads as plastic.
interface DeckPlacement {
  rotate: number
  scale: number
  x: string
  y: string
}

// Offsets alternate sides so the stack reads as letters dropped on a desk
// rather than a machine-squared deck of playing cards.
const DECK_DEPTHS: DeckPlacement[] = [
  { rotate: 0, scale: 1, x: '0px', y: '0px' },
  { rotate: 1.5, scale: 0.972, x: '-7px', y: '9px' },
  { rotate: -1.7, scale: 0.945, x: '6px', y: '18px' },
  { rotate: 0.9, scale: 0.92, x: '-4px', y: '26px' },
]

// The waypoint the travelling card passes through: lifted off the stack and
// swung out to the left. Forward runs depth-0 → aside → back; backward runs
// the same path in reverse, so the two directions mirror each other exactly.
const DECK_ASIDE: DeckPlacement = {
  rotate: -6,
  scale: 1.02,
  x: '-20%',
  y: '-9%',
}

// Uniform scale commutes with rotate, so splitting the single
// `translate rotate scale` across two nested elements lands in the same place.
function placementTransform(placement: DeckPlacement): string {
  return `translate(${placement.x}, ${placement.y}) scale(${placement.scale})`
}

function tiltTransform(placement: DeckPlacement): string {
  return `rotate(${placement.rotate}deg)`
}

// The lift used to run 150ms on a front-loaded curve, which spent ~70% of the
// travel in the first three frames and read as a jump rather than a glide.
const DECK_LIFT_MS = 240
// The drop had the same problem: a front-loaded curve over 200ms snapped into
// the slot. Paper eases in, gathers speed, then gets caught by the air.
const DECK_SETTLE_MS = 340
// How long after the card lands in place its tilt keeps settling.
const DECK_TILT_LAG_MS = 90
const DECK_LIFT_EASE = 'cubic-bezier(0.33, 0, 0.2, 1)'
const DECK_SETTLE_EASE = 'cubic-bezier(0.37, 0.01, 0.18, 1)'
const DECK_TILT_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'

interface DeckAnimation {
  dir: -1 | 1
  phase: 'lift' | 'settle'
}

function depthPlacement(depth: number): DeckPlacement {
  return DECK_DEPTHS[Math.min(depth, DECK_DEPTHS.length - 1)]!
}

function wrapIndex(value: number, total: number): number {
  if (total <= 0) return 0
  return ((value % total) + total) % total
}

// Which tile sits in which slot. The neighbours on either side are parked at
// the deepest slot — already mounted, fully hidden — so a turn never has to
// mount a card mid-flight and lose its starting transform.
function deckLayout(
  index: number,
  total: number,
  slots: number,
): Map<number, number> {
  const layout = new Map<number, number>()
  for (let depth = 0; depth < slots; depth++) {
    const tileIndex = wrapIndex(index + depth, total)
    if (!layout.has(tileIndex)) layout.set(tileIndex, depth)
  }
  for (const parked of [wrapIndex(index - 1, total), wrapIndex(index + slots, total)]) {
    if (!layout.has(parked)) layout.set(parked, slots)
  }
  return layout
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

// The server never knows the reader's preference, so it renders the animated
// branch and the client corrects on hydration — same shape either way, only
// the turn's motion differs.
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    () => false,
  )
}

function padCount(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function DeckChevron({ direction }: { direction: 'next' | 'prev' }) {
  return (
    <svg
      aria-hidden
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d={direction === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  )
}

const deckControlClass = clsx(
  'inline-flex size-8 items-center justify-center rounded-full',
  'border border-border bg-paper text-neutral-7',
  'transition-[opacity,color,border-color] duration-200',
  'hover:border-accent/40 hover:text-(--afilmory-accent,--color-accent)',
)

// Desktop keeps the arrows clear of the photo edge so they read as controls
// rather than decoration; a phone has no room beside a full-bleed column, so
// there they move down into the caption row instead.
function DeckSideArrow({
  direction,
  onActivate,
}: {
  direction: 'next' | 'prev'
  onActivate: () => void
}) {
  return (
    <button
      aria-label={direction === 'prev' ? '上一张' : '下一张'}
      type="button"
      className={clsx(
        deckControlClass,
        'absolute top-1/2 z-30 hidden -translate-y-1/2 sm:inline-flex',
        'opacity-0 group-hover/deck:opacity-100 group-focus-within/deck:opacity-100',
        direction === 'prev' ? 'sm:-left-11' : 'sm:-right-11',
      )}
      onClick={onActivate}
    >
      <DeckChevron direction={direction} />
    </button>
  )
}

function DeckInlineArrow({
  direction,
  onActivate,
}: {
  direction: 'next' | 'prev'
  onActivate: () => void
}) {
  return (
    <button
      aria-label={direction === 'prev' ? '上一张' : '下一张'}
      className={clsx(deckControlClass, 'size-7 sm:hidden')}
      type="button"
      onClick={onActivate}
    >
      <DeckChevron direction={direction} />
    </button>
  )
}

function DeckCard({
  accent,
  baseUrl,
  inner,
  isTop,
  onNavigate,
  outer,
  tile,
}: {
  accent?: string
  baseUrl: string
  inner: React.CSSProperties
  isTop: boolean
  onNavigate: (event: React.MouseEvent) => void
  outer: React.CSSProperties
  tile: GalleryTile
}) {
  const { photo } = tile
  const thumb = photo ? resolveAssetUrl(baseUrl, photo.thumbnailUrl) : undefined
  // Outer element slides and scales, inner one tilts. The paper itself — edge,
  // shadow, mount — belongs to the tilting layer so the whole sheet turns with
  // it rather than the photo rotating inside a static frame.
  const cardClass = clsx(
    'group/card absolute inset-0 block no-underline will-change-transform',
    !isTop && 'pointer-events-none',
  )
  const sheetClass = clsx(
    'size-full bg-paper p-2.5 sm:p-3',
    'ring-1 ring-border shadow-[0_4px_24px_rgba(0,0,0,0.05)]',
  )
  // The photo well takes the photo's own shape and is centred on the card, so
  // the mount's margins land wherever the orientation needs them and nothing
  // is ever cropped.
  const wellStyle: React.CSSProperties =
    tile.ratio >= 1
      ? { aspectRatio: tile.aspect, height: 'auto', width: '100%' }
      : { aspectRatio: tile.aspect, height: '100%', width: 'auto' }

  const body = (
    <div className="flex size-full items-center justify-center">
      <div
        className="relative overflow-hidden bg-neutral-2"
        style={wellStyle}
      >
        {tile.hash ? (
          <ImagePlaceholder
            accent={accent}
            className="absolute inset-0 size-full object-cover"
            thumbhash={tile.hash}
          />
        ) : null}
        {thumb ? (
          <img
            alt={photo?.title ?? tile.id}
            className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover/card:scale-[1.04]"
            decoding="async"
            draggable={false}
            loading="lazy"
            src={thumb}
            // Inline sizes on purpose: the preflight `img { height: auto }`
            // wins over `size-full` in article context, which drops the photo
            // to its natural height and pins it to the top of the well.
            style={{ borderRadius: 0, height: '100%', width: '100%' }}
          />
        ) : null}
        {isTop ? (
          <div
            className={clsx(
              'pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3',
              'bg-gradient-to-t from-black/55 to-transparent',
              'opacity-0 transition-opacity duration-200 group-hover/card:opacity-100',
            )}
          >
            <span className="truncate font-mono text-[10px] tracking-[0.06em] text-white/90">
              {photo?.title ?? tile.id}
            </span>
            <span className="shrink-0 font-mono text-[9px] tracking-[0.12em] text-white/85">
              View ↗
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )

  // Always an anchor, even when buried. Swapping the element type as a card
  // leaves the top slot makes React drop and recreate the node, and a
  // recreated node cannot continue the transition it was in the middle of —
  // that is the other half of why the lift used to snap. Cards behind are
  // inert instead: no pointer events, no tab stop, hidden from the a11y tree.
  const buried = !isTop
  return (
    <a
      aria-hidden={buried || undefined}
      className={cardClass}
      data-photo-id={tile.id}
      href={buildPhotoDetailHref(baseUrl, tile.id)}
      rel="noopener noreferrer"
      style={outer}
      tabIndex={buried ? -1 : undefined}
      target="_blank"
      onClick={onNavigate}
    >
      <div className={sheetClass} style={inner}>
        {body}
      </div>
    </a>
  )
}

function DeckFooter({
  caption,
  index,
  onNext,
  onPrev,
  showArrows,
  total,
  viewAllHref,
}: {
  caption: string | null
  index: number
  onNext: () => void
  onPrev: () => void
  showArrows: boolean
  total: number
  viewAllHref: string
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 font-mono text-[10px] text-neutral-6">
      <span className="min-w-0 truncate">{caption}</span>
      <span className="flex shrink-0 items-center gap-2 sm:gap-3">
        {showArrows ? (
          <DeckInlineArrow direction="prev" onActivate={onPrev} />
        ) : null}
        <span aria-live="polite">
          {padCount(index + 1)} / {padCount(total)}
        </span>
        {showArrows ? (
          <DeckInlineArrow direction="next" onActivate={onNext} />
        ) : null}
        <span aria-hidden className="h-3 w-px bg-neutral-4" />
        <a
          className="inline-flex items-center gap-1 tracking-[0.12em] text-neutral-7 uppercase no-underline transition-colors hover:text-(--afilmory-accent,--color-accent)"
          href={viewAllHref}
          rel="noopener noreferrer"
          target="_blank"
        >
          <AfilmoryGlyph className="size-[11px]" />
          All ↗
        </a>
      </span>
    </div>
  )
}

function AfilmoryStackView({
  accent,
  baseUrl,
  caption,
  tiles,
  title,
  viewAllHref,
}: {
  accent?: string
  baseUrl: string
  caption?: string
  tiles: GalleryTile[]
  title?: string
  viewAllHref: string
}) {
  const [index, setIndex] = useState(0)
  const [animation, setAnimation] = useState<DeckAnimation | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  // A swipe ends in a click on the top card's anchor; this suppresses that
  // navigation so dragging through the deck never opens the gallery.
  const swipedRef = useRef(false)
  const pointerStartRef = useRef<number | null>(null)
  const reducedMotion = usePrefersReducedMotion()

  const total = tiles.length
  const slots = Math.min(DECK_VISIBLE_CARDS, total)
  const canTurn = total > 1

  const go = useCallback(
    (dir: -1 | 1) => {
      if (!canTurn) return
      // One turn at a time: interrupting mid-flight would strand the
      // travelling card between two slots.
      if (animation) return
      if (reducedMotion) {
        setIndex((prev) => wrapIndex(prev + dir, total))
        return
      }
      setAnimation({ dir, phase: 'lift' })
    },
    [animation, canTurn, reducedMotion, total],
  )

  useEffect(() => {
    if (!animation) return
    if (animation.phase === 'lift') {
      const timer = setTimeout(
        () => setAnimation({ dir: animation.dir, phase: 'settle' }),
        DECK_LIFT_MS,
      )
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      setIndex((prev) => wrapIndex(prev + animation.dir, total))
      setAnimation(null)
    }, DECK_SETTLE_MS + DECK_TILT_LAG_MS)
    return () => clearTimeout(timer)
  }, [animation, total])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        go(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        go(1)
      }
    },
    [go],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointerStartRef.current = event.clientX
      swipedRef.current = false
    },
    [],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = pointerStartRef.current
      pointerStartRef.current = null
      if (start === null) return
      const dx = event.clientX - start
      if (Math.abs(dx) < DECK_SWIPE_THRESHOLD) return
      swipedRef.current = true
      go(dx < 0 ? 1 : -1)
    },
    [go],
  )

  const handleNavigate = useCallback(
    (event: React.MouseEvent) => {
      if (swipedRef.current) {
        swipedRef.current = false
        event.preventDefault()
        return
      }
      // A modified click is a deliberate "open the gallery elsewhere"; leave
      // the anchor alone so the browser handles it as any other link.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }
      // Until the photo's metadata has arrived there is nothing to show in the
      // caption panel, so the anchor stays a plain link to the gallery.
      if (!tiles[index]?.photo) return
      event.preventDefault()
      setLightboxIndex(index)
    },
    [index, tiles],
  )

  const closeLightbox = useCallback(() => {
    // Leave the deck showing whatever the reader ended on.
    setLightboxIndex((prev) => {
      if (prev !== null) setIndex(prev)
      return null
    })
  }, [])

  // While a turn is running every card is already laid out at its destination;
  // committing the index afterwards reproduces exactly the same positions, so
  // the deck never jumps at the hand-off.
  const targetIndex = animation ? wrapIndex(index + animation.dir, total) : index
  const layout = useMemo(
    () => deckLayout(targetIndex, total, slots),
    [slots, targetIndex, total],
  )
  const travellerIndex = animation
    ? animation.dir === 1
      ? index
      : wrapIndex(index - 1, total)
    : -1

  // Ordered by photo, never by depth. Moving a DOM node resets whatever
  // transition it is running, and a depth-ordered list reshuffles the moment a
  // turn starts — which silently swallowed the whole lift leg and made the top
  // card snap aside instead of gliding. Stacking comes from zIndex alone, so
  // this order only has to stay stable: across a turn the window shifts by one
  // photo, which adds and drops an entry at the ends without moving the rest.
  const cards = [...layout.entries()]
    .map(([tileIndex, depth]) => ({ depth, tile: tiles[tileIndex]!, tileIndex }))
    .sort((a, b) => a.tileIndex - b.tileIndex)

  const styleFor = (
    tileIndex: number,
    depth: number,
  ): { inner: React.CSSProperties, outer: React.CSSProperties } => {
    if (tileIndex !== travellerIndex || !animation) {
      const resting = depthPlacement(depth)
      const duration = DECK_LIFT_MS + DECK_SETTLE_MS
      return {
        inner: {
          transform: tiltTransform(resting),
          transition: `transform ${duration + DECK_TILT_LAG_MS}ms ${DECK_TILT_EASE}`,
        },
        outer: {
          transform: placementTransform(resting),
          transition: `transform ${duration}ms ${DECK_SETTLE_EASE}`,
          zIndex: DECK_VISIBLE_CARDS + 1 - depth,
        },
      }
    }
    // The traveller rides above the stack on the leg that touches the top slot
    // and slips underneath on the leg that touches the back — which is why
    // forward and backward read as the same motion played either way.
    const nearTop = animation.dir === 1 ? animation.phase === 'lift' : animation.phase === 'settle'
    const lifting = animation.phase === 'lift'
    const target = lifting ? DECK_ASIDE : depthPlacement(depth)
    // Only the drop lets the tilt trail the slide; on the way up the corner
    // and the card leave the stack together.
    const tiltMs = lifting ? DECK_LIFT_MS : DECK_SETTLE_MS + DECK_TILT_LAG_MS
    return {
      inner: {
        transform: tiltTransform(target),
        transition: `transform ${tiltMs}ms ${lifting ? DECK_LIFT_EASE : DECK_TILT_EASE}`,
      },
      outer: {
        transform: placementTransform(target),
        transition: lifting
          ? `transform ${DECK_LIFT_MS}ms ${DECK_LIFT_EASE}`
          : `transform ${DECK_SETTLE_MS}ms ${DECK_SETTLE_EASE}`,
        zIndex: nearTop ? DECK_VISIBLE_CARDS + 2 : 0,
      },
    }
  }

  const lightboxTile = lightboxIndex === null ? undefined : tiles[lightboxIndex]
  const current = tiles[index]
  const footerCaption = current
    ? (caption ??
      current.photo?.title ??
      formatCameraLine(current.photo?.exif) ??
      current.id)
    : (caption ?? null)

  return (
    <figure
      className="not-prose mx-auto my-8 w-full max-w-[480px] font-sans"
      style={frameStyle(accent)}
    >
      {title ? (
        <figcaption className="mb-3 text-sm leading-tight font-medium text-neutral-9">
          {title}
        </figcaption>
      ) : null}
      <div
        aria-roledescription="carousel"
        className="group/deck relative pb-8"
        role="group"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <div className="relative w-full" style={{ aspectRatio: DECK_CARD_RATIO }}>
          {cards.map(({ depth, tile, tileIndex }) => (
            <DeckCard
              accent={accent}
              baseUrl={baseUrl}
              isTop={depth === 0}
              key={tile.id}
              tile={tile}
              onNavigate={handleNavigate}
              {...styleFor(tileIndex, depth)}
            />
          ))}
        </div>
        {canTurn ? (
          <>
            <DeckSideArrow direction="prev" onActivate={() => go(-1)} />
            <DeckSideArrow direction="next" onActivate={() => go(1)} />
          </>
        ) : null}
      </div>
      <DeckFooter
        caption={footerCaption}
        index={index}
        showArrows={canTurn}
        total={total}
        viewAllHref={viewAllHref}
        onNext={() => go(1)}
        onPrev={() => go(-1)}
      />
      {lightboxTile?.photo ? (
        // Turning photos stays the deck's job; the lightbox is only ever about
        // the one photo the reader wanted a closer look at.
        <AfilmoryLightbox
          detailHref={buildPhotoDetailHref(baseUrl, lightboxTile.id)}
          key={lightboxTile.id}
          photo={lightboxTile.photo}
          thumbnailSrc={resolveAssetUrl(baseUrl, lightboxTile.photo.thumbnailUrl)}
          onClose={closeLightbox}
        />
      ) : null}
    </figure>
  )
}

function DeckSkeleton({ accent }: { accent?: string }) {
  return (
    <figure
      className="not-prose mx-auto my-8 w-full max-w-[480px] font-sans"
      style={frameStyle(accent)}
    >
      <div className="relative pb-8">
        <div className="relative w-full" style={{ aspectRatio: DECK_CARD_RATIO }}>
          {DECK_DEPTHS.map((placement, depth) => (
            <div
              className="absolute inset-0 animate-pulse bg-neutral-3 ring-1 ring-border"
              key={placement.y}
              style={{
                transform: `${placementTransform(placement)} ${tiltTransform(placement)}`,
                zIndex: DECK_VISIBLE_CARDS - depth,
              }}
            />
          ))}
        </div>
      </div>
    </figure>
  )
}

function PhotoCollectionBody({
  accent,
  baseUrl,
  layout,
  onOpen,
  tiles,
}: {
  accent?: string
  baseUrl: string
  layout: AfilmoryLayout
  onOpen: (tile: GalleryTile, event: React.MouseEvent) => void
  tiles: GalleryTile[]
}) {
  const variant = layout === 'masonry' ? 'masonry' : 'grid'
  return (
    <div className={clsx('p-2', collectionBodyClassFor(layout))}>
      {tiles.map((tile) => (
        <PhotoTile
          accent={accent}
          baseUrl={baseUrl}
          key={tile.id}
          tile={tile}
          variant={variant}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

function StateBlock({ message }: { message: string }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center px-6 py-8 text-center font-mono text-[12px] text-neutral-7">
      {message}
    </div>
  )
}

const SKELETON_HEIGHTS = [
  'h-[180px]',
  'h-[240px]',
  'h-[200px]',
  'h-[280px]',
  'h-[160px]',
  'h-[220px]',
]

function SkeletonGrid({
  layout,
  limit,
}: {
  layout: AfilmoryLayout
  limit: number
}) {
  const slots = Array.from({ length: limit }, (_, i) => ({
    height: SKELETON_HEIGHTS[i % SKELETON_HEIGHTS.length]!,
    key: `skel-${i}`,
  }))
  if (layout !== 'masonry') {
    return (
      <div className={clsx('p-2', collectionBodyClassFor(layout))}>
        {slots.map((s) => (
          <div
            className="aspect-square w-full animate-pulse bg-neutral-3"
            key={s.key}
          />
        ))}
      </div>
    )
  }
  return (
    <div className={clsx('p-2', collectionBodyClassFor(layout))}>
      {slots.map((s) => (
        <div
          key={s.key}
          className={clsx(
            'mb-1 w-full animate-pulse bg-neutral-3 break-inside-avoid',
            s.height,
          )}
        />
      ))}
    </div>
  )
}

function AfilmoryGalleryView({
  accent,
  baseUrl,
  caption,
  layout = 'grid',
  limit,
  source,
  title,
}: AfilmorySlotProps) {
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const { error, isError, isLoading, photos } = useCollectionPhotos(
    baseUrl,
    source,
    limit,
  )

  const tiles = useMemo(
    () => tilesFromSource(source, photos, limit),
    [source, photos, limit],
  )

  const viewAllHref =
    source.kind === 'filter'
      ? buildFilterHref(baseUrl, source.filter)
      : `${baseUrl.replace(/\/$/, '')}/`

  // Same bargain every afilmory surface makes: a plain click opens the photo
  // where the reader already is, a modified click still goes to the gallery,
  // and an unresolved photo falls back to following the link.
  const handleOpen = (tile: GalleryTile, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (!tile.photo) return
    event.preventDefault()
    setLightboxId(tile.id)
  }

  // The deck is deliberately unframed: a header bar plus a ring around a
  // tilted stack of prints fights the stack's own edges. Its footer carries
  // the counter and the "view all" link the frame used to hold.
  if (layout === 'carousel') {
    if (tiles.length > 0) {
      return (
        <AfilmoryStackView
          accent={accent}
          baseUrl={baseUrl}
          caption={caption}
          tiles={tiles}
          title={title}
          viewAllHref={viewAllHref}
        />
      )
    }
    if (isLoading) {
      return <DeckSkeleton accent={accent} />
    }
    return (
      <figure
        className="not-prose mx-auto my-8 w-full max-w-[480px] font-sans"
        style={frameStyle(accent)}
      >
        <div className="ring-1 ring-border">
          <StateBlock
            message={
              isError
                ? error instanceof Error
                  ? error.message
                  : 'Photos fetch failed'
                : 'No photos matched'
            }
          />
        </div>
      </figure>
    )
  }

  if (tiles.length === 0 && isLoading) {
    return (
      <figure className={frameOuterClass} style={frameStyle(accent)}>
        <CollectionHeader
          source={source}
          title={title}
          total={limit ?? 8}
          viewAllHref={viewAllHref}
        />
        <SkeletonGrid layout={layout} limit={limit ?? 8} />
        {caption ? (
          <figcaption className="px-5 pt-1 pb-3 text-sm text-neutral-7">
            {caption}
          </figcaption>
        ) : null}
      </figure>
    )
  }

  if (tiles.length === 0 && isError) {
    return (
      <figure className={frameOuterClass} style={frameStyle(accent)}>
        <CollectionHeader
          source={source}
          title={title}
          total={0}
          viewAllHref={viewAllHref}
        />
        <StateBlock
          message={
            error instanceof Error ? error.message : 'Photos fetch failed'
          }
        />
      </figure>
    )
  }

  if (tiles.length === 0) {
    return (
      <figure className={frameOuterClass} style={frameStyle(accent)}>
        <CollectionHeader
          source={source}
          title={title}
          total={0}
          viewAllHref={viewAllHref}
        />
        <StateBlock message="No photos matched" />
      </figure>
    )
  }

  const lightboxPhoto =
    lightboxId === null
      ? undefined
      : tiles.find((tile) => tile.id === lightboxId)?.photo

  return (
    <figure className={frameOuterClass} style={frameStyle(accent)}>
      <CollectionHeader
        source={source}
        title={title}
        total={tiles.length}
        viewAllHref={viewAllHref}
      />
      <PhotoCollectionBody
        accent={accent}
        baseUrl={baseUrl}
        layout={layout}
        tiles={tiles}
        onOpen={handleOpen}
      />
      {caption ? (
        <figcaption className="px-5 pt-2 pb-3 text-sm text-neutral-7">
          {caption}
        </figcaption>
      ) : null}
      {/* A sibling of the tiles, never a child of one: React bubbles synthetic
          events through the component tree, so a portal nested inside a tile's
          anchor would route the lightbox's own clicks back into that link. */}
      {lightboxPhoto ? (
        <AfilmoryLightbox
          detailHref={buildPhotoDetailHref(baseUrl, lightboxPhoto.id)}
          key={lightboxPhoto.id}
          photo={lightboxPhoto}
          thumbnailSrc={resolveAssetUrl(baseUrl, lightboxPhoto.thumbnailUrl)}
          onClose={() => setLightboxId(null)}
        />
      ) : null}
    </figure>
  )
}
