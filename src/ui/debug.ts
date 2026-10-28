import type { LevelState } from '../game/types'
import type { LayoutMetrics } from './layout'
import { traceLines, type BootLog } from './bootlog'
import type { MatchMedia } from './capabilities'

/**
 * Adult debug overlay (`?debug=1`), SPEC §14.3 and issue #18.
 *
 * `?debug=1` only, never a child-visible toggle, so it stays plain, dense and monospace. It
 * shows what the panel shows plus what the panel cannot: the tap queue, the live particles,
 * and the tier the renderer is actually running at.
 *
 * The game hands over one snapshot and the overlay paints every row from it. There is no per-row
 * `set(key, text)` any more: the row keys were a protocol between the game and the overlay, so adding
 * a row meant editing both, and the suite that guarded it read `main.ts` as text. Now a row is
 * declared here, formatted here, and the only thing the game sends is the state it already has.
 */

/**
 * SPEC §14.3: `?debug=1` or `?debug=true`, and nothing else. `1` is what the child-proofed
 * tablet will actually be typed, so it has to work; the flag is read from the URL only, never
 * from storage, so a debug run cannot leak into the next normal launch.
 */
export function parseDebugFlag(search: string): boolean {
  const match = /[?&]debug=([^&#]*)/.exec(search)
  if (match === null) return false
  const value = match[1]
  if (value === undefined) return false
  // Lower-cased, because `?debug=TRUE` is what a parent actually types on the tablet (SPEC §14.3).
  const normalised = value.toLowerCase()
  return normalised === '1' || normalised === 'true'
}

/** What the overlay shows of a goal: what is still missing, which is what an adult can check. */
export interface GoalRow {
  label: string
  current: number
  needed: number
}

/**
 * The facts that are fixed for the run. `display`, `motion` and the seed are read once at boot, so
 * they cannot move and are not part of the snapshot the game keeps sending (SPEC §9.2, issue #19).
 */
export interface DebugMount {
  /** The per-install seed, `0x…` (SPEC §9.2). */
  seed: number
  /** `standalone` for the installed app, `browser` for a Chrome visit (issue #23). */
  display: string
  /** The system's reduced-motion setting, which the board and party read once at boot (SPEC §13). */
  motion: string
  /** The boot trace, the reason the overlay is worth opening on the tablet (issue #23). */
  bootLog: BootLog
  /** Left out when the overlay is mounted outside a running game. */
  onNextLevel?: () => void
}

/** The party's live numbers. Null while it is not running, which is a different thing from zero. */
export interface LiveCounts {
  balloons: number
  particles: number
  tier: string
}

/** Everything that can move during a run, as one value rather than ten calls. */
export interface DebugSnapshot {
  state: LevelState
  layout: LayoutMetrics
  /** Taps waiting while the board is busy. The cap is MAX_QUEUED_TAPS in game/constants.ts. */
  queue: number
  live: LiveCounts | null
}

export interface DebugOverlay {
  element: HTMLElement
  /** Paint every live row from one snapshot. */
  report(snapshot: DebugSnapshot): void
  measureFps(now: number): string
  reportError(message: string): void
}

/** Long values would push the overlay over the panel, so rows are capped. */
export const MAX_VALUE_LENGTH = 48

/**
 * The rows the overlay declares, and the only place a row's text is decided.
 *
 * Issue #18 wants every listed field live. A row is live when it is read from the snapshot the game
 * keeps sending, so "can this row move?" is answered by the shape of `DebugSnapshot` rather than by
 * grepping the composition root for a call. `fps` is the one row the overlay measures for itself,
 * and `boot` reads the log, which pushes rather than being sampled.
 */
export interface RowDef {
  key: string
  label: string
  value: (mount: DebugMount, snapshot: DebugSnapshot) => string
  /** The trace row: never truncated, and painted by the log rather than by a report. */
  trace?: boolean
  /** True when the value cannot change during a run. */
  fixed?: boolean
}

export const DEBUG_ROWS: readonly RowDef[] = [
  { key: 'level', label: 'level', value: (_mount, snapshot) => numberText(snapshot.state.level) },
  { key: 'seed', label: 'seed', value: (mount) => seedText(mount.seed), fixed: true },
  // The environment rows make the device checks readable on the tablet itself. `display` is what tells
  // a standalone launch from a browser visit (issue #23 asked for it), `motion` is the system setting the
  // reduced-motion rules read (issue #19), and `viewport`/`cell` are the numbers §13's fit and issue #10's
  // 90 CSS px criterion are measured against (issue #20).
  { key: 'display', label: 'display', value: (mount) => mount.display, fixed: true },
  { key: 'motion', label: 'motion', value: (mount) => mount.motion, fixed: true },
  {
    key: 'viewport',
    label: 'viewport',
    value: (_mount, snapshot) => viewportText(snapshot.layout.viewportWidth, snapshot.layout.viewportHeight),
  },
  { key: 'cell', label: 'board cell', value: (_mount, snapshot) => cellText(snapshot.layout.cell) },
  { key: 'animals', label: 'animals', value: (_mount, snapshot) => animalsText(snapshot.state.roster) },
  { key: 'rack', label: 'rack', value: (_mount, snapshot) => numberText(snapshot.state.bubbles) },
  { key: 'goals', label: 'remaining goals', value: (_mount, snapshot) => goalsText(goalRowsFor(snapshot.state)) },
  { key: 'queue', label: 'tap queue', value: (_mount, snapshot) => numberText(snapshot.queue) },
  { key: 'balloons', label: 'balloons popped', value: (_mount, snapshot) => numberText(liveCountsFor(snapshot).balloons) },
  { key: 'particles', label: 'particles alive', value: (_mount, snapshot) => numberText(liveCountsFor(snapshot).particles) },
  { key: 'tier', label: 'frame tier', value: (_mount, snapshot) => liveCountsFor(snapshot).tier },
  { key: 'fps', label: 'fps', value: () => 'not running' },
  { key: 'boot', label: 'boot', value: (mount) => traceText(mount.bootLog), trace: true },
]

export function debugRowKeys(): string[] {
  return DEBUG_ROWS.map((row) => row.key)
}

/** Every row's text for one snapshot, which is the whole model the overlay paints from. */
export function snapshotRows(mount: DebugMount, snapshot: DebugSnapshot): Record<string, string> {
  const rows: Record<string, string> = {}
  for (const row of DEBUG_ROWS) {
    const text = row.value(mount, snapshot)
    rows[row.key] = row.trace ? text : truncate(text)
  }
  return rows
}

/** Goals read as what is still missing, which is the thing an adult can check against the panel. */
export function goalRowsFor(state: LevelState): GoalRow[] {
  return state.goals.map((goal) => ({
    label: goal.animal,
    current: goal.target - goal.remaining,
    needed: goal.target,
  }))
}

/**
 * The party's numbers, or the idle words when no party is running. A row that kept the last party's
 * numbers would look live and be wrong, so the idle case is spelled out rather than defaulted to zero.
 */
export function liveCountsFor(snapshot: DebugSnapshot): LiveCounts {
  if (snapshot.live === null) return { balloons: 0, particles: 0, tier: 'not running' }
  return snapshot.live
}

export function numberText(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

export function seedText(seed: number | undefined): string {
  return seed === undefined ? '' : `0x${(seed >>> 0).toString(16)}`
}

/**
 * What kind of launch this is (issue #23).
 *
 * The browser and the installed app run the same bundle in different engines, so a crash report is only
 * meaningful once the overlay says which one it is. `navigator.standalone` is the iOS spelling; Android's
 * WebAPK answers the `display-mode` media query. `unknown` is a real answer: it names an engine without
 * `matchMedia`, which is exactly the kind of old WebView issue #23 is about.
 */
export function displayMode(media: MatchMedia | null, standalone: boolean | undefined): string {
  if (standalone === true) return 'standalone'
  if (media === null) return 'unknown'
  return media.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'
}

/** The system's reduced-motion setting (SPEC §13, issue #19). The modules read it once at boot. */
export function motionPreference(media: MatchMedia | null): string {
  if (media === null) return 'unknown'
  return media.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'
}

/** The viewport the layout was computed for, in CSS px (SPEC §16.3). */
export function viewportText(width: number, height: number): string {
  return `${Math.round(width)}×${Math.round(height)}`
}

/** The board cell size, rounded the way the stylesheet writes it (SPEC §13). */
export function cellText(cell: number): string {
  return `${Math.round(cell)}px`
}

export function animalsText(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  return value === undefined ? '' : String(value)
}

/** Goals read as what is still missing, which is the thing an adult can check against the panel. */
export function goalsText(goals: readonly GoalRow[] | undefined): string {
  if (goals === undefined || goals.length === 0) return 'none yet'
  return goals.map((goal) => `${goal.label} ${goal.needed - goal.current} left`).join(', ')
}

/** Clicking the button is the whole point, so a click that arrives while it is disabled must
 *  do nothing rather than advance a level the child never finished. */
export function nextLevelClick(handler: (() => void) | undefined, enabled: boolean): void {
  if (!enabled || handler === undefined) return
  handler()
}

/** The error row shows what the game reports and nothing else. It is deliberately not truncated:
 *  `MAX_VALUE_LENGTH` caps a row, but the error is the reason the overlay was opened. An empty message
 *  would leave the row blank, so it keeps the word the row already shows before anything is reported
 *  (issue #18). */
export function errorText(message: string): string {
  return message === '' ? 'none' : message
}

/** The rolling window the fps row averages over, in ms. */
export const FPS_WINDOW_MS = 300

export function updateFps(now: number, samples: number[]): string {
  const window = FPS_WINDOW_MS
  const recent = samples.filter((sample) => now - sample <= window)
  if (recent.length < 2) return 'no readings yet'

  const last = recent[recent.length - 1]
  const first = recent[0]
  if (last === undefined || first === undefined) return 'no readings yet'

  const span = last - first
  if (span <= 0) return 'no readings yet'
  return ((recent.length - 1) / (span / 1000)).toFixed(1)
}

/**
 * Record one animation frame and return the rolling rate. `measureFps` used to pass
 * `samples.concat([now])` and never store the sample, so the history stayed empty and the row read
 * "no readings yet" for the whole session - the one number #12's device check needs. The samples live
 * here, pruned to what the window can still use, so a party that idles for an hour cannot grow it.
 */
export function recordFps(now: number, samples: number[]): string {
  samples.push(now)

  const oldest = now - FPS_WINDOW_MS
  let expired = 0
  while (expired < samples.length && (samples[expired] as number) < oldest) expired += 1
  if (expired > 0) samples.splice(0, expired)

  return updateFps(now, samples)
}

/**
 * The trace is the reason the overlay is worth opening on the tablet, so it is never truncated.
 *
 * SPEC §14.3: "the previous run's steps then this run's". Both halves matter on the tablet: the browser
 * and the installed app share one Chrome profile, so the previous run is the standalone launch that died,
 * and this run is the browser visit reading it (issue #23). Showing only `current()` hid exactly the run
 * the overlay was opened to see. `traceLines` starts each run with its own timestamp, so the two blocks
 * stay distinguishable without a heading the row would have to spend a line on.
 */
function traceText(log: BootLog): string {
  const lines: string[] = []
  const previous = log.previous()
  if (previous !== null) lines.push(...traceLines(previous))
  lines.push(...traceLines(log.current()))
  return lines.join('\n')
}

/** A long value would push the overlay over the panel, so it is capped (never a trace row). */
function truncate(text: string): string {
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text
}

/** A declared row always has a value; this keeps the indexed lookup total without optional chaining. */
function textFor(rows: Record<string, string>, key: string): string {
  const text = rows[key]
  return text === undefined ? '' : text
}

export function mountDebugOverlay(root: HTMLElement, mount: DebugMount, snapshot: DebugSnapshot): DebugOverlay {
  const panel = document.createElement('div')
  panel.className = 'debug'

  const header = document.createElement('div')
  header.className = 'debug__header'
  const title = document.createElement('span')
  title.className = 'debug__title'
  title.textContent = 'debug'
  const toggle = document.createElement('button')
  toggle.className = 'debug__button'
  toggle.type = 'button'
  toggle.textContent = 'hide'
  toggle.addEventListener('click', () => {
    panel.classList.toggle('debug--collapsed')
    toggle.textContent = panel.classList.contains('debug--collapsed') ? 'show' : 'hide'
  })
  header.append(title, toggle)

  const next = document.createElement('button')
  next.className = 'debug__button'
  next.type = 'button'
  next.textContent = 'next level'
  next.disabled = mount.onNextLevel === undefined
  next.addEventListener('click', () => nextLevelClick(mount.onNextLevel, !next.disabled))
  header.append(next)

  const grid = document.createElement('dl')
  grid.className = 'debug__rows'
  const values: Record<string, HTMLElement> = {}
  // The mount paints from the same snapshot `report` paints from, so the value a row shows at mount and
  // the value the game reports for the same thing cannot disagree.
  const painted = snapshotRows(mount, snapshot)

  for (const row of DEBUG_ROWS) {
    const label = document.createElement('dt')
    label.className = 'debug__label'
    label.textContent = row.label

    const value = document.createElement('dd')
    value.className = row.trace ? 'debug__value debug__value--trace' : 'debug__value'
    value.textContent = textFor(painted, row.key)
    values[row.key] = value

    grid.append(label, value)
  }

  // Issue #18: the boot row is the one that changes without a report, because the trace grows while the
  // game runs. The log tells us when it moves, so the row is not a snapshot taken at mount.
  const bootRow = values['boot']
  if (bootRow !== undefined) {
    paint(bootRow, traceText(mount.bootLog))
    mount.bootLog.subscribe(() => paint(bootRow, traceText(mount.bootLog)))
  }

  const errorRow = document.createElement('div')
  errorRow.className = 'debug__error'
  const errorLabel = document.createElement('span')
  errorLabel.className = 'debug__error-label'
  errorLabel.textContent = 'last error'
  const errorValue = document.createElement('p')
  errorValue.className = 'debug__error-value'
  // What the row shows before anything is reported is the same word `errorText` falls back to, so the
  // row and the helper cannot disagree about what "no error" looks like (issue #18).
  errorValue.textContent = errorText('')
  errorRow.append(errorLabel, errorValue)

  const footer = document.createElement('div')
  footer.className = 'debug__footer'
  const hint = document.createElement('span')
  hint.className = 'debug__hint'
  hint.textContent = 'issue #23'
  footer.append(hint)

  panel.append(header, grid, errorRow, footer)
  if (root !== null) root.append(panel)

  // FPS is measured by the renderer, so the overlay keeps its own samples rather than reading them from
  // a snapshot that is taken every 250ms.
  const samples: number[] = []
  const measureFps = (now: number): string => {
    const text = recordFps(now, samples)
    const row = values['fps']
    if (row !== undefined) paint(row, text)
    return text
  }

  return {
    element: panel,
    report(snapshot: DebugSnapshot): void {
      const rows = snapshotRows(mount, snapshot)
      for (const row of DEBUG_ROWS) {
        // The two rows that do not come from a report: the trace pushes, and the fps row is sampled.
        if (row.trace || row.key === 'fps') continue
        const element = values[row.key]
        if (element !== undefined) paint(element, textFor(rows, row.key))
      }
    },
    measureFps,
    reportError(message: string): void {
      errorValue.textContent = errorText(message)
    },
  }
}

function paint(element: HTMLElement, text: string): void {
  element.textContent = text
}
