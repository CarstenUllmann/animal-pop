export const GRID = 6
export const BOARD_SIZE = GRID * GRID
export const MIN_GROUP = 2
export const RESHUFFLE_MIN_GROUP = 3

/** A tap that arrives while the board settles is queued, up to this many. */
export const MAX_QUEUED_TAPS = 2

/** The rack never empties: there is no fail state. */
export const MIN_BUBBLES = 1

export const MAX_BALLOONS = 12

export const PLATEAU_LEVEL = 16

/** `pct` thresholds for the celebration's intensity. */
export const PARTY_TIERS = { big: 0.5, medium: 0.25 } as const

/**
 * Measured with `npm run sim`: levels 1-30, 1000 runs per policy, seed 0x5eb00b1e (recorded in
 * README.md). The rows starting at levels 1 and 3 are deliberate estimates; from level 7 every
 * rack is measured.
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
  /** Shortest plausible level, in pops. */
  minTaps: number
  /** Median pop count of the `random` policy. */
  medianTaps: number
}

/** Motion timings, in ms. */
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
  /** High and short, so the bubble tick never reads as an animal pop. */
  bubblePitch: 1568,
  bubbleGain: 0.06,
  bubbleDuration: 0.06,
  /** A latex click over a body that drops 320 → 120 Hz. */
  balloonPopClickStartHz: 3600,
  balloonPopClickEndHz: 1400,
  balloonPopClickDuration: 0.02,
  balloonPopClickGain: 0.1,
  balloonPopBodyFromHz: 320,
  balloonPopBodyToHz: 120,
  balloonPopDuration: 0.14,
  balloonPopGain: 0.22,
  /** Pitch drift either side of the body, so repeated taps are not one sound replayed. */
  balloonPopPitchJitter: 0.06,
  /** A muffled thump with a sparkle tail, at 40% of a balloon pop's peak: weather, not an event. */
  fireworkThumpFromHz: 110,
  fireworkThumpToHz: 42,
  fireworkThumpDuration: 0.22,
  fireworkThumpGain: 0.088,
  fireworkAirDuration: 0.2,
  fireworkAirGain: 0.03,
  fireworkAirFilterStart: 320,
  fireworkAirFilterEnd: 90,
  fireworkCrackleMin: 11,
  fireworkCrackleMax: 17,
  fireworkCrackleGain: 0.015,
  fireworkCrackleSpreadMin: 0.45,
  fireworkCrackleSpreadMax: 0.65,
  /** A rising C-E-G-C arpeggio. */
  fanfareNotes: [523.25, 659.25, 783.99, 1046.5],
  fanfareNoteSpacing: 0.28,
  fanfareNoteDuration: 0.42,
  fanfareNoteGain: 0.14,
  shimmerDuration: 1.2,
  shimmerGain: 0.05,
  shimmerFilterStart: 900,
  shimmerFilterEnd: 4200,
  /** Soft two-note "aww", never a sad sting. */
  chimeNotes: [880, 659.25],
  chimeGain: 0.1,
  chimeSpacing: 0.45,
  chimeDuration: 0.5,
} as const

/** Layout numbers in CSS px at the target density. */
export const LAYOUT = {
  panelWidthFraction: 0.30,
  landscapeBoardFraction: 0.90,
  /** The board's smallest cell. Below 90 the root reports `data-tap-target="too-small"`. */
  cellMinPx: 60,
  cellMaxPx: 128,
  /* A whole fraction, because the minifier turns `.58` into a token the baseline test reads as `?.`. */
  portraitBoardFraction: 0.58,
  tapTargetCssPx: 90,
  tapTargetDevicePx: 48,
  bubblePxMin: 22,
  bubblePxMax: 26,
  rackColumnsMin: 3,
  rackColumnsMax: 4,
  /** The largest rack a level shows, so it is both the sizing number and the capacity. */
  rackSizingBubbles: 35,
  /** Nothing interactive is smaller than this. */
  interactiveMinPx: 64,
  balloonWidthFactor: 0.195,
  balloonHeightFactor: 0.225,
  /** Floor after the −6% jitter, so every balloon still clears the tap target. */
  balloonPxMin: 120,
  balloonHeightRatio: 1.18,
  balloonSizeJitter: 0.06,
  /** Clearance between a floating balloon and the board border. The play arrow uses it too. */
  balloonMarginPx: 16,
  /** Minimum centre distance, as a fraction of the mean of the two jittered sizes. */
  balloonSpacingFactor: 0.55,
  /** Spacing stops tightening here; below it the count drops instead. */
  balloonMinExposure: 0.40,
  /** Step between the spacing rungs, in percent. */
  balloonSpacingStepPct: 5,
  celebrationBottomPaddingPct: 4,
  balloonBandBottomMin: 50,
  dprMax: 2,
} as const

/** Chrome the stylesheet reserves inside the panel and the board area. */
export const CHROME = {
  panelPaddingPx: 13,
  panelPaddingXPx: 16,
  boardAreaPaddingPx: 16,
  goalPaddingPx: 7,
  goalRingPx: 44,
  rackPaddingPx: 8,
  rackPaddingXPx: 13,
  rackMarginPx: 10,
  /** Space between rack rows. */
  rackRowPx: 6,
} as const

export const FONTS = {
  levelPx: 44,
  goalPx: 32,
} as const

/** The seven hues a firework burst draws from. */
export const FIREWORK_COLORS = ['#ff5c8a', '#ffd166', '#4ce3c0', '#7bdff2', '#b388ff', '#ff8f4d', '#fff3b0'] as const

/** Kept apart from `FIREWORK_COLORS`: the two palettes sit on different backgrounds. */
export const BALLOON_COLORS = [
  '#ff8fab',
  '#ffd166',
  '#7bdff2',
  '#a0e57c',
  '#c9a7ff',
  '#ff9f68',
  '#ff6b6b',
  '#4ce3c0',
  '#6ea8fe',
] as const

/** Fireworks. The pool never grows, so a burst beyond capacity drops particles. */
export const PARTICLES = {
  capacity: 500,
  perBurst: 120,
  degradePerBurst: 60,
  speedPxPerSecond: 192,
  gravityPxPerSecond: 180,
  lifeSeconds: 1.05,
  radiusMin: 2,
  radiusMax: 5,
  /** About one particle in five is near-white, so a burst sparkles. */
  whiteShare: 0.2,
  whiteColor: '#fffaf0',
  burstHuesMin: 2,
  burstHuesMax: 3,
  hotCoreLifeFraction: 0.2,
  frameBudgetMs: 16.7,
  /** A healthy 60Hz panel is a little uneven, so only 1.5× the budget counts as late. */
  lateFrameFactor: 1.5,
  /** A longer gap is a pause (hidden tab, sleep), not a slow frame. */
  stallMs: 250,
  /** Delivered frames are averaged over this window before a tier decision. */
  measureWindowMs: 250,
  degradeAfterMs: 1000,
  recoverAfterMs: 3000,
} as const

/** Celebration timings, in ms. */
export const CELEBRATION = {
  balloonRiseMs: 1200,
  balloonRiseEase: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  balloonStaggerMs: 120,
  /** One sway cycle. The bob runs at twice this rate so the two never resolve into a circle. */
  balloonFloatMsMin: 6000,
  balloonFloatMsMax: 7000,
  balloonSwayPx: 7,
  balloonBobPx: 8,
  /** How long a popped balloon takes to collapse before it leaves the layer. */
  balloonCollapseMs: 180,
  /** The stylesheet fallback; the shipped delay is computed per party. */
  playButtonDelayMs: 1500,
  /** The firework volley follows the fanfare, so the party opens on one cue. */
  fireworkVolleyAtMs: 1200,
  fireworkVolleyGapMs: 180,
  fireworkVolleySecondGapMs: 280,
  /** The bed starts after the volley and repeats on a timer, so it survives the 30fps tier. */
  fireworkBedStartsAtMs: 2200,
  fireworkBedMs: 1000,
} as const

/** The ▶ waits until the last balloon has landed. */
export function playButtonDelayMsFor(partySize: number): number {
  return CELEBRATION.balloonRiseMs + Math.max(0, partySize - 1) * CELEBRATION.balloonStaggerMs
}

export const ADULT_RESET = {
  holdMs: 3000,
  /** The confirm step gives up if the adult stops interacting. */
  confirmTimeoutMs: 15000,
  shakeMs: 500,
} as const

/** Simulator settings and acceptance bands. `sim.test.ts` asserts the bands. */
export const SIM = {
  levels: 30,
  runs: 1000,
  /** The run README.md's numbers were captured from. */
  seed: 0x5eb00b1e,
  /** Guard against a runaway run; a level always completes by design. */
  maxTaps: 2000,
  /** The fun tail after the goals, capped so a simulated session terminates. */
  funTailTaps: 20,
  tapIntervalMs: 2500,
  settleMs: 300,

  /** Greedy must finish at least this much ahead of random at levels 1 through `leadLevels`. */
  leadMargin: 0.3,
  leadLevels: 6,

  /** Greedy's rack share on the mean run, and the tier it earns. */
  greedyBand: { min: 0.5, max: 0.65, numericFrom: 7, numericTo: 12, bigThrough: 12 },

  /** Random play sits near the floor from `floorFromLevel`, measured at `bandPercentile`. */
  floorFromLevel: 11,
  bandPercentile: 0.1,
  floorBand: { min: MIN_BUBBLES, max: 3 },

  /** From level 11 the rack is the pop count at this percentile plus `rackSlack`. */
  rackPercentile: 0.9,
  rackSlack: 2,

  /** A ramp row covers several levels, so a level may sit this far from its row's number. */
  bandTolerance: 1,

  /** Levels 1-2 are over-funded so the first party is a big one. */
  overFundedThrough: 2,

  /** The goal phase of a plateau level must stay inside this band, in seconds. */
  sessionBand: { min: 30, max: 60 },
} as const
