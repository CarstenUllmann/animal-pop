import type { Rng } from '../game/types'
import type { Place } from './bunch'

/**
 * Balloon colour selection (SPEC §10.1, issue #49). A pure rule: given the place a balloon is about
 * to hang at, the balloons already hanging, the palette and a source of randomness, it answers one
 * colour for the newcomer. No DOM, no drawing, no timers - `ui/celebration` asks this rule once per
 * spawn, for the opening bunch and for every refill.
 *
 * ## The neighbour rule
 *
 * Two balloons are neighbours when their centre distance is below the mean of their two jittered
 * widths. That is the same mean-size metric `canPlaceAt` uses for minimum spacing, so "overlapping"
 * has one meaning in the codebase rather than a second, colour-only definition.
 *
 * The newcomer takes a colour no neighbour is using. With nine colours and a bunch of at most twelve
 * the palette is rarely exhausted, but when neighbours already hold every entry the rule falls back
 * to the least-used neighbour colour, breaking ties with the injected `Rng`. It always answers an
 * entry from the palette, so a balloon can never be left colourless.
 *
 * The draw uses the injected `Rng`, so a session still replays. Placement has already been decided
 * by the time this rule runs, so the colour choice cannot move a balloon.
 */

/** A balloon already on screen: the place it hangs at and the colour it was given. */
export interface HungBalloon {
  place: Place
  colour: string
}

/** The distance below which two balloon bodies visibly overlap: the mean of their two widths. */
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
