# score-adapters — One score adapter per framework, turning analysis into scorecard groups
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/report-v2/score-adapters kg=a84ea9760ed5 gen=43d7d4ee02a0 overflow=13 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `dispatch.js` — framework key to adapter
- `fico-adapter.js` — four FICO section groups
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fico-adapter.js` | FICO score adapter: four section groups on a 1-4 scale with not-assessed and lesson-mismatch wording |
| `dispatch.js` | Maps framework key to its score adapter, empty scorecard for unknown frameworks |
| `fico17-v6-adapter.js` | (unmapped) |
| `hots-adapter.js` | HOTS score adapter: five area groups on a 1-3 scale, gathering indicator scores (bd-yy4l2) |
| `mewaka-adapter.js` | MEWAKA score adapter: six domain groups, Swahili display names when the report is in Swahili |
| `oecd-adapter.js` | OECD score adapter: five goal groups from goalN_total marks and rubric max marks |
| `teach-adapter.js` | TEACH score adapter: three areas plus time-on-task as four groups, elements scored 1-5 |

## Who reads this (generated)
- `fico-adapter.js` ← imported by `bot/shared/services/coaching/report-v2/hero-report.service.js:76:9bf0be34` · `bot/shared/services/coaching/report-v2/narrative.service.js:405:9bf0be34` (+2)
- `dispatch.js` ← imported by `bot/shared/services/coaching/report-v2/narrative.service.js:141:25bde1fe` · `bot/shared/services/coaching/report-v2/score-adapter.service.js:23:25bde1fe`
- `fico17-v6-adapter.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/dispatch.js:21:c1d5295b`
- `hots-adapter.js` ← imported by `bot/shared/services/coaching/report-v2/score-adapters/dispatch.js:16:e71b22d3`
- … 3 more → `CLAUDE.index.md`

## Never (human)
- Take the scale from the framework module, not a local copy (fico-adapter.js:11)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/bd-0c01q-observe-scale.test.js` (fico-adapter.js)
- `tests/coaching/bd-1t1wz-fico-bilingual-headings.test.js` (fico-adapter.js)
- … 10 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/report-v2/CLAUDE.md`? · `docs/customization.md`? · `docs/features/coaching.md`?
