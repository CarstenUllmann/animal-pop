import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Engine baseline test - issue #23.
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
  allSettled: 76,
  'flatMap(': 69,
  '.flat(': 69,
  '.at(': 92,
  'matchAll(': 81,
  'fromEntries(': 71,
  'hasOwn(': 93,
  'structuredClone(': 98,
  'queueMicrotask(': 69,
}

/**
 * Syntax the target can downlevel but this engine still cannot parse, so a source that uses it is
 * only safe if the build really rewrites it — which is what the second half of this test checks.
 */
const TOO_NEW_SYNTAX: Array<[string, string]> = [
  ['optional chaining', '?.'],
  ['nullish coalescing', '??'],
  ['optional catch binding', 'catch {'],
  ['private class field', '#'],
]

/**
 * Blank out comments and string contents, keeping line structure, so the scan sees code rather than
 * prose that merely mentions a banned construct. Regex literals are not tracked, so a regex
 * containing a quote is misread; none of the shipped sources has one.
 */
function withoutCommentsAndStrings(text: string): string {
  let out = ''
  let quote = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (quote) {
      if (c === '\\') {
        out += '  '
        i += 2
        continue
      }
      if (c === quote) {
        quote = ''
        out += c
      } else {
        out += c === '\n' ? '\n' : ' '
      }
      i += 1
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      out += c
      i += 1
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        out += ' '
        i += 1
      }
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' '
        i += 1
      }
      out += '  '
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

function offendersIn(text: string, name: string): string[] {
  const found: string[] = []
  text.split('\n').forEach((line, position) => {
    for (const [label, token] of TOO_NEW_SYNTAX) {
      if (token === '#') {
        // A `#` is only a private field when it follows a class member boundary, not when it is
        // text in a CSS selector or an id.
        if (/(^|[\s{;}])#[A-Za-z_]/.test(line)) found.push(`${name}:${position + 1}: ${label}: ${line.trim()}`)
      } else if (line.includes(token)) {
        found.push(`${name}:${position + 1}: ${label}: ${line.trim()}`)
      }
    }
  })
  return found
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

  it('uses no syntax newer than the engine the installed app runs in', () => {
    const offenders: string[] = []
    for (const file of shippedSources(SRC)) {
      const name = file.slice(SRC.length + 1)
      offenders.push(...offendersIn(withoutCommentsAndStrings(readFileSync(file, 'utf8')), name))
    }
    expect(offenders).toEqual([])
  })

  it('leaves none of that syntax in what the build actually ships', () => {
    const assets = join(SRC, '..', 'dist')
    if (!existsSync(assets)) return // Run after `npm run build` to check the shipped bundle.
    // CSS is not scanned for syntax: `#` is an id selector there, not a private field.
    const files = [join(assets, 'sw.js')]
      .filter((f) => existsSync(f))
      .concat(readdirSync(join(assets, 'assets')).filter((f) => f.endsWith('.js')).map((f) => join(assets, 'assets', f)))
    const offenders: string[] = []
    for (const file of files) {
      offenders.push(...offendersIn(withoutCommentsAndStrings(readFileSync(file, 'utf8')), file.slice(assets.length + 1)))
    }
    expect(offenders).toEqual([])
  })

  it('targets the engine the installed app runs in, not the browser', () => {
    const config = readFileSync(join(SRC, '..', 'vite.config.ts'), 'utf8')
    expect(config).toContain("const CHROME_TARGET = 'chrome61'")
  })

  it('builds the worker as a plain script, which that engine can register', () => {
    const config = readFileSync(join(SRC, '..', 'vite.config.ts'), 'utf8')
    expect(config).toContain("strategies: 'injectManifest'")
    expect(config).toContain("filename: 'sw.ts'")
    expect(config).toContain("rollupFormat: 'iife'")
  })
})
