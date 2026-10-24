import { describe, expect, it } from 'vitest'
import { createPool } from './pool'

/** SPEC §16.1: the particle pool does not allocate during the draw loop. */
describe('object pool', () => {
  it('hands out at most its capacity', () => {
    const pool = createPool(3, () => ({ id: 0 }))
    const taken: Array<{ id: number }> = []
    for (let i = 0; i < 10; i++) {
      const item = pool.acquire()
      if (item === null) continue
      taken.push(item)
    }
    expect(taken.length).toBe(3)
    expect(pool.activeCount()).toBe(3)
  })

  it('returns null when exhausted instead of allocating', () => {
    const pool = createPool(2, () => ({ id: 0 }))
    pool.acquire()
    pool.acquire()
    expect(pool.acquire()).toBeNull()
    expect(pool.createdCount()).toBe(2)
  })

  it('reuses the same objects after release, so the draw loop allocates nothing', () => {
    const pool = createPool(2, () => ({ id: 0 }))
    const first = pool.acquire()
    const second = pool.acquire()
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    const created = pool.createdCount()
    pool.release(first as { id: number })
    const reused = pool.acquire()
    expect(reused).toBe(first)
    expect(pool.createdCount()).toBe(created)
  })

  it('releasing an object it never handed out does nothing', () => {
    const pool = createPool(2, () => ({ id: 0 }))
    pool.release({ id: 99 })
    expect(pool.activeCount()).toBe(0)
  })

  it('reset drops the active set but keeps the prefilled objects', () => {
    const pool = createPool(4, () => ({ id: 0 }))
    pool.acquire()
    pool.acquire()
    pool.reset()
    expect(pool.activeCount()).toBe(0)
    expect(pool.createdCount()).toBe(4)
    expect(pool.acquire()).not.toBeNull()
  })
})
