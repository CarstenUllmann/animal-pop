/**
 * Plain fallback panel — issue #23.
 *
 * Renders without `?debug=1`, because on the tablet the game dies before the debug overlay is
 * ever reached. It shows what this run recorded before it died, plus the trace that survived
 * from the previous run — the only two things an install-path force-close leaves behind.
 *
 * `fallbackLines` is pure so the wording can be tested without a browser.
 */

import { traceLines, type BootLog } from './bootlog'

const HEADINGS = new Set(['This run', 'Last run'])

export function fallbackLines(log: BootLog): string[] {
  const lines = ['This run', ...traceLines(log.current()), '', 'Last run']

  const previous = log.previous()
  if (previous === null) {
    lines.push('no trace from the previous run')
  } else {
    lines.push(...traceLines(previous))
  }

  if (!log.storageAvailable()) lines.push('', 'storage is unavailable on this device')
  return lines
}

export function renderFallback(root: Element, log: BootLog): void {
  const panel = document.createElement('div')
  panel.className = 'fallback'
  panel.setAttribute('role', 'alert')

  const title = document.createElement('h1')
  title.className = 'fallback__title'
  title.textContent = 'Pop-Pals could not start'
  panel.append(title)

  for (const line of fallbackLines(log)) {
    if (line === '') continue
    const row = document.createElement('p')
    row.className = HEADINGS.has(line) ? 'fallback__heading' : 'fallback__line'
    row.textContent = line
    panel.append(row)
  }

  const hint = document.createElement('p')
  hint.className = 'fallback__hint'
  hint.textContent = 'Open with ?debug=1 to read the trace. Please send a screenshot of this screen.'
  panel.append(hint)

  root.append(panel)
}
