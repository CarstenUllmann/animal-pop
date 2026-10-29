import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LEVEL_RAMP } from './constants'

/**
 * Issue #22's first acceptance criterion: the spec's ramp table and the shipped constants agree, and
 * both cite simulator output. The numbers only mean anything if they are the numbers the game plays,
 * so this reads the documentation as data rather than trusting a reviewer to spot the drift.
 */

const SRC = dirname(fileURLToPath(import.meta.url))
const ROOT = join(SRC, '..', '..')
const spec = readFileSync(join(ROOT, 'docs', 'SPEC.md'), 'utf8')
const constants = readFileSync(join(SRC, 'constants.ts'), 'utf8')

interface Row {
  from: number
  types: number
  goalEach: number
  bubbles: number
}

/** The columns §21 also records: the estimate of the shortest level and the measured median taps. */
interface RecordedRow extends Row {
  minTaps: number
  medianTaps: number
}

const shipped: Row[] = LEVEL_RAMP.map(({ from, types, goalEach, bubbles }) => ({ from, types, goalEach, bubbles }))
const shippedRecorded: RecordedRow[] = LEVEL_RAMP.map(({ from, types, goalEach, bubbles, minTaps, medianTaps }) => ({
  from,
  types,
  goalEach,
  bubbles,
  minTaps,
  medianTaps,
}))

/** §9.1's markdown table: `| 1–2 | 4 | 3 + 3 | 12 |`. */
function tableRows(): Row[] {
  const start = spec.indexOf('### 9.1 Ramp')
  expect(start).toBeGreaterThanOrEqual(0)
  const section = spec.slice(start, spec.indexOf('Rows 1–2', start))
  const rows: Row[] = []
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length < 6) continue
    const [from, types, goalsCell, bubbles] = [cells[1] ?? '', cells[2] ?? '', cells[3] ?? '', cells[4] ?? '']
    const range = /^(\d+)(?:[–-](\d+|\+))?$/.exec(from) ?? /^(\d+)\+$/.exec(from)
    const goals = /^(\d+) \+ (\d+)$/.exec(goalsCell)
    if (range === null || goals === null) continue
    rows.push({
      from: Number(range[1]),
      types: Number(types),
      goalEach: Number(goals[1]),
      bubbles: Number(bubbles),
    })
  }
  return rows
}

/** The `LEVEL_RAMP` excerpt in §21, the copy a reader is most likely to quote. */
function excerptRows(): RecordedRow[] {
  const start = spec.indexOf('## 21. Constants')
  expect(start).toBeGreaterThanOrEqual(0)
  const block = spec.slice(start, spec.indexOf('```', spec.indexOf('```ts', start) + 5))
  const rows: RecordedRow[] = []
  const pattern =
    /\{ from: (\d+),\s*types: (\d+), goalEach: (\d+), bubbles: (\d+), minTaps: (\d+),\s*medianTaps: (\d+) \}/g
  for (let match = pattern.exec(block); match !== null; match = pattern.exec(block)) {
    rows.push({
      from: Number(match[1]),
      types: Number(match[2]),
      goalEach: Number(match[3]),
      bubbles: Number(match[4]),
      minTaps: Number(match[5]),
      medianTaps: Number(match[6]),
    })
  }
  return rows
}

describe('the ramp the spec quotes is the ramp the game ships (issue #22)', () => {
  it('§9.1 lists every row of LEVEL_RAMP, in order', () => {
    expect(tableRows()).toEqual(shipped)
  })

  it('§21 copies LEVEL_RAMP exactly, so a quoted constant cannot drift', () => {
    expect(excerptRows()).toEqual(shippedRecorded)
  })

  it('both the table and the constants cite the simulator run they came from', () => {
    for (const source of [spec, constants]) {
      expect(source).toContain('npm run sim')
      expect(source).toContain('0x5eb00b1e')
      expect(source).toContain('1000')
    }

    // Measured rows are labelled as measurements, and the two estimated rows say so.
    const measured = (spec.match(/\/\/ measured/g) ?? []).length
    const estimated = (spec.match(/\/\/ estimate/g) ?? []).length
    expect(measured).toBeGreaterThanOrEqual(5)
    expect(estimated).toBe(2)
  })
})
