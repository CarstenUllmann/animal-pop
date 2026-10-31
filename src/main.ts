import './style.css'
import { createSynthPlayer } from './audio/synth'
import { ANIMAL_POOL } from './game/animals'
import { GRID } from './game/constants'
import { createRng, seedFromCrypto, seedFromRandom } from './game/rng'
import { partySize } from './game/rules'
import { readSave, writeSave } from './game/save'
import { createLevelSession, type TapPlan } from './game/session'
import type { PopResult, TapResult } from './game/types'
import { mountAdultReset } from './ui/adultReset'
import { createBootLog, describeError } from './ui/bootlog'
import { createBoardView } from './ui/boardView'
import { capabilityFlags, engineToken, hasMatchMedia, hasRandomValues } from './ui/capabilities'
import { createCelebration } from './ui/celebration'
import { displayMode, motionPreference, mountDebugOverlay, parseDebugFlag } from './ui/debug'
import { renderFallback } from './ui/fallback'
import { applyLayout, bunchMetricsFor, type Viewport } from './ui/layout'
import { createMuteController, mountMuteToggle } from './ui/muteToggle'
import { createPanelView } from './ui/panelView'
import { installKidProofing } from './ui/shell'
import { localStorageStore } from './ui/storage'
import type { Timer } from './ui/timer'

/**
 * Composition root. It is the only module that touches the screen, the clock and real randomness:
 * the core decides, and here that decision becomes a sound, a movement and a saved level.
 *
 * A force-close on the tablet leaves no console, so every step is recorded to the persisted trace
 * before it runs and nothing here throws; a failure renders the plain fallback panel instead.
 */

const log = createBootLog()
const store = localStorageStore()

log.step('boot')
log.step(log.storageAvailable() ? 'storage ok' : 'storage unavailable')

// Chrome shares one profile between the browser and the installed app, so a `?debug=1` visit can
// read the standalone run's trace. The engine token is how the two are told apart.
log.step(`engine ${engineToken(navigator.userAgent)}`)
log.step(
  `capabilities: ${capabilityFlags({
    crypto: window.crypto,
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

// Registered on `load` so the install does not compete with the first frame, and in a build only,
// because the dev server has no worker to serve.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((error: unknown) => {
      log.error(`service worker: ${describeError(error)}`)
    })
  })
}

function start(root: HTMLElement): void {
  log.step('#app')
  root.classList.add('game')
  installKidProofing()
  log.step('kid-proofing')

  // A save we cannot trust is no save at all. Its session seed keeps a resumed level on the same
  // board and goal animals.
  const saved = readSave(store)
  const pool = ANIMAL_POOL.map((animal) => animal.id)
  const sessionSeed = saved === null ? randomSeed() : saved.sessionSeed
  const rng = createRng(sessionSeed)

  const session = createLevelSession({
    saved,
    sessionSeed,
    pool,
    rng,
    save: (state, context) => {
      writeSave(state, context, store)
    },
  })
  log.step(saved === null ? `level ${session.state().level}` : `resumed level ${session.state().level}`)

  // The party is an overlay over the board rather than a band below it, so the board stays visible
  // under the dim. The celebration measures the rect its root element covers.
  const boardArea = divWithClass('board-area')
  const party = divWithClass('celebration')
  party.hidden = true
  boardArea.append(party)
  root.append(boardArea)

  const panel = createPanelView()
  root.append(panel.element)

  const view = createBoardView({
    onTap: enqueueTap,
    goals: () => session.state().goals,
  })
  boardArea.append(view.element)
  log.step('view')

  const player = createSynthPlayer()

  const mute = createMuteController({
    player,
    saved,
    onChange: (muted: boolean) => session.setMuted(muted),
  })
  mountMuteToggle(panel.element, mute)
  log.step('mute')

  mountAdultReset(panel.levelElement, {
    clock: { now: () => Date.now() },
    timer: timer(),
    onReset: () => {
      celebration.stop()
      party.hidden = true
      const state = session.reset()
      log.step(`adult reset → level ${state.level}`)
      void view
        .renderInitial(state.board)
        .then(showLevel)
        .catch((error: unknown) => showError(describeError(error)))
    },
  })

  let layout = applyLayout(root, viewport(), { rows: GRID, cols: GRID })
  const media = hasMatchMedia(window) ? window : null

  const debug = parseDebugFlag(window.location.search)
    ? mountDebugOverlay(
        document.body,
        {
          seed: sessionSeed,
          display: displayMode(media, navigator.standalone),
          motion: motionPreference(media),
          bootLog: log,
          onNextLevel: nextLevel,
        },
        { state: session.state(), layout, queue: session.queueSize(), live: null },
      )
    : null
  log.step(debug === null ? 'debug off' : 'debug overlay')

  // A thrown error and an unhandled rejection take the same message, because both have to survive
  // a force-close on the tablet.
  const showError = (message: string): void => {
    log.error(message)
    if (debug !== null) debug.reportError(message)
  }
  window.addEventListener('error', (event: ErrorEvent) => showError(describeError(event.error)))
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => showError(describeError(event.reason)))

  const celebration = createCelebration(party, player, rng, {
    tier: () => partySize(session.state()).tier,
    balloons: () => partySize(session.state()).balloons,
    onFirstBalloon: () => log.step('first balloon'),
    onPlayReady: () => log.step('play arrow'),
    onPlay: nextLevel,
    metrics: () => bunchMetricsFor(layout.boardPx, layout.balloonPx, layout.arrowBandPx),
    boardOrigin: () => ({ x: layout.boardOffsetXPx, y: layout.boardOffsetYPx }),
    timer: timer(),
  })

  // The overlay measures frames itself, because the game is the only thing that knows which frames
  // it is spending. No overlay means no sampling loop. The party rows are reported here too, since
  // they change while the party runs.
  if (debug !== null) {
    let lastLive = 0
    const sample = (now: number): void => {
      debug.measureFps(now)
      if (now - lastLive >= 250) {
        lastLive = now
        report()
      }
      window.requestAnimationFrame(sample)
    }
    window.requestAnimationFrame(sample)
  }

  window.addEventListener('resize', () => {
    // A turn keeps the state. The overlay's rect changes with the board, so it has to be resized
    // after the new layout is applied, and the same report updates the overlay's rows.
    layout = applyLayout(root, viewport(), { rows: GRID, cols: GRID })
    celebration.resize()
    report()
  })

  // The first frame is the deal. The session opened its window at construction, so a tap during it
  // waits rather than running against a board that is still appearing.
  void view
    .renderInitial(session.state().board)
    .then(() => {
      log.step('first frame')
      showLevel()
      // A save written after the goals hit zero is a party she has not left yet, so it opens again.
      if (session.restoreParty()) showParty()
      const next = session.settle()
      if (next !== null) void applyTapPlan(next)
    })
    .catch((error: unknown) => {
      showError(describeError(error))
      renderFallback(root, log)
    })

  function enqueueTap(index: number): void {
    player.unlock()
    // The board is inert while the party shows, apart from the celebration's own interactions.
    const plan = session.beginTap(index)
    if (plan.firstTap) log.step('first tap')
    report()
    if (plan.result !== null) void applyTapPlan(plan)
  }

  /** Render one settle the session already decided and wrote. */
  async function applyTapPlan(plan: TapPlan): Promise<void> {
    const result = plan.result
    if (result === null) return

    try {
      // The panel is rendered before the pop is animated, so the bubble that pays for this tap
      // sparkles in the same frame as the pop.
      showLevel()

      if (result.group !== null) {
        playTapSounds(result)
        await view.animatePop(popForView(result))
        // The core's reshuffled board has to reach the screen too, or the next tap would be decided
        // against tiles she cannot see. The whoosh belongs to this animation, not to the pop.
        if (result.reshuffled !== null) {
          player.playReshuffle()
          await view.animateReshuffle(result.reshuffled)
        }
      } else {
        view.animateInvalid(plan.index)
        player.playInvalid()
      }

      if (plan.firstPop) log.step('first pop')

      if (plan.party) showParty()
    } catch (error) {
      log.error(describeError(error))
    } finally {
      // The settle is over, so the queue may release the next tap against the board it made.
      const next = session.settle()
      if (next !== null) void applyTapPlan(next)
    }
  }

  function playTapSounds(result: TapResult): void {
    const group = result.group
    if (group === null) return
    // The bubble that leaves the rack has its own tick, distinct from an animal pop.
    if (result.bubbleSpent) player.playBubble()
    player.playPop(group.animal, group.cells.length)
  }

  /** The view animates exactly what the core decided, so the screen and the save cannot disagree. */
  function popForView(result: TapResult): PopResult {
    const group = result.group
    return {
      board: result.state.board,
      cleared: result.cleared,
      moves: result.moves,
      animal: group === null ? '' : group.animal,
      count: group === null ? 0 : group.cells.length,
    }
  }

  /** Paint every live row from one value, so a row cannot lag the state it describes. */
  function report(): void {
    if (debug === null) return
    debug.report({
      state: session.state(),
      layout,
      queue: session.queueSize(),
      live: party.hidden
        ? null
        : {
            balloons: celebration.popCount(),
            particles: celebration.particleCount(),
            tier: celebration.frameTier(),
          },
    })
  }

  function showLevel(): void {
    panel.render(session.state())
    report()
  }

  /** The party is the rack, and it is the only thing that plays the completion cue. */
  function showParty(): void {
    log.step(`party ${partySize(session.state()).tier}`)
    party.hidden = false
    celebration.start()
  }

  function nextLevel(): void {
    celebration.stop()
    party.hidden = true
    const state = session.nextLevel()
    log.step(`level ${state.level}`)
    void view
      .renderInitial(state.board)
      .then(showLevel)
      .catch((error: unknown) => log.error(describeError(error)))
  }
}

function divWithClass(className: string): HTMLElement {
  const element = document.createElement('div')
  element.className = className
  return element
}

function viewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** The clock and the timer come in as seams, so nothing in game/ assumes a browser. */
function timer(): Timer {
  return {
    after: (ms: number, run: () => void): number => window.setTimeout(run, ms),
    clear: (id: number): void => window.clearTimeout(id),
  }
}

/** Older WebViews do not always provide `crypto.getRandomValues`. */
function randomSeed(): number {
  if (hasRandomValues(window.crypto)) {
    log.step('random: crypto')
    return seedFromCrypto(window.crypto.getRandomValues(new Uint32Array(1)))
  }
  log.step('random: Math.random fallback')
  return seedFromRandom(Math.random())
}
