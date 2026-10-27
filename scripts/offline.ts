import { globSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { build } from 'vite'
import type { Plugin } from 'vite'

/**
 * The offline shell — issue #23.
 *
 * Workbox's runtime cannot install on the tablet's engine (SPEC §2), so the worker is hand-written in
 * `src/sw.ts` and the only thing left to build is the list of files it should precache. That used to be
 * `vite-plugin-pwa`, which brought the whole Workbox build chain (`workbox-build`, Babel, a deprecated
 * `glob`) along for one array of URLs. This plugin is that array, and nothing else:
 *
 * 1. after the client build has written `dist/`, list what it wrote;
 * 2. build `src/sw.ts` as a second, plain-script bundle with that list baked in (`__PRECACHE_FILES__`).
 *
 * The list is baked in rather than published as a file the worker fetches at install time: a worker that
 * has to download its own manifest before it can cache anything needs a second round trip before the app
 * is usable, and this app is installed over a weak connection.
 */

/** What the worker caches: everything the app is, and nothing the app never asks for. */
const PRECACHE_EXTENSIONS = ['.css', '.html', '.js', '.png', '.svg', '.webmanifest']

/** The worker is not precached: it is what the browser fetches to find out a new build exists. */
const WORKER = 'sw.js'

export interface OfflineShellOptions {
  /** The engine floor the worker is downlevelled to, which is the same one the app is built to. */
  target: string[]
}

export function offlineShell(options: OfflineShellOptions): Plugin {
  let root = '.'
  let outDir = 'dist'

  return {
    name: 'animal-pop:offline-shell',
    apply: 'build',

    configResolved(config) {
      root = config.root
      // Absolute in a resolved config, so the nested build writes where the client build did.
      outDir = config.build.outDir
    },

    async closeBundle() {
      const files = precacheList(outDir)

      await build({
        configFile: false,
        root,
        logLevel: 'warn',
        define: { __PRECACHE_FILES__: JSON.stringify(files) },
        build: {
          outDir,
          // The client build is already there; this pass only adds the worker next to it.
          emptyOutDir: false,
          copyPublicDir: false,
          target: options.target,
          rollupOptions: {
            input: { worker: join(root, 'src/sw.ts') },
            output: {
              // A plain script, not a module: the tablet's engine cannot register a module worker (SPEC §2).
              format: 'iife',
              entryFileNames: WORKER,
            },
          },
        },
      })

      verify(outDir, files)
    },
  }
}

/** Every file the build shipped, as URLs relative to the worker, sorted so a rebuild is byte-identical. */
function precacheList(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((url) => PRECACHE_EXTENSIONS.includes(extname(url)) && url !== WORKER)
    .sort()
}

/**
 * The list is injected through `define`, which fails silently if it ever stops applying: the worker would
 * ship, register, and cache nothing at all, and a tablet that is offline would show the boot fallback. So
 * the emitted worker is read back and held to the files that are actually on disk — `globSync` rather than
 * `precacheList`, so that a list which has lost a directory (`index-abc.js` for `assets/index-abc.js`)
 * cannot agree with itself.
 */
function verify(outDir: string, files: string[]): void {
  if (files.length === 0) {
    throw new Error(`${WORKER}: nothing to precache, so the build looks empty`)
  }

  const worker = readFileSync(join(outDir, WORKER), 'utf8')

  if (worker.includes('__PRECACHE_FILES__')) {
    throw new Error(`${WORKER}: the precache list was not injected`)
  }

  const shipped = globSync('**/*', { cwd: outDir })
    .map((url) => url.split(sep).join('/'))
    .filter((url) => url !== WORKER && PRECACHE_EXTENSIONS.includes(extname(url)))

  const missing = shipped.filter((url) => !worker.includes(url))
  if (missing.length > 0) {
    throw new Error(`${WORKER}: ${missing.join(', ')} would not be cached for offline use`)
  }
}
