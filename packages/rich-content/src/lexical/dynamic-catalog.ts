import { dynamicModule } from '@haklex/rich-compose/modules/dynamic'
import { useSyncExternalStore } from 'react'

import type { HostCapabilities } from '../host'

const CATALOG_SNIPPET_PATH = 's/dynamic-widgets-catalog'

interface DynamicCatalogPayload {
  components?: { url: string }[]
}

const bridge: {
  fetchJSON: HostCapabilities['fetchJSON'] | null
} = { fetchJSON: null }

const catalogUrls = new Set<string>()
let catalogPromise: Promise<void> | null = null

// validateUrl is synchronous, so the catalog must be in memory before the
// dynamic renderer asks about a URL — otherwise the first paint always fails
// the check and the reader is left with a "Failed to load component" that only
// a manual retry clears. Settled state plus subscribers let the renderer wait.
let settled = false
const listeners = new Set<() => void>()

function markSettled() {
  settled = true
  for (const listener of listeners) listener()
}

export function setDynamicCatalogHost(host: HostCapabilities) {
  bridge.fetchJSON = host.fetchJSON
  void ensureDynamicCatalog()
}

function ensureDynamicCatalog(): Promise<void> {
  const { fetchJSON } = bridge
  if (!fetchJSON) return Promise.resolve()
  catalogPromise ??= fetchJSON<DynamicCatalogPayload>(
    `/${CATALOG_SNIPPET_PATH}?_t=${Date.now()}`,
  )
    .catch(() => fetchJSON<DynamicCatalogPayload>(`/${CATALOG_SNIPPET_PATH}`))
    .then((catalog) => {
      for (const c of catalog?.components ?? []) catalogUrls.add(c.url)
    })
    .catch(() => {})
    // A catalog that cannot be fetched still settles: the renderer then runs
    // the check, fails it, and shows its own error instead of hanging.
    .finally(markSettled)
  return catalogPromise
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  void ensureDynamicCatalog()
  return () => {
    listeners.delete(listener)
  }
}

/** False until the catalog has been fetched (or has failed for good). */
export function useDynamicCatalogSettled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => settled,
    () => false,
  )
}

function isAllowedDynamicUrl(url: string): boolean {
  void ensureDynamicCatalog()
  return catalogUrls.has(url)
}

export const configuredDynamicModule = dynamicModule.setup({
  validateUrl: isAllowedDynamicUrl,
})
