import type { Rng } from './types'

/** Seeded mulberry32. Deterministic and tiny, which is all a toy board game needs. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive)

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('Cannot pick from an empty list')
    return items[int(items.length)] as T
  }

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = items.slice()
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(i + 1)
      const item = copy[i] as T
      copy[i] = copy[j] as T
      copy[j] = item
    }
    return copy
  }

  return { next, int, pick, shuffle }
}

export function seedFromCrypto(values: ArrayLike<number>): number {
  let seed = 0
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    seed = (seed ^ (value === undefined ? 0 : value)) >>> 0
  }
  return seed
}

/** The fallback for engines without `crypto.getRandomValues`. */
export function seedFromRandom(value: number): number {
  return Math.floor(value * 0x100000000) >>> 0
}

/** Combine the session seed with a level number (murmur3 finalizer). */
export function mixSeed(sessionSeed: number, value: number): number {
  let hash = (sessionSeed >>> 0) ^ (Math.imul(value, 0x9e3779b9) >>> 0)
  hash = (hash ^ (hash >>> 16)) >>> 0
  hash = Math.imul(hash, 0x85ebca6b) >>> 0
  hash = (hash ^ (hash >>> 13)) >>> 0
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0
  return (hash ^ (hash >>> 16)) >>> 0
}
