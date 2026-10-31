import type { LevelState } from '../game/types'
import type { LayoutMetrics } from './layout'
import { traceLines, type BootLog } from './bootlog'
import type { MatchMedia } from './capabilities'

/**
 * The adult debug overlay (`?debug=1`). One snapshot goes in and every row is painted from it, so a
 * row cannot be stale; the trace row pushes and the fps row samples its own frames.
 */

/** `?debug=1` or `?debug=true`, from the URL only. */
export function parseDebugFlag(search: string): boolean {
  const match = /[?&]debug=([^&#]*)/.exec(search)
  if (match === null) return false
  const value = match[1]
  if (value === undefined) return false
  const normalised = value.toLowerCase()
  return normalised === '1' || normalised === 'true'
}

/** What the overlay shows of a goal: what is still missing. */
export interface GoalRow {
  label: string
  current: number
  needed: number
}

/** The facts that are fixed for the run. */
export interface DebugMount {
  /** The per-install seed, `0x…`. */
  seed: number
  /** `standalone` for the installed app, `browser` for a Chrome visit. */
  display: string
  /** The system's reduced-motion setting. */
  motion: string
  bootLog: BootLog
  /** Left out when the overlay is mounted outside a running game. */
  onNextLevel?: () => void
}

/** The party's live numbers; null while it is not running, which is not the same as zero. */
export interface LiveCounts {
  balloons: number
  particles: number
  tier: string
}

export interface DebugSnapshot {
  state: LevelState
  layout: LayoutMetrics
  /** Taps waiting while the board is busy. */
  queue: number
  live: LiveCounts | null
}

export interface DebugOverlay {
  element: HTMLElement
  report(snapshot: DebugSnapshot): void
  measureFps(now: number): string
  reportError(message: string): void
}

/** Long values would push the overlay over the panel, so rows are capped. */
export const MAX_VALUE_LENGTH = 48

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

/** Every row's text for one snapshot. */
export function snapshotRows(mount: DebugMount, snapshot: DebugSnapshot): Record<string, string> {
  const rows: Record<string, string> = {}
  for (const row of DEBUG_ROWS) {
    const text = row.value(mount, snapshot)
    rows[row.key] = row.trace ? text : truncate(text)
  }
  return rows
}

export function goalRowsFor(state: LevelState): GoalRow[] {
  return state.goals.map((goal) => ({
    label: goal.animal,
    current: goal.target - goal.remaining,
    needed: goal.target,
  }))
}

/** The party's numbers, or the idle words when none is running. */
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

/** `standalone`, `browser`, or `unknown` when the engine has no `matchMedia`. */
export function displayMode(media: MatchMedia | null, standalone: boolean | undefined): string {
  if (standalone === true) return 'standalone'
  if (media === null) return 'unknown'
  return media.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'
}

/** The system's reduced-motion setting, read once at boot. */
export function motionPreference(media: MatchMedia | null): string {
  if (media === null) return 'unknown'
  return media.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'
}

export function viewportText(width: number, height: number): string {
  return `${Math.round(width)}×${Math.round(height)}`
}

export function cellText(cell: number): string {
  return `${Math.round(cell)}px`
}

export function animalsText(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  return value === undefined ? '' : String(value)
}

/** Goals read as what is still missing. */
export function goalsText(goals: readonly GoalRow[] | undefined): string {
  if (goals === undefined || goals.length === 0) return 'none yet'
  return goals.map((goal) => `${goal.label} ${goal.needed - goal.current} left`).join(', ')
}

/** A click that arrives while the button is disabled must do nothing. */
export function nextLevelClick(handler: (() => void) | undefined, enabled: boolean): void {
  if (!enabled || handler === undefined) return
  handler()
}

/** The error row is never truncated: the error is the reason the overlay was opened. */
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

/** Record one frame and return the rolling rate, pruning samples the window can no longer use. */
export function recordFps(now: number, samples: number[]): string {
  samples.push(now)

  const oldest = now - FPS_WINDOW_MS
  let expired = 0
  while (expired < samples.length && (samples[expired] as number) < oldest) expired += 1
  if (expired > 0) samples.splice(0, expired)

  return updateFps(now, samples)
}

/** The previous run's trace followed by this one's, each starting with its own timestamp. */
function traceText(log: BootLog): string {
  const lines: string[] = []
  const previous = log.previous()
  if (previous !== null) lines.push(...traceLines(previous))
  lines.push(...traceLines(log.current()))
  return lines.join('\n')
}

/** A long value would push the overlay over the panel, so it is capped. */
function truncate(text: string): string {
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text
}

/** A declared row always has a value; this keeps the indexed lookup total. */
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

  // The trace grows while the game runs, so the log tells the row when to repaint.
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

  // FPS is measured here rather than read from a snapshot taken every 250ms.
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
