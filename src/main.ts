import './style.css'
import { createSynthPlayer } from './audio/synth'
import { ANIMAL_POOL } from './game/animals'
import { createBoard, deadBoard, legalGroupAt, popGroup, reshuffleBoard } from './game/board'
import { M1_ANIMAL_TYPES, MAX_QUEUED_TAPS } from './game/constants'
import { createRng } from './game/rng'
import { createBoardView } from './ui/boardView'
import { mountDebugOverlay, parseDebugFlag } from './ui/debug'
import { installKidProofing } from './ui/shell'

installKidProofing()

const app = document.querySelector<HTMLElement>('#app')
if (app === null) throw new Error('Missing #app root element')

const seed = randomSeed()
const rng = createRng(seed)
const roster = rng
  .shuffle(ANIMAL_POOL)
  .slice(0, M1_ANIMAL_TYPES)
  .map((animal) => animal.id)

let board = createBoard(roster, rng)
let busy = true
const queuedTaps: number[] = []
const player = createSynthPlayer()

const view = createBoardView({ onTap: enqueueTap })
app.append(view.element)

// The only debugging channel we can rely on once installed (SPEC §14.3).
if (parseDebugFlag(window.location.search)) {
  mountDebugOverlay(document.body, { seed, animals: roster })
}

// Android only allows audio from inside a gesture. Capture the first pointerdown
// before the tap handler so the very first pop already has sound.
document.addEventListener('pointerdown', () => player.unlock(), {
  capture: true,
  once: true,
})

void start()

async function start(): Promise<void> {
  await view.renderInitial(board)
  busy = false
  drainQueue()
}

function enqueueTap(index: number): void {
  player.unlock()
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

function randomSeed(): number {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0] ?? 0
}
