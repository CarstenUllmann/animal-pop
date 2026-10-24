import { traceLines, type BootLog } from './bootlog'

/**
 * Adult debug overlay (`?debug=1`), SPEC §14.3 and issue #18.
 *
 * `?debug=1` only, never a child-visible toggle, so it stays plain, dense and monospace. It
 * shows what the panel shows plus what the panel cannot: the tap queue, the live particles,
 * and the tier the renderer is actually running at.
 *
 * The overlay does not own those numbers - the game reports them through `set`. That is what
 * keeps the overlay from ever disagreeing with the panel, and it is why the row helpers are
 * pure: the value formatting is the part that can be tested without a screen.
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

export interface GoalRow {
  label: string
  current: number
  needed: number
}

/** What the game tells the overlay. Everything is optional, because a row is only as true as the
 *  last thing the game reported for it - and a mount before the game has a level has nothing. */
export interface DebugInfo {
  level?: number
  seed?: number
  animals?: readonly string[]
  /** Bubbles left in the rack (SPEC §13). */
  bubbles?: number
  goals?: readonly GoalRow[]
  /** Taps waiting while the board is busy. The cap is MAX_QUEUED_TAPS in game/constants.ts. */
  queue?: number
  balloons?: number
  particles?: number
  /** The tier the renderer is on (SPEC §10.2). Not the tier the game hoped for. */
  tier?: string
  /** The boot trace, the reason the overlay is worth opening on the tablet (issue #23). */
  bootLog?: BootLog
  /** Left out when the overlay is mounted outside a running game. */
  onNextLevel?: () => void
}

export interface DebugOverlay {
  element: HTMLElement
  /** Report a row. An unknown key paints nothing, and a long value is truncated. */
  set(key: string, text: string): string
  measureFps(now: number): string
  reportError(message: string): void
}

/** Long values would push the overlay over the panel, so rows are capped. */
export const MAX_VALUE_LENGTH = 48

/** The rows the game can report, plus `boot`, the trace, which is not a value. */
const GAME_KEYS = ['level', 'seed', 'animals', 'rack', 'goals', 'queue', 'balloons', 'particles', 'tier', 'fps']

export function isDebugRow(key: string): boolean {
  return key === 'boot' || GAME_KEYS.indexOf(key) >= 0
}

/** The text a row shows for a reported value. A trace row is never truncated. */
export function debugRowText(key: string, text: string): string {
  if (!isDebugRow(key)) return ''
  if (key === 'boot') return text
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text
}

/** The text a row shows for a value the game hands over, in its own type. */
export function rowText(key: string, value: unknown): string {
  if (!isDebugRow(key)) return ''
  if (key === 'boot') return String(value)
  if (key === 'animals') return animalsText(value)
  if (key === 'goals') return goalsText(value as readonly GoalRow[] | undefined)
  return debugRowText(key, value === undefined ? '' : String(value))
}

export function numberText(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

export function seedText(seed: number | undefined): string {
  return seed === undefined ? '' : `0x${(seed >>> 0).toString(16)}`
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

interface RowDef {
  key: string
  label: string
  /** What the row shows before the game has reported anything for it. */
  initial: (info: DebugInfo) => string
  trace?: boolean
}

const ROWS: RowDef[] = [
  { key: 'level', label: 'level', initial: (info) => textOr(numberText(info.level), 'not started') },
  { key: 'seed', label: 'seed', initial: (info) => textOr(seedText(info.seed), 'not recorded') },
  { key: 'animals', label: 'animals', initial: (info) => animalsText(info.animals) },
  { key: 'rack', label: 'rack', initial: (info) => textOr(numberText(info.bubbles), 'no rack') },
  { key: 'goals', label: 'remaining goals', initial: (info) => goalsText(info.goals) },
  { key: 'queue', label: 'tap queue', initial: (info) => textOr(numberText(info.queue), '0') },
  { key: 'balloons', label: 'balloons popped', initial: (info) => textOr(numberText(info.balloons), '0') },
  { key: 'particles', label: 'particles alive', initial: (info) => textOr(numberText(info.particles), '0') },
  { key: 'tier', label: 'frame tier', initial: (info) => textOr(info.tier, 'not running') },
  { key: 'fps', label: 'fps', initial: () => 'not running' },
  { key: 'boot', label: 'boot', initial: (info) => traceText(info.bootLog), trace: true },
]

export function updateFps(now: number, samples: number[]): string {
  const window = 300
  const recent = samples.filter((sample) => now - sample <= window)
  if (recent.length < 2) return 'no readings yet'

  const last = recent[recent.length - 1]
  const first = recent[0]
  if (last === undefined || first === undefined) return 'no readings yet'

  const span = last - first
  if (span <= 0) return 'no readings yet'
  return ((recent.length - 1) / (span / 1000)).toFixed(1)
}

/** The trace is the reason the overlay is worth opening on the tablet, so it is never truncated. */
function traceText(log: BootLog | undefined): string {
  if (log === undefined) return 'nothing recorded yet'
  return traceLines(log.current()).join('\n')
}

function textOr(value: string | undefined, fallback: string): string {
  return value === undefined || value === '' ? fallback : value
}

export function mountDebugOverlay(root: HTMLElement, info: DebugInfo): DebugOverlay {
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
  next.disabled = info.onNextLevel === undefined
  next.addEventListener('click', () => nextLevelClick(info.onNextLevel, !next.disabled))
  header.append(next)

  const grid = document.createElement('dl')
  grid.className = 'debug__rows'
  const values: Record<string, HTMLElement> = {}

  for (const row of ROWS) {
    const label = document.createElement('dt')
    label.className = 'debug__label'
    label.textContent = row.label

    const value = document.createElement('dd')
    value.className = row.trace ? 'debug__value debug__value--trace' : 'debug__value'
    value.textContent = row.initial(info)
    values[row.key] = value

    grid.append(label, value)
  }

  const errorRow = document.createElement('div')
  errorRow.className = 'debug__error'
  const errorLabel = document.createElement('span')
  errorLabel.className = 'debug__error-label'
  errorLabel.textContent = 'last error'
  const errorValue = document.createElement('p')
  errorValue.className = 'debug__error-value'
  errorValue.textContent = 'none'
  errorRow.append(errorLabel, errorValue)

  const footer = document.createElement('div')
  footer.className = 'debug__footer'
  const hint = document.createElement('span')
  hint.className = 'debug__hint'
  hint.textContent = 'issue #23'
  footer.append(hint)

  panel.append(header, grid, errorRow, footer)
  if (root !== null) root.append(panel)

  const set = (key: string, text: string): string => {
    const shown = debugRowText(key, text)
    const value = values[key]
    if (value === undefined) return shown
    value.textContent = shown
    return shown
  }

  // FPS is measured by the renderer, so the overlay keeps its own samples and reports them
  // through `set` like every other row does.
  const samples: number[] = []
  const measureFps = (now: number): string => set('fps', updateFps(now, samples.concat([now])))

  return {
    element: panel,
    set,
    measureFps,
    reportError(message: string): void {
      errorValue.textContent = message
    },
  }
}
