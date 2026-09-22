import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

import type { HostCapabilities } from '../host'

// Each case needs a catalog module with its own settled state.
async function loadCatalog() {
  vi.resetModules()
  return import('./dynamic-catalog')
}

async function renderSettledProbe(
  useDynamicCatalogSettled: () => boolean,
): Promise<() => boolean> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  let settled = false
  function Probe() {
    settled = useDynamicCatalogSettled()
    return null
  }

  await act(async () => {
    root.render(<Probe />)
  })
  return () => settled
}

it('stays unsettled until the catalog request resolves', async () => {
  const { setDynamicCatalogHost, useDynamicCatalogSettled } =
    await loadCatalog()

  let release: (value: unknown) => void = () => {}
  const fetchJSON = vi.fn(
    () => new Promise((resolve) => (release = resolve)),
  ) as unknown as HostCapabilities['fetchJSON']
  setDynamicCatalogHost({ fetchJSON } as HostCapabilities)

  const settled = await renderSettledProbe(useDynamicCatalogSettled)
  expect(settled()).toBe(false)

  await act(async () => {
    release({ components: [{ url: 'https://cdn.example.com/widget.js' }] })
  })
  expect(settled()).toBe(true)
})

it('settles even when the catalog cannot be fetched, so the renderer reports the failure itself', async () => {
  const { setDynamicCatalogHost, useDynamicCatalogSettled } =
    await loadCatalog()

  const fetchJSON = vi.fn(() =>
    Promise.reject(new Error('offline')),
  ) as unknown as HostCapabilities['fetchJSON']
  setDynamicCatalogHost({ fetchJSON } as HostCapabilities)

  const settled = await renderSettledProbe(useDynamicCatalogSettled)
  await act(async () => {
    await Promise.resolve()
  })
  expect(settled()).toBe(true)
})

it('falls through after a timeout when the catalog request never lands', async () => {
  vi.useFakeTimers()
  try {
    const { setDynamicCatalogHost, useDynamicCatalogSettled } =
      await loadCatalog()

    const fetchJSON = vi.fn(
      () => new Promise(() => {}),
    ) as unknown as HostCapabilities['fetchJSON']
    setDynamicCatalogHost({ fetchJSON } as HostCapabilities)

    const settled = await renderSettledProbe(useDynamicCatalogSettled)
    expect(settled()).toBe(false)

    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(settled()).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})
