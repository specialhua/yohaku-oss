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

// A catalog request that never lands (hung connection, missing snippet route)
// would otherwise park the renderer on a blank placeholder with nothing to act
// on. Falling through restores the old behaviour: the check runs, fails, and
// the renderer offers its retry.
const SETTLE_TIMEOUT_MS = 3000
let settleTimer: ReturnType<typeof setTimeout> | null = null

function markSettled() {
  if (settled) return
  settled = true
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
  for (const listener of listeners) listener()
}

function armSettleTimeout() {
  if (settled || settleTimer) return
  settleTimer = setTimeout(markSettled, SETTLE_TIMEOUT_MS)
}

export function setDynamicCatalogHost(host: HostCapabilities) {
  bridge.fetchJSON = host.fetchJSON
  armSettleTimeout()
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
  armSettleTimeout()
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
