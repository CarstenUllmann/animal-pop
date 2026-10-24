import { describe, expect, it } from 'vitest'
import { canAnimate, canListAnimations, hasMatchMedia, hasRandomValues } from './capabilities'

describe('hasRandomValues', () => {
  it('accepts an object with getRandomValues', () => {
    const crypto = { getRandomValues: (array: Uint32Array): Uint32Array => array }
    expect(hasRandomValues(crypto)).toBe(true)
  })

  it('rejects a missing or non-callable getRandomValues', () => {
    expect(hasRandomValues(undefined)).toBe(false)
    expect(hasRandomValues(null)).toBe(false)
    expect(hasRandomValues({})).toBe(false)
    expect(hasRandomValues({ getRandomValues: 'not a function' })).toBe(false)
  })
})

describe('hasMatchMedia', () => {
  it('accepts an object with matchMedia', () => {
    expect(hasMatchMedia({ matchMedia: (query: string) => ({ matches: query.length > 0 }) })).toBe(true)
  })

  it('rejects a window without matchMedia', () => {
    expect(hasMatchMedia({})).toBe(false)
    expect(hasMatchMedia(undefined)).toBe(false)
  })
})

describe('canAnimate', () => {
  it('accepts an element with animate', () => {
    expect(canAnimate({ animate: () => undefined })).toBe(true)
  })

  it('rejects an element without animate', () => {
    expect(canAnimate({})).toBe(false)
    expect(canAnimate(null)).toBe(false)
  })
})

describe('canListAnimations', () => {
  it('accepts an element that can list running animations', () => {
    expect(canListAnimations({ getAnimations: () => [] })).toBe(true)
  })

  it('rejects an element that cannot', () => {
    expect(canListAnimations({})).toBe(false)
    expect(canListAnimations(undefined)).toBe(false)
  })
})
