import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Engine baseline: Chrome 61, the version measured on the tablet's System WebView (issue #23).
// The installed app runs in that WebView, not in the tablet's browser (Chrome 138), so the shipped
// bundle has to parse there. es2017 caps the syntax, chrome61 covers the engine; APIs newer than
// Chrome 61 are feature-detected at runtime in src/ui/capabilities.ts. No CDN in the build.
const CHROME_TARGET = 'chrome61'
const BUILD_TARGETS = ['es2017', CHROME_TARGET]

export default defineConfig({
  // Relative base so the same build works on GitHub Pages project URLs and local previews.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // Both targets together: es2022 caps the syntax, chrome138 covers the engine.
    target: BUILD_TARGETS,
    cssTarget: CHROME_TARGET,
  },
  plugins: [
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
      workbox: {
        // Precache the whole app: after install there are zero runtime requests.
        // The manifest and its icons are added automatically by vite-plugin-pwa.
        globPatterns: ['**/*.{js,css,html,svg}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
