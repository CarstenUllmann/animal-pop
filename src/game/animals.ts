import cat from '../assets/animals/cat.svg'
import fox from '../assets/animals/fox.svg'
import frog from '../assets/animals/frog.svg'
import monkey from '../assets/animals/monkey.svg'
import panda from '../assets/animals/panda.svg'
import penguin from '../assets/animals/penguin.svg'
import pig from '../assets/animals/pig.svg'
import rabbit from '../assets/animals/rabbit.svg'
import { ANIMAL_IDS } from './animalIds'
import type { AnimalId } from './types'

/**
 * The animal manifest (SPEC §12.2). Adding, removing or re-drawing an animal is a
 * data change only: keep `id` and `pitch` stable, point `face` at a new file. The ids live in
 * `animalIds.ts`, so the simulator can ramp the same roster the game ships without pulling the
 * asset graph (which only the bundler can resolve).
 *
 * Art: Twemoji (https://github.com/jdecked/twemoji), CC BY 4.0. The SVGs are bundled
 * locally, so the game makes no network request for them.
 */
export interface AnimalDef {
  id: AnimalId
  label: string
  face: string
  /** Hz, root note for the synth audio player. C-major pentatonic. */
  pitch: number
}

const FACES: Record<AnimalId, string> = {
  cat,
  rabbit,
  panda,
  frog,
  pig,
  penguin,
  monkey,
  fox,
}

const PITCHES: Record<AnimalId, number> = {
  cat: 523.25, // C5
  rabbit: 587.33, // D5
  panda: 659.25, // E5
  frog: 783.99, // G5
  pig: 880.0, // A5
  penguin: 1046.5, // C6
  monkey: 1174.66, // D6
  fox: 1318.51, // E6
}

export const ANIMAL_POOL: readonly AnimalDef[] = ANIMAL_IDS.map((id) => ({
  id,
  label: id,
  face: FACES[id] === undefined ? '' : FACES[id],
  pitch: PITCHES[id] === undefined ? 0 : PITCHES[id],
}))

export const ANIMALS_BY_ID: ReadonlyMap<AnimalId, AnimalDef> = new Map(
  ANIMAL_POOL.map((animal) => [animal.id, animal]),
)
