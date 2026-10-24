import './style.css'
import { createSynthPlayer } from './audio/synth'
import { ANIMAL_POOL } from './game/animals'
import { GRID, MAX_QUEUED_TAPS } from './game/constants'
import { createLevel, resumeLevel } from './game/level'
import { createRng, seedFromCrypto, seedFromRandom } from './game/rng'
import { partySize, resolveTap } from './game/rules'
import { readSave, toSaveState, writeSave, type SaveContext } from './game/save'
import type { PopResult, SaveState, TapResult } from './game/types'
import { mountAdultReset, type Timer } from './ui/adultReset'
import { createBootLog, describeError } from './ui/bootlog'
import { createBoardView } from './ui/boardView'
import { capabilityFlags, engineToken, hasRandomValues } from './ui/capabilities'
import { createCelebration, type CelebrationLayer } from './ui/celebration'
import { mountDebugOverlay, parseDebugFlag, goalsText, numberText, type DebugOverlay, type GoalRow } from './ui/debug'
import { renderFallback } from './ui/fallback'
import { applyLayout, type Viewport } from './ui/layout'
import { createMuteController, mountMuteToggle } from './ui/muteToggle'
import { createPanelView } from './ui/panelView'
import { installKidProofing } from './ui/shell'
import { localStorageStore } from './ui/storage'

/**
 * Survivable boot — issue #23, and the composition root.
 *
 * A force-close on the tablet leaves nothing behind: there is no console in standalone mode, and the
 * process dies before anything is on screen. So every step is recorded to the persisted trace before
 * it runs, and nothing here throws. A failure renders the plain fallback panel instead, which is what
 * makes the trace readable on the next launch.
 *
 * This is also the only file that touches the screen, the clock, and real random numbers (SPEC §15):
 * the core decides a settle, and here it becomes a sound, a movement, and a saved level.
 */

const log = createBootLog()
const store = localStorageStore()

log.step('boot')
log.step(log.storageAvailable() ? 'storage ok' : 'storage unavailable')

// Recorded first, because these are the only facts a force-close leaves behind that can be read
// without a screen: Chrome uses one profile for both the browser and the installed app, so the
// browser's `?debug=1` boot row shows the standalone run's trace (issue #23). The engine token is
// how we tell the two apart — standalone gets the System WebView, not the browser build.
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

function start(root: HTMLElement): void {
  log.step('#app')
  root.classList.add('game')
  installKidProofing()
  log.step('kid-proofing')

  // SPEC §14.1: a save is the level, and a save we cannot trust is no save at all. The session seed
  // comes from the save when there is one, so a resumed level regenerates the same board and the same
  // goal animals (SPEC §9.2) — which is what makes a tablet report mean anything.
  const saved = readSave(store)
  const pool = ANIMAL_POOL.map((animal) => animal.id)
  const sessionSeed = saved === null ? randomSeed() : saved.sessionSeed
  const rng = createRng(sessionSeed)

  let state = saved === null ? createLevel(1, sessionSeed, pool) : resumeLevel(saved, pool)
  const context: SaveContext = {
    muted: saved === null ? false : saved.muted,
    levelsCompleted: saved === null ? 0 : saved.levelsCompleted,
  }
  log.step(saved === null ? `level ${state.level}` : `resumed level ${state.level}`)

  const boardArea = block('board-area')
  const party = block('celebration')
  party.hidden = true
  root.append(boardArea, party)

  const panel = createPanelView()
  root.append(panel.element)

  const view = createBoardView({ onTap: enqueueTap })
  boardArea.append(view.element)
  log.step('view')

  const player = createSynthPlayer()
  let lastSave = saved

  const mute = createMuteController({ player, store, currentSave: () => lastSave })
  context.muted = mute.muted()
  mountMuteToggle(panel.element, mute)
  log.step('mute')

  // SPEC §14.2 (issue #16): the level numeral is the long-press target. The rules are in game/, so
  // this is only the pointer handling, the shake, and the glyph.
  mountAdultReset(panel.levelElement, {
    clock: { now: () => Date.now() },
    timer: timer(),
    pool,
    currentSave: () => lastSave,
    onReset: (resetSave: SaveState) => {
      lastSave = resetSave
      state = resumeLevel(resetSave, pool)
      context.levelsCompleted = 0
      partyShown = false
      celebration.stop()
      party.hidden = true
      log.step(`adult reset → level ${state.level}`)
      showLevel()
    },
  })

  // The only debugging channel we can rely on once installed (SPEC §14.3).
  const debug = parseDebugFlag(window.location.search)
    ? mountDebugOverlay(document.body, {
        level: state.level,
        seed: sessionSeed,
        animals: state.roster,
        bubbles: state.bubbles,
        goals: goalRows(),
        bootLog: log,
        onNextLevel: nextLevel,
      })
    : null
  log.step(debug === null ? 'debug off' : 'debug overlay')

  const celebration = createCelebration(party, player, rng, {
    tier: () => partySize(state).tier,
    onFirstBalloon: () => log.step('first balloon'),
    onPlayReady: () => log.step('play arrow'),
    onPlay: nextLevel,
  })

  // The overlay measures frames itself, because the game is the only thing that knows which frames
  // it is spending (SPEC §10.2, issue #18). No overlay means no sampling loop.
  if (debug !== null) {
    const sample = (): void => {
      debug.measureFps(performance.now())
      window.requestAnimationFrame(sample)
    }
    window.requestAnimationFrame(sample)
  }

  applyLayout(root, viewport(), { rows: GRID, cols: GRID })
  window.addEventListener('resize', () => {
    applyLayout(root, viewport(), { rows: GRID, cols: GRID })
  })

  let busy = true
  const queuedTaps: number[] = []
  let firstTap = true
  let firstPop = true
  // Issue #14: the completion cue fires once per completion. Goals stay at zero after the win, so a
  // tap on a completed level must not fanfare again.
  let partyShown = false

  void view
    .renderInitial(state.board)
    .then(() => {
      busy = false
      log.step('first frame')
      showLevel()
      drainQueue()
    })
    .catch((error: unknown) => {
      log.error(describeError(error))
      renderFallback(root, log)
    })

  function enqueueTap(index: number): void {
    player.unlock()
    if (firstTap) {
      firstTap = false
      log.step('first tap')
    }
    if (busy) {
      // Issue #11: at most two taps wait, so the queue can never run ahead of what she sees.
      if (queuedTaps.length < MAX_QUEUED_TAPS) queuedTaps.push(index)
      return
    }
    void resolveTapAndShow(index)
  }

  async function resolveTapAndShow(index: number): Promise<void> {
    busy = true
    try {
      const result = resolveTap(state, index, rng)
      if (result.group !== null) {
        playTap(result)
        await view.animatePop(popForView(result))
      } else {
        view.animateInvalid(index)
        player.playInvalid()
      }

      // If the crash happens on the first interaction, the trace shows how far we got.
      if (firstPop && result.outcome === 'popped') {
        firstPop = false
        log.step('first pop')
      }

      state = result.state
      lastSave = toSaveState(state, context)
      writeSave(state, context, store)
      showLevel()

      // SPEC §8.1: both goals at zero is the win, and the party is what is left on the rack.
      if (result.complete && !partyShown) showParty()
    } catch (error) {
      log.error(describeError(error))
    } finally {
      busy = false
    }

    drainQueue()
  }

  function playTap(result: TapResult): void {
    const group = result.group
    if (group === null) return
    // SPEC §11: the bubble that leaves the rack has its own tick, distinct from an animal pop.
    if (result.bubbleSpent) player.playBubble()
    player.playPop(group.animal, group.cells.length)
    if (result.reshuffled !== null) player.playReshuffle()
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

  /** The overlay reads goals as what is still missing, which is the level's `remaining` (issue #18). */
  function goalRows(): GoalRow[] {
    return state.goals.map((goal) => ({
      label: goal.animal,
      current: goal.target - goal.remaining,
      needed: goal.target,
    }))
  }

  function showLevel(): void {
    panel.render(state)
    if (debug === null) return
    debug.set('level', numberText(state.level))
    debug.set('rack', numberText(state.bubbles))
    debug.set('goals', goalsText(goalRows()))
    debug.set('queue', numberText(queuedTaps.length))
    reportLive(debug, celebration)
  }

  /** SPEC §10.1: the party is the rack, and it is the only thing that plays the completion cue. */
  function showParty(): void {
    partyShown = true
    // Internal only, never shown to her (SPEC §14.1).
    context.levelsCompleted += 1
    writeSave(state, context, store)
    log.step(`party ${partySize(state).tier}`)
    party.hidden = false
    celebration.start()
  }

  function nextLevel(): void {
    partyShown = false
    celebration.stop()
    party.hidden = true
    queuedTaps.length = 0
    state = createLevel(state.level + 1, sessionSeed, pool)
    lastSave = toSaveState(state, context)
    writeSave(state, context, store)
    log.step(`level ${state.level}`)
    void view
      .renderInitial(state.board)
      .then(showLevel)
      .catch((error: unknown) => log.error(describeError(error)))
  }

  function drainQueue(): void {
    if (busy) return
    const next = queuedTaps.shift()
    if (next !== undefined) void resolveTapAndShow(next)
  }
}

/** The frame tier and the live counts only reach the overlay when the game reports them (issue #18). */
function reportLive(debug: DebugOverlay, celebration: CelebrationLayer): void {
  debug.set('balloons', numberText(celebration.balloonCount()))
  debug.set('particles', numberText(celebration.particleCount()))
  debug.set('tier', celebration.frameTier())
}

function block(className: string): HTMLElement {
  const element = document.createElement('div')
  element.className = className
  return element
}

function viewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** The clock and the timer come in as seams (SPEC §15), so nothing in game/ assumes a browser. */
function timer(): Timer {
  return {
    after: (ms: number, run: () => void): number => window.setTimeout(run, ms),
    clear: (id: number): void => window.clearTimeout(id),
  }
}

/** Feature-detected: older WebViews do not always provide `crypto.getRandomValues` (issue #23). */
function randomSeed(): number {
  if (hasRandomValues(window.crypto)) {
    log.step('random: crypto')
    return seedFromCrypto(window.crypto.getRandomValues(new Uint32Array(1)))
  }
  log.step('random: Math.random fallback')
  return seedFromRandom(Math.random())
}
