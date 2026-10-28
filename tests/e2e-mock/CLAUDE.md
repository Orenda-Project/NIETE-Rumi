# e2e-mock — Unit tests for the mock E2E lane: cassettes, mock Graph API, flow emulator, drivers
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/e2e-mock kg=314d750368ad gen=eff7e742e9d3 overflow=13 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `cassette-strict.test.js` — replay-strict: a miss fails loudly, never reaches a live vendor
- `mock-graph-api.test.js` — stand-in for Meta's Graph API recording sends as outbox items
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/e2e-mock --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `child*` | 3 files; most used `child-test-v3-visit.test.js`: bd-s1oo0.50.5: a full battery-v3 child-test visit (five children, 18 tasks) through the real handler |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `simulate-builders.test.js` | scripts/simulate.js builders produce webhooks that pass the bot's inbound guards (sample ids, phone_number_id, dedupe) |
| `lane-waits.test.js` | bd-k5gjje: mock lane turns off send pacing, lifts the rate limit and shortens switch cache so fixed waits disappear |
| `app-settings-ttl.test.js` | bd-0vaqcg: app-settings-ttl config reads APP_SETTINGS_FLAG_TTL_MS (default 30 s, tunable on the mock lane) |
| `build-info.test.js` | build-info.commitSha prefers E2E_COMMIT_SHA, then RAILWAY_GIT_COMMIT_SHA; /health exposes it for E2E runners |
| `cassette*` | 3 files; most used `cassette-trace.test.js`: e2e-cassette trace log records replay ms and recorded live ms per hit, and traces strict misses |
| `driver*` | 4 files; most used `driver-sleep.test.js`: bd-aqi0ay: mock-api /outbox?wait= long-poll lets driver sleeps wake as soon as the bot answers |
| … | 13 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `OPENROUTER_API_KEY`

## Never (human)
- Mock lane never reaches a live vendor (tests/e2e-mock/cassette-strict.test.js:4)
- A driver for unbuilt code records BLOCKED, never PASS (tests/e2e-mock/child-test-driver.test.js:6)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.md`? · `bot/shared/services/child-test/conversation/CLAUDE.index.md`? (+7)
