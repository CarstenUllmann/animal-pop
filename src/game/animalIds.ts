import type { AnimalId } from './types'

/**
 * The animal manifest ids (SPEC §12.2), kept apart from `animals.ts` because that module imports
 * the `.svg` files, which only the bundler can resolve. The simulator and its reporter run under
 * plain node, so they need the ids without the asset graph — and both must read the same list,
 * so the roster the simulator ramps is the roster the game ships.
 */
export const ANIMAL_IDS: readonly AnimalId[] = [
  'cat',
  'rabbit',
  'panda',
  'frog',
  'pig',
  'penguin',
  'monkey',
  'fox',
]
