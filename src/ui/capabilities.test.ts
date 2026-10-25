import { describe, expect, it } from 'vitest'
import {
  canAnimate,
  canAwaitFinished,
  canListAnimations,
  capabilityFlags,
  engineToken,
  hasMatchMedia,
  hasRandomValues,
} from './capabilities'

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

describe('canAwaitFinished', () => {
  it('accepts an animation that can report when it lands', () => {
    const animation = { finished: Promise.resolve(null) }
    expect(canAwaitFinished(animation)).toBe(true)
  })

  it('rejects a Chrome 61 animation, which has no finished promise', () => {
    expect(canAwaitFinished({})).toBe(false)
    expect(canAwaitFinished({ finished: undefined })).toBe(false)
    expect(canAwaitFinished({ finished: 'not a promise' })).toBe(false)
    expect(canAwaitFinished(null)).toBe(false)
  })
})

describe('capabilityFlags', () => {
  it('names the APIs the engine provides', () => {
    const snapshot = {
      crypto: { getRandomValues: (array: unknown) => array },
      window: { matchMedia: (query: string) => ({ matches: query.length > 0 }) },
      element: { animate: () => undefined, getAnimations: () => [] },
    }
    expect(capabilityFlags(snapshot)).toEqual([
      'getRandomValues',
      'matchMedia',
      'animate',
      'getAnimations',
    ])
  })

  it('names nothing for an engine without them', () => {
    expect(capabilityFlags({ crypto: undefined, window: {}, element: {} })).toEqual([])
  })
})

describe('engineToken', () => {
  it('reports the Chrome version token, which differs between browser and WebView', () => {
    const browser =
      'Mozilla/5.0 (Linux; Android 8.1.0; Pixel C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
    const webView =
      'Mozilla/5.0 (Linux; Android 8.1.0; Pixel C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36'
    expect(engineToken(browser)).toBe('Chrome/137')
    expect(engineToken(webView)).toBe('Chrome/109')
  })

  it('names the engine for Firefox, which is the engine the installed app runs in (ADR-0002)', () => {
    // Android Firefox, as the PWA wrapper reports it. A token that only read Chrome said
    // `unknown engine` for every launch the child actually makes.
    const firefox = 'Mozilla/5.0 (Android 8.1.0; Mobile; rv:158.0) Gecko/158.0 Firefox/158.0'
    expect(engineToken(firefox)).toBe('Firefox/158')
  })

  it('says unknown when there is no engine token to read', () => {
    expect(engineToken('Mozilla/5.0 (compatible; SomeBrowser/12.0)')).toBe('unknown engine')
  })
})
