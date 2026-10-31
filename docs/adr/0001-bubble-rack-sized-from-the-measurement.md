# 0001. The bubble rack is sized from the measurement, not the pre-measurement guess

SPEC §8.2 sized the bubble rack for "a full rack of up to ~39", a number written before the rack was
measured. Issue #10 asks that rack to fit the panel height at once, and on the target tablet in portrait it
does not: a 600x1024 panel row gives 461 CSS px, the level label's reserved place plus two goal cards take
180 of it, and the 239 left for the rack is 7 rows of the 10 a 39-bubble rack needs. The panel cannot
scroll — a child taps a bubble on the rack, so nothing she has to reach may need scrolling — so a rack taller
than that is clipped.

We size the rack from the measurement instead of the guess: 35, which is the measured plateau and also where
§9.1's ramp tops out, so no level shows a rack the panel cannot hold. In portrait the rack is the horizontal
band §13 already describes across the panel width rather than §8.2's 3–4 column grid; at the target density
that is 17 columns of 24 px bubbles, three rows inside the seven the panel row affords. Landscape keeps the
3–4 column grid, where the rack has always fitted.

## Considered and rejected

- **Keep 39 as the sizing number.** It is the honest worst case only if a level can reach 39, and none does.
  Sizing for it charges the panel permanently for a rack the game never shows, and it charges for a criterion
  the code cannot meet.
- **Scroll the rack.** Rejected by §8.2 and issue #10: a rack that must be scrolled to see the next animal is a
  rack where she cannot see the animals she is collecting.
- **Shrink the bubbles below 22 px to make them fit.** Rejected by §16.3: the bubble is a tap target and the
  floor exists to keep it tappable by a small finger.
- **Take height off the board to give it to the rack.** Rejected by §13 and issue #10's board criterion: the
  board is the dominant half, and trading it for the rack reverses which half she plays on.

## Consequences

`rackFitsPanel` is now true on the target device in both orientations, so the fit criterion is no longer a
reported shortfall. What the fit model cannot prove is readability: a band of 17 columns is less grid-like than
the 3–4 per row block §8.2 was written around, so whether a rack reads as a block that visibly shrinks —
rather than as a strip — is a device check on issue #20's checklist, not an assertion in `layout.test.ts`.
That check came back green on the 2026-10-27 device pass (§16.3): the installed portrait rack is 26 columns
of two rows inside the panel row, and no readability shortfall was recorded.
