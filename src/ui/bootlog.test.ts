import { describe, expect, it } from 'vitest'
import {
  MAX_ERROR_LENGTH,
  createBootLog,
  describeError,
  traceLines,
  type BootRun,
  type BootStorage,
  type Clock,
} from './bootlog'

/** A fake storage, so the tests never touch real `localStorage`. */
function fakeStorage(initial: Record<string, string> = {}): BootStorage & { writes: string[] } {
  const values = new Map(Object.entries(initial))
  const writes: string[] = []
  return {
    writes,
    read(key: string): string | null {
      return values.get(key) ?? null
    },
    write(key: string, value: string): boolean {
      writes.push(value)
      values.set(key, value)
      return true
    },
  }
}

/** The first `now()` call is the run's start; each recorded step gets the next offset. */
function fakeClock(start: number, offsets: number[] = []): Clock {
  let calls = 0
  return {
    now(): number {
      const call = calls
      calls += 1
      return call === 0 ? start : start + (offsets[call - 1] ?? 0)
    },
  }
}

function stored(run: BootRun): Record<string, string> {
  return { 'pop-pals.boot.v1': JSON.stringify(run) }
}

describe('createBootLog', () => {
  it('reads the previous run from the persisted trace', () => {
    const previous: BootRun = {
      startedAt: 1700000000000,
      steps: [{ name: 'boot', at: 0 }, { name: 'storage ok', at: 12 }],
      lastError: 'TypeError: crypto.getRandomValues is not a function',
    }
    const log = createBootLog({ storage: fakeStorage(stored(previous)), clock: fakeClock(1700000500000) })

    expect(log.previous()).toEqual(previous)
    // Reading the previous run must not add a step to the current one.
    expect(log.current().steps).toEqual([])
    expect(log.current().startedAt).toBe(1700000500000)
  })

  it('persists after every step, so a force-close cannot lose the last one', () => {
    const storage = fakeStorage()
    const log = createBootLog({ storage, clock: fakeClock(1000, [0, 10]) })

    log.step('boot')
    log.step('storage ok')
    log.error('Missing #app root element')

    expect(log.current().steps).toEqual([
      { name: 'boot', at: 0 },
      { name: 'storage ok', at: 10 },
    ])
    expect(log.current().lastError).toBe('Missing #app root element')
    expect(storage.writes).toHaveLength(3)
    expect(JSON.parse(storage.writes[2] ?? '')).toEqual(log.current())
  })

  it('drops the oldest steps when the trace is longer than the cap', () => {
    const storage = fakeStorage()
    const log = createBootLog({ storage, clock: fakeClock(0, [0, 1, 2, 3, 4, 5]), maxSteps: 3 })

    for (const name of ['boot', 'storage ok', 'seed', 'board', 'view', 'first frame']) log.step(name)

    expect(log.current().steps).toEqual([
      { name: 'board', at: 3 },
      { name: 'view', at: 4 },
      { name: 'first frame', at: 5 },
    ])
  })

  it('still records steps when storage refuses read and write', () => {
    const storage: BootStorage = {
      read: () => {
        throw new Error('storage is denied')
      },
      write: () => {
        throw new Error('storage is denied')
      },
    }
    const log = createBootLog({ storage, clock: fakeClock(0, [0, 20]) })

    expect(log.previous()).toBeNull()
    expect(log.storageAvailable()).toBe(false)

    log.step('boot')
    log.step('storage unavailable')
    log.error('storage is denied')

    expect(log.current().steps).toEqual([
      { name: 'boot', at: 0 },
      { name: 'storage unavailable', at: 20 },
    ])
    expect(log.current().lastError).toBe('storage is denied')
  })

  it('ignores a stored trace it cannot read back', () => {
    // A half-written value is what a killed process leaves behind.
    const log = createBootLog({ storage: fakeStorage(stored({ startedAt: 1, steps: [], lastError: null })) })
    expect(log.previous()).not.toBeNull()

    const broken = createBootLog({ storage: fakeStorage({ 'pop-pals.boot.v1': '{"startedAt":1,"steps":[' }) })
    expect(broken.previous()).toBeNull()

    const shapeless = createBootLog({
      storage: fakeStorage({ 'pop-pals.boot.v1': JSON.stringify({ steps: [{ name: 'boot' }], lastError: 5 }) }),
    })
    expect(shapeless.previous()).toBeNull()

    const partial = createBootLog({
      storage: fakeStorage({
        'pop-pals.boot.v1': JSON.stringify({
          startedAt: 5,
          steps: [{ name: 'boot', at: 0 }, 'junk', { name: 'view', at: 40 }, { name: 'oops' }],
          lastError: null,
        }),
      }),
    })
    expect(partial.previous()?.steps).toEqual([
      { name: 'boot', at: 0 },
      { name: 'view', at: 40 },
    ])
  })

  it('notifies subscribers after a step or an error', () => {
    const log = createBootLog({ storage: fakeStorage(), clock: fakeClock(0, [0, 5]) })
    const seen: string[] = []
    const unsubscribe = log.subscribe(() => seen.push(JSON.stringify(log.current().steps.length)))

    log.step('boot')
    unsubscribe()
    log.step('storage ok')

    expect(seen).toEqual(['1'])
  })

  it('truncates long error text', () => {
    const log = createBootLog({ storage: fakeStorage(), clock: fakeClock(0) })
    log.error('x'.repeat(MAX_ERROR_LENGTH + 100))
    expect(log.current().lastError).toHaveLength(MAX_ERROR_LENGTH)
  })
})

describe('traceLines', () => {
  it('renders a header, offsets, then the error', () => {
    const run: BootRun = {
      startedAt: new Date('2026-10-23T18:11:02.000Z').getTime(),
      steps: [
        { name: 'boot', at: 0 },
        { name: 'storage ok', at: 12 },
        { name: 'view', at: 40 },
      ],
      lastError: 'TypeError: crypto is undefined',
    }

    expect(traceLines(run)).toEqual([
      'run 2026-10-23T18:11:02.000Z',
      '+0ms boot',
      '+12ms storage ok',
      '+40ms view',
      'error TypeError: crypto is undefined',
    ])
  })

  it('has no error line when the run finished cleanly', () => {
    expect(traceLines({ startedAt: 0, steps: [{ name: 'boot', at: 0 }], lastError: null })).toEqual([
      'run 1970-01-01T00:00:00.000Z',
      '+0ms boot',
    ])
  })
})

describe('describeError', () => {
  it('names the error before its message', () => {
    expect(describeError(new RangeError('too big'))).toBe('RangeError: too big')
  })

  it('passes strings through and JSON-serialises anything else', () => {
    expect(describeError('boom')).toBe('boom')
    expect(describeError({ code: 3 })).toBe('{"code":3}')
    expect(describeError(null)).toBe('null')
  })

  it('does not throw on a value JSON cannot stringify', () => {
    const circular: Record<string, unknown> = { name: 'board' }
    circular.self = circular
    expect(describeError(circular)).toBe('[object Object]')
  })
})
