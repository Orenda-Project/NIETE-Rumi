# assessment — Assessment (exam paper) generator: textbook pages to marked, rendered papers
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/assessment kg=a3311ed17e6c gen=0e6f24f8772f overflow=346 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `assessment-orchestrator.service.js` — runs a queued request end to end (generate, render, deliver)
- `assessment-generation.service.js` — the model prompts and question writing
- `patterns/index.js` — which board patterns exist and who may use them
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `patterns/` | Board-pattern definitions (FDE grades 1, 2, 5) as frozen data → `patterns/CLAUDE.md` |
| `topics/` | Curriculum-matrix rows to the tickable topics of a chapter; pure grouping → `topics/CLAUDE.md` |
| `assessment-generation.service.js` | Core generator: textbook pages in, exam question JSON out via ict-prompts.json and board-pattern writers |
| … | 48 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `assessment-paper.renderer.js` ← imported by `bot/scripts/assessment/backfill-paper-versions.js:103:10ace4e3` · `bot/shared/routes/assessment-gen-endpoint.js:754:7568e5aa` (+9)
- `assessment-vocabulary.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:35:0bbbf370` · `bot/shared/services/portal-ready-whatsapp.service.js:45:ac2a62e8` (+8)
- `question-types.js` ← imported by `bot/shared/routes/assessment-gen-endpoint.js:26:6c8431b2` · `bot/shared/routes/internal-api.routes.js:1490:6c8431b2` (+6)
- … 63 more → `CLAUDE.index.md`

## Never (human)
- Don't pick the renderer or file extension outside assessment-format.js (assessment-format.js:3-6)
- Don't change a stored paper by editing a pattern: papers carry a `_layout` copy (fde-layout.js:13-15)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/assessment/fde-r6s2.test.js` (assessment-generation.service.js, assessment-paper-fde.renderer.js, assessment-selection.js, fde-layout.js, marking-scheme.js, maths-check.js)
- `tests/assessment/fde-edit.test.js` (assessment-edit.js, assessment-editor.service.js, assessment-paper.renderer.js, assessment-selection.js, fde-layout.js)
- … 235 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`? · `todo.md`?
