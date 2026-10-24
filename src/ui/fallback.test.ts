import { describe, expect, it } from 'vitest'
import { createBootLog, type BootRun, type BootStorage, type Clock } from './bootlog'
import { fallbackLines } from './fallback'

/** A fake storage, so the tests never touch real `localStorage`. */
function fakeStorage(initial: Record<string, string> = {}, denied = false): BootStorage {
  const values = new Map(Object.entries(initial))
  return {
    read(key: string): string | null {
      if (denied) throw new Error('storage is denied')
      return values.get(key) ?? null
    },
    write(key: string, value: string): boolean {
      if (denied) return false
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

describe('fallbackLines', () => {
  it('shows this run first, then what survived from the previous one', () => {
    const previous: BootRun = {
      startedAt: new Date('2026-10-23T18:11:02.000Z').getTime(),
      steps: [{ name: 'boot', at: 0 }],
      lastError: 'TypeError: element.animate is not a function',
    }
    const log = createBootLog({
      storage: fakeStorage({ 'pop-pals.boot.v1': JSON.stringify(previous) }),
      clock: fakeClock(0, [30]),
    })
    log.step('boot')

    expect(fallbackLines(log)).toEqual([
      'This run',
      'run 1970-01-01T00:00:00.000Z',
      '+30ms boot',
      '',
      'Last run',
      'run 2026-10-23T18:11:02.000Z',
      '+0ms boot',
      'error TypeError: element.animate is not a function',
    ])
  })

  it('says so when nothing survived from the previous run', () => {
    const log = createBootLog({ storage: fakeStorage(), clock: fakeClock(0) })
    log.step('boot')

    expect(fallbackLines(log)).toEqual([
      'This run',
      'run 1970-01-01T00:00:00.000Z',
      '+0ms boot',
      '',
      'Last run',
      'no trace from the previous run',
    ])
  })

  it('reports storage, because a trace that cannot be persisted cannot be read back', () => {
    const log = createBootLog({ storage: fakeStorage({}, true), clock: fakeClock(0) })
    log.step('boot')

    expect(fallbackLines(log)).toEqual([
      'This run',
      'run 1970-01-01T00:00:00.000Z',
      '+0ms boot',
      '',
      'Last run',
      'no trace from the previous run',
      '',
      'storage is unavailable on this device',
    ])
  })
})
