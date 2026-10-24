/**
 * The service worker — issue #23.
 *
 * Hand-written rather than Workbox. Workbox 7 parses on the tablet's engine, but its install handler
 * needs a promise combinator that engine does not have (Chrome 76), so the worker can never finish
 * installing there and offline caching never worked — SPEC §2 records this. Every API below is inside
 * the Chrome 61 surface that device has: CacheStorage (42), FetchEvent (45), skipWaiting (45),
 * clients.claim (45).
 *
 * The decisions are in src/swPolicy.ts, where they can be tested; this file is the wiring, and
 * src/baseline.test.ts scans it like the rest of src/.
 */
import { CACHE_NAME, SHELL, answersFromCache, canServeShell, entryUrl, type PrecacheEntry } from './swPolicy'

/**
 * Only the parts of the worker API this file uses. tsconfig compiles against the DOM lib, which has no
 * service-worker types, so the shape is declared here rather than pulling in a second lib.
 */
interface ExtendableEvent {
  waitUntil(settled: Promise<unknown>): void
}

interface FetchEvent extends ExtendableEvent {
  request: Request
  respondWith(response: Response | Promise<Response>): void
}

interface WorkerScope {
  /** Replaced at build time by vite-plugin-pwa with the list of files the build produced. */
  __WB_MANIFEST: PrecacheEntry[]
  location: string
  clients: { claim(): Promise<void> }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install', listener: (event: ExtendableEvent) => void): void
  addEventListener(type: 'activate', listener: (event: ExtendableEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void
}

declare const self: WorkerScope

const ORIGIN = new URL(self.location).origin

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
  event.waitUntil(self.skipWaiting())
})

/**
 * One entry at a time, not all-or-nothing: she often installs the app over a weak connection, and one
 * file that cannot be fetched must not take the whole cache with it. An entry that fails is simply not
 * cached, and the app still works offline for the rest.
 */
async function precache(): Promise<void> {
  const cache = await caches.open(CACHE_NAME)
  await Promise.all(self.__WB_MANIFEST.map((entry) => cache.add(entryUrl(entry)).catch(() => null)))
}

self.addEventListener('activate', (event) => {
  event.waitUntil(adopt())
})

/**
 * A new build means a new cache, so the old one is dropped — the app should not grow on a tablet with
 * little storage. Claiming the clients is what makes the current page controlled without a reload.
 */
async function adopt(): Promise<void> {
  const names = await caches.keys()
  for (const name of names) {
    if (name !== CACHE_NAME) await caches.delete(name)
  }
  await self.clients.claim()
}

self.addEventListener('fetch', (event) => {
  if (!answersFromCache(event.request, ORIGIN)) return
  event.respondWith(answer(event))
})

/** Cache first: after install the game needs nothing from the network, and on this tablet the network
 *  is not something to rely on. `ignoreSearch` is what keeps a `?debug=1` visit on the cached page. */
async function answer(event: FetchEvent): Promise<Response> {
  const hit = await caches.match(event.request, { ignoreSearch: true })
  if (hit) return hit
  try {
    return await fetch(event.request)
  } catch (error) {
    // Offline. Only a navigation has something worth serving: the page itself.
    if (canServeShell(event.request)) {
      const shell = await caches.match(new Request(SHELL), { ignoreSearch: true })
      if (shell) return shell
    }
    throw error
  }
}
