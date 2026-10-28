# diagrams — Diagram-as-code engine turning specs into deterministic SVG for LPs
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/vendor/lp-v9/diagrams kg=3d9abef32c91 gen=ec9835a96714 overflow=8 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `index.js` — registry and the contract render_lp.js uses
- `types_manifest.json` — roster of 32 kinds, test-verified
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `assets/` | Static assets for the diagram engine → `assets/CLAUDE.md` |
| `lib/` | Shared helpers for diagram types: SVG builder, text measure, tokens, degeneracy check → `lib/CLAUDE.md` |
| `types/` | One file per diagram kind (atom, graph, circuit, clock, panels, ...) → `types/CLAUDE.md` |
| `index.js` | Diagram engine entry: registry and contract render_lp.js depends on, deterministic diagram spec to SVG for 6-12 lessons |
| `types_manifest.json` | Machine-readable roster of 32 diagram kinds, aliases and spec conventions, verified against the live registry by a test |
| `CLAUDE.md` | (unmapped) |
| `CLAUDE.index.md` | (unmapped) |

## Who reads this (generated)
- `index.js` ← imported by `bot/shared/services/quiz/transcript-quiz-figure-gates.js:18:b36a893b` · `bot/shared/services/quiz/transcript-quiz-figure.js:32:ac38be60` (+2)
- `types_manifest.json` ← imported by `bot/shared/services/quiz/transcript-quiz-figure.js:34:0cde44c6` · `bot/vendor/lp-v9/lint_lp.js:2209:be119a43`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/lp612/visual-contract.test.js` (index.js, types_manifest.json)
- `tests/quiz/base-ten-thousands.test.js` (index.js, types_manifest.json)
- `tests/quiz/transcript-quiz-figure-adaptive-scale.test.js` (index.js, types_manifest.json)
- `tests/quiz/transcript-quiz-figure-early-years.test.js` (index.js, types_manifest.json)
- `tests/quiz/transcript-quiz-figure-manipulatives.test.js` (index.js, types_manifest.json)
- `tests/quiz/transcript-quiz-figure-visible-subset.test.js` (index.js, types_manifest.json)
- … 8 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/vendor/lp-v9/CLAUDE.index.md`? · `bot/vendor/lp-v9/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `bot/vendor/lp-v9/brief_author_v3.md`? · `bot/vendor/lp-v9/brief_author_v3_flash_maths.md`? · `bot/vendor/lp-v9/brief_author_v3_flash_prose.md`? (+10)
