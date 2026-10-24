import './style.css'
import { createSynthPlayer } from './audio/synth'
import { ANIMAL_POOL } from './game/animals'
import { createBoard, deadBoard, legalGroupAt, popGroup, reshuffleBoard } from './game/board'
import { M1_ANIMAL_TYPES, MAX_QUEUED_TAPS } from './game/constants'
import { createRng, seedFromCrypto, seedFromRandom } from './game/rng'
import { createBootLog, describeError } from './ui/bootlog'
import { createBoardView } from './ui/boardView'
import { capabilityFlags, engineToken, hasRandomValues } from './ui/capabilities'
import { mountDebugOverlay, parseDebugFlag } from './ui/debug'
import { renderFallback } from './ui/fallback'
import { installKidProofing } from './ui/shell'

/**
 * Survivable boot — issue #23.
 *
 * A force-close on the tablet leaves nothing behind: there is no console in standalone
 * mode, and the process dies before anything is on screen. So every step is recorded to
 * the persisted trace before it runs, and nothing here throws. A failure renders the plain
 * fallback panel instead, which is what makes the trace readable on the next launch.
 */

const log = createBootLog()

log.step('boot')
log.step(log.storageAvailable() ? 'storage ok' : 'storage unavailable')

// Recorded first, because these are the only facts a force-close leaves behind that can be read
// without a screen: Chrome uses one profile for both the browser and the installed app, so the
// browser's `?debug=1` boot row shows the standalone run's trace (issue #23). The engine token is
// how we tell the two apart — standalone gets the System WebView, not the browser build.
log.step(`engine ${engineToken(navigator.userAgent)}`)
log.step(
  `capabilities: ${capabilityFlags({
    crypto: globalThis.crypto,
    window,
    element: document.createElement('div'),
  }).join(', ') || 'none'}`,
)

const app = document.querySelector<HTMLElement>('#app')
if (app === null) {
  log.error('Missing #app root element')
  if (document.body !== null) renderFallback(document.body, log)
} else {
  try {
    start(app)
  } catch (error) {
    log.error(describeError(error))
    renderFallback(app, log)
  }
}

function start(root: HTMLElement): void {
  log.step('#app')
  installKidProofing()
  log.step('kid-proofing')

  const seed = randomSeed()
  log.step(`seed ${seed}`)
  const rng = createRng(seed)
  const roster = rng.shuffle(ANIMAL_POOL).slice(0, M1_ANIMAL_TYPES).map((animal) => animal.id)
  log.step('roster')

  let board = createBoard(roster, rng)
  log.step('board')

  let busy = true
  const queuedTaps: number[] = []
  const player = createSynthPlayer()

  const view = createBoardView({ onTap: enqueueTap })
  root.append(view.element)
  log.step('view')

  // The only debugging channel we can rely on once installed (SPEC §14.3).
  if (parseDebugFlag(window.location.search)) {
    mountDebugOverlay(document.body, { seed, animals: roster, bootLog: log })
    log.step('debug overlay')
  } else {
    log.step('debug off')
  }

  // Android only allows audio from inside a gesture. Capture the first pointerdown
  // before the tap handler so the very first pop already has sound.
  document.addEventListener('pointerdown', () => player.unlock(), {
    capture: true,
    once: true,
  })
  log.step('listeners')

  void view
    .renderInitial(board)
    .then(() => {
      busy = false
      log.step('first frame')
      drainQueue()
    })
    .catch((error: unknown) => {
      log.error(describeError(error))
      renderFallback(root, log)
    })

  let firstTap = true
  let firstPop = true

  function enqueueTap(index: number): void {
    player.unlock()
    if (firstTap) {
      firstTap = false
      log.step('first tap')
    }
    if (busy) {
      if (queuedTaps.length < MAX_QUEUED_TAPS) queuedTaps.push(index)
      return
    }
    void resolveTap(index)
  }

  async function resolveTap(index: number): Promise<void> {
    busy = true
    try {
      const group = legalGroupAt(board, index)
      if (group === null) {
        view.animateInvalid(index)
        player.playInvalid()
      } else {
        const result = popGroup(board, group, roster, rng)
        board = result.board
        player.playPop(result.animal, result.count)
        await view.animatePop(result)

        if (deadBoard(board)) {
          player.playReshuffle()
          const next = reshuffleBoard(roster, rng)
          await view.animateReshuffle(next)
          board = next
        }
      }

      // If the crash happens on the first interaction, the trace shows how far we got.
      if (firstPop) {
        firstPop = false
        log.step('first pop')
      }
    } catch (error) {
      log.error(describeError(error))
    } finally {
      busy = false
    }

    drainQueue()
  }

  function drainQueue(): void {
    if (busy) return
    const next = queuedTaps.shift()
    if (next !== undefined) void resolveTap(next)
  }
}

/** Feature-detected: older WebViews do not always provide `crypto.getRandomValues`. */
function randomSeed(): number {
  if (hasRandomValues(globalThis.crypto)) {
    log.step('random: crypto')
    return seedFromCrypto(globalThis.crypto.getRandomValues(new Uint32Array(1)))
  }
  log.step('random: Math.random fallback')
  return seedFromRandom(Math.random())
}
