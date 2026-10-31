import type { AnimalId } from './types'

/**
 * The animal ids, kept apart from `animals.ts` because that module imports the `.svg` files and
 * the simulator runs under plain node.
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
