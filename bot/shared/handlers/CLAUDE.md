# handlers — Inbound WhatsApp message handlers and slash-command doors
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/handlers kg=4015653c6750 gen=b8b72aa1ebd3 overflow=206 rendered=2026-11-24 kg.py=1.1.0 -->

## Entry points
- `text-message.handler.js` — main text router
- `voice-message.handler.js` — voice note pipeline
- `flow-response.handler.js` — Flow submissions
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__mocks__/` | → (no door; 1 files: 0 test + 1 support) |
| `text-message.handler.js` | Main inbound text router (167 KB): slash commands, hot-triggers, menus, LP serve, then chat LLM fallback |
| `observe-visit-flow.handler.js` | Observe-visit Flow endpoint: school/teacher picker and scheduling UI behind OBSERVE_SCHEDULING_UI (bd-2430/2431/2443) |
| `flow-response.handler.js` | Routes WhatsApp Flow NFM_REPLY submissions to per-flow processors (registration, settings, reading, observe) |
| … | 16 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `flow-response.handler.js` (+2)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+220)
- column `users.phone_number` (written by `observe-visit-flow.handler.js`) ← read by `bot/shared/calls/call-context.repo.js:37:2b4c151c` · `bot/shared/database/queries.js:106:fef21f32` (+102)
- table `coaching_sessions` (written by `text-message.handler.js`) ← read by `bot/scripts/fico17-v6-replay.js:87:0a1853f5`? · `bot/shared/calls/call-context.repo.js:63:5911672a`? (+98)
- … 57 more → `CLAUDE.index.md`

## Never (human)
- child-test.handler stays inert unless CHILD_TEST_ENABLED=true (child-test.handler.js:7)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/first-touch/maker.cards.assessment-door.test.js` (exam-checker.handler.js, lesson-plan-v2.handler.js, text-message.handler.js)
- `tests/child-test/L4/media-claim.test.js` (child-test.handler.js, image-message.handler.js, voice-message.handler.js)
- … 147 more → `CLAUDE.index.md`

## Related (generated)
- skills: `reading-assessment`? · `registration`? · `whatsapp-flows`?
- docs: `bot/shared/CLAUDE.md`? · `docs/LP_PATHS.md`? · `docs/features/homework.md`? · `docs/features/pic-to-lp.md`? · `docs/features/quiz.md`? · `docs/migration/01-lesson-plans.md`? (+1)
