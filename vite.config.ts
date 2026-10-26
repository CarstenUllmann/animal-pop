import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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
 * shipped build has no inline script and no inline style (`registerSW.js` is a file), so the
 * strict policy holds there. `frame-ancestors` is ignored in a meta policy, so it is not listed.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self'",
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
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        id: './',
        name: 'Pop Pals',
        short_name: 'Pop Pals',
        description: 'Tap a group of animals to make them pop.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'landscape',
        background_color: '#101426',
        theme_color: '#101426',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // Workbox's own runtime cannot install on the tablet's engine (SPEC §2), so the worker is
      // hand-written in src/sw.ts and this plugin only supplies the list of files to precache.
      strategies: 'injectManifest',
      // srcDir and filename are what pick the worker source: the plugin builds them as its entry.
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        // The whole app plus the manifest and its icons: after install there are zero runtime requests.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // The plugin defaults to a module worker, which the tablet's engine cannot register. As a plain
        // script it registers fine there.
        rollupFormat: 'iife',
      },
    }),
  ],
})
