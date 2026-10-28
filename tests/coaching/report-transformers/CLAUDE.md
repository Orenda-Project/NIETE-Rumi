# report-transformers — Tests for per-framework report transformers that shape analysis into reportData

<!-- kg:meta repo=NIETE-Rumi dir=tests/coaching/report-transformers kg=6386a248748c gen=9e9693a2c566 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `fico-report-transformer.test.js` — FICO B/C/D/F sections and 26 indicators into reportData goals
- `coach-role-label-in-transformers.test.js` — every transformer sets region-scoped observerName
- Run from repo root: `node tests/run.js tests/coaching/report-transformers --maxWorkers=2` (tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `coach-role-label-in-transformers.test.js` | Every framework report transformer sets the region-scoped coach-role label as reportData.observerName |
| `fico-report-transformer.test.js` | FICO report transformer: 4 sections B/C/D/F, 26 indicators, max 104, section titles, focus area (ICT rubric) |
| `CLAUDE.md` | (unmapped) |
| `hots-report-transformer.test.js` | bd-605: HOTS analysis transformed to generic reportData: 5 goals, Area N titles, max 48 |

## Who reads this (generated)
- (none)

## Never (human)
- Every framework transformer must surface the region-scoped coach-role label as reportData.observerName (`coach-role-label-in-transformers.test.js:3`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/coaching/report-transformers/CLAUDE.index.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.md`? · `tests/coaching/CLAUDE.index.md`? · `tests/coaching/CLAUDE.md`? · `tests/coaching/report-transformers/CLAUDE.md`?
