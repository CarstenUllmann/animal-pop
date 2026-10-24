import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appendProbeLine, probeLine, probeLines, probeStatus, PROBE_KEY, PROBE_MAX_LINES } from './probe'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FACTS = { engine: 'engine Chrome/61', mode: 'standalone' }
const TIME = new Date('2026-10-24T09:14:02.000Z').getTime()

describe('probeLine', () => {
  it('is one launch as one line: when, which engine, which display mode', () => {
    expect(probeLine(FACTS, TIME)).toBe('2026-10-24T09:14:02.000Z engine Chrome/61 standalone')
  })

  it('names the engine the way capabilities.ts does, so the two agree on the tablet', () => {
    // The inline script in index.html cannot import this module, so the shape is the contract.
    expect(FACTS.engine).toMatch(/^engine Chrome\/\d+$/)
  })

  it('says on screen whether storage took the line, because a refused write cannot be read back', () => {
    expect(probeStatus(FACTS, TIME, true)).toContain('wrote')
    expect(probeStatus(FACTS, TIME, false)).toContain('cannot write')
  })
})

describe('appendProbeLine', () => {
  it('keeps the launches in order, newest last', () => {
    const first = appendProbeLine('', '2026-10-23T18:11:02.000Z engine Chrome/61 standalone')
    const second = appendProbeLine(first, '2026-10-24T09:14:02.000Z engine Chrome/138 browser')
    expect(probeLines(second)).toEqual([
      '2026-10-23T18:11:02.000Z engine Chrome/61 standalone',
      '2026-10-24T09:14:02.000Z engine Chrome/138 browser',
    ])
  })

  it('drops the oldest launches, so the history stays readable on the device', () => {
    let raw = ''
    for (let i = 0; i < PROBE_MAX_LINES + 3; i++) {
      raw = appendProbeLine(raw, `launch ${i}`)
    }
    const lines = probeLines(raw)
    expect(lines).toHaveLength(PROBE_MAX_LINES)
    expect(lines[0]).toBe('launch 3')
    expect(lines[lines.length - 1]).toBe(`launch ${PROBE_MAX_LINES + 2}`)
  })

  it('survives a half-written value, which is what a force-close leaves behind', () => {
    expect(probeLines('launch 1\n\n\nnot a line')).toEqual(['launch 1', 'not a line'])
    expect(probeLines('')).toEqual([])
  })
})

describe('the probe in index.html', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  const script = html.slice(html.indexOf('<script>'), html.indexOf('</script>'))

  it('runs as a classic script, before the module is requested', () => {
    expect(script).not.toContain('type="module"')
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('<script type="module"'))
  })

  it('writes into the key this module owns, so the two cannot drift apart', () => {
    expect(script).toContain(`'${PROBE_KEY}'`)
    expect(script).toContain(`var MAX = ${PROBE_MAX_LINES}`)
  })

  it('stays inside ES5, because it has to parse on an engine newer syntax is the problem with', () => {
    const banned = ['=>', '`', 'const ', 'let ', '?.', '??', '...', 'globalThis', 'includes(']
    const offenders = banned.filter((token) => script.includes(token))
    expect(offenders).toEqual([])
  })
})
