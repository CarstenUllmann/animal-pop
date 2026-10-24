/**
 * Feature detection for the platform baseline (SPEC §2, "Platform constraint").
 *
 * The baseline is Chrome 138, so every API here is allowed; what is not guaranteed is that the
 * installed app gets that Chrome. The standalone launch runs in whatever WebView the tablet
 * provides, and issue #23 is exactly that gap: the same bundle works in the tablet browser and
 * on a newer phone. Each guard takes the object it checks and narrows it, so the call sites stay
 * typed and the fallback is visible from the code.
 *
 * Pure (no globals touched), so the guards can be tested in the node environment.
 */

export interface RandomValues {
  getRandomValues(array: unknown): unknown
}

export interface MatchMedia {
  matchMedia(query: string): MediaQueryList
}

export interface Animatable {
  animate(keyframes: unknown, options?: unknown): Animation
}

export interface ListAnimations {
  getAnimations(options?: unknown): readonly Animation[]
}

function hasMethod(target: unknown, name: string): boolean {
  if (typeof target !== 'object' || target === null) return false
  return typeof (target as Record<string, unknown>)[name] === 'function'
}

/** `crypto.getRandomValues` is not present in every WebView. */
export function hasRandomValues(target: unknown): target is RandomValues {
  return hasMethod(target, 'getRandomValues')
}

/** The reduced-motion and display-mode rows depend on it (SPEC §16.3). */
export function hasMatchMedia(target: unknown): target is MatchMedia {
  return hasMethod(target, 'matchMedia')
}

/** Web Animations API. Without it the board stays static instead of crashing. */
export function canAnimate(target: unknown): target is Element & Animatable {
  return hasMethod(target, 'animate')
}

/** Within the baseline, but a WebView may still not expose it on the element. */
export function canListAnimations(target: unknown): target is Element & ListAnimations {
  return hasMethod(target, 'getAnimations')
}
