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
    fetchJSON: async () => PHOTOS as never,
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
  __resetResourceCache()
  mountEl = document.createElement('div')
  document.body.append(mountEl)
  root = createRoot(mountEl)
})

afterEach(() => {
  act(() => root.unmount())
  mountEl.remove()
  vi.useRealTimers()
})

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
