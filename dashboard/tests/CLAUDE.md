# tests — Jest suite for the dashboard server: web-quiz edge, SA runner, leader services
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/tests kg=d226c310aad5 gen=2cf6a7123fc4 overflow=457 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `web-quiz-edge.service.test.js` — start here: the portal edge pages and bot relay pattern; Run: cd dashboard && ./run-tests.sh tests/<file> --maxWorkers=2 (jest.config.js testRegex)
- `wq-page-harness.js` — runs public/wq scripts in a vm; most web-quiz page tests use it (and wqc-page-harness.js)
- `sa-core.service.test.js` — the SA battery runner, with the mini G3 Urdu battery fixture
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__golden__/` | Byte-exact switch-OFF response goldens recorded on the base code before each switch → `__golden__/CLAUDE.md` |
| `fixtures/` | → (no door; 45 test files) |
| `insights/` | Tests for the nightly CoachIP insights job: signals, rollups, ranking, model stage, locks → `insights/CLAUDE.md` |
| `queue/` | Tests for the portal SQS queue service and worker (transcript and AMA jobs) → `queue/CLAUDE.md` |
| `support/` | Shared helper for the SA Urdu fit tests, not a test file itself → `support/CLAUDE.md` |
| … | 457 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `BASE_ROUTES` · `BASE_SRC` · `CHILD_LINT_PAGE_SRC` · `CHILD_LINT_SEED` · `FR_GOLDEN_WRITE` · `GITHUB_TOKEN` · `GOLDEN_PRINT` · `GOLDEN_WRITE` · `INTERNAL_API_KEY` · `JC_GOLDEN_WRITE` · `KEEP_JUG_GOLDEN_WRITE` · `MAIN_BOT_URL` (+20)

## Never (human)
- Name new tests *.service.test.js: dashboard/jest.config.js:3 testRegex skips 15 files (ama-service, billing-service, byof-*, code-chunker, embedder, gpt-cache, materialized-views, transcript-ux-helpers, vector-db, video-observability-*) so they never run
- Do not regenerate a switch-OFF golden from changed code; it is recorded on the base (dashboard/tests/web-quiz-way-back.service.test.js:13)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/data/child-test/sa/CLAUDE.index.md`? · `bot/shared/data/child-test/sa/CLAUDE.md`? · `bot/shared/services/child-test/sa/CLAUDE.index.md`? · `bot/shared/services/child-test/sa/CLAUDE.md`? · `bot/shared/services/child-test/scoring/CLAUDE.index.md`? (+24)
