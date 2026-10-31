/**
 * The service worker. Hand-written because Workbox's install handler needs a promise combinator the
 * tablet's engine lacks. Every API used here is inside the Chrome 61 surface: CacheStorage,
 * FetchEvent, `skipWaiting` and `clients.claim`.
 *
 * The decisions are in `src/swPolicy.ts`; `scripts/offline.ts` builds this file as a plain script
 * with the precache list baked in.
 */
import { CACHE_NAME, SHELL, answersFromCache, canServeShell } from './swPolicy'

/** Only the worker API this file uses; tsconfig compiles against the DOM lib, which has no SW types. */
interface ExtendableEvent {
  waitUntil(settled: Promise<unknown>): void
}

interface FetchEvent extends ExtendableEvent {
  request: Request
  respondWith(response: Response | Promise<Response>): void
}

interface WorkerScope {
  location: string
  clients: { claim(): Promise<void> }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install', listener: (event: ExtendableEvent) => void): void
  addEventListener(type: 'activate', listener: (event: ExtendableEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void
}

declare const self: WorkerScope

/** Replaced at build time with the files this build produced. */
declare const __PRECACHE_FILES__: string[]

const ORIGIN = new URL(self.location).origin

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
  event.waitUntil(self.skipWaiting())
})

/** One entry at a time: a file that cannot be fetched must not take the whole cache with it. */
async function precache(): Promise<void> {
  const cache = await caches.open(CACHE_NAME)
  await Promise.all(__PRECACHE_FILES__.map((url) => cache.add(url).catch(() => null)))
}

self.addEventListener('activate', (event) => {
  event.waitUntil(adopt())
})

/** Drop every cache but this build's, then control the open page without a reload. */
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

/**
 * Cache first. `ignoreSearch` keeps a `?debug=1` visit on the cached page; `debug` is the only
 * query the app reads, so a query string cannot address a different asset.
 */
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
