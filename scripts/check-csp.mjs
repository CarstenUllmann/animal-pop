#!/usr/bin/env node
/**
 * Fail if the built app violates its own Content-Security-Policy.
 *
 * The policy is enforced by the browser, not by reading `dist/index.html`: the running page is the
 * only place that knows which URLs the bundle actually asks for. Vite inlines small assets as
 * `data:` URIs, and a static scan of the HTML cannot see that — issue #38 is exactly that
 * regression, where `img-src 'self'` blocked every animal face while the built HTML looked fine.
 *
 * Needs a Chromium-based browser (Chrome, Edge or Chromium). Set `CHROME_PATH` to point at one;
 * otherwise the usual install locations are probed. Run it through `npm run check:csp`, which
 * builds first.
 *
 * Exit codes: 0 clean, 1 the policy or the page failed, 2 the check could not run (no build,
 * no browser).
 */
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'

const DIST = resolve(import.meta.dirname, '..', 'dist')
const SETTLE_MS = 3000
const START_TIMEOUT_MS = 20000
const LOAD_TIMEOUT_MS = 15000

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
}

/** A CSP violation is reported by the browser in this shape; the console copy follows it. */
const VIOLATION = /content security policy|refused to (load|apply|execute)|violates the following/i

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function fail(message) {
  console.error(`check:csp: ${message}`)
  process.exit(2)
}

/** Chromium, by preference, from the environment or the platform's usual install locations. */
function findBrowser() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) fail(`CHROME_PATH does not exist: ${process.env.CHROME_PATH}`)
    return process.env.CHROME_PATH
  }

  const candidates = []
  if (process.platform === 'win32') {
    const programFiles = process.env['PROGRAMFILES'] ?? 'C:\\Program Files'
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
    candidates.push(
      join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    )
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    )
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      try {
        const found = execFileSync('which', [name], { encoding: 'utf8' }).trim()
        if (found) candidates.push(found)
      } catch {
        // Not installed; try the next name.
      }
    }
  }

  const found = candidates.find((candidate) => existsSync(candidate))
  if (found === undefined) {
    fail('no Chromium-based browser found. Install Chrome or Edge, or set CHROME_PATH.')
  }
  return found
}

/** The build, served the way Pages serves it: static files from the project root. */
function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const file = resolve(DIST, `.${pathname}`)

    if (!file.startsWith(DIST + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }

    response.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      // The point is to check this build, not a cached older one.
      'cache-control': 'no-store',
    })
    response.end(readFileSync(file))
  })

  return new Promise((resolveServer, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('could not bind the static server'))
        return
      }
      resolveServer({ server, port: address.port })
    })
  })
}

/** `--remote-debugging-port=0` writes the port the browser picked into the profile directory. */
async function devtoolsPort(profile) {
  const file = join(profile, 'DevToolsActivePort')
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const port = readFileSync(file, 'utf8').split('\n')[0]?.trim()
      if (port) return Number(port)
    }
    await sleep(100)
  }
  throw new Error(`browser did not open a DevTools port within ${START_TIMEOUT_MS}ms`)
}

/** A page session, with the parts of CDP this check needs. */
async function openPage(port, url) {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, {
    method: 'PUT',
  })
  if (!created.ok) throw new Error(`could not open a page target (${created.status})`)
  const page = await created.json()

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolveSocket, reject) => {
    socket.onopen = resolveSocket
    socket.onerror = () => reject(new Error('could not connect to the page target'))
  })

  const pending = new Map()
  const violations = new Set()
  let loaded = () => {}
  let nextId = 1

  const send = (method, params = {}) =>
    new Promise((resolveCall, rejectCall) => {
      const id = nextId++
      pending.set(id, { resolve: resolveCall, reject: rejectCall })
      socket.send(JSON.stringify({ id, method, params }))
    })

  const note = (text) => {
    if (VIOLATION.test(text)) violations.add(text)
  }

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)

    if (message.id !== undefined && pending.has(message.id)) {
      const call = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) call.reject(new Error(JSON.stringify(message.error)))
      else call.resolve(message.result)
      return
    }

    if (message.method === 'Log.entryAdded') note(message.params.entry.text ?? '')
    if (message.method === 'Runtime.consoleAPICalled') {
      note(message.params.args.map((argument) => argument.value ?? argument.description ?? '').join(' '))
    }
    if (message.method === 'Page.loadEventFired') loaded()
  }

  await send('Log.enable')
  await send('Runtime.enable')
  await send('Page.enable')

  const load = new Promise((resolveLoad) => {
    loaded = resolveLoad
  })
  await send('Page.navigate', { url })
  await Promise.race([load, sleep(LOAD_TIMEOUT_MS)])
  await sleep(SETTLE_MS)

  const state = await send('Runtime.evaluate', {
    expression: `(() => ({
      policy: Boolean(document.querySelector('meta[http-equiv="Content-Security-Policy"]')),
      mounted: Boolean(document.querySelector('#app.game')),
      fallback: Boolean(document.querySelector('.fallback')),
      images: document.images.length,
      loaded: Array.from(document.images).filter((image) => image.complete && image.naturalWidth > 0).length,
      tiles: document.querySelectorAll('.tile__face').length,
      goals: document.querySelectorAll('.goal__face').length
    }))()`,
    returnByValue: true,
  })

  socket.close()
  return { violations: [...violations], state: state.result.value }
}

async function closeBrowser(port) {
  try {
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    const socket = new WebSocket(info.webSocketDebuggerUrl)
    await new Promise((resolveSocket, reject) => {
      socket.onopen = resolveSocket
      socket.onerror = () => reject(new Error('could not connect to the browser target'))
    })
    socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    await sleep(500)
    socket.close()
  } catch {
    // The browser is gone already; the kill below is the backstop.
  }
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) fail('dist/index.html not found. Run `npm run build` first.')
  if (typeof WebSocket === 'undefined') fail('Node 22+ is required (global WebSocket).')

  const browser = findBrowser()
  const { server, port: serverPort } = await startServer()
  const profile = mkdtempSync(join(tmpdir(), 'animal-pop-csp-'))
  let port = null
  let child = null

  try {
    child = spawn(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-extensions',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        '--remote-debugging-port=0',
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: true },
    )

    port = await devtoolsPort(profile)
    const { violations, state } = await openPage(port, `http://127.0.0.1:${serverPort}/`)

    const problems = []
    if (!state.policy) problems.push('the built page carries no Content-Security-Policy meta tag')
    if (!state.mounted) {
      problems.push(state.fallback ? 'the app fell back to the boot-failure panel' : 'the app did not mount')
    }
    if (state.images === 0) problems.push('the page rendered no images, so a blocked image would go unnoticed')
    if (state.loaded !== state.images) problems.push(`${state.images - state.loaded} of ${state.images} images did not load`)
    for (const violation of violations) problems.push(violation)

    if (problems.length > 0) {
      console.error(`check:csp: FAILED — ${problems.length} problem${problems.length === 1 ? '' : 's'}`)
      for (const problem of problems.slice(0, 10)) console.error(`  - ${problem.slice(0, 300)}`)
      process.exitCode = 1
      return
    }

    console.log(
      `check:csp: OK — 0 violations, ${state.loaded}/${state.images} images loaded ` +
        `(${state.tiles} tiles, ${state.goals} goal cards).`,
    )
  } finally {
    if (port !== null) await closeBrowser(port)
    if (child !== null) child.kill()
    server.close()
    server.closeAllConnections?.()
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      // A locked profile directory is not a reason to fail the check.
    }
  }
}

main().catch((error) => {
  console.error(`check:csp: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
})
