# observability — Tests that portal and dashboard telemetry really reaches the Axiom sink

<!-- kg:meta repo=NIETE-Rumi dir=tests/observability kg=89463416c42b gen=ec612e9de90a overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `dashboard-axiom-sink.test.js` — dependency-free sink the portal process uses on its own
- `portal-request-telemetry.test.js` — http.request.completed emitted for served requests (bd-43487)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/observability --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `portal-request-telemetry.test.js` | bd-43487: portal requests emit http.request.completed (with status on failure) through a real log sink |
| `CLAUDE.md` | (unmapped) |
| `dashboard-axiom-sink.test.js` | Pins the dashboard's own dependency-free Axiom ndjson sink so portal telemetry ships without bot/ code |

## Who reads this (generated)
- (none)

## Never (human)
- The dashboard sink must not require anything from bot/: its process has no bot deps (dashboard-axiom-sink.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/middleware/CLAUDE.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/observability/CLAUDE.md`?
