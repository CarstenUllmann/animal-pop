import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Engine baseline test — issue #23.
 *
 * The build target downlevelles syntax, but it cannot polyfill an API the engine never had, and
 * an old WebView fails to *parse* a module that uses newer syntax: nothing runs, so nothing is on
 * screen and no console shows it. That is why the shipped sources may not name an API newer than
 * the measured engine unless capabilities.ts feature-detects it. SPEC §2 states the rule; this test
 * keeps it from drifting back to the browser baseline.
 */

const SRC = dirname(fileURLToPath(import.meta.url))

/** Shipped sources only: the tests themselves run in node, where anything is allowed. */
function shippedSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) shippedSources(path, found)
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) found.push(path)
  }
  return found
}

/** APIs newer than Chrome 61 that the build target cannot transpile. */
const TOO_NEW: Record<string, number> = {
  globalThis: 71,
  'flatMap(': 69,
  '.flat(': 69,
  '.at(': 92,
  'matchAll(': 81,
  'fromEntries(': 71,
  'hasOwn(': 93,
  'structuredClone(': 98,
  'queueMicrotask(': 69,
}

describe('engine baseline', () => {
  it('names no API newer than the engine the installed app runs in', () => {
    const offenders: string[] = []
    for (const file of shippedSources(SRC)) {
      const source = readFileSync(file, 'utf8')
      for (const [api, chrome] of Object.entries(TOO_NEW)) {
        const name = file.slice(SRC.length + 1)
        if (source.includes(api)) offenders.push(`${name}: ${api} (Chrome ${chrome})`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('targets the engine the installed app runs in, not the browser', () => {
    const config = readFileSync(join(SRC, '..', 'vite.config.ts'), 'utf8')
    expect(config).toContain("const CHROME_TARGET = 'chrome61'")
  })
})
