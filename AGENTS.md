# animal-pop

A tap-a-cluster animal-popping game for a young child, shipped as an offline-first
browser PWA. The design spec is [`docs/SPEC.md`](docs/SPEC.md) — read it before changing
game behaviour, layout, or audio.

## Commands

`npm install`, then `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`,
`npm run preview`, `npm run check:csp`. Pushing to `main` deploys to GitHub Pages.

`npm run check:csp` builds, serves `dist/`, and loads it in a headless Chromium to assert the CSP
admits every URL the bundle uses (needs Chrome, Edge or Chromium; set `CHROME_PATH` if needed).

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `CarstenUllmann/animal-pop` and are managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: a root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
