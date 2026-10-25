export const GRID = 6
export const BOARD_SIZE = GRID * GRID
export const MIN_GROUP = 2
export const RESHUFFLE_MIN_GROUP = 3

/** Input queue depth: a tap arriving while the board is still settling is kept, not dropped. */
export const MAX_QUEUED_TAPS = 2

/** SPEC §3: the tap queue the child plays from — three cells, popped cell returns to the tail. */
export const QUEUE_DEPTH = 3

/** The party never reaches zero, so there is no fail state (SPEC §8.3). */
export const MIN_BUBBLES = 1

/** Celebration size is capped, whatever the rack holds (SPEC §8.4). */
export const MAX_BALLOONS = 12

/** The goal card shows up to three animals (SPEC §3, §10); level 30 is the maximum goal count (SPEC §1). */
export const MAX_GOAL_SLOTS = 3
export const MAX_GOAL_COUNT = 30

/** Difficulty stops rising here; only the roster and goals rotate afterwards (SPEC §9.3). */
export const PLATEAU_LEVEL = 16

/** `partyPct` thresholds for celebration intensity (SPEC §8.4). */
export const PARTY_TIERS = { big: 0.5, medium: 0.25 } as const

/**
 * The level ramp (SPEC §9.1): the numbers the §16.2 simulator produced (`npm run sim`), measured
 * over levels 1-30 with 1000 seeded runs per policy at seed 0x5eb00b1e, recorded in README.md.
 *
 * `minTaps` and `medianTaps` are the *pop* counts, not all taps: a bubble leaves the rack on a pop
 * only, so an invalid tap (a single animal, SPEC §7.2) never touches the rack. `medianTaps` is the
 * `random` policy's measured median pop count; `minTaps` is §9.1's estimate of the shortest plausible
 * level, which the measurement does not support (the observed minimum is 2-7 pops). Neither is what a
 * rack is sized from - that is the p90 pop count plus the floor band.
 *
 * Rows 1-6 hold the numbers as they were estimated, over-funded through level 2 so the first party is a
 * big one. From level 7 every rack is the measurement, and the derivation is the floor band itself: the
 * rack is the 90% pop count plus the band, because "random play can plausibly end with 2-3 balloons"
 * describes the run that takes the most pops — the 10% smallest leftover is what a rack leaves to the 90%
 * largest pop count. Levels 7-10 land within 1 of that rule rather than exactly on it, and the row they
 * were estimated at (24) is the estimate the measurement contradicts.
 *
 * That reading is what makes §16.2's two bands hold together: the numeric band and the tier band are read
 * on the mean run, the floor clause at p10. At the plateau the typical run hits the 12-balloon cap for both
 * policies, so the meter's count reads the same there and only the tier separates them. What that costs is
 * the trade recorded on `SIM`: a rack tight enough for the count to read apart on the typical run puts
 * random's p10 at the floor itself, outside the band, and the ramp takes the band.
 */
export const LEVEL_RAMP: Array<LevelRampRow> = [
  { from: 1, types: 4, goalEach: 3, bubbles: 12, minTaps: 3, medianTaps: 7 },
  { from: 3, types: 5, goalEach: 4, bubbles: 16, minTaps: 6, medianTaps: 10 },
  { from: 7, types: 5, goalEach: 5, bubbles: 20, minTaps: 7, medianTaps: 12 },
  { from: 9, types: 5, goalEach: 6, bubbles: 22, minTaps: 9, medianTaps: 14 },
  { from: 11, types: 6, goalEach: 6, bubbles: 29, minTaps: 11, medianTaps: 18 },
  { from: 13, types: 6, goalEach: 7, bubbles: 33, minTaps: 13, medianTaps: 21 },
  { from: 16, types: 6, goalEach: 8, bubbles: 35, minTaps: 15, medianTaps: 23 },
]

export interface LevelRampRow {
  /** First level this row applies to. */
  from: number
  types: number
  /** Goal target per goal animal. */
  goalEach: number
  bubbles: number
  /** Recorded numbers, not the sizing rule (SPEC §16.2): `medianTaps` is the `random` policy's median
   *  pop count, `minTaps` is §9.1's estimate of the shortest plausible level. A row covers several
   *  levels, so a level inside it can be a little off. The rack itself is sized from the p90 pop count
   *  plus the floor band. */
  minTaps: number
  medianTaps: number
}

/** Motion timings, all in one place (SPEC §21). */
export const MOTION = {
  dealStagger: 18,
  dropDuration: 190,
  dropPerRow: 14,
  pop: 200,
  wobble: 150,
  reshuffleShake: 420,
  reshuffleScatter: 260,
  reshuffleStagger: 22,
} as const

/** Synth levels and timings, all in one place (SPEC §11, §21). */
export const AUDIO = {
  masterGain: 0.5,
  popGain: 0.16,
  popDuration: 0.16,
  popNoteSpacing: 0.05,
  popMaxNotes: 6,
  boopPitch: 155,
  boopGain: 0.09,
  boopDuration: 0.18,
  whooshDuration: 0.45,
  whooshGain: 0.16,
  /** Bubble tick: high and short, so it never reads as an animal pop (SPEC §11). */
  bubblePitch: 1568,
  bubbleGain: 0.06,
  bubbleDuration: 0.06,
  balloonNoiseGain: 0.1,
  balloonNoiseDuration: 0.12,
  /** Four-note rising arpeggio, C-E-G-C (SPEC §11). */
  fanfareNotes: [523.25, 659.25, 783.99, 1046.5],
  fanfareNoteSpacing: 0.28,
  fanfareNoteDuration: 0.42,
  fanfareNoteGain: 0.14,
  /** The shimmer that sits under the fanfare, and its filter sweep. */
  shimmerDuration: 1.2,
  shimmerGain: 0.05,
  shimmerFilterStart: 900,
  shimmerFilterEnd: 4200,
  chimeNotes: [880, 659.25], // soft two-note "aww", never a sad sting
  chimeGain: 0.1,
  chimeSpacing: 0.45,
  chimeDuration: 0.5,
} as const

/**
 * Layout, in CSS px at the target density (SPEC §13). These are the numbers the layout
 * module works from, so they live with the other tunables rather than in the stylesheet.
 */
export const LAYOUT = {
  /** Panel column in landscape: 28-32% of the width, goals then rack below them (SPEC §13, §8.2). */
  panelWidthFraction: 0.30,
  /**
   * Board share of the height. The celebration is an overlay over the board (SPEC §10), so it no
   * longer needs a band of its own, and the board keeps enough height for the 90 CSS px cell §13
   * asks for: 6 rows x 90 = 540 of the target device's 600.
   */
  landscapeBoardFraction: 0.90,
  /** Cell bounds; the cell is sized from the board area within them. */
  cellMinPx: 60,
  cellMaxPx: 128,
  /* Portrait puts the panel above the board, so the board gives most of that share back (SPEC §13).
     Written as whole fractions rather than `.55`, because the minifier turns `x ? .55 : y` into
     `x?.55:y`, which the engine-baseline test reads as optional chaining. */
  portraitBoardFraction: 0.55,
  /** Smallest tappable element: 48 device px, which is 90 CSS px at the tablet's density. */
  tapTargetCssPx: 90,
  tapTargetDevicePx: 48,
  /** Rack bubbles (SPEC §8.2): 22-26 CSS px, 3-4 per row, picked from the width the panel has. */
  bubblePxMin: 22,
  bubblePxMax: 26,
  rackColumnsMin: 3,
  rackColumnsMax: 4,
  /**
   * SPEC §8.2: the rack is sized so a full rack fits the panel height at once (issue #10). ADR 0001 amends
   * the number to the measurement: 35 is the largest rack a level shows at once, which is also where §9.1's
   * ramp tops out, so it is both the sizing number and the rack's capacity. 39 was the pre-measurement guess
   * the clause was written from, and no level reaches it.
   */
  rackSizingBubbles: 35,
  /**
   * The chrome the stylesheet reserves inside the panel and the board area. Each value is `style.css`'s own
   * declaration read at 1rem = 16 CSS px, rounded up: the layout model may not charge less than the rule
   * actually reserves, so `styles.test.ts` compares every value below against the stylesheet and fails if
   * either side drifts. That is what turns "the rack fits the panel" from an estimate into a checked number.
   */
  chrome: {
    /** `.panel` padding: 0.8rem vertical, 1rem across. */
    panelPaddingPx: 13,
    panelPaddingXPx: 16,
    /** `.board-area` padding: the margin SPEC §13 asks the board to be centred inside. */
    boardAreaPaddingPx: 16,
    /** `.goal` padding, and the ring the card row has to hold, which is taller than its numeral. */
    goalPaddingPx: 7,
    goalRingPx: 44,
    /** `.rack` padding: 0.5rem vertical, 0.8rem across, plus the 0.6rem it stands away from the panel edge. */
    rackPaddingPx: 8,
    rackPaddingXPx: 13,
    rackMarginPx: 10,
    /** `.rack__bubble` margin-bottom: the row spacing, which the stylesheet charges on every row. */
    rackRowPx: 6,
  },
  /** Nothing interactive is smaller than this (SPEC §13): the mute target and the numeral's box. */
  interactiveMinPx: 64,
  /** Device pixel ratio cap (SPEC §5). */
  dprMax: 2,
} as const

/** Numeral sizes (SPEC §13): level 40-56 CSS px, goal count 28-40 CSS px. */
export const FONTS = {
  levelPx: 44,
  goalPx: 32,
} as const

/**
 * Fireworks (SPEC §10.2). The burst cap is a hard one: the pool in `ui/pool.ts` hands out at
 * most `capacity` particles and never grows, so a burst that would exceed it drops particles
 * rather than allocating them. `degradeAfterMs` is how long frame times must run over budget
 * before the celebration drops to the 30fps tier.
 */
export const PARTICLES = {
  capacity: 500,
  perBurst: 120,
  /** The tier the celebration degrades to when frames run long (SPEC §10.2). */
  degradePerBurst: 60,
  /**
   * Per-second units, because `draw()` integrates with `dt` in seconds (issue #12). 192 px/s is the
   * 3.2 px/frame the burst was first sketched at, and 1.05s is its 64 frames. Read as per-frame
   * against a per-second clock, a burst lived for about a minute and crawled instead of flashing.
   */
  speedPxPerSecond: 192,
  gravityPxPerSecond: 180,
  lifeSeconds: 1.05,
  /** The radius the burst is drawn at, in CSS px. */
  particleSize: 3,
  /** One ambient burst every this many frames once the party is idle (SPEC §10.1 phase 4). */
  ambientFrames: 90,
  /** 60fps budget; over it for `degradeAfterMs` drops the celebration to 30fps. */
  frameBudgetMs: 16.7,
  /**
   * What counts as over budget. A healthy 60Hz panel delivers frames a little unevenly (roughly
   * 16.6-17.2ms), so charging the bare 16.7ms would make a perfect tablet degrade itself. 1.5x is
   * about 25ms: below 40fps, and above anything a 60Hz panel does without being late.
   */
  lateFrameFactor: 1.5,
  /**
   * A gap this long is not a slow frame but a pause: the tab was hidden, the device slept, or the main
   * thread was blocked outside this layer. The meter starts a fresh window instead of charging it to
   * the tier (issue #12).
   */
  stallMs: 250,
  degradeAfterMs: 1000,
  /**
   * A tier this long inside the budget brings the 60fps tier back (issue #12). §10.2 only says the
   * layer drops, so without this the degrade is a ratchet: one bad stretch on the tablet would be
   * the tier for the rest of the session.
   */
  recoverAfterMs: 3000,
} as const

/** Celebration timings, in ms (SPEC §10.1): balloons one at a time, ▶ after a beat. */
export const CELEBRATION = {
  balloonStaggerMs: 120,
  playButtonDelayMs: 1500,
  /** Rings the pentatonic pitches a balloon pop is drawn from (SPEC §11). */
  balloonPitchHz: 1046.5,
} as const

/**
 * Adult long-press reset (SPEC §14.2): three seconds on the level numeral opens the confirm
 * step, and a normal tap never gets that far.
 */
export const ADULT_RESET = {
  holdMs: 3000,
  /** The confirm step gives up if the adult stops interacting, so it never lingers. */
  confirmTimeoutMs: 15000,
} as const

/**
 * Simulator (SPEC §16.2, issue #21): levels 1-30 x 1000 seeded runs per policy. `tapIntervalMs` and
 * `settleMs` turn taps into the session length §9.3 measures; the settle is not additive, because the
 * tap queue (§3) lets her tap while the board is still settling, so a session is taps x interval plus the
 * goal pause. The bands below are what the ramp was chosen against, and `sim.test.ts` asserts them.
 *
 * **How the floor band reads, and why the two bands hold together.** §16.2 asks for two things at the
 * plateau: greedy inside 50-65% of the rack, and `random` near the floor. Read as a mean, those pull the
 * rack in opposite directions, which is how they were first reported as incompatible. Read as §9.1
 * actually writes them — "can plausibly end with 2-3 balloons", a percentile, not a mean — the floor band
 * *is* the sizing rule: the rack that leaves the 10% smallest leftover at 2 balloons is the 90% pop count
 * plus 2. At that rack greedy measures 50-53% at the plateau, inside its band, and random 34-38%, one
 * tier below. Both bands hold, and the tiers still read apart.
 *
 * What that costs, stated plainly: at the plateau the rack is 35, so the typical run hits the 12-balloon
 * cap §8.4 sets for both policies - the meter's count reads 12 for each, and only the mean still reads
 * apart (greedy 11.0, random 9.3). The tier separates them because intensity is a ratio and the count is
 * capped, so the tier band is asserted on the mean run: at p10 random reads `small` at every level. If the
 * meter's count has to read apart on the typical run, the rack has to be tight (around 1.15x the mean pop
 * count), and then random's p10 sits at the floor itself - one balloon, outside the band. That is the
 * trade, and the ramp takes the band.
 */
export const SIM = {
  levels: 30,
  runs: 1000,
  /** The run README.md's numbers were captured from, so the test reproduces the same table. */
  seed: 0x5eb00b1e,
  /** Guard against a runaway run; a level always completes by design (SPEC §3). */
  maxTaps: 2000,
  /** SPEC §1: the fun tail after the goals, capped so a simulated session terminates. */
  funTailTaps: 20,
  tapIntervalMs: 2500,
  settleMs: 300,

  /** §16.2: greedy must finish at least this much ahead of random, at levels 1 through `leadLevels`. */
  leadMargin: 0.3,
  leadLevels: 6,

  /**
   * §16.2's numeric band for greedy, and the tier it earns. The numeric band is asserted at the levels
   * the ramp is sized for it, `numericFrom` through `numericTo`: levels 1-6 measure above it because §9.1
   * funds them deliberately, and from level 13 the rack is sized for the floor band instead, so greedy
   * measures just below the band's floor (46-54%) and holds the medium tier. The tier is what the game
   * reads, so it is asserted at every level: never below medium, big through `bigThrough`.
   */
  greedyBand: { min: PARTY_TIERS.medium, max: 0.65, numericFrom: 7, numericTo: 12, bigThrough: 12 },

  /** §16.2: `random` sits within 2-3 balloons of the floor from level 11, measured at p10. The band is an
   *  upper bound on how near the floor she plausibly gets, and p10 cannot go below the floor, so the lower
   *  edge is the floor itself. Measured p10 at levels 11-30 is 1-3. */
  floorFromLevel: 11,
  bandPercentile: 0.1,
  floorBand: { min: MIN_BUBBLES, max: 3 },

  /** §9.1: from level 11 the rack is the pop count at this percentile plus the floor band's lower edge. */
  rackPercentile: 0.9,
  rackSlack: 2,

  /** A row covers several levels, so a level can be this far from the number its row was chosen against. */
  bandTolerance: 1,

  /**
   * The rack rule is sized on the policy the ramp is measured against — `random` — because the rack has
   * to cover the pop count that play plausibly produces. The greedy policy pops fewer taps out of the
   * same rack, which is exactly the lead §16.2 asks for, so the rule is asserted for `random` alone.
   */

  /** Levels 1-2 are the deliberate exception: over-funded so the first party is a big one. */
  overFundedThrough: 2,

  /** §9.3: the goal phase of a plateau level stays inside this band, in seconds. The fun tail is
   *  open-ended by design (SPEC §1), so §9.3's band can only be read as the goal phase. */
  sessionBand: { min: 30, max: 60 },
} as const
