import { describe, expect, it } from 'vitest'
import { CACHE_NAME, SHELL, answersFromCache, canServeShell } from './swPolicy'

const ORIGIN = 'https://carstenullmann.github.io'

describe('answersFromCache', () => {
  it('answers same-origin GETs', () => {
    expect(answersFromCache({ url: '/animal-pop/assets/index.js', method: 'GET' }, ORIGIN)).toBe(true)
  })

  it('resolves a relative request against the worker', () => {
    expect(answersFromCache({ url: 'index.html', method: 'GET' }, ORIGIN)).toBe(true)
  })

  it('does not intercept another origin', () => {
    expect(answersFromCache({ url: 'https://cdn.jsdelivr.net/npm/x.js', method: 'GET' }, ORIGIN)).toBe(false)
  })

  it('does not intercept anything that is not a GET', () => {
    expect(answersFromCache({ url: '/animal-pop/index.html', method: 'POST' }, ORIGIN)).toBe(false)
  })

  it('answers a request that carries the debug query', () => {
    expect(answersFromCache({ url: '/animal-pop/?debug=1', method: 'GET' }, ORIGIN)).toBe(true)
  })
})

describe('canServeShell', () => {
  it('serves the shell for the page she launches offline', () => {
    expect(canServeShell({ mode: 'navigate' })).toBe(true)
  })

  it('does not serve the shell for an asset', () => {
    expect(canServeShell({ mode: 'no-cors' })).toBe(false)
  })

  it('names the shell as the entry the cache holds', () => {
    expect(SHELL).toBe('index.html')
    expect(CACHE_NAME).toBe('pop-pals.v1')
  })
})
