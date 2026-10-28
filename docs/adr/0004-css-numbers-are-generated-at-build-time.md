# 0004. The stylesheet's numbers are generated from the constants at build time

`style.css` held a second copy of numbers that `game/constants.ts` already owned: the panel padding
(`0.8rem 1rem`), the goal ring (`44px`), the balloon's height ratio (`1.18`), the rise and the collapse
(`1200ms`, `180ms`), the shake (`500ms`). `styles.test.ts` parsed the declarations and compared them
against `LAYOUT.chrome`, rounding rem to CSS px with `Math.ceil` on the way. That is a test-shaped
promise, not a single source, and the rounding gave it away: the layout module charged 13 px for a
padding the stylesheet painted at 12.8 px, so "the rack fits the panel" was checked against a number the
remarkably similar rule did not paint. Every change to one of those numbers meant editing the sheet, the
constant, and sometimes the test.

## Decision

`game/constants.ts` is the only source. `scripts/tokens.ts` maps the constants a rule paints onto custom
properties - `--chrome-*` for the chrome the layout charges, `--balloon-*` for the party, `--tap-min-px`,
`--arrow-band`, `--shake-ms`, and the defaults the layout module overwrites from its measurement - and a
Vite plugin with `enforce: 'pre'` prepends a generated `:root` block to `src/style.css`. `style.css` reads
`var(--token)` and carries no literal of the same number, so the charged number and the painted number
are one value.

The block rides inside the stylesheet the build already emits. It is not a `<style>` tag in the document,
so `style-src 'self'` stays as it is and `npm run check:csp` still sees a page with no inline style. The
same transform runs in `npm run dev`, so the dev server and the shipped build paint the same sheet.

Measured metrics stay runtime properties: `ui/layout.ts` still writes `--cell`, `--panel-height-fraction`,
`--bubble-px`, `--level-px` and the rest from the viewport. Where the constant is the floor of a measured
value (`--bubble-px: 22px`, `--level-px: 44px`), the token block carries that floor as the default, which
is what a page without script paints; the module writes the measured value over it.

`src/ui/tokens.test.ts` is the contract: each token is declared once, its value comes from the constant,
the stylesheet reads it, and the stylesheet does not declare it again. `styles.test.ts` keeps the part a
token cannot check - that the rule which paints a number reads the token, and that the behaviour the
SPEC asks for survives the rewrite - and its `Math.ceil` parser and the `LAYOUT.chrome` mirror are gone.

## Considered options

- **Keep the mirror and the parser** - it did catch drift, but only between two copies; it could not
  catch the 0.2 px the `ceil` invented, and it made the stylesheet a second place to edit every charged
  number.
- **Inject a `<style>` tag through `transformIndexHtml`** - the CSP plugin already has that hook. Rejected
  because `style-src 'self'` refuses an inline style; admitting it would mean a hash that changes with
  every build, widening the policy for a block the stylesheet can carry for free.
- **Write a generated `src/tokens.css` into the tree** - plain CSS, nothing to wire, but it puts generated
  source in the repo, needs a clean step, and can go stale between a build and a dev server. The transform
  cannot.
- **A PostCSS plugin** - the same `:root` block through another configuration layer. The Vite plugin is the
  seam this build already has (`offlineShell`), so no second tool for one prepend.

## Consequences

- Changing a number the layout charges is one edit in `game/constants.ts`. Forgetting `scripts/tokens.ts`
  fails `tokens.test.ts` if the stylesheet reads a property nothing emits, or if a token is emitted and
  never read.
- The `ceil` is gone: `0.8rem` and `0.4rem` are now painted as 13 px and 7 px, the numbers the layout
  charges. The sub-pixel shift is the point rather than a regression, but it is a visual change and is
  recorded here for that reason.
- Derived values now live in the token module instead of in the sheet. `--balloon-sway-diag` is
  `balloonSwayPx * sin(45°)`, because the 12.5% keyframe sits at 45 degrees of the sway; a number that
  used to be typed as `4.95px` is now arithmetic with a test against it.
- The block is prepended to `src/style.css` only. A second shipped stylesheet would need the plugin's entry
  list extended; `tokens.test.ts` would fail on the unread tokens first, which is the failure wanted.
- `npm test` reads `dist/` when it exists, like `baseline.test.ts` does. A test run after changing a token
  but before rebuilding sees the previous build's sheet and fails the shipped-stylesheet test; that is a
  stale artifact, not a broken contract, and the check is skipped when there is no build.

See also: [0001](0001-bubble-rack-sized-from-the-measurement.md) for the rack measurement the chrome is
charged against, and [0003](0003-the-offline-shell-is-built-locally.md) for the other build-time plugin.
