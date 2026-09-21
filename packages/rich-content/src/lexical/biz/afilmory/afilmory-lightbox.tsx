'use client'

import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { formatCameraLine, formatShutter } from './_shared'
import type { AfilmoryManifestPhoto } from './use-afilmory-manifest'

interface ExifStat {
  label: string
  value: string
}

// Four readings, in the order a photographer reads them off a camera back.
function buildStats(photo: AfilmoryManifestPhoto): ExifStat[] {
  const exif = photo.exif
  const focal = exif?.FocalLengthIn35mmFormat ?? exif?.FocalLength
  const shutter = formatShutter(exif?.ExposureTime)
  const stats: ExifStat[] = []
  if (typeof exif?.FNumber === 'number') {
    stats.push({ label: 'Aperture', value: `f/${exif.FNumber}` })
  }
  if (shutter) stats.push({ label: 'Shutter', value: shutter })
  if (typeof exif?.ISO === 'number') {
    stats.push({ label: 'ISO', value: String(exif.ISO) })
  }
  if (focal) {
    stats.push({ label: 'Focal', value: focal.replace(/\s*mm$/i, 'mm') })
  }
  return stats
}

// ────────────────────────────────────────────────────────────────────────────
// Loading the original with an honest percentage
// ────────────────────────────────────────────────────────────────────────────

type OriginalState =
  | { kind: 'direct' }
  | { kind: 'measured', percent: number }
  | { kind: 'ready', src: string }
  | { kind: 'unmeasured' }

// A plain <img> cannot report progress, so the bytes are streamed instead and
// handed to the image as a blob. Anything that makes the count untrustworthy —
// no Content-Length, a blocked cross-origin read, a failed request — falls
// back to letting <img> load the URL directly behind a spinner, rather than
// animating a number that means nothing.
function useOriginalImage(url: string): OriginalState {
  const [state, setState] = useState<OriginalState>({ kind: 'unmeasured' })

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    const run = async () => {
      try {
        const response = await fetch(url)
        if (!response.ok || !response.body) throw new Error('unreadable')
        const total = Number(response.headers.get('content-length') ?? 0)
        if (!Number.isFinite(total) || total <= 0) throw new Error('unsized')

        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let received = 0

        for (;;) {
          const { done, value } = await reader.read()
          if (cancelled) {
            await reader.cancel()
            return
          }
          if (done) break
          if (!value) continue
          chunks.push(value)
          received += value.length
          // Held at 99 until the image itself reports it has decoded, so the
          // counter never claims to be finished before the photo is on screen.
          setState({
            kind: 'measured',
            percent: Math.min(99, Math.floor((received / total) * 100)),
          })
        }

        const blob = new Blob(chunks as BlobPart[], {
          type: response.headers.get('content-type') ?? 'image/jpeg',
        })
        objectUrl = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
          objectUrl = null
          return
        }
        setState({ kind: 'ready', src: objectUrl })
      } catch {
        if (!cancelled) setState({ kind: 'direct' })
      }
    }

    void run()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  return state
}

// ────────────────────────────────────────────────────────────────────────────
// Zoom and pan
// ────────────────────────────────────────────────────────────────────────────

const ZOOM_MIN = 1
const ZOOM_MAX = 8
const ZOOM_DOUBLE_TAP = 2.5

interface ZoomState {
  scale: number
  x: number
  y: number
}

const ZOOM_RESET: ZoomState = { scale: 1, x: 0, y: 0 }

// Offsets are clamped so the scaled layer always covers the frame — the photo
// can never be dragged off into empty paper.
function clampZoom(state: ZoomState, width: number, height: number): ZoomState {
  const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.scale))
  if (scale <= 1 || width === 0 || height === 0) return ZOOM_RESET
  return {
    scale,
    x: Math.min(0, Math.max(width - width * scale, state.x)),
    y: Math.min(0, Math.max(height - height * scale, state.y)),
  }
}

// Keeps whatever sits under the cursor pinned there while the scale changes.
function zoomAround(
  state: ZoomState,
  nextScale: number,
  pointerX: number,
  pointerY: number,
): ZoomState {
  const ratio = nextScale / state.scale
  return {
    scale: nextScale,
    x: pointerX - (pointerX - state.x) * ratio,
    y: pointerY - (pointerY - state.y) * ratio,
  }
}

function useZoom(frameRef: React.RefObject<HTMLDivElement | null>) {
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_RESET)
  const pointersRef = useRef(new Map<number, { x: number, y: number }>())
  const pinchRef = useRef<number | null>(null)

  const frameSize = useCallback(() => {
    const rect = frameRef.current?.getBoundingClientRect()
    return { height: rect?.height ?? 0, width: rect?.width ?? 0 }
  }, [frameRef])

  const applyZoom = useCallback(
    (next: ZoomState) => {
      const { height, width } = frameSize()
      setZoom(clampZoom(next, width, height))
    },
    [frameSize],
  )

  // React attaches wheel listeners passively at the root, so preventDefault
  // only works from a listener registered by hand.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = frame.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      // ctrlKey marks a trackpad pinch; a plain wheel zooms more gently.
      const intensity = event.ctrlKey ? 0.012 : 0.0022
      setZoom((prev) => {
        const nextScale = Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, prev.scale * Math.exp(-event.deltaY * intensity)),
        )
        return clampZoom(
          zoomAround(prev, nextScale, pointerX, pointerY),
          rect.width,
          rect.height,
        )
      })
    }

    frame.addEventListener('wheel', handleWheel, { passive: false })
    return () => frame.removeEventListener('wheel', handleWheel)
  }, [frameRef])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      })
    },
    [],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pointers = pointersRef.current
      const previous = pointers.get(event.pointerId)
      if (!previous) return
      const current = { x: event.clientX, y: event.clientY }
      pointers.set(event.pointerId, current)

      const points = [...pointers.values()]
      if (points.length >= 2) {
        const [first, second] = points as [
          { x: number, y: number },
          { x: number, y: number },
        ]
        const distance = Math.hypot(first.x - second.x, first.y - second.y)
        const last = pinchRef.current
        pinchRef.current = distance
        if (!last || distance === 0) return
        const rect = frameRef.current?.getBoundingClientRect()
        if (!rect) return
        const midX = (first.x + second.x) / 2 - rect.left
        const midY = (first.y + second.y) / 2 - rect.top
        setZoom((prev) =>
          clampZoom(
            zoomAround(
              prev,
              Math.min(
                ZOOM_MAX,
                Math.max(ZOOM_MIN, prev.scale * (distance / last)),
              ),
              midX,
              midY,
            ),
            rect.width,
            rect.height,
          ),
        )
        return
      }

      // A single pointer only pans once there is something to pan.
      setZoom((prev) => {
        if (prev.scale <= 1) return prev
        const { height, width } = frameSize()
        return clampZoom(
          {
            scale: prev.scale,
            x: prev.x + (current.x - previous.x),
            y: prev.y + (current.y - previous.y),
          },
          width,
          height,
        )
      })
    },
    [frameRef, frameSize],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(event.pointerId)
      if (pointersRef.current.size < 2) pinchRef.current = null
    },
    [],
  )

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const rect = frameRef.current?.getBoundingClientRect()
      if (!rect) return
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      setZoom((prev) =>
        prev.scale > 1
          ? ZOOM_RESET
          : clampZoom(
              zoomAround(prev, ZOOM_DOUBLE_TAP, pointerX, pointerY),
              rect.width,
              rect.height,
            ),
      )
    },
    [frameRef],
  )

  const reset = useCallback(() => setZoom(ZOOM_RESET), [])

  return {
    applyZoom,
    handleDoubleClick,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    reset,
    zoom,
  }
}

// ────────────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-3 animate-spin rounded-full border border-white/30 border-t-white/90"
    />
  )
}

export function AfilmoryLightbox({
  detailHref,
  onClose,
  photo,
  thumbnailSrc,
}: {
  detailHref: string
  onClose: () => void
  photo: AfilmoryManifestPhoto
  thumbnailSrc: string
}) {
  const [decoded, setDecoded] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const original = useOriginalImage(photo.originalUrl)
  const {
    handleDoubleClick,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    reset,
    zoom,
  } = useZoom(frameRef)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    const { body } = document
    const previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => {
      body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const handleDecoded = useCallback(() => setDecoded(true), [])

  const ratio = photo.height > 0 ? photo.width / photo.height : 1.5
  // Portrait keeps the caption beside the photo, landscape below it — the
  // margin of the square card, kept where the eye already expects it. A phone
  // has no room beside a full-width photo, so there it is always below.
  const besideOnDesktop = ratio < 1
  const stats = buildStats(photo)
  const cameraLine = formatCameraLine(photo.exif)

  // Width is driven by every limit at once — a width cap, the viewport, and
  // the height budget folded back through the aspect ratio — so the paper
  // hugs the photo exactly instead of letterboxing it.
  // Portrait is height-bound and landscape width-bound, so each is pushed
  // against the edges it can actually reach. The mount is only wide enough to
  // read as paper, not to frame the photo.
  const photoClass = besideOnDesktop
    ? 'w-[min(94vw,calc((72vh-60px)*var(--r)))] sm:w-[min(calc(95vw-250px),calc((94vh-20px)*var(--r)))]'
    : 'w-[min(94vw,calc((80vh-80px)*var(--r)))] sm:w-[min(95vw,1800px,calc((94vh-140px)*var(--r)))]'

  const originalSrc =
    original.kind === 'ready'
      ? original.src
      : original.kind === 'direct'
        ? photo.originalUrl
        : undefined

  const zoomed = zoom.scale > 1

  return createPortal(
    <div
      aria-modal
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 p-2 backdrop-blur-[2px] sm:p-3"
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
      onClick={onClose}
    >
      <button
        aria-label="关闭"
        className="absolute top-4 right-4 z-10 inline-flex size-9 items-center justify-center rounded-full border border-white/20 text-white/80 transition-colors hover:border-white/40 hover:text-white"
        type="button"
        onClick={onClose}
      >
        <svg
          aria-hidden
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <figure
        className={clsx(
          'not-prose m-0 flex max-h-full max-w-full flex-col gap-2 bg-paper p-1.5 font-sans sm:gap-3 sm:p-2',
          'ring-1 ring-border',
          besideOnDesktop && 'sm:flex-row',
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          ref={frameRef}
          className={clsx(
            'relative shrink-0 touch-none overflow-hidden bg-neutral-2',
            photoClass,
            zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
          )}
          style={
            {
              '--r': String(ratio),
              aspectRatio: `${photo.width} / ${photo.height}`,
            } as React.CSSProperties
          }
          onDoubleClick={handleDoubleClick}
          onPointerCancel={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* No will-change here on purpose: promoting this to its own
              compositing layer makes the browser rasterise it once at layout
              size and stretch that bitmap, so zooming shows enlarged pixels
              instead of the original's detail — most visibly on phones, whose
              compositors are the laziest about re-rastering. */}
          <div
            className="absolute inset-0 origin-top-left"
            style={{
              transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            }}
          >
            {/* The deck already painted this thumbnail, so it is on screen the
                instant the lightbox opens; the original fades over it. */}
            <img
              aria-hidden
              alt=""
              src={thumbnailSrc}
              style={{ borderRadius: 0, height: '100%', width: '100%' }}
              className={clsx(
                'absolute inset-0 size-full object-cover transition-opacity duration-300',
                decoded ? 'opacity-0' : 'opacity-100',
              )}
            />
            {originalSrc && (
              <img
                alt={photo.title ?? photo.id}
                decoding="async"
                draggable={false}
                src={originalSrc}
                style={{ borderRadius: 0, height: '100%', width: '100%' }}
                className={clsx(
                  'absolute inset-0 size-full object-cover transition-opacity duration-300',
                  decoded ? 'opacity-100' : 'opacity-0',
                )}
                onLoad={handleDecoded}
              />
            )}
          </div>

          {!decoded && (
            <span className="pointer-events-none absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 font-mono text-[10px] text-white/90 tabular-nums">
              {original.kind === 'measured' ? (
                <>加载中 {original.percent}%</>
              ) : (
                <>
                  <Spinner />
                  加载中
                </>
              )}
            </span>
          )}

          {zoomed && (
            <button
              className="absolute bottom-3 left-3 rounded-full bg-black/50 px-2.5 py-1 font-mono text-[10px] text-white/90 tabular-nums transition-colors hover:bg-black/70"
              type="button"
              onClick={reset}
            >
              {zoom.scale.toFixed(1)}× · 复位
            </button>
          )}
        </div>

        <aside
          className={clsx(
            'flex min-w-0 flex-col justify-between',
            besideOnDesktop ? 'sm:w-[240px] sm:shrink-0' : 'w-full',
          )}
        >
          {/* A phone has too little room to spend on readings nobody zoomed in
              for; there the panel is just the way through to the gallery. */}
          <div className="hidden min-w-0 sm:block">
            {photo.title && (
              <div className="truncate font-serif text-[13px] leading-tight font-medium text-neutral-10">
                {photo.title}
              </div>
            )}
            {cameraLine && (
              <div className="mt-0.5 font-mono text-[10px] leading-[1.6] text-neutral-7">
                {cameraLine}
              </div>
            )}
          </div>

          {stats.length > 0 && (
            <div
              className={clsx(
                'mt-2 hidden border-y-[0.5px] border-neutral-4 sm:grid',
                besideOnDesktop ? 'grid-cols-2' : 'grid-cols-4',
              )}
            >
              {stats.map((stat) => (
                <div
                  className="border-r-[0.5px] border-b-[0.5px] border-neutral-4 px-2.5 py-1.5 last:border-r-0"
                  key={stat.label}
                >
                  <p className="m-0 font-serif text-[15px] leading-none font-medium text-neutral-10 tabular-nums">
                    {stat.value}
                  </p>
                  <p className="m-0 mt-1 font-mono text-[8px] tracking-[0.08em] text-neutral-7 uppercase">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          )}

          <a
            className="group/cta mt-2 flex items-baseline gap-2 no-underline"
            href={detailHref}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="font-serif leading-none text-neutral-10 transition-colors group-hover/cta:text-(--afilmory-accent,--color-accent)">
              <span className="text-[24px]">V</span>
              <span className="text-[14px]">iew</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-7 underline decoration-neutral-4 underline-offset-4 transition-colors group-hover/cta:text-neutral-9 group-hover/cta:decoration-neutral-6">
              移步 Afilmory 相册查看更多信息
            </span>
            <svg
              aria-hidden
              className="size-3 shrink-0 self-center text-neutral-6 transition-transform group-hover/cta:-translate-y-px group-hover/cta:translate-x-px"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
            >
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>
        </aside>
      </figure>
    </div>,
    document.body,
  )
}
