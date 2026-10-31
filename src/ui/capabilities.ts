/**
 * Feature detection for the Chrome 61 baseline. Syntax is downlevelled by the build; newer APIs
 * are read through these guards, so call sites stay typed and the fallback is explicit.
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

export function hasRandomValues(target: unknown): target is RandomValues {
  return hasMethod(target, 'getRandomValues')
}

export function hasMatchMedia(target: unknown): target is MatchMedia {
  return hasMethod(target, 'matchMedia')
}

export function canAnimate(target: unknown): target is Element & Animatable {
  return hasMethod(target, 'animate')
}

export function canListAnimations(target: unknown): target is Element & ListAnimations {
  return hasMethod(target, 'getAnimations')
}

export interface AwaitableAnimation {
  finished: PromiseLike<unknown>
}

/** `Animation.finished` is newer than the baseline, so an older engine gets no landing signal. */
export function canAwaitFinished(target: unknown): target is AwaitableAnimation {
  if (typeof target !== 'object' || target === null) return false
  const finished = (target as Record<string, unknown>).finished
  return (
    typeof finished === 'object' &&
    finished !== null &&
    typeof (finished as PromiseLike<unknown>).then === 'function'
  )
}

export interface EngineSnapshot {
  crypto: unknown
  window: unknown
  element: unknown
}

export function capabilityFlags(snapshot: EngineSnapshot): string[] {
  const flags: string[] = []
  if (hasRandomValues(snapshot.crypto)) flags.push('getRandomValues')
  if (hasMatchMedia(snapshot.window)) flags.push('matchMedia')
  if (canAnimate(snapshot.element)) flags.push('animate')
  if (canListAnimations(snapshot.element)) flags.push('getAnimations')
  return flags
}

/** The engine that booted this run, as a version token. Chrome first: its UA may mention Firefox. */
export function engineToken(userAgent: string): string {
  const chrome = /Chrome\/(\d+)/.exec(userAgent)
  if (chrome !== null) return `Chrome/${chrome[1]}`
  const firefox = /Firefox\/(\d+)/.exec(userAgent)
  if (firefox !== null) return `Firefox/${firefox[1]}`
  return 'unknown engine'
}
