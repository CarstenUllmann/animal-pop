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

/**
 * The rows the overlay declares. Issue #18 wants every listed field live, and a row is only as live as the
 * last thing the game reported for it, so the rows are data rather than a list of names: the test compares
 * this list against what main.ts reports, which is how a row that can never update gets caught. `boot` is a
 * row like any other, except that it is the trace rather than a value.
 */
export interface RowDef {
  key: string
  label: string
  /** What the row shows before the game has reported anything for it. */
  initial: (info: DebugInfo) => string
  trace?: boolean
  /** True when the value cannot change during a run, so what the row shows at mount is the whole truth.
   *  The session seed is generated once per install (SPEC §9.2), so it is the only row fixed by the
   *  definition rather than by what the game reports (issue #18). */
  fixed?: boolean
}

export const DEBUG_ROWS: readonly RowDef[] = [
  { key: 'level', label: 'level', initial: (info) => textOr(numberText(info.level), 'not started') },
  { key: 'seed', label: 'seed', initial: (info) => textOr(seedText(info.seed), 'not recorded'), fixed: true },
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

export function debugRowKeys(): string[] {
  return DEBUG_ROWS.map((row) => row.key)
}

function rowDef(key: string): RowDef | undefined {
  for (const row of DEBUG_ROWS) {
    if (row.key === key) return row
  }
  return undefined
}

export function isDebugRow(key: string): boolean {
  return rowDef(key) !== undefined
}

/** The text a row shows for a reported value. A trace row is never truncated. */
export function debugRowText(key: string, text: string): string {
  const row = rowDef(key)
  if (row === undefined) return ''
  if (row.trace) return text
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

/**
 * The rows as a pure model. `mountDebugOverlay` paints every row from this and writes every later report
 * through it, so the text a row shows at mount and the text the game reports for the same value cannot
 * disagree. That is the only part of "the rows are live" a node test can reach: vitest runs in node
 * (vitest.config.ts), so the overlay itself cannot be mounted in a test (issue #18).
 */
export interface RowModel {
  text(key: string): string
  /** Report a value through the same path `set` uses, so the truncation rule applies to both. */
  set(key: string, text: string): string
}

export function createRowModel(info: DebugInfo): RowModel {
  const shown: Record<string, string> = {}
  for (const row of DEBUG_ROWS) shown[row.key] = debugRowText(row.key, row.initial(info))

  return {
    text(key: string): string {
      const value = shown[key]
      return value === undefined ? '' : value
    },
    set(key: string, text: string): string {
      const value = debugRowText(key, text)
      if (isDebugRow(key)) shown[key] = value
      return value
    },
  }
}

/** The error row shows what the game reports and nothing else. It is deliberately not truncated:
 *  `MAX_VALUE_LENGTH` caps a row, but the error is the reason the overlay was opened. An empty message
 *  would leave the row blank, so it keeps the word the row already shows before anything is reported
 *  (issue #18). */
export function errorText(message: string): string {
  return message === '' ? 'none' : message
}

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

/**
 * The trace is the reason the overlay is worth opening on the tablet, so it is never truncated.
 *
 * SPEC §14.3: "the previous run's steps then this run's". Both halves matter on the tablet: the browser
 * and the installed app share one Chrome profile, so the previous run is the standalone launch that died,
 * and this run is the browser visit reading it (issue #23). Showing only `current()` hid exactly the run
 * the overlay was opened to see. `traceLines` starts each run with its own timestamp, so the two blocks
 * stay distinguishable without a heading the row would have to spend a line on.
 */
function traceText(log: BootLog | undefined): string {
  if (log === undefined) return 'nothing recorded yet'
  const lines: string[] = []
  const previous = log.previous()
  if (previous !== null) lines.push(...traceLines(previous))
  lines.push(...traceLines(log.current()))
  return lines.join('\n')
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
  const rows = createRowModel(info)

  const set = (key: string, text: string): string => {
    const shown = rows.set(key, text)
    const value = values[key]
    if (value === undefined) return shown
    value.textContent = shown
    return shown
  }

  for (const row of DEBUG_ROWS) {
    const label = document.createElement('dt')
    label.className = 'debug__label'
    label.textContent = row.label

    const value = document.createElement('dd')
    value.className = row.trace ? 'debug__value debug__value--trace' : 'debug__value'
    // Painted from the same model `set` writes through, so the value the row shows at mount and the
    // value the game reports for the same thing cannot disagree.
    value.textContent = rows.text(row.key)
    values[row.key] = value

    grid.append(label, value)
  }

  // Issue #18: every listed field has to be live, and the boot row is the one that changes after mount.
  // The log tells us when it moves, so the row is not a snapshot taken at mount, and the update goes
  // through `set` like every other row does.
  const bootRow = values['boot']
  if (info.bootLog !== undefined && bootRow !== undefined) {
    info.bootLog.subscribe(() => set('boot', traceText(info.bootLog)))
  }

  const errorRow = document.createElement('div')
  errorRow.className = 'debug__error'
  const errorLabel = document.createElement('span')
  errorLabel.className = 'debug__error-label'
  errorLabel.textContent = 'last error'
  const errorValue = document.createElement('p')
  errorValue.className = 'debug__error-value'
  // What the row shows before anything is reported is the same word `errorText` falls back to, so the
  // row and the helper cannot disagree about what "no error" looks like.
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

  // FPS is measured by the renderer, so the overlay keeps its own samples and reports them
  // through `set` like every other row does.
  const samples: number[] = []
  const measureFps = (now: number): string => set('fps', updateFps(now, samples.concat([now])))

  return {
    element: panel,
    set,
    measureFps,
    reportError(message: string): void {
      errorValue.textContent = errorText(message)
    },
  }
}
