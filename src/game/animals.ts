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
 * The animal manifest. Swapping art is a data change: keep `id` and `pitch`, point `face` at the
 * new file.
 *
 * Art: Twemoji (https://github.com/jdecked/twemoji), CC BY 4.0.
 */
export interface AnimalDef {
  id: AnimalId
  label: string
  face: string
  /** Hz, root note for the synth. */
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
  cat: 523.25,
  rabbit: 587.33,
  panda: 659.25,
  frog: 783.99,
  pig: 880.0,
  penguin: 1046.5,
  monkey: 1174.66,
  fox: 1318.51,
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
