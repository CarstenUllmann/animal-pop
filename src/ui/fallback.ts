import { traceLines, type BootLog } from './bootlog'

/**
 * The plain fallback panel, rendered without `?debug=1` when the game cannot start. It shows this
 * run's trace plus the one that survived the previous run.
 */

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
