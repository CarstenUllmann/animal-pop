/**
 * On-device debug overlay (SPEC §14.3). The tablet has no USB tethering we can count
 * on, so `?debug=1` is the debugging channel. This is the M0 skeleton: it reports
 * platform facts and reserves labelled slots for the game values that arrive in M1/M2.
 *
 * Without the query parameter nothing is created, no listeners are added and no
 * requestAnimationFrame loop runs.
 */

const DEBUG_PARAM = 'debug'

export function parseDebugFlag(search: string): boolean {
  const value = new URLSearchParams(search).get(DEBUG_PARAM)
  return value === '1' || value?.toLowerCase() === 'true'
}

export interface DebugOverlay {
  readonly element: HTMLElement
  destroy(): void
}

/** Values the running game already knows; later milestones add more. */
export interface DebugInfo {
  seed?: number
  animals?: readonly string[]
}

type ValueKey =
  | 'level'
  | 'seed'
  | 'animals'
  | 'bubbles'
  | 'goals'
  | 'fps'
  | 'display'
  | 'viewport'
  | 'online'
  | 'serviceWorker'
  | 'build'

interface RowDef {
  key: ValueKey
  label: string
  initial: () => string
  /** Game values are not wired up until later milestones. */
  pending?: boolean
}

const ROWS: RowDef[] = [
  { key: 'level', label: 'level', initial: () => '—', pending: true },
  { key: 'seed', label: 'seed', initial: () => '—', pending: true },
  { key: 'animals', label: 'animals', initial: () => '—', pending: true },
  { key: 'bubbles', label: 'bubbles', initial: () => '—', pending: true },
  { key: 'goals', label: 'goals', initial: () => '—', pending: true },
  { key: 'fps', label: 'fps', initial: () => '—' },
  { key: 'display', label: 'display', initial: displayMode },
  { key: 'viewport', label: 'viewport', initial: viewportText },
  { key: 'online', label: 'network', initial: () => (navigator.onLine ? 'online' : 'offline') },
  { key: 'serviceWorker', label: 'service worker', initial: serviceWorkerStatus },
  {
    key: 'build',
    label: 'build',
    initial: () => `${__APP_VERSION__} · ${__BUILD_TIME__.slice(0, 16).replace('T', ' ')}Z`,
  },
]

export function mountDebugOverlay(root: HTMLElement, info: DebugInfo = {}): DebugOverlay {
  const panel = element('aside', 'debug')
  panel.setAttribute('aria-label', 'Debug overlay')

  const header = element('header', 'debug__header')
  const title = element('strong', 'debug__title', 'debug')
  const toggle = element('button', 'debug__button', 'hide')
  toggle.type = 'button'
  toggle.setAttribute('aria-expanded', 'true')
  header.append(title, toggle)

  const rows = element('dl', 'debug__rows')
  const values = {} as Record<ValueKey, HTMLElement>

  for (const row of ROWS) {
    const label = element('dt', row.pending ? 'debug__label debug__label--pending' : 'debug__label', row.label)
    if (row.pending) label.title = 'Wired up in a later milestone'
    const value = element('dd', row.pending ? 'debug__value debug__value--pending' : 'debug__value', row.initial())
    values[row.key] = value
    rows.append(label, value)
  }

  const errorBlock = element('section', 'debug__error')
  errorBlock.append(element('span', 'debug__error-label', 'last error'))
  const errorValue = element('p', 'debug__error-value', 'none')
  errorBlock.append(errorValue)

  const footer = element('footer', 'debug__footer')
  const nextLevel = element('button', 'debug__button debug__button--next', 'next level')
  nextLevel.type = 'button'
  nextLevel.disabled = true
  nextLevel.title = 'Arrives with levels in M2'
  footer.append(nextLevel, element('span', 'debug__hint', 'game values land in M1–M2'))

  panel.append(header, rows, errorBlock, footer)
  root.append(panel)

  const setValue = (key: ValueKey, text: string): void => {
    values[key].textContent = text
    values[key].classList.remove('debug__value--pending')
  }

  // M1 knows the seed and the animals in play; the rest arrive with levels in M2.
  if (info.seed !== undefined) setValue('seed', info.seed.toString(16).padStart(8, '0'))
  if (info.animals !== undefined) setValue('animals', info.animals.join(' '))

  const setLastError = (message: string): void => {
    const trimmed = message.trim() || 'unknown error'
    errorValue.textContent = trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed
    errorValue.title = message
  }

  // FPS: sampled twice a second while the overlay is mounted.
  let frames = 0
  let sampleStart = performance.now()
  let frameHandle = 0
  const sampleFrame = (now: number): void => {
    frames += 1
    const elapsed = now - sampleStart
    if (elapsed >= 500) {
      setValue('fps', String(Math.round((frames * 1000) / elapsed)))
      frames = 0
      sampleStart = now
    }
    frameHandle = requestAnimationFrame(sampleFrame)
  }
  frameHandle = requestAnimationFrame(sampleFrame)

  const onResize = (): void => {
    setValue('viewport', viewportText())
    setValue('display', displayMode())
  }
  const onNetwork = (): void => {
    setValue('online', navigator.onLine ? 'online' : 'offline')
  }
  const onServiceWorkerChange = (): void => {
    setValue('serviceWorker', serviceWorkerStatus())
  }
  const onError = (event: ErrorEvent): void => {
    setLastError(event.message || 'unknown error')
  }
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    setLastError(describe(event.reason))
  }
  const onToggle = (): void => {
    const collapsed = panel.classList.toggle('debug--collapsed')
    toggle.textContent = collapsed ? 'show' : 'hide'
    toggle.setAttribute('aria-expanded', String(!collapsed))
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    // A desktop convenience only; the tablet never sends this.
    if (event.key === 'd' && event.altKey) onToggle()
  }
  const onVisibility = (): void => {
    // Avoid a huge bogus FPS sample after the tab was in the background.
    frames = 0
    sampleStart = performance.now()
  }

  window.addEventListener('resize', onResize)
  window.addEventListener('online', onNetwork)
  window.addEventListener('offline', onNetwork)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  window.addEventListener('keydown', onKeyDown)
  document.addEventListener('visibilitychange', onVisibility)
  toggle.addEventListener('click', onToggle)
  navigator.serviceWorker?.addEventListener('controllerchange', onServiceWorkerChange)

  return {
    element: panel,
    destroy(): void {
      cancelAnimationFrame(frameHandle)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('online', onNetwork)
      window.removeEventListener('offline', onNetwork)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVisibility)
      toggle.removeEventListener('click', onToggle)
      navigator.serviceWorker?.removeEventListener('controllerchange', onServiceWorkerChange)
      panel.remove()
    },
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function displayMode(): string {
  if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone'
  if (navigator.standalone) return 'standalone'
  return 'browser'
}

function viewportText(): string {
  return `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio.toFixed(2)}`
}

function serviceWorkerStatus(): string {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  return navigator.serviceWorker.controller ? 'active' : 'registering'
}

function describe(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`
  if (typeof reason === 'string') return reason
  try {
    return JSON.stringify(reason) ?? String(reason)
  } catch {
    return String(reason)
  }
}
