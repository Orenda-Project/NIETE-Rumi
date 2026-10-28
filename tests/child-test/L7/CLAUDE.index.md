# L7 — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/child-test/L7 -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `app-api.service.test.js` | Tests the coach-app child-test service on the bot (bd-s1oo0.7): gate, visits, session, upload, scoring, check relay |
| `app-integration.test.js` | Coach-app path over the real store, item bank and gate with only network faked: one child start to finish (bd-s1oo0.7) |
| `app-internal.routes.test.js` | Tests /api/internal/child-test/*: internal key required, service status maps to HTTP code, a failure is never 2xx |
| `sa-api.service.test.js` | Tests the coach's self-administered Learning assessment API: gate, schools list with today's visit first, day-key draw |
| `sa-r7b-stop-events.service.test.js` | Round 7b: every skip/stop is one event on child_test_sessions.device.events; six STOP_TYPES, never dropped by the cap |
| `sa-r8-lang-switch-event.service.test.js` | Round 8 item 4: a language switch event is kept on the session device.events; unknown event types accepted and ignored |
| `sa-r8-no-reading-skip.service.test.js` | Round 8: when a child read nothing aloud, no_reading_skip event is kept on the session and questions are skipped |
| `sa-store.test.js` | Tests sa-store: one blocks row per subtask with phone evidence and marks, written once; unscored recordings parked |
| `sa-sync.service.test.js` | Tests the phone's Learning assessment sync: numbered batches, per-session identity, direct R2 recordings, saBattery |

## Who reads this (all, generated)
- table `child_test_draws` (written by `app-integration.test.js`) ← read by `bot/shared/services/child-test/check-flow/check-store.js:145:5bbb6be1`? · `bot/shared/services/child-test/store.js:417:c5aa16bb`? · `scripts/child-test/smoke-sandbox.js:38:41b84f7d`?
- env `CHILD_TEST_ENABLED` read at `tests/child-test/L7/app-api.service.test.js:155:d9df2de2`
- env `CHILD_TEST_R2_ENV` read at `tests/child-test/L7/app-api.service.test.js:202:40326d08`
- env `INTERNAL_API_KEY` read at `tests/child-test/L7/app-internal.routes.test.js:65:df8a3916`
- env `RAILWAY_ENVIRONMENT` read at `tests/child-test/L7/app-api.service.test.js:202:40326d08`
- env `WEB_QUIZ_TOKEN_SECRET` read at `tests/child-test/L7/sa-sync.service.test.js:271:ce7f0cd3`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/data/child-test/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/app/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L7/CLAUDE.index.md`? · `tests/child-test/L7/CLAUDE.md`?
