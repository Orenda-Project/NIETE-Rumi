# score-adapters — One score adapter per framework, turning analysis into scorecard groups
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/report-v2/score-adapters kg=65c16229e528 gen=edba059963cb overflow=10 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `dispatch.js` — framework key to adapter
- `fico-adapter.js` — four FICO section groups
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fico-adapter.js` | FICO score adapter: four section groups on a 1-4 scale with not-assessed and lesson-mismatch wording |
| `dispatch.js` | Maps framework key to its score adapter, empty scorecard for unknown frameworks |
| `hots-adapter.js` | HOTS score adapter: five area groups on a 1-3 scale, gathering indicator scores (bd-yy4l2) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `mewaka-adapter.js` | MEWAKA score adapter: six domain groups, Swahili display names when the report is in Swahili |
| … | 2 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `fico-adapter.js` ← imported by `bot/shared/services/coaching/report-v2/hero-report.service.js:73:9bf0be34` · `bot/shared/services/coaching/report-v2/narrative.service.js:162:9bf0be34` (+1)
- `dispatch.js` ← imported by `bot/shared/services/coaching/report-v2/narrative.service.js:140:25bde1fe` · `bot/shared/services/coaching/report-v2/score-adapter.service.js:23:25bde1fe`
- `hots-adapter.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/dispatch.js:16:e71b22d3`
- `mewaka-adapter.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/dispatch.js:19:c27f8f87`
- … 2 more → `CLAUDE.index.md`

## Never (human)
- Take the scale from the framework module, not a local copy (fico-adapter.js:11)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/bd-0c01q-observe-scale.test.js` (fico-adapter.js)
- `tests/coaching/bd-1t1wz-fico-bilingual-headings.test.js` (fico-adapter.js)
- … 6 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/report-v2/CLAUDE.index.md`? · `bot/shared/services/coaching/report-v2/CLAUDE.md`? · `bot/shared/services/coaching/report-v2/score-adapters/CLAUDE.index.md`? · `bot/shared/services/coaching/report-v2/score-adapters/CLAUDE.md`? · `docs/customization.md`? · `docs/features/coaching.md`?
