# assessment — Assessment (exam paper) generator: textbook pages to marked, rendered papers
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/assessment kg=dcd7aab3e2b8 gen=ecebdd96d680 overflow=880 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `assessment-orchestrator.service.js` — runs a queued request end to end (generate, render, deliver)
- `assessment-generation.service.js` — the model prompts and question writing
- `patterns/index.js` — which board patterns exist and who may use them
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `board-6-12/` | (no description yet) → `board-6-12/CLAUDE.md` |
| `board-checks/` | (no description yet) → `board-checks/CLAUDE.md` |
| `board-render/` | (no description yet) → `board-render/CLAUDE.md` |
| `patterns/` | Board-pattern definitions (FDE grades 1, 2, 5) as frozen data → `patterns/CLAUDE.md` |
| `slo-map/` | (no description yet) → `slo-map/CLAUDE.md` |
| `subject-config/` | (no description yet) → `subject-config/CLAUDE.md` |
| … | 211 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `fde-near-repeats.js` ← imported by `bot/shared/services/assessment/fde-answer-repeats.js:39:cc246831` · `bot/shared/services/assessment/fde-concept-caps.js:16:3a65e219` (+26)
- `assessment-paper.renderer.js` ← imported by `bot/scripts/assessment/backfill-paper-versions.js:103:10ace4e3` · `bot/shared/routes/assessment-gen-endpoint.js:810:7568e5aa` (+10)
- … 229 more → `CLAUDE.index.md`

## Never (human)
- Don't pick the renderer or file extension outside assessment-format.js (assessment-format.js:3-6)
- Don't change a stored paper by editing a pattern: papers carry a `_layout` copy (fde-layout.js:13-15)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/assessment/fde-v37-science-r2.test.js` (fde-circuit-frame.js, fde-layout.js, fde-science-keys.js, fde-science-r2.js, fde-science-repeats.js, fde-science-shared-facts.js, marking-scheme.js)
- `tests/assessment/fde-r6s2.test.js` (assessment-generation.service.js, assessment-paper-fde.renderer.js, assessment-selection.js, fde-layout.js, marking-scheme.js, maths-check.js)
- … 455 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`? · `todo.md`?
