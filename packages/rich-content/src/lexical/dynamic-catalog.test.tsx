import type { ComponentType, ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

import type { HostCapabilities } from '../host'
import {
  configuredDynamicModule,
  setDynamicCatalogHost,
} from './dynamic-catalog'

it('holds the dynamic renderer until the allowlist catalog settles', async () => {
  const Provider = configuredDynamicModule.Provider as ComponentType<{
    children: ReactNode
  }>
  const Dynamic = configuredDynamicModule.renderers!.Dynamic as ComponentType<{
    initialHeight: number
    url: string
  }>
  const el = document.createElement('div')
  const root = createRoot(el)

  await act(async () => {
    root.render(
      <Provider>
        <Dynamic initialHeight={120} url="https://cdn.example.com/w.js" />
      </Provider>,
    )
  })
  expect(el.textContent).toBe('')

  let resolveCatalog!: (v: unknown) => void
  setDynamicCatalogHost({
    fetchJSON: () =>
      new Promise((resolve) => {
        resolveCatalog = resolve
      }),
  } as unknown as HostCapabilities)
  await act(async () => {
    resolveCatalog({ components: [{ url: 'https://cdn.example.com/w.js' }] })
  })

  expect(el.textContent).not.toBe('')
  expect(el.textContent).not.toContain('Failed to load component')
  act(() => root.unmount())
})

// These cases need a catalog module with its own settled state.
async function mountFreshDynamic() {
  vi.resetModules()
  const catalog = await import('./dynamic-catalog')
  const Provider = catalog.configuredDynamicModule.Provider as ComponentType<{
    children: ReactNode
  }>
  const Dynamic = catalog.configuredDynamicModule.renderers!
    .Dynamic as ComponentType<{ initialHeight: number; url: string }>
  const el = document.createElement('div')
  const root = createRoot(el)
  await act(async () => {
    root.render(
      <Provider>
        <Dynamic initialHeight={120} url="https://cdn.example.com/w.js" />
      </Provider>,
    )
  })
  return { catalog, el, root }
}

it('releases the renderer when the catalog cannot be fetched, so it reports the failure itself', async () => {
  const { catalog, el, root } = await mountFreshDynamic()
  expect(el.textContent).toBe('')

  await act(async () => {
    catalog.setDynamicCatalogHost({
      fetchJSON: () => Promise.reject(new Error('offline')),
    } as unknown as HostCapabilities)
  })

  expect(el.textContent).not.toBe('')
  act(() => root.unmount())
})

it('releases the renderer after a timeout when the catalog request never lands', async () => {
  vi.useFakeTimers()
  try {
    const { catalog, el, root } = await mountFreshDynamic()
    catalog.setDynamicCatalogHost({
      fetchJSON: () => new Promise(() => {}),
    } as unknown as HostCapabilities)
    expect(el.textContent).toBe('')

    await act(async () => {
      vi.advanceTimersByTime(3000)
    })

    expect(el.textContent).not.toBe('')
    act(() => root.unmount())
  } finally {
    vi.useRealTimers()
  }
})
