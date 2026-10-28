import { describe, expect, it } from 'vitest'
import { BALLOON_COLORS } from '../game/constants'
import { createRng } from '../game/rng'
import type { Rng } from '../game/types'
import { isColourNeighbour, pickBalloonColour, type HungBalloon } from './balloonColours'
import type { Place } from './bunch'

const place = (x: number, y: number, size: number): Place => ({ x, y, size })

/** A draw that always takes the entry at `index`, clamped to the list it is offered. */
function chooses(index: number): Rng {
  return {
    next: () => 0,
    int: (maxExclusive) => Math.min(index, maxExclusive - 1),
    pick: (items) => items[0] as never,
    shuffle: (items) => items.slice(),
  }
}

const hung = (at: Place, colour: string): HungBalloon => ({ place: at, colour })

describe('balloon palette (SPEC §10.1, issue #49)', () => {
  it('holds nine distinct, valid colours', () => {
    expect(BALLOON_COLORS).toHaveLength(9)
    expect(new Set(BALLOON_COLORS).size).toBe(9)
    for (const colour of BALLOON_COLORS) expect(colour).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('what counts as a colour neighbour (issue #49)', () => {
  it('treats two balloons as neighbours only while their centres are closer than their mean width', () => {
    const balloon = place(0, 0, 100)
    expect(isColourNeighbour(balloon, place(99, 0, 100))).toBe(true)
    // Touching exactly at the mean width is not an overlap.
    expect(isColourNeighbour(balloon, place(100, 0, 100))).toBe(false)
    expect(isColourNeighbour(balloon, place(101, 0, 100))).toBe(false)
  })

  it('measures jittered sizes as the mean of the two widths', () => {
    const big = place(0, 0, 100)
    expect(isColourNeighbour(big, place(89, 0, 80))).toBe(true)
    expect(isColourNeighbour(big, place(90, 0, 80))).toBe(false)
  })
})

describe('picking a balloon colour (issue #49)', () => {
  it('never repeats a neighbour colour when the palette has another entry', () => {
    const neighbour = hung(place(50, 0, 100), BALLOON_COLORS[0] as string)
    for (let seed = 1; seed <= 20; seed++) {
      const colour = pickBalloonColour(place(0, 0, 100), [neighbour], BALLOON_COLORS, createRng(seed))
      expect(colour).not.toBe(neighbour.colour)
      expect(BALLOON_COLORS).toContain(colour)
    }
  })

  it('does not let a balloon outside the neighbour distance forbid a colour', () => {
    const palette = ['#111111', '#222222']
    const far = hung(place(1000, 0, 100), '#111111')
    // The draw takes the first allowed entry. If the far balloon were treated as a neighbour, its
    // colour would be forbidden and the answer would be the other one.
    expect(pickBalloonColour(place(0, 0, 100), [far], palette, chooses(0))).toBe('#111111')
  })

  it('falls back to the least-used neighbour colour when every entry is taken', () => {
    const palette = ['#111111', '#222222']
    const neighbours = [
      hung(place(50, 0, 100), '#111111'),
      hung(place(0, 50, 100), '#222222'),
      hung(place(-50, 0, 100), '#222222'),
    ]
    expect(pickBalloonColour(place(0, 0, 100), neighbours, palette, chooses(0))).toBe('#111111')
  })

  it('breaks a fallback tie with the injected Rng, deterministically', () => {
    const palette = ['#111111', '#222222']
    const neighbours = [
      hung(place(50, 0, 100), '#111111'),
      hung(place(-50, 0, 100), '#222222'),
    ]
    const first = pickBalloonColour(place(0, 0, 100), neighbours, palette, createRng(7))
    const second = pickBalloonColour(place(0, 0, 100), neighbours, palette, createRng(7))
    expect(second).toBe(first)
    expect(palette).toContain(first)
  })

  it('replays the same colour for the same inputs and seed', () => {
    const neighbours = [hung(place(40, 0, 100), BALLOON_COLORS[1] as string)]
    const first = pickBalloonColour(place(0, 0, 100), neighbours, BALLOON_COLORS, createRng(99))
    const second = pickBalloonColour(place(0, 0, 100), neighbours, BALLOON_COLORS, createRng(99))
    expect(second).toBe(first)
  })

  it('answers a palette entry even for the first balloon of a bunch', () => {
    expect(BALLOON_COLORS).toContain(pickBalloonColour(place(0, 0, 100), [], BALLOON_COLORS, createRng(3)))
  })
})
