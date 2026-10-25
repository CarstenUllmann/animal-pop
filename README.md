# Pop Pals

A tap-a-cluster animal-popping game for a young child, shipped as an offline-first PWA.
The design spec is [`docs/SPEC.md`](docs/SPEC.md).

**Status: M2/M3 — goals, the level ramp, the party and the wiring are in.** M1 (board,
tap-to-pop, gravity, refill, dead-board reshuffle, synthesised sound) is joined by goals and
the bubble meter, the celebration with balloons and the play arrow, save/resume, mute, the adult
long-press reset, the debug overlay, and the portrait and reduced-motion rules. The ramp is locked
to `npm run sim` output (issue #22). What is left is the device checklist, the unsupervised
five-minute session and the v1 tag (issues #20 and #22).

## Commands

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build locally
npm run sim        # headless player, levels 1-30 x 1000 runs, and the acceptance checks
```

## Deploy

Pushes to `main` build and deploy to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The app is served from
<https://carstenullmann.github.io/animal-pop/>.

The build targets `es2017` / `chrome61`, the engine the installed app actually gets (the tablet's
browser is Chrome 138; SPEC §2 explains why those are two different engines). No CDN,
no web fonts, no runtime network requests: everything is bundled and the service worker precaches
the whole app.

The *engine* baseline is lower than the build target: the installed app runs in System WebView 61,
so the shipped bundle has to parse on Chrome 61, and the service worker is built as a plain script
inside the Chrome 61 API surface (issue #23, SPEC §2). `src/baseline.test.ts` keeps the shipped
sources from naming an API the engine never had, and it reads `dist/`, so it is only meaningful
after a fresh `npm run build`.

## How it plays

Tap any orthogonally touching group of two or more identical animals. The group pops, animals
above fall, and fresh animals drop in from the top. Tapping a lone animal wobbles it and plays a
quiet boop. If the board ever has no legal tap, it shakes and reshuffles itself into a board with
at least one group of three.

Each level has two goal animals with a target each, and a rack of bubbles: one bubble leaves the
rack per pop, never below 1, and an invalid tap is free. When both goals reach zero the party is
sized by what is left on the rack — fewer taps, bigger party — capped at 12 balloons. The play
arrow appears after the fanfare has run and advances the level.

Every sound is synthesised with the Web Audio API; there are no audio files. Audio unlocks on the
first tap, as Android requires.

## Level ramp, as measured

`npm run sim` plays levels 1-30 with two policies — `random` (a five-year-old mashing) and
`greedy` (largest group, preferring goal animals) — 1000 seeded runs each, at seed `0x5eb00b1e`.
Those are the numbers `LEVEL_RAMP` was chosen against. SPEC §9.1 and §21 quote the same table,
and `src/game/rampDocs.test.ts` fails if either drifts from the shipped constants.

| Levels | Types | Goals | Rack | `random` p90 pops | `random` p10 left | `greedy` mean share | mean balloons |
|--------|-------|-------|------|-------------------|-------------------|---------------------|---------------|
| 1–2    | 4     | 3 + 3 | 12   | 12                | 1                 | 76% (big)           | 5.0 / 9.1     |
| 3–6    | 5     | 4 + 4 | 16   | 16                | 1                 | 65–67% (big)        | 5.8 / 10.3    |
| 7–8    | 5     | 5 + 5 | 20   | 19                | 1                 | 63% (big)           | 7.3 / 10.8    |
| 9–10   | 5     | 6 + 6 | 22   | 21                | 1                 | 60–61% (big)        | 7.7 / 11.1    |
| 11–12  | 6     | 6 + 6 | 29   | 27                | 2–3               | 53–54% (big)        | 9.1 / 10.9    |
| 13–15  | 6     | 7 + 7 | 33   | 31                | 2–3               | 49–50% (medium)     | 9.3 / 10.9    |
| 16+    | 6     | 8 + 8 | 35   | 33                | 1–3               | 47–48% (medium)     | 9.3 / 11.0    |

`p10 left` is the plausibly smallest run, which is what §9.1's floor clause describes; the mean
row is what §16.2 states its numeric band on. The rack is `random`'s p90 pop count plus 2 — the
floor clause read as a sizing rule — which reproduces the ramp exactly from level 11 and within 1
at levels 7–10. At levels 1–10 the plausibly smallest run is already at the floor, which is the
over-funding paying for itself; the band is asserted from level 11. At the plateau the typical run
hits the 12-balloon cap for both policies, so the meter's count reads the same there and only the
tier separates them; the mean still reads apart (greedy 11.0, random 9.3). Balloons are
`random` / `greedy`, mean run.

The goal phase at the plateau measures 45s, inside §9.3's 30–60s band; the whole session measures
about 95s, because the fun tail after the goals is open-ended by design (§1).

## Debug overlay

Open `?debug=1` (for example
<https://carstenullmann.github.io/animal-pop/?debug=1>) to show the on-device debug overlay. It
reports the session seed, the animals in play, the rack, the goals still missing, the tap queue,
the live balloon and particle counts, the frame tier, FPS, the viewport and the boot trace. The
`fps` row averages the frames the browser actually delivers, and the frame tier is the celebration's
own degrade/recover decision, measured on those same intervals — that is what issues #12 and #20
record on the tablet. The
boot trace is the reason it matters on the tablet: a force-close leaves nothing but the persisted
trace, and the browser and the installed app share one Chrome profile, so `?debug=1` in the
browser shows what the standalone run recorded (issue #23).

Without the query parameter the overlay is not created and adds no listeners.

## Icons

Placeholder icons are generated locally, no image tooling required:

```sh
pwsh -File scripts/generate-icons.ps1
```

## Layout

```
src/
  main.ts              # composition root: taps -> core -> view/audio/save; the only file
                       # touching the screen, the clock and real random
  game/                # pure core: no DOM, no timers, randomness only via Rng
    animals.ts         # THE animal manifest
    animalIds.ts       # the same ids without the .svg asset graph, for plain node
    board.ts           # groups, pop, gravity, refill, reshuffle
    rules.ts           # tap resolution, the rack, the party tier
    level.ts           # the ramp and the generator
    save.ts            # save round-trip and resume
    mute.ts            # mute state, the rules behind the toggle
    adultReset.ts      # the long-press level reset rules
    constants.ts       # tunables (grid, timings, audio levels, the ramp, the sim bands)
    rng.ts             # seeded mulberry32
    sim.ts             # the headless player and its per-level summary
    types.ts
    *.test.ts
  audio/
    player.ts          # AudioPlayer interface (the swap seam)
    synth.ts           # Web Audio implementation
  ui/
    boardView.ts       # tiles, pops, falls, wobble, reshuffle animation
    celebration.ts     # balloons, particles, the play arrow, the frame tier
    panelView.ts       # the level numeral, goals and the meter
    layout.ts          # portrait and landscape fractions
    muteToggle.ts      # the mute control
    adultReset.ts      # the long-press pointer handling and the shake
    pool.ts            # fixed-capacity object pool
    shell.ts           # kid-proofing: no zoom, selection, context menu or gestures
    capabilities.ts    # feature detection for APIs newer than Chrome 61
    bootlog.ts         # the persisted boot trace
    fallback.ts        # what renders when boot fails
    storage.ts         # localStorage seam
    debug.ts           # ?debug=1 overlay
  assets/animals/      # bundled SVGs
public/icons/          # generated PWA icons + source SVG
scripts/               # icon generator, and the simulator reporter
```

## Credits

Animal art: [Twemoji](https://github.com/jdecked/twemoji), CC BY 4.0.
