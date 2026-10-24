import { describe, expect, it } from 'vitest'
import { parseDebugFlag } from './debug'

describe('parseDebugFlag', () => {
  it.each([
    ['', false],
    ['?', false],
    ['?debug', false],
    ['?debug=0', false],
    ['?debug=false', false],
    ['?debug=1', true],
    ['?debug=true', true],
    ['?debug=TRUE', true],
    ['?debug=1&level=3', true],
    ['?level=3&debug=1', true],
    ['?debug=1&other=2', true],
    ['?DEBUG=1', false],
  ])('parses %j as %s', (search, expected) => {
    expect(parseDebugFlag(search)).toBe(expected)
  })
})
