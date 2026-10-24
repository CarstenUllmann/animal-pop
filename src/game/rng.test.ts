import { describe, expect, it } from 'vitest'
import { createRng, seedFromCrypto, seedFromRandom } from './rng'

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

describe('seed sources', () => {
  it('combines the crypto values it is given', () => {
    expect(seedFromCrypto(new Uint32Array([1, 2]))).toBe(3)
    expect(seedFromCrypto(new Uint32Array([0xffffffff, 1]))).toBe(0xfffffffe)
  })

  it('maps a Math.random value in [0, 1) into the seed range', () => {
    expect(seedFromRandom(0)).toBe(0)
    expect(seedFromRandom(0.5)).toBe(2147483648)
    expect(seedFromRandom(0.75)).toBe(3221225472)
    expect(seedFromRandom(0.9999999998)).toBeLessThan(0x100000000)
  })
})
