# routes — HTTP endpoints: encrypted WhatsApp Flow data exchange and /api/internal routes
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/routes kg=4888fe6e5550 gen=0da205692dc6 overflow=471 rendered=2026-11-25 kg.py=1.1.0 -->

## Entry points
- `flow-endpoint.routes.js` — Flow dispatcher
- `internal-api.routes.js` — portal-to-bot API
- `observe-mewaka-endpoint.js` — Flow contract notes
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `web-quiz-internal.routes.js` | /api/internal/wq/* routes for the web child quiz, forwarded by the portal; logic lives in web-quiz.service |
| `internal*` | 9 files; most used `internal-api.routes.js`: Internal service-to-service API (/api/internal, x-api-key) used by the portal: LP enqueue, training, classes etc. |
| `assessment-gen-endpoint.js` | Server-driven Assessment Generator Flow: CLASS, COVERAGE, QUESTIONS/PAGES, CONFIRM with Redis session state |
| … | 42 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `registration-endpoint.js` (+1)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+221)
- table `coaching_sessions` (written by `observe2-check-endpoint.js`) ← read by `bot/scripts/fico17-v6-replay.js:87:0a1853f5`? · `bot/scripts/quiz/backfill-quiz-lesson-links.js:76:0b673d4d`? (+102)
- … 66 more → `CLAUDE.index.md`

## Never (human)
- Flow responses never include a `version` field (observe-mewaka-endpoint.js:5)
- Every internal-api.routes.js route uses requireInternalKey, which refuses when the key is unset (shared/middleware/require-internal-key.js:7)
- Never add a per-region or per-generation lesson-plan table or env flag; extend the existing one, book as separator (docs/lesson-plan-data-model-debt.md)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/whatsapp/send-sync-budget.test.js` (observe-mewaka-endpoint.js, pakistan-lp-endpoint.js, student-videos-endpoint.js)
- `bot/tests/lp-v8/flow-response-telemetry.test.js` (pakistan-lp-endpoint.js, pakistan-lp-telemetry.js)
- … 376 more → `CLAUDE.index.md`

## Related (generated)
- skills: `registration`?
- docs: `bot/shared/CLAUDE.md`? · `docs/features/video-quiz.md`? · `docs/quiz-telemetry.md`? · `docs/reports/bug131-phase3-grand-quiz.md`? · `tests/BASELINE.md`?
