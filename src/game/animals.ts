import cat from '../assets/animals/cat.svg'
import fox from '../assets/animals/fox.svg'
import frog from '../assets/animals/frog.svg'
import monkey from '../assets/animals/monkey.svg'
import panda from '../assets/animals/panda.svg'
import penguin from '../assets/animals/penguin.svg'
import pig from '../assets/animals/pig.svg'
import rabbit from '../assets/animals/rabbit.svg'
import type { AnimalId } from './types'

/**
 * The animal manifest (SPEC §12.2). Adding, removing or re-drawing an animal is a
 * data change only: keep `id` and `pitch` stable, point `face` at a new file.
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

export const ANIMAL_POOL: readonly AnimalDef[] = [
  { id: 'cat', label: 'cat', face: cat, pitch: 523.25 }, // C5
  { id: 'rabbit', label: 'rabbit', face: rabbit, pitch: 587.33 }, // D5
  { id: 'panda', label: 'panda', face: panda, pitch: 659.25 }, // E5
  { id: 'frog', label: 'frog', face: frog, pitch: 783.99 }, // G5
  { id: 'pig', label: 'pig', face: pig, pitch: 880.0 }, // A5
  { id: 'penguin', label: 'penguin', face: penguin, pitch: 1046.5 }, // C6
  { id: 'monkey', label: 'monkey', face: monkey, pitch: 1174.66 }, // D6
  { id: 'fox', label: 'fox', face: fox, pitch: 1318.51 }, // E6
]

export const ANIMALS_BY_ID: ReadonlyMap<AnimalId, AnimalDef> = new Map(
  ANIMAL_POOL.map((animal) => [animal.id, animal]),
)
