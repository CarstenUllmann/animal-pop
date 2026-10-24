# Pop Pals

A tap-a-cluster animal-popping game for a young child, shipped as an offline-first PWA.
The design spec is [`docs/SPEC.md`](docs/SPEC.md).

**Status: M0 — platform proof.** The deployed build is a throwaway "hello" screen; the
game itself starts in M1.

## Commands

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build locally
```

## Deploy

Pushes to `main` build and deploy to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The app is served from
<https://carstenullmann.github.io/animal-pop/>.

The build targets Chrome 138 / `es2022` (the last Chrome available on the target
tablet). No CDN, no web fonts, no runtime network requests: everything is bundled and
the service worker precaches the whole app.

## Debug overlay

Open `?debug=1` (for example
<https://carstenullmann.github.io/animal-pop/?debug=1>) to show the on-device debug
overlay. Game values (level, seed, animals, bubbles, goals) are stubs until M1/M2; the
overlay already reports FPS, viewport, display mode, network state, service-worker
status, build time and the last caught error.

Without the query parameter the overlay is not created and adds no listeners.

## Icons

Placeholder icons are generated locally, no image tooling required:

```sh
pwsh -File scripts/generate-icons.ps1
```

## Layout

```
src/
  main.ts          # bootstrap: shell, hello screen, debug overlay
  ui/
    shell.ts       # kid-proofing: no zoom, selection, context menu or multi-touch gestures
    debug.ts       # ?debug=1 overlay skeleton
    debug.test.ts
  style.css
public/icons/      # generated PNG icons + source SVG
scripts/           # icon generator
```

The `src/game/` and `src/audio/` modules from the spec arrive with M1.
