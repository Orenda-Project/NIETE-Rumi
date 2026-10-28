# e2e-mock — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/e2e-mock -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `app-settings-ttl.test.js` | bd-0vaqcg: app-settings-ttl config reads APP_SETTINGS_FLAG_TTL_MS (default 30 s, tunable on the mock lane) |
| `build-info.test.js` | build-info.commitSha prefers E2E_COMMIT_SHA, then RAILWAY_GIT_COMMIT_SHA; /health exposes it for E2E runners |
| `cassette-key-ignores-telemetry.test.js` | bd-t3u9t: telemetry labels (job, fallbackModel) do not change which sealed e2e-cassette a request replays |
| `cassette-strict.test.js` | e2e-cassette replay-strict: hits replay like replay, a miss fails loudly instead of reaching a live vendor |
| `cassette-trace.test.js` | e2e-cassette trace log records replay ms and recorded live ms per hit, and traces strict misses |
| `child-test-driver.test.js` | bd-s1oo0.9: child-test mock-lane driver binds to spec ids and records BLOCKED (never PASS) until code lands |
| `child-test-v3-sim-real.test.js` | bd-s1oo0.50.5: simulated coach runVisitV3 plays five children against the real child-test handler in process |
| `child-test-v3-visit.test.js` | bd-s1oo0.50.5: a full battery-v3 child-test visit (five children, 18 tasks) through the real handler |
| `coaching-report-row.test.js` | bd-05v2sn: coaching.cjs walker recognises the report image even with the Step 5/5 line in its caption |
| `driver-fixes-batch1.test.js` | bd-yuur1a: mock-lane driver fixes (training.cjs question-line detection after merged feedback header, others) |
| `driver-fixes-batch2.test.js` | bd-1r3k2h: mock-lane driver gaps from run 20261026-2335-par (lesson-plan quiz seed, quiz purge before offeredToday) |
| `driver-fixes-batch3.test.js` | bd-1r3k2h: removes leftover driver sleeps (coaching voice-note wait, photo Yes tap) and makes them lane-tunable |
| `driver-sleep.test.js` | bd-aqi0ay: mock-api /outbox?wait= long-poll lets driver sleeps wake as soon as the bot answers |
| `flow-emulator.test.js` | flow-emulator plays Meta's side of a Flow from stored JSON: screens, bindings, visibility, routing-model checks |
| `flow-inventory.test.js` | bot/scripts/e2e/flow-inventory pure half: summarises a Flow JSON (screens, routing, terminals, components, footers) |
| `jest-ignores-run-checkouts.test.js` | jest.config ignores the in-repo .claude/qa/results run checkouts, avoiding duplicate-module failures on tests/__mocks__ |
| `lane-waits.test.js` | bd-k5gjje: mock lane turns off send pacing, lifts the rate limit and shortens switch cache so fixed waits disappear |
| `local-db-proxy-timing.test.js` | The local DB proxy writes one JSON timing line per PostgREST request when LOCAL_DB_TIMING_LOG is set |
| `mock-api-endpoints.test.js` | mock-api.cjs resolves a Flow's endpoint path from the registry, falling back to routes the bot really mounts |
| `mock-graph-api.test.js` | bot/scripts/e2e/mock-graph-api: stand-in for Meta's Graph API that records sends as normalised outbox items |
| `profile-trace.test.js` | trace.cjs span emitter: nested spans with parent ids, layer and measured ms for mock-lane profiling |
| `quiz-offer-delay.test.js` | bd-aqi0ay: transcript-quiz offer delay reads TRANSCRIPT_QUIZ_OFFER_DELAY_SECS (240 s default, tunable on the lane) |
| `reflective-router-cassette.test.js` | bd-yjyn0: reflective-question llm-router goes through the e2e cassette; strict miss throws, vendor never called |
| `registration-seed-school.test.js` | bd-v4mdcv: registration driver seeds and purges the one school row its R12 search needs, on the mock lane only |
| `selection.test.js` | bd-r09cmx: selection.cjs parses "feature=ids" maps and exclusion sets so one feature can shard across slots |
| `simulate-builders.test.js` | scripts/simulate.js builders produce webhooks that pass the bot's inbound guards (sample ids, phone_number_id, dedupe) |
| `whatsapp-api-base.test.js` | whatsapp.service builds sends from WHATSAPP_API_BASE (mock lane) and defaults to graph.facebook.com when unset |

## Who reads this (all, generated)
- env `OPENROUTER_API_KEY` read at `tests/e2e-mock/child-test-v3-sim-real.test.js:37:6d424b49` · `tests/e2e-mock/child-test-v3-visit.test.js:32:6d424b49`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.md`? · `bot/shared/services/child-test/conversation/CLAUDE.index.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.index.md`? · `bot/shared/services/quiz/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/e2e-mock/CLAUDE.index.md`? · `tests/e2e-mock/CLAUDE.md`?
