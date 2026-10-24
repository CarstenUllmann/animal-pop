# Pop Pals

A tap-a-cluster animal-popping game for a young child, shipped as an offline-first PWA.
The design spec is [`docs/SPEC.md`](docs/SPEC.md).

**Status: M1 — the fun test.** The board, tap-to-pop, gravity, refill, dead-board
reshuffle and synthesised sounds are in. No goals, bubbles or celebration yet (M2/M3).

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

## How it plays (M1)

Tap any orthogonally touching group of two or more identical animals. The group pops,
animals above fall, and fresh animals drop in from the top. Tapping a lone animal
wobbles it and plays a quiet boop. If the board ever has no legal tap, it shakes and
reshuffles itself into a board with at least one group of three.

Every sound is synthesised with the Web Audio API; there are no audio files. Audio
unlocks on the first tap, as Android requires.

## Debug overlay

Open `?debug=1` (for example
<https://carstenullmann.github.io/animal-pop/?debug=1>) to show the on-device debug
overlay. It reports the session seed, the animals in play, FPS, viewport, display mode,
network state, service-worker status, build time and the last caught error. Level,
bubbles and goals are stubs until M2.

Without the query parameter the overlay is not created and adds no listeners.

## Icons

Placeholder icons are generated locally, no image tooling required:

```sh
pwsh -File scripts/generate-icons.ps1
```

## Layout

```
src/
  main.ts              # bootstrap: wires taps -> core -> view/audio
  game/                # pure core: no DOM, no timers, randomness only via Rng
    animals.ts         # THE animal manifest
    board.ts           # groups, pop, gravity, refill, reshuffle
    constants.ts       # tunables (grid, timings, audio levels)
    rng.ts             # seeded mulberry32
    types.ts
    *.test.ts
  audio/
    player.ts          # AudioPlayer interface (the swap seam)
    synth.ts           # Web Audio implementation
  ui/
    boardView.ts       # tiles, pops, falls, wobble, reshuffle animation
    shell.ts           # kid-proofing: no zoom, selection, context menu or gestures
    debug.ts           # ?debug=1 overlay
  assets/animals/      # bundled SVGs
public/icons/          # generated PWA icons + source SVG
scripts/               # icon generator
```

## Credits

Animal art: [Twemoji](https://github.com/jdecked/twemoji), CC BY 4.0.
