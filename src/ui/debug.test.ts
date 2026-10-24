import { describe, expect, it } from 'vitest'
import {
  debugRowText,
  goalsText,
  isDebugRow,
  MAX_VALUE_LENGTH,
  nextLevelClick,
  parseDebugFlag,
  rowText,
  updateFps,
} from './debug'

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

describe('debug rows', () => {
  it('accepts the rows the game can report and nothing else (issue #18)', () => {
    for (const key of ['level', 'seed', 'animals', 'rack', 'goals', 'queue', 'balloons', 'particles', 'tier', 'fps']) {
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
})
