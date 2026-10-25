import { ANIMALS_BY_ID } from '../game/animals'
import { goalProgress } from '../game/rules'
import type { Goal, LevelState } from '../game/types'

/**
 * The left panel (SPEC §12, §8.1, §8.2): the level numeral, the two goal cards, and the bubble
 * rack under them. It only shows what the core has already decided, so the numbers on screen and
 * the numbers in the save can never disagree.
 */
export interface PanelView {
  readonly element: HTMLElement
  /** The level numeral, which is also the adult long-press reset target (SPEC §14.2). */
  readonly levelElement: HTMLElement
  render(state: LevelState): void
  destroy(): void
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const RING_RADIUS = 44
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

interface GoalCard {
  element: HTMLElement
  face: HTMLImageElement
  numeral: HTMLElement
  ring: Element
}

export function createPanelView(): PanelView {
  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.setAttribute('aria-label', 'Goals and party')

  const levelLine = document.createElement('p')
  levelLine.className = 'panel__level'
  levelLine.append(label('level', 'panel__level-label'))
  const levelValue = label('', 'panel__level-value')
  // The numeral is its own node because `levelValue` is also where the adult reset appends its confirm
  // glyph (`mountAdultReset`, SPEC §14.2). Writing the level into `levelValue.textContent` would delete
  // that glyph on every render, which leaves the long-press with nothing to confirm on.
  const levelNumber = label('1', 'panel__level-number')
  levelValue.append(levelNumber)
  levelLine.append(levelValue)

  const cards = [goalCard(), goalCard()]
  const goals = document.createElement('div')
  goals.className = 'panel__goals'
  for (const card of cards) goals.append(card.element)

  const rack = document.createElement('div')
  rack.className = 'rack'
  rack.setAttribute('aria-label', 'Party bubbles')

  panel.append(levelLine, goals, rack)

  const bubbles: HTMLElement[] = []

  function goalCard(): GoalCard {
    const card = document.createElement('div')
    card.className = 'goal'

    const ring = svg('svg', 'goal__ring')
    ring.setAttribute('viewBox', '0 0 100 100')
    ring.setAttribute('aria-hidden', 'true')

    const track = svg('circle', 'goal__ring-track')
    const fill = svg('circle', 'goal__ring-fill')
    for (const node of [track, fill]) {
      node.setAttribute('cx', '50')
      node.setAttribute('cy', '50')
      node.setAttribute('r', String(RING_RADIUS))
    }
    fill.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE))
    fill.setAttribute('stroke-dashoffset', String(RING_CIRCUMFERENCE))
    ring.append(track, fill)

    const face = document.createElement('img')
    face.className = 'goal__face'
    face.alt = ''
    face.decoding = 'async'
    face.draggable = false

    const numeral = label('', 'goal__numeral')
    card.append(ring, face, numeral)
    return { element: card, face, numeral, ring: fill }
  }

  function renderGoal(card: GoalCard, goal: Goal): void {
    const definition = ANIMALS_BY_ID.get(goal.animal)
    card.face.src = definition === undefined ? '' : definition.face
    card.face.alt = definition === undefined ? goal.animal : definition.label
    card.numeral.textContent = String(goal.remaining)

    // The ring is what she reads; the numeral is the backup for the debug overlay and for us.
    const progress = goalProgress(goal)
    card.ring.setAttribute('stroke-dashoffset', String(RING_CIRCUMFERENCE * (1 - progress)))
    card.element.classList.toggle('goal--done', goal.remaining <= 0)
  }

  /** The rack shows the level's whole starting size, so a spent bubble is a gap she can see. */
  function renderRack(state: LevelState): void {
    // The rack is the level's starting size, and a reset can take her from a late level's 35 back to
    // level 1's 12. Slots are removed as well as added: keeping the old ones would paint a 35-slot rack
    // with twenty-three gaps - and, on the first render, a sparkle on every one of them - while the save
    // says the level has twelve bubbles (SPEC §8.2, §14.2, issue #16).
    while (bubbles.length > state.bubblesStart) {
      const bubble = bubbles.pop()
      if (bubble !== undefined) bubble.remove()
    }
    while (bubbles.length < state.bubblesStart) {
      const bubble = document.createElement('span')
      bubble.className = 'rack__bubble'
      rack.append(bubble)
      bubbles.push(bubble)
    }

    bubbles.forEach((bubble, position) => {
      if (position < state.bubbles) {
        bubble.classList.remove('rack__bubble--spent')
        // The sparkle belongs to one pop, so it cannot survive into the next render or into the refill
        // at the start of a level (issue #8).
        bubble.classList.remove('rack__bubble--just-spent')
        return
      }
      // A bubble that was full before this render is the one that just popped, and it is the only place
      // the sparkle is added: the game calls this in the same frame as the pop it pays for.
      if (!bubble.classList.contains('rack__bubble--spent')) {
        bubble.classList.add('rack__bubble--spent', 'rack__bubble--just-spent')
      }
    })
  }

  function render(state: LevelState): void {
    levelNumber.textContent = String(state.level)
    for (let position = 0; position < cards.length; position++) {
      const card = cards[position]
      const goal = state.goals[position]
      if (card !== undefined && goal !== undefined) renderGoal(card, goal)
    }
    renderRack(state)
  }

  function destroy(): void {
    bubbles.length = 0
    panel.remove()
  }

  return { element: panel, levelElement: levelValue, render, destroy }
}

function label(content: string, className: string): HTMLElement {
  const node = document.createElement('span')
  node.className = className
  node.textContent = content
  return node
}

function svg(tag: string, className: string): Element {
  const node = document.createElementNS(SVG_NS, tag)
  node.setAttribute('class', className)
  return node
}
