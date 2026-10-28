import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ANIMAL_IDS } from '../game/animalIds'
import { bubblesForLevel, createLevel, goalTargetForLevel } from '../game/level'
import { readSave, toSaveState, writeSave, type SaveContext } from '../game/save'
import type { KeyValueStore } from '../game/types'
import { describeError, traceLines, type BootLog, type BootRun } from './bootlog'
import {
  DEBUG_ROWS,
  MAX_VALUE_LENGTH,
  cellText,
  createRowModel,
  debugRowText,
  displayMode,
  errorText,
  goalsText,
  isDebugRow,
  motionPreference,
  nextLevelClick,
  parseDebugFlag,
  recordFps,
  rowText,
  updateFps,
  viewportText,
} from './debug'

/**
 * Issue #18: the overlay is the only way to read the tablet, so it has to be live and readable from
 * across the room. Vitest runs in the node environment (vitest.config.ts), so the overlay cannot be
 * mounted in a test - what can be proved here is the pure layer, plus the shipped sources read as text:
 * the stylesheet, the way `styles.test.ts` reads it, and what `main.ts` actually reports, the way
 * `baseline.test.ts` reads those.
 */

const SRC = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(SRC, '..', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const mainSource = readFileSync(join(SRC, '..', 'main.ts'), 'utf8')
const debugSource = readFileSync(join(SRC, 'debug.ts'), 'utf8')

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return ''
  return css.slice(start, css.indexOf('}', start))
}

/** A size the test can compare against the acceptance floor. -1 means the rule inherits, which is the
 *  thing issue #18 is complaining about. */
function fontPx(selector: string): number {
  const match = /font-size:\s*(\d+)px/.exec(rule(selector))
  return match === null ? -1 : Number(match[1])
}

/** The same blanking `baseline.test.ts` uses, so a scan sees code rather than prose naming a banned thing. */
function codeOnly(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n'
        i += 1
      }
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  const found: string[] = []
  let match = pattern.exec(text)
  while (match !== null) {
    const value = match[1]
    if (value !== undefined && !found.includes(value)) found.push(value)
    match = pattern.exec(text)
  }
  return found
}

function functionBlock(source: string, header: string): string {
  const start = source.indexOf(header)
  if (start === -1) return ''
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return ''
}

/** What runs when `debug.ts` is imported, as opposed to what runs when one of its functions is called. */
function runsAtLoad(text: string): string[] {
  const offenders: string[] = []
  let depth = 0
  for (const line of codeOnly(text).split('\n')) {
    const trimmed = line.trim()
    if (depth === 0 && trimmed !== '') {
      const declares = /^(import|export|function|interface|type)\b/.test(trimmed) || /^[})\]]/.test(trimmed)
      // A declaration is a definition; only a value computed by a call runs when the module is imported.
      const computes = /^(export )?(const|let|var)\b/.test(trimmed) && (trimmed.includes('(') || trimmed.includes('new '))
      if (!declares || computes) offenders.push(trimmed)
    }
    for (const c of line) {
      if (c === '{' || c === '[' || c === '(') depth += 1
      else if (c === '}' || c === ']' || c === ')') depth -= 1
    }
  }
  return offenders
}

/** The two rows `debug.ts` reports through its own path - the frame samples and the trace subscription -
 *  because they are numbers only the overlay measures. Every other row has to be reported by the game. */
const SELF_REPORTED = ['fps', 'boot']

/** The mount object names two things differently from the row key it fills: `bubbles` shows as the rack
 *  row (SPEC §8), `bootLog` as the trace row (SPEC §14.3, issue #23). */
function rowForMountKey(key: string): string {
  if (key === 'bubbles') return 'rack'
  if (key === 'bootLog') return 'boot'
  return key
}

function mountInfoKeys(source: string): string[] {
  const start = source.indexOf('mountDebugOverlay(')
  if (start === -1) return []
  const end = source.indexOf(': null', start)
  const call = source.slice(start, end === -1 ? source.length : end)
  return uniqueMatches(call, /^\s+([A-Za-z][A-Za-z0-9]*):/gm)
}

/** A row is only as live as the last thing the game reported for it, so a row that nothing reports after
 *  mount can never be live (issue #18). */
function rowsThatCanNeverMove(source: string): string[] {
  const reported = uniqueMatches(source, /debug\.set\('([a-z]+)'/g)
  const missing: string[] = []
  for (const row of DEBUG_ROWS) {
    if (row.fixed) continue
    if (reported.includes(row.key)) continue
    if (SELF_REPORTED.includes(row.key)) continue
    missing.push(row.key)
  }
  return missing
}

/** A boot log with both halves the row reads, so the previous-then-current rule can be checked in node. */
function fakeBootLog(previous: BootRun | null, current: BootRun): BootLog {
  return {
    previous: () => previous,
    current: () => current,
    step: () => undefined,
    error: () => undefined,
    storageAvailable: () => true,
    subscribe: () => () => undefined,
  }
}

function fakeStore(initial: Record<string, string> = {}): KeyValueStore {
  const values = new Map(Object.entries(initial))
  return {
    read: (key: string) => values.get(key) ?? null,
    write: (key: string, value: string) => {
      values.set(key, value)
      return true
    },
  }
}

describe('parseDebugFlag', () => {
  it.each([
    ['', false],
    ['?', false],
    ['?debug', false],
    ['?debug=0', false],
    ['?debug=1', true],
    ['?debug=true', true],
    ['?debug=TRUE', true],
    ['?debug=1&level=3', true],
    ['?level=3&debug=1', true],
    ['?debug=1&other=2', true],
    ['?DEBUG=1', false],
  ])('parses %j as %s', (search, expected) => {
    expect(parseDebugFlag(search)).toBe(expected)
  })
})

describe('environment rows (issues #10, #19, #23)', () => {
  const query = (answers: Record<string, boolean>) => ({
    matchMedia: (q: string) => ({ matches: answers[q] === true }) as MediaQueryList,
  })

  it('tells a standalone launch from a browser visit', () => {
    // Issue #23 asked the reporter what the `display` row says, because the same bundle runs in the browser
    // (Chrome 138) and the installed app (System WebView 61). `navigator.standalone` is the iOS spelling.
    expect(displayMode(query({ '(display-mode: standalone)': true }), undefined)).toBe('standalone')
    expect(displayMode(query({ '(display-mode: standalone)': false }), undefined)).toBe('browser')
    expect(displayMode(query({}), true)).toBe('standalone')
    // No matchMedia is an answer, not a crash: it names an engine old enough to matter.
    expect(displayMode(null, undefined)).toBe('unknown')
  })

  it('reports the system motion setting the reduced-motion rules read', () => {
    expect(motionPreference(query({ '(prefers-reduced-motion: reduce)': true }))).toBe('reduced')
    expect(motionPreference(query({}))).toBe('full')
    expect(motionPreference(null)).toBe('unknown')
  })

  it('reports the viewport and the board cell as the numbers they are', () => {
    expect(viewportText(1024, 600)).toBe('1024×600')
    expect(viewportText(600.4, 1023.6)).toBe('600×1024')
    expect(cellText(90)).toBe('90px')
    expect(cellText(89.6)).toBe('90px')
  })

  it('paints the environment from the mount values', () => {
    const rows = createRowModel({
      display: 'standalone',
      motion: 'reduced',
      viewport: '1024×600',
      cell: '90px',
    })
    expect(rows.text('display')).toBe('standalone')
    expect(rows.text('motion')).toBe('reduced')
    expect(rows.text('viewport')).toBe('1024×600')
    expect(rows.text('cell')).toBe('90px')
  })
})

describe('debug rows', () => {
  it('accepts the rows the game can report and nothing else (issue #18)', () => {
    for (const key of ['level', 'seed', 'display', 'motion', 'viewport', 'cell', 'animals', 'rack', 'goals', 'queue', 'balloons', 'particles', 'tier', 'fps']) {
      expect(isDebugRow(key)).toBe(true)
    }
    expect(isDebugRow('whatever')).toBe(false)
    expect(isDebugRow('')).toBe(false)
  })

  it('reports a row through the same helper `set` uses', () => {
    expect(debugRowText('queue', '2')).toBe('2')
    expect(debugRowText('goals', 'lion 2 left')).toBe('lion 2 left')
  })

  it('paints nothing for an unknown key', () => {
    expect(debugRowText('whatever', '3')).toBe('')
    expect(rowText('whatever', 3)).toBe('')
  })

  it('truncates a long value so a row cannot push the overlay wider than the panel', () => {
    const long = 'x'.repeat(MAX_VALUE_LENGTH + 12)
    expect(debugRowText('tier', long)).toBe(`${'x'.repeat(MAX_VALUE_LENGTH)}…`)
    expect(debugRowText('tier', 'short')).toBe('short')
  })

  it('leaves the trace row whole, because the trace is the point of issue #23', () => {
    const longTrace = 'first tap\n'.repeat(20)
    expect(debugRowText('boot', longTrace)).toBe(longTrace)
    expect(rowText('boot', 'first pop')).toBe('first pop')
  })

  it('carries the previous run before this one, which is the trace a force-close leaves (SPEC §14.3)', () => {
    // Issue #23: the browser and the installed app share one Chrome profile, so the previous run is the
    // standalone launch that died and this run is the browser visit reading it. Showing only `current()`
    // hid exactly the run the overlay was opened to see.
    const previous: BootRun = {
      startedAt: Date.UTC(2026, 9, 24, 8, 0, 0),
      steps: [{ name: 'standalone boot', at: 4 }],
      lastError: 'Error: dead',
    }
    const current: BootRun = {
      startedAt: Date.UTC(2026, 9, 24, 8, 5, 0),
      steps: [{ name: 'browser boot', at: 2 }],
      lastError: null,
    }

    const row = createRowModel({ bootLog: fakeBootLog(previous, current) }).text('boot')
    expect(row).toContain('standalone boot')
    expect(row).toContain('error Error: dead')
    expect(row).toContain('browser boot')
    expect(row.indexOf('standalone boot')).toBeLessThan(row.indexOf('browser boot'))
  })

  it('shows this run alone when no trace survived a previous launch', () => {
    const current: BootRun = { startedAt: 0, steps: [{ name: 'boot', at: 1 }], lastError: null }
    expect(createRowModel({ bootLog: fakeBootLog(null, current) }).text('boot')).toBe(traceLines(current).join('\n'))
    expect(createRowModel({}).text('boot')).toBe('nothing recorded yet')
  })

  it('shows goals as what is still missing', () => {
    expect(goalsText([{ label: 'cat', current: 2, needed: 3 }])).toBe('cat 1 left')
    expect(goalsText([{ label: 'cat', current: 3, needed: 3 }, { label: 'lion', current: 0, needed: 4 }])).toBe(
      'cat 0 left, lion 4 left',
    )
    expect(goalsText([])).toBe('none yet')
    expect(goalsText(undefined)).toBe('none yet')
  })

  it('keeps the fps row its own, measured over a rolling window', () => {
    expect(updateFps(1000, [])).toBe('no readings yet')
    expect(updateFps(1000, [1000])).toBe('no readings yet')
    expect(updateFps(1000, [1000, 1000])).toBe('no readings yet')
    expect(updateFps(1000, [700, 850, 1000])).toBe('6.7')
    // A sample just outside the window is not a sample.
    expect(updateFps(1000, [699, 1000])).toBe('no readings yet')
  })

  it('records the frames it is given, so the fps row is not dead on the tablet (issue #12)', () => {
    // `measureFps` used to pass `samples.concat([now])` without storing the sample, so the history stayed
    // empty and the row read "no readings yet" for the whole session - the one number the device check
    // exists to read.
    const samples: number[] = []
    expect(recordFps(1000, samples)).toBe('no readings yet')
    expect(samples).toEqual([1000])

    // 60Hz: one sample every 16.7ms. The rate has to read as a rate, not as one lone sample.
    let now = 1000
    for (let i = 0; i < 10; i++) {
      now += 16.7
      recordFps(now, samples)
    }
    now += 16.7
    expect(recordFps(now, samples)).toBe('59.9')
    // Only the rolling window is kept, so an hour-long party cannot grow the array without bound.
    expect(samples.length).toBeLessThan(25)
  })

  it('starts a fresh window after a pause instead of averaging across it', () => {
    const samples: number[] = []
    recordFps(1000, samples)
    recordFps(1016.7, samples)
    // A hidden tab produces no frames; the next one must not be averaged as if 60 seconds had passed
    // between two 60Hz frames.
    expect(recordFps(61000, samples)).toBe('no readings yet')
    expect(samples).toEqual([61000])
    expect(recordFps(61016.7, samples)).toBe('59.9')
  })
})

describe('the rows the overlay declares (SPEC §14.3, issue #18)', () => {
  it('declares every field SPEC §14.3 lists, and the four numbers the panel cannot show', () => {
    // SPEC §14.3: level, seed, animal types in play, bubbles, remaining goals, fps, last error, and the
    // boot row from §14.1. `queue`, `balloons`, `particles` and `tier` are what the tablet cannot see
    // without the overlay, which is why the overlay is worth opening on it.
    for (const key of ['level', 'seed', 'animals', 'rack', 'goals', 'fps', 'boot']) {
      expect(DEBUG_ROWS.map((row) => row.key)).toContain(key)
    }
    expect(DEBUG_ROWS.map((row) => row.key)).toEqual([
      'level',
      'seed',
      'display',
      'motion',
      'viewport',
      'cell',
      'animals',
      'rack',
      'goals',
      'queue',
      'balloons',
      'particles',
      'tier',
      'fps',
      'boot',
    ])
  })

  it('has the rows fixed by the definition rather than by a report', () => {
    // SPEC §9.2: the session seed is generated once per install. The display mode and the system's motion
    // preference are read once by the modules they describe (SPEC §13, issue #23), so a boot snapshot is the
    // whole truth for the run and the row does not pretend to be live.
    expect(DEBUG_ROWS.filter((row) => row.fixed).map((row) => row.key)).toEqual(['seed', 'display', 'motion'])
  })

  it('has something to show for every row before the game reports it', () => {
    // A row is painted from `initial`, so the overlay cannot open with a blank line. Every row has a word of
    // its own for before anything is reported except the roster row, which only the game can know - so that
    // row has to be one main.ts hands over at mount (issue #18).
    const blankAtMount = DEBUG_ROWS.filter((row) => row.initial({}) === '').map((row) => row.key)
    expect(blankAtMount).toEqual(['animals'])

    const mounted = mountInfoKeys(mainSource).map(rowForMountKey).filter((key) => key !== 'onNextLevel')
    for (const key of blankAtMount) expect(mounted).toContain(key)

    // Every key main.ts hands the overlay at mount is a declared row, so the game cannot report a key the
    // overlay would paint nothing for. `bubbles` and `bootLog` name rows by what they show.
    for (const key of mounted) expect(isDebugRow(key)).toBe(true)
    for (const key of ['level', 'seed', 'animals', 'rack', 'goals', 'boot']) expect(mounted).toContain(key)
  })

  it('catches a row that can never update', () => {
    // The scan is the acceptance test, so it has to be able to fail: `showLevel()` reports level, rack,
    // goals and the animals in play, `reportQueue` the queue, `reportLive` the balloons, particles and tier.
    // Nothing may be handed over at mount and never reported again, because the roster changes with the
    // level (SPEC §9.3), so a mount snapshot would be the wrong level's truth from level 2 on. Every row is
    // reported after mount, so this expectation is closed - and the next test shows it can still fail.
    expect(rowsThatCanNeverMove(mainSource)).toEqual([])
  })

  it('is not vacuous: a report removed from main.ts is caught', () => {
    const quiet = mainSource.replace(/debug\.set\('queue', numberText\(session\.queueSize\(\)\)\)/, '')
    expect(rowsThatCanNeverMove(quiet)).toContain('queue')
    expect(rowsThatCanNeverMove(quiet)).not.toEqual([])
  })

  it('reads at tablet distance, with its own pixel size rather than the small base the overlay inherits', () => {
    // An adult reads the values from the doorway: 20px or more. The label that names a number is the
    // smaller line, 12px or more; the trace is a list of lines rather than a glance, so it stays smaller
    // because the panel is capped at the tablet's height (SPEC §13).
    expect(fontPx('.debug .debug__rows .debug__value')).toBeGreaterThanOrEqual(20)
    expect(fontPx('.debug .debug__error-value')).toBeGreaterThanOrEqual(20)
    expect(fontPx('.debug .debug__rows .debug__label')).toBeGreaterThanOrEqual(12)
    expect(fontPx('.debug .debug__error-label')).toBeGreaterThanOrEqual(12)
    expect(fontPx('.debug .debug__rows .debug__value--trace')).toBeGreaterThanOrEqual(14)

    // A value has to read bigger than the label naming it, and the rules are px so they cannot
    // re-inherit the `rem` base that `baseline.test.ts` holds to the Chrome 61 engine.
    expect(fontPx('.debug .debug__rows .debug__value')).toBeGreaterThan(fontPx('.debug .debug__rows .debug__label'))
    expect(fontPx('.debug .debug__error-value')).toBeGreaterThan(fontPx('.debug .debug__error-label'))

    // Every class `mountDebugOverlay` sets has a rule, so a row the module builds cannot be unstyled.
    const built: string[] = []
    for (const line of codeOnly(debugSource).split('\n')) {
      if (!line.includes('className = ') && !line.includes('classList.toggle(')) continue
      for (const match of line.match(/'([^']+)'/g) ?? []) {
        for (const cls of match.slice(1, -1).split(' ')) if (!built.includes(cls)) built.push(cls)
      }
    }
    expect(built).toContain('debug__value--trace')
    const missing = built.filter((cls) => !css.includes(`.${cls}`))
    expect(missing).toEqual([])
  })
})

describe('the last error row (SPEC §14.3, issue #18)', () => {
  it('shows a thrown error by name, which is what main.ts hands the row', () => {
    expect(errorText(describeError(new TypeError('crypto.getRandomValues is not a function')))).toBe(
      'TypeError: crypto.getRandomValues is not a function',
    )
  })

  it('shows a rejection whose reason is not an Error', () => {
    // `unhandledrejection` hands over whatever the promise rejected with, so the row cannot assume an Error.
    expect(errorText(describeError('board view failed'))).toBe('board view failed')
    expect(errorText(describeError({ code: 3, reason: 'storage is denied' }))).toBe('{"code":3,"reason":"storage is denied"}')
    expect(errorText(describeError(null))).toBe('null')
  })

  it('never blanks the row, whatever the reason was', () => {
    for (const reason of [new Error('boom'), 'boom', { code: 3 }, undefined, null, 0, '', '   ']) {
      expect(errorText(describeError(reason))).not.toBe('')
    }
    // 'none' is the word the row shows before anything is reported, so the row and the helper agree.
    expect(errorText('')).toBe('none')
  })

  it('keeps the error whole, past the cap every other row has', () => {
    const long = 'x'.repeat(MAX_VALUE_LENGTH + 40)
    expect(errorText(long)).toBe(long)
    expect(errorText(long)).not.toContain('…')
  })
})

describe('next level button', () => {
  it('does nothing while the button is disabled, which is what a click cannot be trusted not to do', () => {
    const clicks: string[] = []
    nextLevelClick(() => clicks.push('advanced'), false)
    nextLevelClick(undefined, false)
    nextLevelClick(undefined, true)
    expect(clicks).toEqual([])
  })

  it('advances once when the game supplied a handler and the button is enabled', () => {
    const clicks: string[] = []
    nextLevelClick(() => clicks.push('advanced'), true)
    expect(clicks).toEqual(['advanced'])
  })

  it('leaves the save describing the same level the rows show after an advance', () => {
    // The pure part of main.ts's `nextLevel()`: the level it deals and the save written from that state.
    // `celebration.stop()`, `party.hidden`, `queue.clear()` and the render are main.ts wiring, so the node
    // test can only reach the numbers - which is what the rows show.
    const context: SaveContext = { muted: false, levelsCompleted: 0 }
    const store = fakeStore()
    // ANIMAL_IDS is the roster ANIMAL_POOL is built from (animalIds.ts), so the test can deal a level
    // without the asset graph.
    const dealt = createLevel(1, 0x3039, ANIMAL_IDS)
    expect(writeSave(dealt, context, store)).toBe(true)

    const advanced = createLevel(dealt.level + 1, dealt.sessionSeed, ANIMAL_IDS)
    expect(writeSave(advanced, context, store)).toBe(true)

    // What the next launch reads back has to be the level the rows show, or the overlay disagrees with the save.
    const saved = readSave(store)
    expect(saved).toEqual(toSaveState(advanced, context))
    if (saved === null) return

    // A level just dealt has earned nothing, so each goal row shows the ramp's whole target as still missing.
    const target = goalTargetForLevel(2)
    const rows = saved.goals.map((goal) => ({ label: goal.animal, current: target - goal.remaining, needed: target }))
    expect(rows.map((row) => row.current)).toEqual([0, 0])

    // Read the rows through the model, because that is the path `mountDebugOverlay` paints from: the model
    // formats each value as its row declares it, so the seed row shows the hex the save holds rather than the
    // number, and the test cannot quietly measure a row against a helper the overlay does not use (issue #18).
    const model = createRowModel({ level: saved.level, seed: saved.sessionSeed, bubbles: saved.bubbles, goals: rows })
    expect(model.text('level')).toBe('2')
    // SPEC §9.2: an advance deals a new level from the same per-install seed, so the seed row does not move.
    expect(model.text('seed')).toBe('0x3039')
    expect(model.text('rack')).toBe(String(bubblesForLevel(2)))
    expect(model.text('goals')).toBe(`${saved.goals[0]?.animal} ${target} left, ${saved.goals[1]?.animal} ${target} left`)
  })

  it('advances through the same report path that wrote the save (main.ts wiring)', () => {
    // The button is only enabled for a handler main.ts supplies, so a click can never call a level the
    // child has not finished. The run writes the save and this wiring reports it, so the rows cannot lag.
    expect(mainSource).toContain('onNextLevel: nextLevel')
    // The report happens on the render's then, so the row is written from the state the save was written from.
    expect(functionBlock(mainSource, 'function nextLevel()')).toContain('.then(showLevel)')
    expect(functionBlock(mainSource, 'function showLevel()')).toContain("debug.set('level'")
  })
})

describe('off by default (SPEC §14.3, issue #18)', () => {
  it('runs nothing at module load', () => {
    // Every line at depth 0 in debug.ts is a declaration: the module computes no value and touches no
    // screen when it is imported, so a launch that never opens the overlay pays for the import alone.
    // The node environment is the proof on this test's own side - `document` is not defined here and the
    // import at the top of this file still succeeds.
    expect(typeof document).toBe('undefined')
    expect(runsAtLoad(debugSource)).toEqual([])
  })

  it('reads the flag from the URL only, never from storage, so a debug run cannot leak into the next launch', () => {
    const code = codeOnly(debugSource)
    for (const banned of ['localStorage', 'sessionStorage', 'location', 'window.', 'navigator.']) {
      expect(code).not.toContain(banned)
    }
  })

  it('mounts nothing without the flag, and the report calls cost nothing when it is off', () => {
    expect(mainSource).toMatch(/parseDebugFlag\([^)]*\)\s*\?\s*mountDebugOverlay/)
    expect(mainSource).toMatch(/const debug = [\s\S]{0,900}: null/)
    expect(functionBlock(mainSource, 'function showLevel()')).toContain('if (debug === null) return')
    // The frame sampling loop is the only thing the overlay keeps running, and it runs only for a mounted one.
    expect(mainSource).toMatch(/if \(debug !== null\) \{[^}]*measureFps/)
  })
})

describe('no network, no external tooling (SPEC §14.3)', () => {
  it('names nothing that reaches outside the device', () => {
    const code = codeOnly(debugSource)
    for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'import(', 'beacon(']) {
      expect(code).not.toContain(banned)
    }
    // The only imports are app-internal: the overlay reads the boot trace and the media-query shape,
    // and reaches nothing outside the app.
    expect(uniqueMatches(debugSource, /from '([^']+)'/g)).toEqual(['./bootlog', './capabilities'])
  })

  it('writes nothing, so a debug run cannot change the save it is reading', () => {
    // SPEC §14.1 reserves `pop-pals.v1` for the save and `pop-pals.boot.v1` for the trace; the overlay
    // only displays what the game reports, so it must name neither.
    const code = codeOnly(debugSource)
    for (const banned of ['pop-pals', 'setItem', '.write(', 'JSON.stringify']) {
      expect(code).not.toContain(banned)
    }
  })
})
