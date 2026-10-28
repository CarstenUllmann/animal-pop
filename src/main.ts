import './style.css'
import { createSynthPlayer } from './audio/synth'
import { ANIMAL_POOL } from './game/animals'
import { GRID } from './game/constants'
import { createLevel, resumeLevel } from './game/level'
import { createRng, seedFromCrypto, seedFromRandom } from './game/rng'
import { partySize, resolveTap, shouldShowParty } from './game/rules'
import { readSave, toSaveState, writeSave, type SaveContext } from './game/save'
import { createTapQueue } from './game/tapQueue'
import type { PopResult, SaveState, TapResult } from './game/types'
import { mountAdultReset, type Timer } from './ui/adultReset'
import { createBootLog, describeError } from './ui/bootlog'
import { createBoardView } from './ui/boardView'
import { capabilityFlags, engineToken, hasMatchMedia, hasRandomValues } from './ui/capabilities'
import { createCelebration, type CelebrationLayer } from './ui/celebration'
import { animalsText, cellText, displayMode, goalsText, motionPreference, mountDebugOverlay, numberText, parseDebugFlag, viewportText, type DebugOverlay, type GoalRow } from './ui/debug'
import { renderFallback } from './ui/fallback'
import { applyLayout, bunchMetricsFor, type Viewport } from './ui/layout'
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

/**
 * Offline install — issue #23. The worker is hand-written (`src/sw.ts`) and `scripts/offline.ts` builds
 * it with this build's file list, so after it installs the game needs nothing from the network.
 *
 * Registered on `load`, so the install does not compete with the first frame for the tablet's
 * connection, and in a build only, because the dev server has no worker to serve. A failure is
 * recorded rather than thrown: there is no console on the tablet, and the trace is what gets read on
 * the next launch.
 */
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

  // SPEC §10: the party is an overlay over the board, not a band below it, so the board stays visible
  // under the dim. The celebration module measures the rect its root element covers, which is why the
  // party element has to live inside the board area.
  const boardArea = block('board-area')
  const party = block('celebration')
  party.hidden = true
  boardArea.append(party)
  root.append(boardArea)

  const panel = createPanelView()
  root.append(panel.element)

  const view = createBoardView({
    onTap: enqueueTap,
    // SPEC §8.1: the view needs the goals so it can mark a goal animal that is in a legal group; the
    // core has already decided, so this only reports (issue #48).
    goals: () => state.goals,
  })
  boardArea.append(view.element)
  log.step('view')

  const player = createSynthPlayer()
  let lastSave = saved

  const mute = createMuteController({
    player,
    store,
    currentSave: () => lastSave,
    // Issue #17: the game persists the toggle on the next save, so the save context and the last save
    // have to move with the switch. Without this, the next tap wrote the muted state the game booted
    // with and quietly turned the sound back on after a reload.
    onChange: (muted: boolean) => {
      context.muted = muted
      if (lastSave !== null) lastSave = Object.assign({}, lastSave, { muted: muted })
    },
  })
  context.muted = mute.muted()
  // A save exists from the first frame, not just after the first tap: otherwise a mute chosen before
  // she plays has nothing to merge into and is forgotten on reload (issue #17).
  lastSave = toSaveState(state, context)
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
      // Issue #16: a reset is only a reset once it is written, otherwise the next force-close brings the
      // wiped level straight back. Issue #11: the reset is a level change, so anything still queued goes
      // with it, and the board is dealt again rather than left as the wiped one was.
      persistProgress()
      queue.clear()
      partyShown = false
      celebration.stop()
      party.hidden = true
      log.step(`adult reset → level ${state.level}`)
      void view
        .renderInitial(state.board)
        .then(showLevel)
        .catch((error: unknown) => showError(describeError(error)))
    },
  })

  // SPEC §13: the layout is computed before the overlay is mounted, because the overlay reports the cell
  // the layout produced - that number is issue #10's device measurement. `layout` is reassigned on rotation.
  let layout = applyLayout(root, viewport(), { rows: GRID, cols: GRID })
  // Feature-detected once: the environment rows are read from the same probe the reduced-motion rules use.
  const media = hasMatchMedia(window) ? window : null

  // The only debugging channel we can rely on once installed (SPEC §14.3).
  const debug = parseDebugFlag(window.location.search)
    ? mountDebugOverlay(document.body, {
        level: state.level,
        seed: sessionSeed,
        display: displayMode(media, navigator.standalone),
        motion: motionPreference(media),
        viewport: viewportText(window.innerWidth, window.innerHeight),
        cell: cellText(layout.cell),
        animals: state.roster,
        bubbles: state.bubbles,
        goals: goalRows(),
        bootLog: log,
        onNextLevel: nextLevel,
      })
    : null
  log.step(debug === null ? 'debug off' : 'debug overlay')

  // Issue #18: the last error row has to catch a thrown error and an unhandled rejection alike. The boot
  // log is what survives a force-close on an installed PWA, so both channels get the same message.
  const showError = (message: string): void => {
    log.error(message)
    if (debug !== null) debug.reportError(message)
  }
  window.addEventListener('error', (event: ErrorEvent) => showError(describeError(event.error)))
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => showError(describeError(event.reason)))

  const celebration = createCelebration(party, player, rng, {
    tier: () => partySize(state).tier,
    balloons: () => partySize(state).balloons,
    onFirstBalloon: () => log.step('first balloon'),
    onPlayReady: () => log.step('play arrow'),
    onPlay: nextLevel,
    // Issue #34: the celebration asks the placement rule for the bunch, and the rule reads the board through
    // these. Both are read on every set and on every rotation, so a turn mid-party hangs the balloons on the
    // board the game has now rather than the one the party started on.
    metrics: () => bunchMetricsFor(layout.boardPx, layout.balloonPx, layout.arrowBandPx),
    boardOrigin: () => ({ x: layout.boardOffsetXPx, y: layout.boardOffsetYPx }),
  })

  // The overlay measures frames itself, because the game is the only thing that knows which frames
  // it is spending (SPEC §10.2, issue #18). No overlay means no sampling loop. The celebration rows are
  // reported here too: they change while the party runs, so reporting them only on `showLevel` left the
  // balloon, particle and tier rows showing the values from before the party started.
  if (debug !== null) {
    let lastLive = 0
    const sample = (now: number): void => {
      debug.measureFps(now)
      if (now - lastLive >= 250) {
        lastLive = now
        reportLive(debug, celebration)
      }
      window.requestAnimationFrame(sample)
    }
    window.requestAnimationFrame(sample)
  }

  window.addEventListener('resize', () => {
    // Issue #19: a turn mid-level keeps the state, and the layout has to be playable straight away. The
    // canvas is sized from the rect the party covers, so rotation also has to resize it.
    layout = applyLayout(root, viewport(), { rows: GRID, cols: GRID })
    celebration.resize()
    reportEnvironment()
  })

  // Issue #11 (SPEC §7.5): the queue is the pure module in `game/tapQueue.ts`, so what it decides is
  // testable without a screen. Here it is only wired: the game hands it taps, opens the window a settle
  // occupies, and runs whatever the queue says may run.
  const queue = createTapQueue()
  let firstTap = true
  let firstPop = true
  // Issue #14: the completion cue fires once per completion. Goals stay at zero after the win, so a
  // tap on a completed level must not fanfare again.
  let partyShown = false

  // The window is open for the deal, so taps during it wait rather than run against a board that is
  // still appearing.
  queue.openWindow()
  void view
    .renderInitial(state.board)
    .then(() => {
      queue.closeWindow()
      log.step('first frame')
      showLevel()
      // SPEC §14.1: a level resumes exactly as it was left. A save written after the goals hit zero is a
      // party she has not tapped the play arrow on yet, so the party opens again rather than leaving a
      // finished board with no party and no arrow. The run that completed the level already counted it.
      if (shouldShowParty(state, partyShown)) showParty(false)
      drainQueue()
    })
    .catch((error: unknown) => {
      showError(describeError(error))
      renderFallback(root, log)
    })

  function enqueueTap(index: number): void {
    player.unlock()
    if (firstTap) {
      firstTap = false
      log.step('first tap')
    }
    // SPEC §10: the board is inert while the party is showing, apart from the celebration's own
    // interactions. A tap during the party is not a tap on the level, so it does not reach the queue.
    if (partyShown) return

    // Issue #11: the queue decides what a tap becomes - it runs, it waits behind the taps that arrived
    // before it, or it is discarded quietly past the cap. Only 'run' is a tap the game acts on, and a
    // dropped one is remembered nowhere, so there is nothing here that could charge her for it.
    const arrival = queue.register(index)
    reportQueue()
    if (arrival === 'run') void resolveTapAndShow(index)
  }

  async function resolveTapAndShow(index: number): Promise<void> {
    // Issue #11: this is the window the queue blocks taps for. The queue owns no clock, so the block ends
    // exactly here, when the settle this tap produced has finished animating.
    queue.openWindow()
    try {
      const result = resolveTap(state, index, rng)

      // Issue #8: the panel is rendered before the pop is animated, so the bubble that pays for this
      // tap sparkles in the same frame as the pop, and the screen cannot show a state the save has
      // already left behind.
      state = result.state
      persistProgress()
      showLevel()

      if (result.group !== null) {
        playTap(result)
        await view.animatePop(popForView(result))
        // SPEC §7.4: the dead board is the core's decision, but the board on screen has to become the
        // board in the save. Without this step the view kept the *settled* board while `state` held the
        // reshuffled one, so the next tap was decided against tiles she could not see. The whoosh belongs
        // to this animation, not to the pop that preceded it.
        if (result.reshuffled !== null) {
          player.playReshuffle()
          await view.animateReshuffle(result.reshuffled)
        }
      } else {
        view.animateInvalid(index)
        player.playInvalid()
      }

      // If the crash happens on the first interaction, the trace shows how far we got.
      if (firstPop && result.outcome === 'popped') {
        firstPop = false
        log.step('first pop')
      }

      // SPEC §8.1: both goals at zero is the win, and the party is what is left on the rack.
      if (shouldShowParty(state, partyShown)) showParty()
    } catch (error) {
      log.error(describeError(error))
    } finally {
      queue.closeWindow()
    }

    // The index that runs now is resolved against `state`, which is the board the settle made - not the
    // one she tapped on (SPEC §7.5).
    drainQueue()
  }

  function playTap(result: TapResult): void {
    const group = result.group
    if (group === null) return
    // SPEC §11: the bubble that leaves the rack has its own tick, distinct from an animal pop.
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
    // Issue #18: the roster is reported with the rest of the level, because the animals in play change
    // with the level. Handed over once at mount, this row would keep showing level 1's roster.
    debug.set('animals', animalsText(state.roster))
    reportQueue()
    reportLive(debug, celebration)
  }

  /** Issue #11: the queue row is the only way to see a tap still waiting, on a device with no console (SPEC §14.3). */
  function reportQueue(): void {
    if (debug === null) return
    debug.set('queue', numberText(queue.size()))
  }

  /**
   * The environment rows move when the tablet turns, so they are re-reported from the same place that
   * re-applies the layout (issue #19). `display` and `motion` are fixed for the run: the modules they
   * describe read them once at boot, so the row showing the boot value is the truthful one.
   */
  function reportEnvironment(): void {
    if (debug === null) return
    debug.set('viewport', viewportText(window.innerWidth, window.innerHeight))
    debug.set('cell', cellText(layout.cell))
  }

  /**
   * SPEC §10.1: the party is the rack, and it is the only thing that plays the completion cue.
   * `countCompletion` is false when this is the launch restoring a party rather than the tap that earned
   * it: the level was already counted by the run that reached it (SPEC §14.1, issue #15).
   */
  function showParty(countCompletion = true): void {
    partyShown = true
    // Issue #11, SPEC §10: a tap that arrived during the settle that won belongs to the level just
    // finished. Draining it after this point would pop a group behind the party's dim and spend a bubble
    // after the balloons were sized, so it goes with the level rather than into it.
    queue.clear()
    // Internal only, never shown to her (SPEC §14.1).
    if (countCompletion) context.levelsCompleted += 1
    persistProgress()
    log.step(`party ${partySize(state).tier}`)
    party.hidden = false
    celebration.start()
  }

  function nextLevel(): void {
    partyShown = false
    celebration.stop()
    party.hidden = true
    // Issue #11: a level change clears the queue, because the taps waiting belong to the level she has
    // left, and the board they would have been decided against is not the one the new level was dealt.
    queue.clear()
    state = createLevel(state.level + 1, sessionSeed, pool)
    persistProgress()
    log.step(`level ${state.level}`)
    void view
      .renderInitial(state.board)
      .then(showLevel)
      .catch((error: unknown) => log.error(describeError(error)))
  }

  /**
   * The one write path for progress (SPEC §14.1). It reads mute from the player rather than from the
   * context captured at boot, so toggling the sound and then playing a tap cannot write the old state
   * back over the remembered one (issue #17).
   */
  function persistProgress(): void {
    context.muted = mute.muted()
    lastSave = toSaveState(state, context)
    writeSave(state, context, store)
  }

  function drainQueue(): void {
    // Nothing may run while the window is open, so this is the moment the queue releases the oldest tap.
    const next = queue.drain()
    if (next !== null) void resolveTapAndShow(next)
  }
}

/** The frame tier and the live counts only reach the overlay when the game reports them (issue #18). */
function reportLive(debug: DebugOverlay, celebration: CelebrationLayer): void {
  // Issue #37: `balloons popped` shows what she did rather than how many balloons are hanging, because the
  // bunch refills as she pops (issue #36) and the two numbers come apart at the first pop. The row itself, its
  // label and its place in the roster are issue #18's and are unchanged.
  debug.set('balloons', numberText(celebration.popCount()))
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
