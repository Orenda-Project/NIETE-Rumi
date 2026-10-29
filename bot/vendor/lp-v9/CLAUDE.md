# lp-v9 — Hand-vendored Grades 6-12 LP pipeline: brief, schema, lint, renderer, diagram engine
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/vendor/lp-v9 kg=46fa9462caf5 gen=ce0fb7d05951 overflow=19 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `SYNC.md` — upstream source and every divergence
- `lint_lp.js` — deterministic gate of record
- `render_lp.js` — lp_doc JSON to HTML and A4 PDF
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `diagrams/` | Diagram-as-code engine turning specs into deterministic SVG for LPs → `diagrams/CLAUDE.md` |
| `fonts/` | → (no door; 6 files) |
| `lib/` | Renderer support: template, rich text, fonts, overlay, validation, fact lint → `lib/CLAUDE.md` |
| `schema/` | → (no door; 2 files) |
| `SYNC.md` | Explains the vendored lp_v9 6-12 pipeline copy: upstream paths, how to re-vendor, and every deliberate divergence |
| `render_lp.js` | Renders lp_doc JSON to self-contained HTML and a two-page A4 PDF (and PNGs), exiting non-zero on any gate failure |
| … | 8 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `render_lp.js` ← imported by `bot/shared/services/lp612-author.service.js:68:70fb282b` · `bot/shared/services/lp612-render.service.js:44:88b652f0` (+1)
- `lint_lp.js` ← imported by `bot/shared/services/lp612-author.service.js:57:ff56f646` · `bot/workers/lp612-author.worker.js:50:b3b531df`
- `visual_check.js` ← imported by `bot/shared/services/lp612-author.service.js:59:cbe13de2` · `bot/vendor/lp-v9/lint_lp.js:56:ed2674cf`
- `g5c_cleared_names.json` ← imported by `bot/vendor/lp-v9/lint_lp.js:1192:41cb7ef9`
- … 3 more → `CLAUDE.index.md`

## Never (human)
- A non-re-vendor change needs a SYNC.md section and a VENDOR DIVERGENCE comment (SYNC.md:8-10)
- Nothing here may require bot/shared/; the tree stays hermetic (diagrams/lib/tex.js:5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/lp612/vendor-integrity.test.js` (lint_lp.js, render_lp.js)
- `tests/lp612/visual-contract.test.js` (lint_lp.js, visual_check.js)
- … 12 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/CLAUDE.md`? · `bot/shared/CLAUDE.md`? · `bot/shared/config/CLAUDE.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/quiz/CLAUDE.md`? · `bot/shared/services/quiz/pictures/CLAUDE.md`? (+16)
