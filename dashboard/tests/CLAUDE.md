# tests — Jest suite for the dashboard server: web-quiz edge, SA runner, leader services
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/tests kg=f8ae3d0ba004 gen=9164831c7630 overflow=456 rendered=2026-10-30 kg.py=1.1.0 -->

## Entry points
- `web-quiz-edge.service.test.js` — start here: the portal edge pages and bot relay pattern; Run: cd dashboard && ./run-tests.sh tests/<file> --maxWorkers=2 (jest.config.js testRegex)
- `wq-page-harness.js` — runs public/wq scripts in a vm; most web-quiz page tests use it (and wqc-page-harness.js)
- `sa-core.service.test.js` — the SA battery runner, with the mini G3 Urdu battery fixture
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__golden__/` | Byte-exact switch-OFF response goldens recorded on the base code before each switch → `__golden__/CLAUDE.md` |
| `fixtures/` | → (no door; 45 files: 0 test + 45 support) |
| `insights/` | Tests for the nightly CoachIP insights job: signals, rollups, ranking, model stage, locks → `insights/CLAUDE.md` |
| `queue/` | → (no door; 2 tests) |
| `support/` | Shared helper for the SA Urdu fit tests, not a test file itself → `support/CLAUDE.md` |
| `__snapshots__/` | → (not mapped: excluded; 3 files) |
| `wq*` | 4 files; most used `wq-page-harness.js`: Shared harness for web quiz page tests: runs public/wq/wq.js and wq.css in a vm with fakes |
| `wqc-page-harness.js` | Shared harness running public/wq/wq-challenge.js whole in a vm with a fake DOM, fetch and media |
| … | 493 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Name new tests *.service.test.js: dashboard/jest.config.js:3 testRegex skips 15 files (ama-service, billing-service, byof-*, code-chunker, embedder, gpt-cache, materialized-views, transcript-ux-helpers, vector-db, video-observability-*) so they never run
- Do not regenerate a switch-OFF golden from changed code; it is recorded on the base (dashboard/tests/web-quiz-way-back.service.test.js:13)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/data/child-test/sa/CLAUDE.md`? · `dashboard/CLAUDE.md`? · `dashboard/lib/CLAUDE.md`? · `dashboard/middleware/CLAUDE.md`? · `dashboard/public/wq/CLAUDE.md`? · `dashboard/routes/CLAUDE.md`? (+3)
