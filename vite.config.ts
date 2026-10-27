import { defineConfig, type Plugin } from 'vite'
import { offlineShell } from './scripts/offline.ts'

// Engine baseline: Chrome 61, the version measured on the tablet's System WebView (issue #23).
// The installed app runs in that WebView, not in the tablet's browser (Chrome 138), so the shipped
// bundle has to parse there. es2017 caps the syntax, chrome61 covers the engine; APIs newer than
// Chrome 61 are feature-detected at runtime in src/ui/capabilities.ts. No CDN in the build.
const CHROME_TARGET = 'chrome61'
const BUILD_TARGETS = ['es2017', CHROME_TARGET]

/**
 * GitHub Pages sends no `Content-Security-Policy` header, and this app runs as an installed
 * standalone app on the child's tablet, so the policy ships as a `<meta>` tag instead. Issue #38.
 *
 * It is injected at build time rather than written into index.html because Vite's dev server
 * delivers styles through inline `<style>` tags, which a strict `style-src 'self'` blocks; the
 * shipped build has no inline script and no inline style, so the strict policy holds there.
 * `frame-ancestors` is ignored in a meta policy, so it is not listed.
 *
 * `img-src` has to allow `data:` because Vite inlines assets under `assetsInlineLimit` (4 KiB) as
 * data URIs, and the Twemoji animal faces are small enough to be inlined. An SVG loaded through
 * `<img src="data:...">` cannot run script, so this does not widen the script surface.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

function injectContentSecurityPolicy(): Plugin {
  return {
    name: 'animal-pop:csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          // First in the head, so the policy is parsed before anything it governs is requested.
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig({
  // Relative base so the same build works on GitHub Pages project URLs and local previews.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // es2017 caps the syntax and chrome61 is the engine the installed app actually gets, so the
    // bundle can parse there (SPEC §2). The tablet's browser is newer; the WebView is not.
    target: BUILD_TARGETS,
    cssTarget: CHROME_TARGET,
  },
  plugins: [
    injectContentSecurityPolicy(),
    // The worker is hand-written (src/sw.ts); this only feeds it the list of files to precache and
    // builds it as a plain script. `public/manifest.webmanifest` is the app manifest.
    offlineShell({ target: BUILD_TARGETS }),
  ],
})
