# routes — HTTP endpoints: encrypted WhatsApp Flow data exchange and /api/internal routes
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/routes kg=36276dce6bb1 gen=1af8967f654f overflow=374 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `flow-endpoint.routes.js` — Flow dispatcher
- `internal-api.routes.js` — portal-to-bot API
- `observe-mewaka-endpoint.js` — Flow contract notes
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `web-quiz-internal.routes.js` | /api/internal/wq/* routes for the web child quiz, forwarded by the portal; logic lives in web-quiz.service |
| `CLAUDE.index.md` | (unmapped) |
| `internal*` | 6 files; most used `internal-api.routes.js`: Internal service-to-service API (/api/internal, x-api-key) used by the portal: LP enqueue, training, classes etc. |
| `teacher*` | 4 files; most used `teacher-training-endpoint.js`: Teacher Training Flow endpoint: vendor picker, training home level cards, level detail with modules and grand quiz |
| … | 29 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `registration-endpoint.js` (+1)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+171)
- table `coaching_sessions` (written by `observe2-check-endpoint.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+87)
- … 58 more → `CLAUDE.index.md`

## Never (human)
- Flow responses never include a `version` field (observe-mewaka-endpoint.js:5)
- Every internal-api.routes.js route uses requireInternalKey, which refuses when the key is unset (shared/middleware/require-internal-key.js:7)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/whatsapp/send-sync-budget.test.js` (observe-mewaka-endpoint.js, pakistan-lp-endpoint.js, student-videos-endpoint.js)
- `bot/tests/lp-v8/flow-response-telemetry.test.js` (pakistan-lp-endpoint.js, pakistan-lp-telemetry.js)
- … 287 more → `CLAUDE.index.md`

## Related (generated)
- skills: `registration`?
- docs: `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/shared/CLAUDE.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.md`? · `bot/tests/lp-v8/CLAUDE.index.md`? (+61)
