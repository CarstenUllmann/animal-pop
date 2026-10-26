/**
 * Service-worker decisions — issue #23.
 *
 * `src/sw.ts` runs in a service worker, so it cannot be tested in node. The decisions it makes live
 * here, pure and dependency-free, and the worker file is only the wiring. Same rule as the game core:
 * no DOM, no timers (SPEC §2).
 */

/**
 * What vite-plugin-pwa injects at the injection point: the files this build produced. Entries are
 * objects, but plain strings are accepted too.
 */
export type PrecacheEntry = string | { url: string }

/** One cache, so a new build's activate step can drop the previous one. */
export const CACHE_NAME = 'pop-pals.v1'

/** What we serve when she launches the installed app with no network. */
export const SHELL = 'index.html'

export function entryUrl(entry: PrecacheEntry): string {
  return typeof entry === 'string' ? entry : entry.url
}

/**
 * Which requests the worker answers from cache: same-origin GETs only. The game makes no runtime
 * requests of its own (SPEC §2), so intercepting anything else would be wrong — a POST or a request
 * to another origin would be answered from a cache that never holds it and would never reach the
 * network.
 *
 * `origin` is the worker's own origin, which is also what a relative URL resolves against.
 *
 * Only the method and the origin are decided here. Whether a request matches a cache entry is
 * deliberately query-agnostic (`ignoreSearch` in src/sw.ts), so a `?debug=1` visit keeps the cached
 * page. Issue #41 records the decision to accept that breadth: `debug` is the only query the app
 * reads, and with no user-generated content a query string cannot address a different asset.
 */
export function answersFromCache(request: { url: string; method: string }, origin: string): boolean {
  return request.method === 'GET' && new URL(request.url, origin).origin === origin
}

/**
 * A navigation is the only request that can be answered with the shell, because a navigation is what
 * she sees when she launches the app offline. Assets are answered from the cache or not at all.
 */
export function canServeShell(request: { mode: string }): boolean {
  return request.mode === 'navigate'
}
