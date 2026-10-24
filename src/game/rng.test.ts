import { describe, expect, it } from 'vitest'
import { createRng } from './rng'

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const first = createRng(12345)
    const second = createRng(12345)
    expect(Array.from({ length: 8 }, () => first.next())).toEqual(
      Array.from({ length: 8 }, () => second.next()),
    )
  })

  it('produces different sequences for different seeds', () => {
    const first = createRng(1)
    const second = createRng(2)
    expect(first.next()).not.toBe(second.next())
  })

  it('keeps next() in [0, 1) and int() inside its bound', () => {
    const rng = createRng(7)
    for (let i = 0; i < 1000; i++) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      const index = rng.int(6)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(6)
    }
  })

  it('picks only from the list and refuses an empty list', () => {
    const rng = createRng(42)
    for (let i = 0; i < 100; i++) expect(['a', 'b', 'c']).toContain(rng.pick(['a', 'b', 'c']))
    expect(() => rng.pick([])).toThrow(/empty/i)
  })

  it('shuffles a copy without mutating the input', () => {
    const rng = createRng(9)
    const input = ['a', 'b', 'c', 'd', 'e']
    const shuffled = rng.shuffle(input)

    expect(shuffled).toHaveLength(input.length)
    expect([...shuffled].sort()).toEqual([...input].sort())
    expect(input).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
