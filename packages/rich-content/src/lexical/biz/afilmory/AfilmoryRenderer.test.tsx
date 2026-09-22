import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { type HostCapabilities, HostProvider } from '../../../host'
import { __resetResourceCache } from '../../../lib/use-resource'
import type { AfilmorySlotProps } from './afilmory-augment'
import { AfilmoryRenderer } from './AfilmoryRenderer'
import type { AfilmoryManifestPhoto } from './use-afilmory-manifest'

const BASE_URL = 'https://gallery.example.com'

function photo(id: string, width: number, height: number): AfilmoryManifestPhoto {
  return {
    exif: {
      ExposureTime: 0.004,
      FNumber: 2.8,
      FocalLength: '18.3 mm',
      ISO: 400,
      LensModel: '18.3mm',
      Make: 'RICOH IMAGING COMPANY, LTD.',
      Model: 'RICOH GR III',
    },
    height,
    id,
    originalUrl: `${BASE_URL}/original/${id}`,
    thumbnailUrl: `/thumbnails/${id}.webp`,
    title: `Photo ${id}`,
    width,
  }
}

const PHOTOS = [photo('a', 3000, 2000), photo('b', 2000, 3000), photo('c', 3000, 2000)]

function hostWithPhotos(): HostCapabilities {
  return {
    apiBase: 'https://example.com/api',
    // Mirrors the real API's two shapes: a single photo by id, an array for
    // the batch endpoint. Returning the array for both hid a crash in the
    // single-photo path.
    fetchJSON: async (url: string) => {
      const byId = /\/api\/manifest\/photos\/([^/?]+)$/.exec(url)
      if (byId) {
        return PHOTOS.find(
          (item) => item.id === decodeURIComponent(byId[1]!),
        ) as never
      }
      return PHOTOS as never
    },
    labels: {
      codeCopied: '',
      codeCopy: '',
      codeExpand: '',
      nestedDocCollapse: '',
      nestedDocExpand: '',
      nestedDocLabel: '',
    },
    nestedDocPresentation: 'inline',
    openImage: () => {},
    openLink: () => {},
    scrollToAnchor: () => {},
    theme: 'light',
    webOrigin: 'https://example.com',
  }
}

function deckProps(layout: AfilmorySlotProps['layout']): AfilmorySlotProps {
  return {
    baseUrl: BASE_URL,
    layout,
    source: {
      items: PHOTOS.map((p) => ({ h: p.height, id: p.id, w: p.width })),
      kind: 'list',
    },
  }
}

// Comfortably longer than a full turn, including the trailing tilt.
const TURN_MS = 700

let mountEl: HTMLDivElement
let root: Root

// A turn is two chained timers: the second is only scheduled once React has
// flushed the first one's state update, so one advance is never enough.
async function settleTurn() {
  await act(async () => {
    vi.advanceTimersByTime(TURN_MS)
  })
  await act(async () => {
    vi.advanceTimersByTime(TURN_MS)
  })
}

function cardById(id: string): HTMLElement {
  return mountEl.querySelector<HTMLElement>(`[data-photo-id="${id}"]`)!
}

// Every card is an anchor so its DOM node survives a turn; the readable one
// is the only card left in the a11y tree.
function topCard(): HTMLElement {
  return mountEl.querySelector<HTMLElement>(
    '[data-photo-id]:not([aria-hidden="true"])',
  )!
}

function topHref(): string {
  return topCard().getAttribute('href')!
}

function clickArrow(label: '上一张' | '下一张') {
  const buttons = mountEl.querySelectorAll<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )
  // The side arrow and the phone-row arrow are both mounted; CSS picks one.
  return act(async () => buttons[0]!.click())
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // The lightbox streams the original to report real progress; unstubbed it
  // would hit the network. Rejecting drives the documented fallback: hand the
  // URL straight to <img> and show a spinner instead of a fake percentage.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('offline'))),
  )
  __resetResourceCache()
  mountEl = document.createElement('div')
  document.body.append(mountEl)
  root = createRoot(mountEl)
})

afterEach(() => {
  act(() => root.unmount())
  mountEl.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function mountSingle() {
  await act(async () => {
    root.render(
      <HostProvider host={hostWithPhotos()}>
        <AfilmoryRenderer
          baseUrl={BASE_URL}
          source={{
            items: [{ h: PHOTOS[0]!.height, id: 'a', w: PHOTOS[0]!.width }],
            kind: 'list',
          }}
        />
      </HostProvider>,
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function mountDeck(layout: AfilmorySlotProps['layout'] = 'carousel') {
  await act(async () => {
    root.render(
      <HostProvider host={hostWithPhotos()}>
        <AfilmoryRenderer {...deckProps(layout)} />
      </HostProvider>,
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

it('paints the deck on the server pass without a skeleton flash', () => {
  const html = renderToStaticMarkup(
    <HostProvider host={hostWithPhotos()}>
      <AfilmoryRenderer {...deckProps('carousel')} />
    </HostProvider>,
  )
  // A list source carries w/h/hash on the node itself, so the stack has its
  // real shape before the photo fetch resolves — no skeleton, no reflow.
  expect(html).not.toContain('animate-pulse')
  expect(html).toContain('01 / 03')
  expect(html).toContain('/photos/a')
  // The horizontal scroller the deck replaced is gone for good.
  expect(html).not.toContain('overflow-x-auto')
})

it('falls back to the deck skeleton when a filter source has nothing yet', () => {
  const html = renderToStaticMarkup(
    <HostProvider host={hostWithPhotos()}>
      <AfilmoryRenderer
        baseUrl={BASE_URL}
        layout="carousel"
        source={{ filter: { tags: ['street'] }, kind: 'filter' }}
      />
    </HostProvider>,
  )
  expect(html).toContain('animate-pulse')
})

it('stacks the photos and advances to the next card', async () => {
  await mountDeck()

  expect(mountEl.textContent).toContain('01 / 03')
  // Exactly one card is reachable; the ones behind are inert but still
  // anchors, so their nodes survive a turn instead of being recreated.
  expect(
    mountEl.querySelectorAll('[data-photo-id]:not([aria-hidden="true"])'),
  ).toHaveLength(1)
  expect(
    [...mountEl.querySelectorAll<HTMLElement>('[data-photo-id][aria-hidden]')]
      .every((card) => card.tabIndex === -1),
  ).toBe(true)
  expect(topHref()).toContain('/photos/a')

  await clickArrow('下一张')
  await settleTurn()

  expect(mountEl.textContent).toContain('02 / 03')
  expect(topHref()).toContain('/photos/b')
})

it('wraps around in both directions', async () => {
  await mountDeck()

  // Backwards off the first card lands on the last one.
  await clickArrow('上一张')
  await settleTurn()
  expect(mountEl.textContent).toContain('03 / 03')
  expect(topHref()).toContain('/photos/c')

  await clickArrow('下一张')
  await settleTurn()
  expect(mountEl.textContent).toContain('01 / 03')
  expect(topHref()).toContain('/photos/a')
})

it('ignores a second turn while one is still in flight', async () => {
  await mountDeck()

  await clickArrow('下一张')
  // Mid-flight: the index has not been committed yet.
  await act(async () => {
    vi.advanceTimersByTime(80)
  })
  expect(mountEl.textContent).toContain('01 / 03')

  await clickArrow('下一张')
  await settleTurn()
  await settleTurn()

  // The second click was swallowed rather than queued — one turn, not two.
  expect(mountEl.textContent).toContain('02 / 03')
})

it('sends the travelling card over the stack, then under it', async () => {
  await mountDeck()

  await clickArrow('下一张')
  // Lift leg: the outgoing card rides above the whole stack, swung out left.
  const lifting = cardById('a')
  expect(Number(lifting.style.zIndex)).toBeGreaterThan(4)
  expect(lifting.style.transform).toContain('-20%')

  await act(async () => {
    vi.advanceTimersByTime(TURN_MS)
  })

  // Settle leg: it has slipped underneath everything on its way to the back.
  expect(Number(cardById('a').style.zIndex)).toBe(0)

  await settleTurn()
  // Committed: parked in the deepest slot, still under the new top card.
  expect(cardById('a').style.transform).toContain('18px')
  expect(Number(cardById('a').style.zIndex)).toBeLessThan(
    Number(cardById('b').style.zIndex),
  )
})

it('never reorders the cards in the DOM while turning', async () => {
  await mountDeck()

  const snapshot = () =>
    [...mountEl.querySelectorAll<HTMLElement>('[data-photo-id]')].map((el) => ({
      el,
      id: el.dataset.photoId!,
    }))

  const before = snapshot()

  await clickArrow('下一张')
  const during = snapshot()

  // Moving a node resets its running transition, which is what turned the
  // lift leg into a jump. Surviving cards must be the same nodes, in the same
  // relative order — stacking is zIndex's job, not the DOM's.
  const survivors = before.filter((card) => during.some((d) => d.el === card.el))
  expect(survivors.length).toBeGreaterThan(1)
  expect(during.filter((d) => survivors.some((s) => s.el === d.el))).toEqual(
    survivors,
  )

  // And the card being flown is one of those survivors, not a remount.
  expect(survivors.map((card) => card.id)).toContain('a')
})

it('mirrors the motion when turning backwards', async () => {
  await mountDeck()

  await clickArrow('上一张')
  // The incoming card starts underneath and slides out to the same side the
  // outgoing one leaves by — the forward path, played in reverse.
  const travelling = cardById('c')
  expect(Number(travelling.style.zIndex)).toBe(0)
  expect(travelling.style.transform).toContain('-20%')

  await settleTurn()
  expect(topHref()).toContain('/photos/c')
})

it('keeps the card square whatever the photo orientation is', async () => {
  await mountDeck()

  // 'a' is 3:2 and 'b' is 2:3; both mount in the same square card, which is
  // what keeps the stack coherent and the article from reflowing on a turn.
  const box = () =>
    mountEl.querySelector<HTMLElement>('[style*="aspect-ratio"]')!.style
      .aspectRatio

  const before = box()
  await clickArrow('下一张')
  await settleTurn()
  expect(box()).toBe(before)
})

it('gives each photo its own well so nothing is cropped', async () => {
  await mountDeck()

  const wellOf = (id: string) =>
    cardById(id).querySelector<HTMLElement>('[style*="aspect-ratio"]')!.style

  // Landscape spans the card's width, portrait spans its height — both keep
  // their true proportions and letterbox against the mount instead.
  expect(wellOf('a').width).toBe('100%')
  expect(wellOf('a').height).toBe('auto')
  expect(wellOf('b').height).toBe('100%')
  expect(wellOf('b').width).toBe('auto')
})

it('fills the well so a photo is not pinned to its top edge', async () => {
  await mountDeck()

  // The preflight `img { height: auto }` beats `size-full` in article context,
  // so the fill has to be inline or the photo collapses to its natural height.
  const img = mountEl.querySelector<HTMLImageElement>('img')!
  expect(img.style.height).toBe('100%')
  expect(img.style.width).toBe('100%')
})

async function openLightbox() {
  await act(async () => {
    topCard().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
  })
  // Let the original-image request settle so the <img> has its src.
  await act(async () => {
    await Promise.resolve()
  })
}

function lightbox(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]')
}

it('opens the photo in place instead of leaving for the gallery', async () => {
  await mountDeck()
  expect(lightbox()).toBeNull()

  await openLightbox()

  const dialog = lightbox()!
  expect(dialog).not.toBeNull()
  // The original, not the thumbnail, is what the reader came for.
  expect(
    [...dialog.querySelectorAll('img')].map((img) => img.getAttribute('src')),
  ).toContain(`${BASE_URL}/original/a`)
  // The gallery is still reachable, just demoted to an explicit link.
  expect(dialog.querySelector('a[href*="/photos/a"]')).not.toBeNull()
})

it('reads the four exif stats off the manifest', async () => {
  await mountDeck()
  await openLightbox()

  const text = lightbox()!.textContent!
  expect(text).toContain('f/2.8')
  expect(text).toContain('1/250s')
  expect(text).toContain('400')
  expect(text).toContain('18.3mm')
  expect(text).toContain('RICOH IMAGING COMPANY, LTD. RICOH GR III')
})

it('lets a modified click still open the gallery in a new tab', async () => {
  await mountDeck()

  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    metaKey: true,
  })
  await act(async () => topCard().dispatchEvent(event))

  expect(event.defaultPrevented).toBe(false)
  expect(lightbox()).toBeNull()
})

it('closes on Escape', async () => {
  await mountDeck()
  await openLightbox()

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })
  expect(lightbox()).toBeNull()
})

it('leaves turning photos to the deck rather than duplicating it', async () => {
  await mountDeck()
  await openLightbox()

  const dialog = lightbox()!
  expect(dialog.querySelector('button[aria-label="下一张"]')).toBeNull()
  expect(dialog.querySelector('button[aria-label="上一张"]')).toBeNull()

  // Arrow keys must not quietly swap the photo behind the reader's back.
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
  })
  expect(
    [...lightbox()!.querySelectorAll('img')].map((img) => img.getAttribute('src')),
  ).toContain(`${BASE_URL}/original/a`)
})

it('reports real download progress and never claims 100% early', async () => {
  // A response that hands over half the bytes, then the rest on demand.
  const chunk = new Uint8Array(50)
  let releaseSecond: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    releaseSecond = resolve
  })
  let reads = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      body: {
        getReader: () => ({
          cancel: async () => {},
          read: async () => {
            reads += 1
            if (reads === 1) return { done: false, value: chunk }
            await gate
            if (reads === 2) return { done: false, value: chunk }
            return { done: true, value: undefined }
          },
        }),
      },
      headers: new Headers({ 'content-length': '100', 'content-type': 'image/jpeg' }),
      ok: true,
    })),
  )
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:original',
    revokeObjectURL: () => {},
  })

  await mountDeck()
  await openLightbox()

  // Half the bytes in: a real 50%, and the photo is not on screen yet.
  expect(lightbox()!.textContent).toContain('加载中 50%')

  await act(async () => {
    releaseSecond?.()
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })

  // All bytes in, but the counter holds at 99 until the image itself decodes.
  const img = [...lightbox()!.querySelectorAll('img')].find(
    (node) => node.getAttribute('src') === 'blob:original',
  )!
  expect(img).toBeTruthy()
  expect(lightbox()!.textContent).not.toContain('100%')

  await act(async () => {
    img.dispatchEvent(new Event('load'))
  })
  expect(lightbox()!.textContent).not.toContain('加载中')
})

it('does not promote the zoom layer to its own compositing layer', async () => {
  await mountDeck()
  await openLightbox()

  // A promoted layer is rasterised once at layout size and then stretched, so
  // zooming would enlarge pixels rather than reveal the original's detail.
  const layer = lightbox()!.querySelector<HTMLElement>('.origin-top-left')!
  expect(layer.className).not.toContain('will-change')
})

it('falls back to a spinner when progress cannot be measured', async () => {
  await mountDeck()
  await openLightbox()

  const text = lightbox()!.textContent!
  expect(text).toContain('加载中')
  // No invented percentage when the byte count is unavailable.
  expect(text).not.toMatch(/加载中\s*\d+%/)
})

it('restores page scrolling when it closes', async () => {
  await mountDeck()
  await openLightbox()
  expect(document.body.style.overflow).toBe('hidden')

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })
  expect(document.body.style.overflow).not.toBe('hidden')
})

it('opens a single photo in the lightbox too, not off to the gallery', async () => {
  await mountSingle()
  expect(lightbox()).toBeNull()

  const card = mountEl.querySelector<HTMLAnchorElement>('a[href*="/photos/a"]')!
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  await act(async () => {
    card.dispatchEvent(event)
  })
  await act(async () => {
    await Promise.resolve()
  })

  expect(event.defaultPrevented).toBe(true)
  expect(lightbox()).not.toBeNull()
  expect(lightbox()!.textContent).toContain('f/2.8')
})

it('keeps the lightbox out of the single photo\'s anchor', async () => {
  await mountSingle()

  const card = mountEl.querySelector<HTMLAnchorElement>('a[href*="/photos/a"]')!
  await act(async () => {
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await act(async () => {
    await Promise.resolve()
  })

  // React bubbles synthetic events through the component tree, so a portal
  // nested inside the anchor would send this click back into the anchor's
  // handler and swallow the gallery link.
  const cta = lightbox()!.querySelector<HTMLAnchorElement>('a[href*="/photos/a"]')!
  const ctaClick = new MouseEvent('click', { bubbles: true, cancelable: true })
  await act(async () => {
    cta.dispatchEvent(ctaClick)
  })
  expect(ctaClick.defaultPrevented).toBe(false)
})

it.each(['grid', 'masonry'] as const)(
  'opens %s tiles in the lightbox like every other afilmory surface',
  async (layout) => {
    await mountDeck(layout)
    expect(lightbox()).toBeNull()

    const tile = mountEl.querySelector<HTMLAnchorElement>('a[href*="/photos/b"]')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => {
      tile.dispatchEvent(event)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(event.defaultPrevented).toBe(true)
    expect(
      [...lightbox()!.querySelectorAll('img')].map((img) =>
        img.getAttribute('src'),
      ),
    ).toContain(`${BASE_URL}/original/b`)
  },
)

it('lets a modified click on a tile still reach the gallery', async () => {
  await mountDeck('grid')

  const tile = mountEl.querySelector<HTMLAnchorElement>('a[href*="/photos/b"]')!
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    metaKey: true,
  })
  await act(async () => {
    tile.dispatchEvent(event)
  })

  expect(event.defaultPrevented).toBe(false)
  expect(lightbox()).toBeNull()
})

it('suppresses the browser selection a double click would start', async () => {
  await mountDeck()
  await openLightbox()

  const frame = lightbox()!.querySelector<HTMLElement>('.select-none')!
  const second = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    detail: 2,
  })
  await act(async () => {
    frame.dispatchEvent(second)
  })
  expect(second.defaultPrevented).toBe(true)

  // A first click must still behave normally — panning depends on it.
  const first = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    detail: 1,
  })
  await act(async () => {
    frame.dispatchEvent(first)
  })
  expect(first.defaultPrevented).toBe(false)
})

it('renders grid as a real grid, not another multi-column flow', async () => {
  await mountDeck('grid')
  expect(mountEl.querySelector('.grid-cols-2')).not.toBeNull()
  expect(mountEl.querySelector('.columns-2')).toBeNull()
})

it('keeps masonry on the multi-column flow', async () => {
  await mountDeck('masonry')
  expect(mountEl.querySelector('.columns-2')).not.toBeNull()
  expect(mountEl.querySelector('.grid-cols-2')).toBeNull()
})
