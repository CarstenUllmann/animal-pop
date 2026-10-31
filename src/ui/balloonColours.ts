import type { Rng } from '../game/types'
import type { Place } from './bunch'

/**
 * Balloon colour selection: a pure rule that gives a newcomer a colour no neighbour is using.
 * Neighbours are balloons whose centres are closer than the mean of their widths, the same metric
 * the placement rule uses. When the palette is exhausted it repeats the least-used neighbour colour.
 * The draw uses the injected `Rng`, so a session still replays.
 */

/** A balloon already on screen: the place it hangs at and the colour it was given. */
export interface HungBalloon {
  place: Place
  colour: string
}

/** The distance below which two balloon bodies visibly overlap. */
export function isColourNeighbour(place: Place, other: Place): boolean {
  return Math.hypot(place.x - other.x, place.y - other.y) < (place.size + other.size) / 2
}

export function pickBalloonColour(
  place: Place,
  hung: readonly HungBalloon[],
  palette: readonly string[],
  rng: Rng,
): string {
  const first = palette[0]
  if (first === undefined) throw new Error('Balloon palette must not be empty')

  const neighbourUses = new Map<string, number>()
  for (const other of hung) {
    if (!isColourNeighbour(place, other.place)) continue
    const seen = neighbourUses.get(other.colour)
    neighbourUses.set(other.colour, seen === undefined ? 1 : seen + 1)
  }

  const allowed = palette.filter((colour) => !neighbourUses.has(colour))
  if (allowed.length > 0) return allowed[rng.int(allowed.length)] as string

  // Every palette entry is held by a neighbour: repeat the one that appears least among them.
  let least = Number.POSITIVE_INFINITY
  for (const colour of palette) {
    const uses = neighbourUses.get(colour)
    least = Math.min(least, uses === undefined ? 0 : uses)
  }
  const candidates = palette.filter((colour) => {
    const uses = neighbourUses.get(colour)
    return (uses === undefined ? 0 : uses) === least
  })
  return candidates[rng.int(candidates.length)] as string
}
