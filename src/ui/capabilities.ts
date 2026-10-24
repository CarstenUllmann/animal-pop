/**
 * Feature detection for the platform baseline (SPEC §2, "Platform constraint").
 *
 * The build targets Chrome 61, the engine measured on the tablet's System WebView, because the
 * installed app runs in that WebView rather than in the tablet's browser (Chrome 138). Syntax is
 * downlevelled by the build target; what the target cannot fix is the set of APIs an old engine
 * actually exposes, so every newer API is read through a guard here. Issue #23 is exactly that
 * gap: the same bundle works in the tablet browser and on a newer phone. Each guard takes the
 * object it checks and narrows it, so the call sites stay typed and the fallback is visible.
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

export interface AwaitableAnimation {
  finished: PromiseLike<unknown>
}

/**
 * `Animation.finished` is the completion promise the board animation sequences on (Chrome 75).
 * Chrome 61 has `Element.animate` without it, so an older engine gets no landing signal and the
 * board stays static, as SPEC §14.3 says. This guard takes the animation object a call returned,
 * so it is not part of the snapshot below.
 */
export function canAwaitFinished(target: unknown): target is AwaitableAnimation {
  if (typeof target !== 'object' || target === null) return false
  const finished = (target as Record<string, unknown>).finished
  return (
    typeof finished === 'object' &&
    finished !== null &&
    typeof (finished as PromiseLike<unknown>).then === 'function'
  )
}

/** The snapshot guards read together, as the names the engine actually provides. */
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

/**
 * The engine that booted this run, as its Chrome version token.
 *
 * The browser and the installed app report different numbers here, because standalone uses the
 * System WebView rather than the browser build. Since the trace is persisted and Chrome uses one
 * profile for both, reading the trace from the browser tells us which engine the crashed run ran
 * in (issue #23).
 */
export function engineToken(userAgent: string): string {
  const match = /Chrome\/(\d+)/.exec(userAgent)
  return match === null ? 'unknown engine' : `Chrome/${match[1]}`
}
