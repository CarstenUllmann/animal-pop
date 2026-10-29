# Pop Pals — Game Spec

Status: **draft v1, ready for build**
Last updated: 2026-10-25
Target: browser (PWA) on an old Android tablet; Android APK possible later

---

## 1. Summary

A tap-a-cluster animal-popping game for a 5-year-old. A 6×6 board of cute animal faces
refills from the top forever. She taps any touching group of two or more identical animals
and they pop. Two "goal animals" must be collected to finish the level; every tap costs one
bubble from a party meter, and the bubbles left over *become* the celebration at the end.
Fewer taps → bigger party.

There is **no failure state, no timer, no score, and no text she has to read**.

---

## 2. Player and device

- One player: a 5-year-old girl, plays alone, ~5 minutes per session, repeats endlessly.
- Cannot read. Knows numerals 1–10. An adult may sit nearby occasionally.
- Plays on an old Android tablet (Pixel C class, Android 8.1), landscape, touch only.
- One active session at a time; she may abandon the tablet for 10+ minutes mid-level and return.

### Platform constraint (important)

Chrome on Android 8.1 is frozen at **Chrome 138** — no further updates. Therefore:

- **Browser baseline: Chrome 138.** No web platform features newer than that.
- **Code baseline: the Chrome 61 parse surface**, kept as a defensive floor. The shipped bundle still
  has to parse on Chrome 61, and `src/baseline.test.ts` keeps the sources from naming an API that
  surface never had.
- **The engine the tablet actually runs** (issue #23, measured 2026-10-25): `dumpsys webviewupdate`
  reports `com.android.chrome` 137.0.7151.115 as the current and preferred WebView provider;
  `com.google.android.webview` 61.0.3163.98 is installed but **not enabled**. The installed app runs in
  Firefox 158's PWA wrapper, so the effective engine is Gecko — see ADR-0002. The Chrome 61 target is
  therefore a floor the code stays inside, not the engine the device runs, and the `?.`/`??` reading
  that produced it was wrong. The standalone crash was never app code: the WebAPK shell Chrome mints for
  this origin declares `minSdkVersion: 24` while its `classes.dex` is DEX 039, which Android 8.1 cannot
  load (038 is its ceiling), so the shell's `SplashContentProvider` throws `ClassNotFoundException`
  before any page, console or boot trace can exist. Nothing in the app can change a shell Chrome mints
  server-side; the install path is the Firefox PWA wrapper, which is verified working on the device.
- Build target: `es2017`, esbuild target `chrome61`. Syntax newer than Chrome 61 is downlevelled by
  the build; APIs newer than it — `globalThis` (71), `Array.flatMap` (69), `getAnimations` (69),
  `Animation.finished` (75) — cannot be transpiled, so they are feature-detected at runtime and the
  board falls back to the static grid (SPEC §14.3). CSS newer than Chrome 61 (`aspect-ratio`,
  `clamp()`, flex `gap`) degrades cosmetically only.
- **Offline caching:** Workbox 7.4.0 parses on Chrome 61, but its install handler calls
  `Promise.allSettled` (Chrome 76), so its worker could never finish installing on the tablet's engine
  and offline-first was not satisfied there. The worker is hand-written instead (`src/sw.ts`) and stays
  inside the Chrome 61 API surface: CacheStorage (42), FetchEvent (45), `skipWaiting` (45),
  `clients.claim` (45), cache query options (54). It is built as a plain script, because that engine
  cannot register a module worker, and it precaches each file on its own — concurrent fetches, each
  with its own failure catch — so a single unreachable file does not take the whole cache down on a
  weak connection. Tracked on issue #23, and verified on the device on 2026-10-25: the Firefox PWA
  cold-launches from cache with Wi-Fi off and airplane mode on, and resumes the exact level it was
  left on.
- No CDN dependencies, no web fonts, no network requests at runtime. Everything is bundled.

---

## 3. Design pillars (non-negotiable)

1. **No failure.** She can never lose, get stuck, or be told she did something wrong.
2. **No timers.** Idling for 10 minutes must cost nothing.
3. **No reading.** Every piece of meaning is carried by icon, animation, or sound.
4. **One tap, one visible consequence.** Cause and effect inside a single frame.
5. **The reward is spendable.** The meter she watches drain during play is literally the
   celebration she gets afterwards.
6. **Pop is the fun.** Big clusters pop loudly and juicily; nothing pops on its own.

---

## 4. Non-goals for v1

- No accounts, no network, no analytics, no ads, no monetisation.
- No levels authored by hand, no world map, no story.
- No drag/swipe gestures, no swap mechanic, no merge mechanic.
- No background music loop.
- No leaderboards, stars, scores, streaks, or any accumulating record she could be
  disappointed by. The only persistent state is *which level she is on* plus the level in
  progress.

---

## 5. Core loop

1. Level loads: board filled, two goal cards shown, bubble rack filled.
2. She taps a group of ≥2 identical animals.
3. They pop (burst + per-animal pitch), animals above fall, new ones drop in from the top.
4. Goal rings advance; one bubble pops off the rack.
5. Repeat until both goals are collected.
6. Celebration: fireworks, poppable balloons scaled to the bubbles left (max 12), fanfare.
7. She taps a big pulsing ▶. Next level loads (slightly different goals/animals).

---

## 6. Board

- **6×6 grid**, 36 square cells, board placed on the right side of the screen (§13).
- **Animal pool of 8** (§12). Each level uses a subset: 4, 5 or 6 types (§9).
- Adjacency is **orthogonal only** (up/down/left/right). Diagonals do not connect.
  This is a deliberate, learnable rule; visual grouping feedback reinforces it.
- A "group" is a maximal set of orthogonally connected cells with the same animal.
  Legal taps are groups of **size ≥ 2**.

---

## 7. Tap resolution

### 7.1 Valid tap (group ≥ 2)

```
resolveTap(group):
  pending   = []                                  // animals to be popped
  counts    = countByAnimal(group)                // e.g. {cat: 3, frog: 1}
  for each animal type in group:
      pending.push({ animal, count })
  clear cells of group -> null
  bubblesLeft -= 1                                // exactly one, regardless of size
  for each goal g: g.remaining -= counts[g.animal]
  clamp bubblesLeft at MIN_BUBBLES (= 1)          // never fully drains, see §8.3
  apply gravity + refill (§7.3)
  if no legal group exists after settle: reshuffle (§7.4)
  if all goals reached: complete level (§10)
```

- Popping is **not** limited to goal animals; any group is a legal, rewarding tap.
- A tap on a group of 8 is worth exactly one bubble. Big clusters are efficient because
  they satisfy goals faster, not because they give bonus currency.

### 7.2 Invalid tap (single animal, or empty cell)

- Wobble the animal ~150ms, play a soft muted "boop" at low volume.
- **No bubble is consumed. No goal progress. No penalty.** Exploring is free.

### 7.3 Gravity and refill

1. Within each column, all animals fall to the bottom, preserving order (staggered drop
   animation, ~15ms per row, ~250ms total).
2. Empty cells at the top are refilled with freshly seeded random animals.
3. **No auto-cascade.** Falls never trigger pops. The board always settles and waits for her.
4. Refill always fills the board completely — the board is never partially empty.

### 7.4 Dead board (no legal tap)

Detection runs after every settle. If no group of ≥2 exists:

1. Screen shake + **filtered-noise "whoosh"** (~450ms), animals scatter outward.
2. New animals fly in and settle (~500ms).
3. The reshuffle **guarantees at least one group of ≥ 3**.
4. Costs nothing: no bubble, no goal.

It must be visually obvious that the *board* decided to change, not that she failed.

### 7.5 Input during animation

Taps during a resolution animation are **queued** (FIFO, max 2). Rapid tapping must never
feel dead, but also must never resolve against a stale board. Input is never blocked longer
than the animation.

---

## 8. Goals and the party meter

### 8.1 Goals

- Two goal animals per level, always distinct, always among the types in play.
- A goal card shows: the animal face, a numeral (`remaining`), and a ring around the face
  that fills as she collects. The numeral is a bonus; the ring must carry the meaning alone.
- Goal animals **that sit in a legal group (≥2)** get a subtle ring on the board. A completed goal's
  animals lose it, and an isolated goal animal looks like any other animal: the gold must never mark a
  tap that would wobble (§7.2).
- Level completes when **both** goals reach 0.

### 8.2 Party meter (the bubble rack)

- A rack of bubbles on the left panel, below the goal cards. Starts full at level start.
- **One bubble pops per valid tap.** Nothing else consumes bubbles.
- The rack drains visibly with a pop + sparkle, tied to the tap that spent it.
- Displayed as a compact grid (3–4 per row in landscape, chosen so a full rack fits the panel
  height without scrolling). ADR-0001 sizes that rack from the measurement — 35, where §9.1's ramp
  tops out — rather than the ~39 written before the rack was measured; in portrait the grid is the
  horizontal band §13 describes. Bubble size ~22–26px; the rack reads as a block of bubbles that
  visibly shrinks. Rows disappearing is the legible signal — she never has to count.

### 8.3 The last bubble never drains

`bubblesLeft` floors at **1**. There is no fail state, so running "out" must be impossible
and meaningless: the last bubble is simply the minimum party. If she taps carelessly, the
party gets small — it never gets to zero, and she is never told she lost.

### 8.4 Party size → celebration size

```
partySize   = bubblesLeft                    // 1 .. bubblesStart
partyPct    = partySize / bubblesStart       // 0..1
balloons    = min(partySize, 12)
fireworkTier = partyPct >= 0.50 ? "big"
             : partyPct >= 0.25 ? "medium"
             : "small"
```

- `partyPct` (not the raw count) drives intensity, so a late level with ~39 bubbles can still
  produce a "big" party without spawning 39 balloons.

---

## 9. Level structure and generation

### 9.1 Ramp

Difficulty rises only through **more animal types** and **bigger goals**. Never through
timers, blockers, or hidden rules. It **plateaus** at level 16 so the game never becomes an
endless grind.

Measured with the §16.2 simulator (`npm run sim`: levels 1–30 × 1000 seeded runs per
policy at seed `0x5eb00b1e`, recorded in README.md). Rows 1–6 are the deliberate estimates
explained below; from level 7 every rack is the measurement:

| Levels | Types in play | Goals | Bubbles |
|--------|---------------|-------|---------|
| 1–2    | 4             | 3 + 3 | 12      |
| 3–6    | 5             | 4 + 4 | 16      |
| 7–8    | 5             | 5 + 5 | 20      |
| 9–10   | 5             | 6 + 6 | 22      |
| 11–12  | 6             | 6 + 6 | 29      |
| 13–15  | 6             | 7 + 7 | 33      |
| 16+    | 6             | 8 + 8 | 35      |

Rows 1–2 and 3–6 are the numbers as they were estimated: level 1 is deliberately over-funded
(~12 bubbles for a ~5-tap level) so her first celebration is a **big** party and she learns that
the rack is a resource, not a countdown she's losing. From level 3 the slack narrows, and from
level 7 every rack is the measured number rather than the estimate — the 24 the pre-measurement table guessed
for levels 7–10 is the one number the measurement contradicts, and the plateau measures 35 rather than the
39 it guessed.

**The floor clause is the sizing rule**, which is how M5 read it: "careless play can plausibly end
with 2–3 balloons" describes the run that takes the most pops, so the rack is the 90% pop count of
the `random` policy plus 2 — the 10% smallest leftover is what a rack leaves to the 90% largest pop
count. Applied, that gives 29 at level 11 and 33 at level 13 exactly, and lands within 1 of the
numbers above at levels 7–10. Level 11 is the first level where the plausibly smallest run ends
with 2–3 balloons; at levels 7–10 it already ends with 1, which is why the floor band is asserted
from level 11.

The two bands only hold together read on different runs, and that is the shape §16.2 has to keep:
the numeric band and the tier band are read on the **mean** run, the floor clause at **p10**. At the
plateau the typical run hits the 12-balloon cap for both policies, so the meter's count reads the
same there and only the tier separates them; the mean run still reads apart (greedy 11.0 balloons,
random 9.3). A rack tight enough for the count to read apart on the typical run puts random's p10 at
the floor itself, outside the band — so the ramp takes the band, and the tier is what still tells the
two policies apart.

### 9.2 Generator rules

```
generateLevel(level, sessionSeed):
  rng      = seededRng(hash(sessionSeed, level))       // deterministic, reproducible
  k        = typesForLevel(level)                      // 4 | 5 | 6
  roster   = shuffle(ANIMAL_POOL, rng).slice(0, k)     // randomised each level
  goals    = pick 2 distinct from roster
  board    = fill 36 cells from roster, then ensure at least one legal group
  bubbles  = bubblesForLevel(level)
```

- `sessionSeed` is generated once per install and persisted, so a level always regenerates
  identically after a reload or crash (critical for resume and for bug reports).
- All randomness goes through one injectable `Rng` interface (no bare `Math.random()` in
  core logic) so the simulator and tests can drive it.

### 9.3 Plateau

After level 16 the numbers stop changing; only the animal roster and goal animals rotate.
**Sessions stay ~30–60s per level forever** — read as the goal phase, the part the rules decide.
The fun tail after the goals stays open-ended by design (§1), so a plateau session measures longer
than the band end to end (~95s, of which ~50s is the tail); the band is asserted on the goal phase,
which is what the simulator can actually control.

---

## 10. Celebration

Triggered the moment both goals hit zero. All animations run over a canvas overlay above the
board; the board itself dims and stops accepting taps (except balloon taps).

### 10.1 Sequence

| Phase | Timing | Content |
|-------|--------|---------|
| 0 | 0ms | Pop burst on the final goal, ring snaps full |
| 1 | 1200–1660ms | Fireworks begin behind/above the board, tier from §8.4. The volley waits for the fanfare (§11) rather than landing on top of it, so the party opens on one cue: three bursts at 1200/1380/1660ms |
| 2 | 0–2.5s | Balloons climb from below the board edge, one at a time, 1200ms each with a decelerating ease and a 120ms stagger, then settle into a swaying, overlapping bunch **inside** the board (see *The bunch*). The first lands at ~1.2s, the twelfth at ~2.5s; the float never stops |
| 3 | after the last balloon lands: `1200 + (n−1) × 120` ms (2.52s at twelve balloons, 1.44s at three) | Big pulsing ▶ button fades in, bottom-centre, already clear of the balloons |
| 4 | until she taps ▶ | Everything keeps running (a firework bed of one burst a second, and the bunch replaces itself as she pops, so it never empties) |

- Balloon tap → pop + sparkle burst + pop sound (a latex click over a body that drops in pitch). Satisfying.
- Balloons are **optional**: ▶ is tappable from the moment it appears.
- Celebration never ends by itself. She decides when to move on.
- If `fireworkTier === "small"` (careless play) the fanfare is replaced by a soft two-note
  "aww" chime and only a few balloons appear. Quieter, **not** sad — there is no fail.

**Popping (issue #35).** A tapped balloon pops, sounds, and then collapses to nothing over 180ms and is
removed from the layer. Nothing is left behind that looks poppable — the `scale(0.55)` stub that used to sit there
until every balloon in the set was popped kept its full hit box and swallowed taps, which is what made
her tap the same balloon over and over. The hit box goes with the balloon, and while it is collapsing it
takes no taps (`pointer-events: none`), so a tap lands on the balloon underneath it. The removal is
scheduled by a timer the module owns and clears, the same rule as every other timer in the celebration,
rather than by a `transitionend` listener; under `prefers-reduced-motion` the pop and the removal are the
same step. The `.balloon__shape` owns the collapse (transform and opacity) as well as the pop, so the
one-transform-owner rule still holds.

The bunch replaces itself as she pops (issue #36): a popped slot gets a new balloon that rises into a fresh
position inside the blob, immediately, with no stagger delay and no sound — sound belongs to the pop — so the
bunch never empties and she always has something to pop. The cap stays twelve whatever the rack holds (§8.4),
and the play arrow's delay is still computed from the original party size (§10.1 phase 3).

**The bunch (issues #32, #33, #34).** A balloon is `min(boardW × 0.195, boardH × 0.225)` CSS px — 1.5× the
factors this section used before — floored at 120px so a −6% jittered balloon still clears the 90px tap
target, and jittered ±6% per balloon: 135px on the target tablet. The size is written by `ui/layout.ts` as
`--balloon-px`, not as a fixed pixel value.

Positions are computed against the painted board square, not as percentages of the overlay: `ui/layout.ts`
owns the geometry and hands the celebration `boardPx`, the board's offset inside the overlay,
`balloonPx`, `balloonMarginPx` and whether the bunch fits. A balloon rests fully inside the board on the
left, right and top — the resting place keeps half the balloon plus the float amplitude plus 16px from the
board edge, so the ±7px sway and ±8px bob can never carry a balloon past the border. The bottom edge is
the deliberate exception: balloons climb from below it, so "inside the board" is a rule about the resting
place, not about the climb.

The bunch is a scattered blob, not a row: up to twelve balloons, each centre at least 0.55 × the mean of
its own and its neighbour's jittered width away from every other centre, so no balloon is fully buried. On
the target tablet that is two rows of six with about 56% of each balloon exposed. When a board cannot hold
twelve at that spacing, size holds first, spacing tightens to a 40% exposure floor, and only then does the
count drop — a phone gets about five, which is still a bunch she can read. Taps go to the balloon painted
on top, and the back of the blob is painted first so it reads as behind. The play arrow keeps its own 16px
band clear of its box, so a balloon can never sit on the button she uses to move on.

Placement is bounded rejection sampling on the injected `Rng`, so the same session draws the same bunch. A
rotation re-clamps every balloon already hanging — it moves them, it does not replay the rise. Each balloon
is still three elements — `.balloon` (button, owns the rise so the hit box travels with it) →
`.balloon__float` (owns the endless ±7px sway over 6–7s and ±8px bob over 3–3.5s) → `.balloon__shape`
(owns the pop and the collapse) — one transform owner each, which is what lets a balloon tapped mid-rise
pop exactly like one at rest. Period, phase and direction come from the injected `Rng`, so the bunch never
moves in lockstep and a session still replays.

**Colour and outline (issue #49).** Colour is decoration: nine fixed hues, with each new balloon coloured
against the balloons it overlaps. Two balloons are neighbours when their centre distance is below the mean
of their two jittered widths — the same metric that spaces the bunch. A newcomer takes a palette entry none
of its neighbours is using; if neighbours already hold every entry, it repeats the least-used one. The
opening bunch and every refill use the same rule, a refill is coloured against the bunch hanging at that
moment, and an existing balloon is never recoloured. The choice uses the injected `Rng`, so colour still
replays; placement is decided first, so colour cannot move a balloon.

Every balloon body carries a thin `#0a0d16` outline at 0.9 SVG units. The body still fills from
`currentColor` and the string keeps its own thin `currentColor` stroke, so the outline separates
overlapping bodies without drawing a ring around the string.

**The arrow (issue #28).** The ▶ waits for the last balloon to settle rather than a fixed beat: the
delay is computed per party when the party starts and written inline as `--play-button-delay`, with
`CELEBRATION.playButtonDelayMs` only as the stylesheet fallback. It is in the DOM from the start,
`next--ready` reveals and enables it in one step, and it sits bottom-centre with its own 16px band clear of
the blob, so a balloon can never land on it.

### 10.2 Performance

Fireworks: max 120 particles per burst, pooled, DPR capped at 2. Must hold 60fps on the
target device; degrade particle count (`30fps` tier) if frame time exceeds budget for 1s.

The burst reads as a firework, not a handful of yellow arcs (issue #27). A seven-hue palette
(`FIREWORK_COLORS`) covers it; each burst draws a 2–3 hue subset, and every particle takes its hue
at **spawn** from the injected `Rng` — never per frame, because that would break replay determinism
and spend main-thread time. About one particle in five is near-white, so a burst sparkles instead
of reading as confetti. Radius is jittered 2–5px, a white-hot core shows for the first ~20% of a
particle's life, and the radius shrinks as it dies. No motion trails. The bed runs one burst a second on a
timer rather than every 60 frames, and the opening volley is three bursts; worst case is 360 live particles
against the unchanged 500-particle pool, so nothing allocates.

"Frame time" is the interval the browser actually delivers between animation frames, not the time the
celebration spends drawing: on the tablet the compositor and the rest of the page are what make a frame
late, and a layer timing only its own arcs reports healthy while the screen runs at 25fps. "Exceeds
budget for 1s" is measured over a window of `measureWindowMs` (250ms) of delivered frames, not frame by
frame, because the tablet delivers a mix rather than a steady rate: 16.7ms then 46.7ms is 31fps averaged
over a second, and a meter that classified frames one at a time and cleared its record whenever one frame
landed inside the budget never reached the threshold (issue #29). The window is the same scale as
`?debug=1`'s fps row, so the tier and the fps reading the device check compares are measured over
comparable spans. Because the 30fps tier throttles draws to every other frame, the meter normalises by the
animation frames in its window: a panel still delivering 60Hz reads 16.7ms even while the throttle is on,
and one that has fallen to 30Hz reads 33ms and stays degraded. It returns to 60fps after `recoverAfterMs`
inside the budget. A hidden tab or a sleeping device drops the window it interrupted instead of being
charged as a slow frame, and what was measured before the gap stays measured. The tier is observable as
`data-tier` and in `?debug=1`'s frame-tier row, which is how issue #12's device check reads it.

---

## 11. Audio

All audio is **synthesised with the Web Audio API** in v1 — no files, no licences.

| Sound | Design |
|-------|--------|
| Animal pop | Short blip, per-animal pitch from C-major pentatonic (C5, D5, E5, G5, A5, C6, D6, E6). Zero-crossing "pop" transient; louder/bigger pop for bigger clusters (arpeggiate cluster size) |
| Bubble pop | Tiny high tick, distinct from animal pops |
| Invalid tap | Muted low "boop", quiet |
| Reshuffle | Filtered noise sweep, wind-like, 450ms |
| Win fanfare | 4-note rising arpeggio + shimmer, ~1.2s |
| Small party | Soft two-note "aww" chime |
| Balloon pop | A bright latex click over a body that drops 320→120 Hz. No pitched blip and no ladder: a pop is the same pop every time, apart from a ±6% drift |
| Firework | A muffled 110→42 Hz thump with a sparkle tail, at 40% of a balloon pop's peak because it is weather, not an event |

- **The celebration's sound is one arc, not two cues at once.** The fanfare owns the first 1.2s; the
  three-burst firework volley follows it (§10.1), and the bed of one burst a second starts after the
  volley has landed. A party that opened on a fanfare *and* a firework was two events competing for the
  same moment.
- **The bed is atmosphere, so it does not depend on a frame.** It runs from a timer rather than from the
  draw loop: the cadence does not halve on the `30fps` tier, and it still sounds under
  `prefers-reduced-motion`, where no bursts are drawn. The sound survives; only the movement goes.
- **Variation is seeded, never ambient.** A firework's pitch, level, spark count and scatter, and a
  balloon pop's small pitch drift, all come from a 0–1 seed the celebration draws from the injected
  `Rng`. The synth holds no random state of its own, so a replayed session hears the same party (§2).
- **The bed is 40% of a pop's peak, and nothing ducks.** A pop is an event, the fireworks are weather,
  so the thing she is tapping stays the loudest sound in the room: the bed does not dip when a balloon
  goes, and it does not taper while she stays. The numbers in `AUDIO` are levels as heard, not as
  measured — a low sine is much quieter to the ear than a bright click at the same gain.
- **No looping background music.**
- Audio context unlocks on the first tap (Android requires a gesture).
- Mute toggle: small speaker icon, top-right of the panel (issue #17), state persisted. All meaning
  must survive muting (every sound has a visual twin).
- Architecture: all playback goes through an `AudioPlayer` interface so a sample-based
  implementation (recorded/AI-generated assets) can replace the synth later without
  touching game code (§15).

---

## 12. Animals and art

### 12.1 Set

Bundled flat SVGs from one consistent open-licensed set (**Twemoji**, CC BY 4.0 — attribution
in an about/credits comment; swap to OpenMoji if preferred). Requirement: distinguishable by
**silhouette and colour**, since a 5-year-old reads shape before colour.

Pool of 8:

| id | animal | distinguishing feature | pitch |
|----|--------|------------------------|-------|
| `cat` | cat | pointy ears, orange | C5 |
| `rabbit` | rabbit | long upright ears, pale | D5 |
| `panda` | panda | round ears, black eye patches | E5 |
| `frog` | frog | wide flat head, green | G5 |
| `pig` | pig | round snout, pink | A5 |
| `penguin` | penguin | black head, white belly, beak | C6 |
| `monkey` | monkey | tan face patch on brown | D6 |
| `fox` | fox | sharp snout, red-orange | E6 |

Deliberately excluded: tiger/lion/bear — they read as "cat" at tablet distance.

### 12.2 Asset swap contract

The pool lives in a single manifest, `src/game/animals.ts`:

```ts
export interface AnimalDef {
  id: string
  label: string        // decorative only, never required reading
  face: string         // import url of the SVG (or an <svg> component later)
  pitch: number        // Hz, used by the synth audio player
}
export const ANIMAL_POOL: AnimalDef[] = [...]
```

Adding, removing, renaming, or re-drawing an animal is a **data change only**. When her own
own doodles are ready: crop/trace to SVG, drop files in `src/assets/animals/`, point
`face` at them. No game-logic, layout, or audio code changes. Keep `id` stable and reuse the
old pitch; replace the art, not the identity.

Constraints for replacement art: square-ish framing, transparent background, no text,
thick outline, and still distinguishable from the other 7 in silhouette.

---

## 13. Layout and responsiveness

Designed **landscape first** for the tablet; portrait must still be playable (no "rotate your
device" gate — she plays however she's holding it).

### Landscape (primary)

```
┌──────────────────────────────────────────────┐
│ ┌──────────────────┐   ┌───────────────────┐ │
│ │ Level 7     [🔊] │   │                   │ │
│ │ Goal  🐱  4      │   │   6 × 6 board     │ │
│ │ Goal  🐸  6      │   │                   │ │
│ │                  │   │  (centred,        │ │
│ │ ○ ○ ○            │   │   slightly right) │ │
│ │ ○ ○ ○            │   │                   │ │
│ │ party rack       │   │                   │ │
│ └──────────────────┘   └───────────────────┘ │
└──────────────────────────────────────────────┘
```

- Left panel: ~28–32% width, goals on top, bubble rack below; the level numeral and the mute
  share its top row, with the mute in the panel's top-right corner (issue #17).
- Board: on the right, centred in the remaining space, with margin.
- Tap targets: board cell **≥ 90 CSS px** on the target device (~110–140px expected), and no
  interactive target smaller than 64px except the board cell on a viewport smaller than the
  tablet. There the cell clamps at 60px and, where even that is more than the board's area can
  hold, the board overhangs its area and the viewport clips it; the root reports
  `data-tap-target="too-small"` for any cell below 90. The target device never takes that path
  (issue #10).
- All sizing in viewport units / `clamp()` / `vmin`, no fixed pixel layout. Must survive the
  Pixel C's 1.41 aspect ratio and Chrome UI resizing.
- Portrait fallback: panel stacks above the board, goals side by side, bubble rack becomes a
  horizontal band across the panel width (ADR-0001: the rack sized for 35 wraps to 3 rows at the
  target density, inside the panel row it has). Board stays square and centred.
- Party balloons are sized from the board area (`min(boardW × 0.195, boardH × 0.225)`, base floor
  120px so a −6% jittered balloon still clears the 90px tap target, ~135px on the target tablet), rest
  fully inside the painted board with 16px of space to the border plus the float amplitude, and a
  rotation recomputes both the size and the resting places (§10.1, issues #25, #32, #33).
- `prefers-reduced-motion: reduce` → shorter, non-scaling animations; nothing becomes
  unreadable. The balloons are bigger but already in their resting places, with no rise and no
  float; a popped balloon is removed in the same step as the pop, and the particle canvas is not
  shown at all.

---

## 14. Persistence, reset, debug

### 14.1 Save state

Key: `localStorage["pop-pals.v1"]`. Written after **every resolved tap** and on level
transition. try/catch around all storage access — if storage is unavailable the game still
plays, it just can't resume.

Separate key `localStorage["pop-pals.boot.v1"]` holds the boot trace (issue #23): the steps
reached during startup plus the last error. It is written after every boot step, because a
force-close on the tablet kills the process before anything renders — the only way to read the
failure is to write it down and look at it on the next launch.

```ts
interface SaveState {
  version: 1
  sessionSeed: number
  level: number
  board: (string | null)[]      // 36 animal ids
  goals: { animal: string; remaining: number }[]
  bubbles: number
  bubblesStart: number
  muted: boolean
  levelsCompleted: number       // internal only, never shown
}
```

- Reopening resumes **mid-level, exactly as left**. No dialogs, no confirmations.
- Schema changes bump `version` and reset to level 1 (acceptable for a toy; migrations only
  if it becomes painful).

### 14.2 Adult reset

- Long-press the level label (top-left) for **3s** → the label shakes, then a confirm icon
  appears; a second tap wipes progress back to level 1.
- No visible button, no discoverable-by-accident path, no way for her to trigger it with a
  normal tap.

### 14.3 Debug overlay

`?debug=1` shows: level, seed, animal types in play, bubbles, remaining goals, fps, last
error message, and a "next level" button. The environment rows are what the device checklist reads:
`display` says `standalone` or `browser`, `motion` says whether the system asked for reduced
motion, `viewport` is the size the layout was computed for, and `board cell` is the CSS px the
layout gives a tile — the number §13's 90 px tap target and issue #10's fit are measured against.
`display` and `motion` are fixed at boot, because the modules they describe read them once.
Off by default. This is the only on-device debugging
channel (no USB tethering guaranteed), so it must be built in M0 rather than bolted on.

It also carries a `boot` row with the persisted boot trace from §14.1 — the previous run's steps
then this run's, starting with the engine version token and the feature-detected APIs it found. The token
names whichever engine the run booted in, Chrome or Firefox, so a trace taken inside Firefox's PWA wrapper
reads `Firefox/158` rather than `unknown engine` (issue #23, measured 2026-10-25; the gap was issue #30).
The `display` row still answers the standalone/browser question there.
Since a crash can end the process before the overlay is ever mounted, boot must also render a
plain fallback panel **without** `?debug=1` when it fails, and no startup call may throw:
feature-detect `crypto.getRandomValues`, `matchMedia`, `Element.prototype.animate` and
`getAnimations({ subtree: true })`, and fall back to a static board when an engine lacks them.

The browser and the installed app share one Chrome profile, so a standalone crash is observable
from the browser: launch the app, let it die, then open `?debug=1` in the browser and read the
`boot` row. That is the only way to see a standalone run without a screen, a console or adb
(issue #23).

---

## 15. Technical architecture

### Stack

- **Vite + TypeScript (strict), no UI framework.**
- DOM + CSS for the board (36 real elements, CSS transforms for motion), one `<canvas>`
  overlay for fireworks/particles.
- **A local Vite plugin** (`scripts/offline.ts`) for the service worker: it builds `src/sw.ts` as a
  plain script with the build's file list baked in (ADR-0003). `public/manifest.webmanifest` is a
  static file, not generated.
- **Vitest** for unit tests. Node script for the tuning simulator.
- Later Android: wrap with **Capacitor** (no code changes expected).

### Modules (core must not import the DOM)

```
src/
  main.ts                 // bootstrap, wires input -> core -> render
  game/
    types.ts              // Board, Goal, AnimalDef, SaveState, Rng
    rng.ts                // seeded PRNG (mulberry32), injectable
    animals.ts            // THE animal manifest (§12.2)
    constants.ts          // every tunable number in ONE place (§21)
    board.ts              // fill, groups, gravity, refill, dead-board, reshuffle (pure)
    level.ts              // level params from level number, goals, generation (pure)
    rules.ts              // resolveTap + level-complete + party math (pure)
    save.ts               // localStorage load/save/versioning
  ui/
    boardView.ts          // renders tiles, tweened pops/falls
    panelView.ts          // goal cards + bubble rack
    celebration.ts        // fireworks canvas + balloons + ▶
    layout.ts             // responsive sizing
    debug.ts              // ?debug=1 overlay
  audio/
    synth.ts              // WebAudio implementation of AudioPlayer
    player.ts             // interface + mute handling + unlock
```

**Hard rule:** everything under `game/` is pure — no DOM, no timers, no `Math.random`, all
randomness via injected `Rng`. This is what makes the simulator and tests possible.

Public core surface (approximate):

```ts
createLevel(level: number, sessionSeed: number, pool: readonly AnimalId[], rng?: Rng): LevelState
getGroups(board: Board, minSize?: number): Group[]
resolveTap(state: LevelState, index: number, rng: Rng): TapResult  // outcome: 'invalid' | 'popped'
isComplete(state: LevelState): boolean
partySize(state: LevelState): Party   // { balloons, tier, pct }
```

### PWA

- `display: standalone`, `orientation: landscape`, `start_url: "./"`, theme colour matched
  to the board's background.
- Icons 192/512 + maskable. Service worker precaches **everything**; the game must work with
  airplane mode on. No runtime network requests at all.
- No links, no buttons that leave the game. Only interactive chrome: mute toggle, ▶, and the
  hidden adult reset.

### Repository and hosting

- **Public GitHub repo, served by GitHub Pages** (free plan only allows Pages from public
  repos; no home server, no third-party host, no runtime backend).
- Deploy = push to `main`; a GitHub Actions workflow builds with Vite and publishes `dist/`.
- **Neutral naming, no personal names.** Repo, URL, PWA name and icon must not contain the
  child's name (`pop-pals` is the placeholder). It's *her* game because it's on her tablet and
  she helped decide the animals — the URL doesn't need to prove it, and can't be unpublished
  later once it's indexed. The local folder name is irrelevant; the remote decides the URL.
- No personal data anywhere in code, comments, commit messages, or the save file. The save
  file contains game state only.

### Kid-proofing

`touch-action: none`, `user-select: none`, `-webkit-touch-callout: none`, viewport
`user-scalable=no, maximum-scale=1`, no context menu handler. `overscroll-behavior: none` is on the list
but is not used: it is newer than the Chrome 61 parse floor §2 holds the shipped sources to (Chrome 63), so
`baseline.test.ts` keeps it out of the stylesheet. The no-scroll half of the intent is delivered without it —
`overflow: hidden` on the shell plus `touch-action: none` — and `styles.test.ts` asserts that. The gestures
CSS cannot disable on Chrome/Android (long-press menu, pinch, double-tap zoom) are prevented by listeners in
`ui/shell.ts`, which never blocks a single-finger tap. `src/ui/shell.test.ts` pins the rules, the listeners
and that carve-out; whether the gestures actually do nothing on the panel is §16.3's check (issue #20).
Accept the Android back gesture (it exits the PWA); persistence (§14.1) makes it harmless.

---

## 16. Testing

### 16.1 Unit tests (`vitest`, pure core)

- Group detection: orthogonal only, diagonals excluded, size-1 groups excluded.
- Tap resolution: correct counts, one bubble per tap, floor at 1, invalid tap is free.
- Gravity: order preserved per column, no partial boards after refill.
- Dead-board detection + reshuffle guarantee (≥1 group of 3) via fuzz over many seeds.
- Goal accounting and completion (both goals required).
- Party math: balloons capped at 12, tier boundaries.
- Level generation: deterministic for a given `(level, seed)`; correct types/goals/bubbles
  per the ramp table; plateau beyond level 16.
- Save/load round-trip, including a mid-level board.

### 16.2 Simulator (`npm run sim`)

Headless player over levels 1–30 × 1000 seeded runs, with two policies:

- `random` — picks a random legal group (models a 5-year-old mashing)
- `greedy` — picks the largest group, preferring goal animals

Reports per level: completion (always 100% by design), mean/median/p10 bubbles left, mean
taps, level duration estimate. Used to set §9.1 for real.

**Acceptance**, each clause read on the run it describes:

- greedy finishes comfortably ahead of random — ≥30% more bubbles on the **mean** run at levels
  1–6 (measured 1.78x at the narrowest);
- `greedy` holds ≈50–65% of the rack on the mean run, asserted at the levels the ramp is sized
  against, 7–12 (measured 63/63/60/61/53/54%). Levels 1–6 measure above the band by design,
  because §9.1 funds them deliberately;
- `random` sits near the floor at level 11+, at **p10** — the plausibly smallest run, measured 1–3
  balloons;
- the party never falls below `medium` on the mean run for either policy, and `greedy` stays `big`
  through level 12. The tier band cannot be asserted at p10: random's plausibly smallest run reads
  `small` at every level, 6% at the plateau, where the count saturates at the cap;
- every rack from level 11 is `random`'s p90 pop count plus 2, within 1, which is the floor clause
  written as a sizing rule;
- the goal phase at the plateau stays inside §9.3's 30–60s band (measured 45s).

If both policies land in the same band, the rack is mis-sized and the number must change — not
the game.

### 16.3 Device tests

Manual checklist on the actual tablet, run at every milestone:

- [x] installs from URL, opens standalone, no address bar — satisfied by Firefox's PWA wrapper
      (ADR-0002), because Chrome's WebAPK shell cannot load on Android 8.1
- [x] works in airplane mode
- [x] rotates to portrait without breaking layout
- [x] no zoom, no scroll, no text selection, no context menu
- [x] 60fps pops, falls and fireworks (or a stable 30)
- [x] every tap gives feedback within one frame
- [x] force-close mid-level → resumes exactly where it was

Run on the target tablet on 2026-10-27 at `9c3714e` (live asset `assets/index-CQJ2DJOe.js`, which a local
build of `main` reproduces), through the Firefox PWA wrapper (ADR-0002) and in Chrome 137 on the same
device for the readings the installed app cannot expose:

- **install, standalone, offline.** The launcher's Pop Pals icon opens `ExternalAppBrowserActivity` with
  no address bar and no browser chrome. With `airplane_mode_on=1` and Wi-Fi/data off (`ping` unreachable),
  a force-stopped app cold-launches from the icon and resumes level 10 exactly.
- **rotation.** Landscape 1280×724 → 900×1104 portrait keeps level, rack, goals and every tile; cell 108px
  → 101px, board square and fully visible, no scroll. The installed app in portrait paints a ~654px board
  (≈109px cells). Portrait also fits a 35-bubble rack (26 columns, two rows) inside the panel row, 245px of
  its 464px, with 64px level and mute boxes.
- **kid-proofing.** A 40→200px pinch leaves `visualViewport.scale` at 1; swipes leave `scrollY` at 0 with
  `scrollHeight == innerHeight`; a 900ms long-press fires no context menu and no selectable text; a double
  tap does not zoom. In the installed app the same swipes and a 1.2s long-press on the level label scroll
  nothing, select nothing, and only arm the adult-reset ✓.
- **frame rate.** The celebration holds 59.1fps at the 60fps tier in Chrome (pops, falls, and a party
  idling 75s with ambient bursts). In Firefox the same party delivers 24.4–29.6fps and the tier reads
  `30fps` (issue #29). Deliberately late frames (6x/8x CPU throttle) take both the tier row and
  `data-tier` to 30fps and back to 60fps 3.4s after the load is removed.
- **tap feedback.** The popped tiles' `.burst` elements are in the DOM by the end of the tap's own event
  dispatch, so the pop is painted on the next animation frame (14ms), not a later one.
- **resume.** After `am force-stop` mid-level, Chrome reopens the same level, seed, rack, goals and a
  byte-identical 36-tile board; the installed app reopens the same level-10 board.

The 2026-10-25 run at `6c1f8e4` is what found #29: the celebration ran at 27.8–31.3fps while the tier kept
reporting 60fps, so the meter never degraded under mixed delivery. `90a1dd1` fixed the meter and the run
above is its device re-check.

---

## 17. Milestones

**M0 — Platform proof (target: this week, ~1 hour).**
Throwaway "hello" PWA deployed to the real URL, installed on the tablet, opened in airplane
mode, landscape, no zoom/scroll. Includes the `?debug=1` overlay skeleton.
*Accept:* every box in §16.3 checked on the device except the game-specific ones.
*Kill criterion:* if PWA install fails on the device, switch to Capacitor APK **before**
building the game.

**M1 — The fun test.**
6×6 board, animal SVGs, tap-to-pop, gravity, refill, reshuffle, pop sounds, no goals, no
bubbles, no celebration.
*Accept:* she taps it for 60 seconds unprompted and doesn't ask what she's supposed to do.
*This is the go/no-go on the whole mechanic.*

**M2 — Goals, party meter, levels.**
Goal cards and rings, bubble rack, level generator + ramp, mid-level state, reshape into the
landscape layout.
*Accept:* a level can be completed; parties vary with play efficiency; unit tests for §16.1
green.

**M3 — Celebration.**
Fireworks overlay, balloons sized by party, fanfare/aww, pulsing ▶, next level.
*Accept:* winning feels like a party; small party feels quiet but never sad; 60fps.

**M4 — Hardening.**
Full persistence + resume, mute toggle, kid-proofing, adult reset, debug overlay completion,
portrait fallback, reduced-motion.
*Accept:* full §16.3 checklist green.

**M5 — Tuning.**
Run the simulator, replace §9.1 with real numbers, watch one real 5-minute session, adjust
pacing/party slack/sound volume. Ship v1.

---

## 18. Definition of done (v1)

- Opens offline on her tablet after install; no address bar, no scroll, no zoom.
- 60fps, or a solid 30, with 36 tiles and a full firework burst; falls are always animated.
- Every tap produces visible feedback within one frame (pop, bubble, ring, sound).
- A dead board auto-reshuffles within 1s, always, with the whoosh.
- Level state survives a force-close mid-level and resumes exactly.
- All core logic unit-tested; level generation seeded and reproducible.
- Simulator shows the ramp is winnable and skill-differentiated.
- **Unsupervised test:** she plays 5 minutes alone, landscape, reaches at least one
  celebration, never gets stuck, never asks for help.
- No text required to play. No way to lose. No way to accidentally leave the game.

---

## 19. Risks

| Risk | Mitigation |
|---|---|
| Chrome frozen at 138 on Android 8.1 | Baseline locked to 138; M0 proves it on device before any game code |
| PWA install unsupported / flaky on old WebView | Materialised in a different way than expected: the install itself works, but Chrome's WebAPK shell cannot load on Android 8.1, so the install path is Firefox's PWA wrapper (ADR-0002). Capacitor stays the fallback for a device with no working PWA shell |
| Old GPU can't hold 60fps with fireworks | Particle pooling, DPR cap 2, automatic 30fps degrade tier — the tier does not engage on the tablet yet, because the meter never reaches its degrade threshold under mixed frame delivery (issue #29) |
| Mechanic isn't actually fun for her | M1 ships the bare loop first; pivot to merge-drop is a core rewrite, decide early |
| Bubble rack grows to the measured 35 items and looks cluttered | 3–4 per row grid in landscape, the portrait band, sized to the panel; `partyPct` (ratio, not count) drives celebration intensity |
| "Fewer taps" lesson is invisible | Rack drains on every tap with the same animation that becomes the balloons |
| Art swap becomes a refactor | Single manifest `animals.ts`; stable ids; data-only change |

---

## 20. Open items

Settled for v1:

- **Final ramp numbers** — measured and shipped (M5, §9.1, README.md); the simulator run recorded
  there is the one `LEVEL_RAMP` is asserted against.
- **5×5 or 6×6** — 6×6 stays. Every measured number in §9.1 and §16.2 is for a 36-cell board, and
  5×5 would retire that measurement and the 90 CSS px cell §13 sizes the tap target from. How it
  feels in her hand is still read in the unsupervised session (§18), but the layout decision is
  closed.
- **A 9th animal** — no; 8 is already at the edge of silhouette distinctness.
- **Twemoji credit** — the CC BY 4.0 attribution is a comment in `src/game/animals.ts` and in
  README.md's Credits, which is what the licence asks for.

Still open:

- **One real unsupervised session** and the device checklist (§16.3, §18) — human/tablet checks,
  tracked on issues #20 and #22.
- **Frame rate under a full burst** (issue #12) — measured on the tablet via `?debug=1`, not in a
  unit test.

---

## 21. Constants (all live in `src/game/constants.ts`)

```ts
export const GRID = 6
export const MIN_GROUP = 2
export const MIN_BUBBLES = 1
export const MAX_BALLOONS = 12
export const MAX_QUEUED_TAPS = 2
export const PLATEAU_LEVEL = 16

// measured with `npm run sim` (SPEC §16.2): levels 1-30, 1000 seeded runs per policy, seed
// 0x5eb00b1e, recorded in README.md. Rows 1-6 are the deliberate estimates; from level 7 every
// rack is the floor-band sizing rule applied to the measurement (SPEC §9.1)
export const LEVEL_RAMP = [
  { from: 1,  types: 4, goalEach: 3, bubbles: 12, minTaps: 3,  medianTaps: 7 },  // estimate, deliberately over-funded
  { from: 3,  types: 5, goalEach: 4, bubbles: 16, minTaps: 6,  medianTaps: 10 }, // estimate
  { from: 7,  types: 5, goalEach: 5, bubbles: 20, minTaps: 7,  medianTaps: 12 }, // measured
  { from: 9,  types: 5, goalEach: 6, bubbles: 22, minTaps: 9,  medianTaps: 14 }, // measured
  { from: 11, types: 6, goalEach: 6, bubbles: 29, minTaps: 11, medianTaps: 18 }, // measured
  { from: 13, types: 6, goalEach: 7, bubbles: 33, minTaps: 13, medianTaps: 21 }, // measured
  { from: 16, types: 6, goalEach: 8, bubbles: 35, minTaps: 15, medianTaps: 23 }, // measured plateau
]
```

`rampDocs.test.ts` parses this block, including the recorded `minTaps`/`medianTaps` columns, and §9.1's
table, and fails if either drifts from the shipped `LEVEL_RAMP`, so the spec cannot quote numbers the game
no longer plays.

**How the first two rows were estimated:** a 6×6 board with *k* types averages
legal clusters of roughly 2.8 / 2.5 / 2.2 animals for k = 4 / 5 / 6. A *greedy* tap (biggest
group) yields about 1.4 / 1.0 / 0.73 goal animals; a *random* tap yields roughly 40% less.
The rack is therefore sized at ≈1.15× the estimated **random-play** tap count, which puts a
careless player near the floor and a careful player around half the rack. These were
**estimates, not measurements** for the rows the rule produced; the §16.2 simulator replaced them from
level 7, and only the calibration target (§9.1) is binding.
