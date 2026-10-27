# 0003. The offline shell is built by a local plugin, not `vite-plugin-pwa`

Workbox's runtime cannot install on the tablet's engine (SPEC §2), so the service worker has been
hand-written in `src/sw.ts` since issue #23. That left `vite-plugin-pwa` doing three build-time jobs
around it: injecting the list of files the build produced, emitting the web app manifest, and emitting a
four-line registration script. In exchange it brought `workbox-build` and, transitively, the Babel
chain, a deprecated `glob@11` that npm warned about on every install, and a precache list with every
icon in it twice — it globbed both `dist/` and `public/`, so the worker cached 12 entries for 8 files.

## Decision

The three jobs are small enough to own. `scripts/offline.ts` lists what the build wrote and builds
`src/sw.ts` as a plain-script bundle with that list baked in (`__PRECACHE_FILES__`),
`public/manifest.webmanifest` is the manifest, and registration is a handful of lines in `src/main.ts`.
`vite-plugin-pwa` is gone, and the lockfile drops from 491 packages to 148.

## Considered options

- **Keep `vite-plugin-pwa`** — it worked, and its `injectManifest` strategy is the sanctioned way to
  feed a hand-written worker. Rejected because it carried 343 of the lockfile's 491 packages — Workbox,
  the Babel chain, Rollup's plugin chain — for one array of URLs, and every Vite upgrade then waited on
  the plugin's peer range.
- **Have the worker fetch a `precache.json` at install** — no build-time injection at all, but the worker
  would need a second round trip before it could cache anything. On a tablet installing over a weak
  connection that is the one round trip worth removing, so the list is baked in.
- **Write the manifest in `vite.config.ts` and emit it from the plugin** — keeps the manifest next to the
  rest of the build config, but a JSON file that never changes does not need generating, and a static
  `public/manifest.webmanifest` is one thing fewer to debug.

## Consequences

- The offline path now fails the build instead of failing on the device: `scripts/offline.ts` reads the
  emitted worker back and refuses to finish if the list was not injected, or if any file the build
  shipped is missing from it. The failure it guards against most closely is a quiet one — a worker that
  ships, registers, caches nothing, and leaves an offline tablet on the boot-fallback panel.
- Nothing in the injected list is itself versioned. Workbox used to attach a revision hash to each entry,
  but `src/sw.ts` never read it (it caches by URL), so the only real difference is the shape of the list.
- `CACHE_NAME` is still fixed, so a rebuild adds its hashed assets beside the previous build's rather
  than replacing them. That was already true before this change — the worker only deletes caches whose
  *name* differs — and it is a few tens of kilobytes per deploy, so it is left as it is rather than
  changing cache lifecycle on a device whose offline behaviour is verified by hand.
- Upgrading Vite no longer waits on a PWA plugin's peer range, and `npm install` no longer prints a
  deprecation warning from a transitive dependency we cannot move.
