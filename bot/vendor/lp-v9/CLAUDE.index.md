# lp-v9 — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/vendor/lp-v9 -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `diagrams/` | Diagram-as-code engine turning specs into deterministic SVG for LPs → `diagrams/CLAUDE.md` |
| `fonts/` | → (no door; 6 files) |
| `lib/` | Renderer support: template, rich text, fonts, overlay, validation, fact lint → `lib/CLAUDE.md` |
| `schema/` | → (no door; 2 files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `SYNC.md` | Explains the vendored lp_v9 6-12 pipeline copy: upstream paths, how to re-vendor, and every deliberate divergence |
| `brief_author_v3.md` | Author-model brief for one 40-minute Grades 6-12 lesson as lp_doc 3.0 JSON, with the blocking gates; read by the LP aut… |
| `brief_author_v3_flash_maths.md` | Flash-tier variant of the v3 author brief for maths, adding worked example and per-section word budgets |
| `brief_author_v3_flash_prose.md` | Flash-tier variant of the v3 author brief for prose subjects, adding worked example and word budgets |
| `brief_author_v3_flash_sci.md` | Flash-tier variant of the v3 author brief for science, adding worked example and word budgets |
| `g5c_cleared_names.json` | Reviewer-of-record clearance list for every whole-word Arabic-script Muhammad in the 6-12 corpus, prophet vs person (bd… |
| `g5c_cleared_names_en.json` | Latin-script half of the G5c name clearance: decided prophet/person rows, undecided stay refused (bd-5t71f) |
| `lint_lp.js` | Deterministic lint gate for lp_doc JSON (no LLM); --auto-send promotes rules before a lesson reaches a teacher with no… |
| `render_lp.js` | Renders lp_doc JSON to self-contained HTML and a two-page A4 PDF (and PNGs), exiting non-zero on any gate failure |
| `visual_check.js` | JS port of the v3 visual-contract gate (rules V0-V14), parity-tested string-for-string against the Python original |

## Who reads this (all, generated)
- `g5c_cleared_names.json` ← imported by `bot/vendor/lp-v9/lint_lp.js:1192:41cb7ef9`
- `g5c_cleared_names_en.json` ← imported by `bot/vendor/lp-v9/lint_lp.js:1345:eedcd6e1`
- `lint_lp.js` ← imported by `bot/shared/services/lp612-author.service.js:57:ff56f646` · `bot/workers/lp612-author.worker.js:50:b3b531df`
- `render_lp.js` ← imported by `bot/shared/services/lp612-author.service.js:68:70fb282b` · `bot/shared/services/lp612-render.service.js:44:88b652f0` · `bot/workers/lp612-author.worker.js:46:624f72f2`
- `visual_check.js` ← imported by `bot/shared/services/lp612-author.service.js:59:cbe13de2` · `bot/vendor/lp-v9/lint_lp.js:56:ed2674cf`
- env `LP612_CHROME_BIN` read at `bot/vendor/lp-v9/render_lp.js:253:caa9dfb2`
- env `LP612_CHROME_CHANNEL` read at `bot/vendor/lp-v9/render_lp.js:295:54a6876a`

## Tests (all, generated)
- `g5c_cleared_names_en.json` ← `tests/lp612/religious-marks-cleared-names-en-realfile.test.js`
- `lint_lp.js` ← `tests/lp612/vendor-integrity.test.js` · `tests/lp612/visual-contract.test.js`
- `render_lp.js` ← `tests/lp612/bidi-caps.test.js` · `tests/lp612/over-cap-delivery.test.js` · `tests/lp612/overflow-absorb.test.js` · `tests/lp612/page-cap-policy.test.js` · `tests/lp612/page-count-advice.test.js` · `tests/lp612/page-count-part.test.js` (+5: `python3 kg/kg.py who-reads bot/vendor/lp-v9/render_lp.js`)
- `visual_check.js` ← `tests/lp612/diagram-solid-bar-thermo.test.js` · `tests/lp612/visual-contract.test.js`

## Related (all, generated)
- docs: `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/shared/CLAUDE.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.md`? · `bot/shared/services/quiz/pictures/CLAUDE.md`? · `bot/shared/templates/CLAUDE.index.md`? · `bot/shared/templates/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.md`? · `bot/tests/quiz/web-quiz/CLAUDE.index.md`? · `bot/tests/quiz/web-quiz/CLAUDE.md`? · `bot/vendor/CLAUDE.md`? · `bot/vendor/lp-v9/CLAUDE.index.md`? · `bot/vendor/lp-v9/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `bot/vendor/lp-v9/brief_author_v3.md`? · `bot/vendor/lp-v9/brief_author_v3_flash_maths.md`? · `bot/vendor/lp-v9/brief_author_v3_flash_prose.md`? · `bot/vendor/lp-v9/brief_author_v3_flash_sci.md`? · `bot/vendor/lp-v9/diagrams/CLAUDE.index.md`? · `bot/vendor/lp-v9/diagrams/CLAUDE.md`? · `bot/vendor/lp-v9/diagrams/assets/CLAUDE.md`? · `bot/vendor/lp-v9/diagrams/assets/pictograms/CLAUDE.md`? · `bot/vendor/lp-v9/diagrams/lib/CLAUDE.index.md`? · `bot/vendor/lp-v9/diagrams/lib/CLAUDE.md`? · `bot/vendor/lp-v9/diagrams/types/CLAUDE.index.md`? · `bot/vendor/lp-v9/diagrams/types/CLAUDE.md`? · `bot/vendor/lp-v9/lib/CLAUDE.index.md`? · `bot/vendor/lp-v9/lib/CLAUDE.md`? · `bot/workers/CLAUDE.index.md`? · `bot/workers/CLAUDE.md`? · `scripts/CLAUDE.index.md`? · `scripts/CLAUDE.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/lp612/CLAUDE.index.md`? · `tests/lp612/CLAUDE.md`? · `tests/quiz/CLAUDE.index.md`? · `tests/quiz/CLAUDE.md`?
