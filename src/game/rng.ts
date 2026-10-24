import type { Rng } from './types'

/**
 * Seeded mulberry32. Deterministic, tiny, and good enough for a toy board game.
 * Every core entry point takes an `Rng` so tests and (from M5) the simulator can
 * reproduce a session exactly.
 */
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
