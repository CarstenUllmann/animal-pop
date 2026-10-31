/**
 * Service-worker decisions, kept pure so they can be tested in node. `src/sw.ts` is the wiring.
 */

/**
 * One cache name for the app. Activation deletes every other cache on this origin, so a rename is
 * what would prune a previous build's files.
 */
export const CACHE_NAME = 'pop-pals.v1'

/** What we serve when she launches the installed app with no network. */
export const SHELL = 'index.html'

/**
 * Only same-origin GETs are answered from cache: the game makes no runtime requests of its own.
 * Cache matching is query-agnostic (`ignoreSearch` in `src/sw.ts`), which keeps a `?debug=1` visit
 * on the cached page; `debug` is the only query the app reads.
 */
export function answersFromCache(request: { url: string; method: string }, origin: string): boolean {
  return request.method === 'GET' && new URL(request.url, origin).origin === origin
}

/** Only a navigation can be answered with the shell: it is what she launches offline. */
export function canServeShell(request: { mode: string }): boolean {
  return request.mode === 'navigate'
}
