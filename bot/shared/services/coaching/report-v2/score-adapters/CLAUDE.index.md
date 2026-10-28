# score-adapters — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/report-v2/score-adapters -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `dispatch.js` | Maps framework key to its score adapter, empty scorecard for unknown frameworks |
| `fico-adapter.js` | FICO score adapter: four section groups on a 1-4 scale with not-assessed and lesson-mismatch wording |
| `hots-adapter.js` | HOTS score adapter: five area groups on a 1-3 scale, gathering indicator scores (bd-yy4l2) |
| `mewaka-adapter.js` | MEWAKA score adapter: six domain groups, Swahili display names when the report is in Swahili |
| `oecd-adapter.js` | OECD score adapter: five goal groups from goalN_total marks and rubric max marks |
| `teach-adapter.js` | TEACH score adapter: three areas plus time-on-task as four groups, elements scored 1-5 |

## Who reads this (all, generated)
- `dispatch.js` ← imported by `bot/shared/services/coaching/report-v2/narrative.service.js:140:25bde1fe` · `bot/shared/services/coaching/report-v2/score-adapter.service.js:23:25bde1fe`
- `fico-adapter.js` ← imported by `bot/shared/services/coaching/report-v2/hero-report.service.js:73:9bf0be34` · `bot/shared/services/coaching/report-v2/narrative.service.js:162:9bf0be34` · `bot/shared/services/coaching/report-v2/score-adapters/dispatch.js:18:0e2e3e52`
- `hots-adapter.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/dispatch.js:16:e71b22d3`
- `mewaka-adapter.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/dispatch.js:19:c27f8f87`
- `oecd-adapter.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/dispatch.js:15:f32d85b5`
- `teach-adapter.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/dispatch.js:17:3c9fa161`

## Tests (all, generated)
- `dispatch.js` ← `tests/coaching/fico-framework-ict.test.js` · `tests/coaching/score-adapters.test.js`
- `fico-adapter.js` ← `tests/coaching/bd-0c01q-observe-scale.test.js` · `tests/coaching/bd-1t1wz-fico-bilingual-headings.test.js` · `tests/coaching/bd-5lrgh-lp-mismatch-reason.test.js` · `tests/coaching/bd-9h2mm-section-b-not-assessed.test.js` · `tests/coaching/incomplete-fico-analysis.test.js`
- `hots-adapter.js` ← `tests/coaching/bd-yy4l2-hots-scorecard-derive.test.js`

## Related (all, generated)
- docs: `bot/shared/services/coaching/report-v2/CLAUDE.index.md`? · `bot/shared/services/coaching/report-v2/CLAUDE.md`? · `bot/shared/services/coaching/report-v2/score-adapters/CLAUDE.index.md`? · `bot/shared/services/coaching/report-v2/score-adapters/CLAUDE.md`? · `docs/customization.md`? · `docs/features/coaching.md`?
