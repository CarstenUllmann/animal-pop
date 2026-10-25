import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Vitest runs in node (vitest.config.ts), so the panel cannot be mounted here. What can be read is the
 * shipped source, the way `debug.test.ts` reads `main.ts`: the shape of the level label is the part that
 * couples the panel to the adult reset, and that coupling is what a render can quietly break.
 */

const SRC = dirname(fileURLToPath(import.meta.url))
const panelSource = readFileSync(join(SRC, 'panelView.ts'), 'utf8')
const mainSource = readFileSync(join(SRC, '..', 'main.ts'), 'utf8')

describe('the level label (SPEC §13, §14.2, issue #16)', () => {
  it('keeps the numeral in its own node, so a render cannot delete the adult confirm glyph', () => {
    // `mountAdultReset` appends the confirm glyph to `PanelView.levelElement`, which is the same
    // `.panel__level-value` span. `render()` runs after every tap and every level change: if it wrote the
    // level into that span's `textContent`, the assignment would remove every child - the glyph included -
    // and the long-press would open a confirm step with no icon to tap (invisible on a tablet, and unplayable
    // to reset). The numeral therefore lives in an inner node that render owns, and nothing writes the
    // outer element's text.
    expect(panelSource).toContain("levelValue.append(levelNumber)")
    expect(panelSource).toContain('levelNumber.textContent = String(state.level)')
    expect(panelSource).not.toMatch(/levelValue\.textContent\s*=/)
    // The wiring the coupling depends on: the reset is mounted on the element the panel exposes.
    expect(mainSource).toContain('mountAdultReset(panel.levelElement')
  })
})
