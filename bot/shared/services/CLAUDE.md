# services — Flat service layer: LP delivery, WhatsApp, LLM, audio, doors, portal links
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services kg=9a729dbabc62 gen=82f67fe7b28f overflow=1044 rendered=2026-11-06 kg.py=1.1.0 -->

## Entry points
- `whatsapp.service.js` — every outbound WhatsApp send, with code-point caps
- `llm-client.js` — provider factory behind every completion
- `conversation-state.service.js` — the one store for what a teacher is doing now
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 29 sub-dirs, each with `CLAUDE.md` | `assessment/` · `attendance/` · `authz/` · `cache/` · `child-test/` · `classes/` · `coaching/` · `exam-checker/` · `fa-video/` · `feedback/` · `fflp/` · `first-touch/` · `identity/` · `monitoring/` · `nudges/` · `observe/` · `push/` · `queue/` · `quiz/` · `reading/` · `remark/` · `roster/` · `sa-game/` · `schools/` · `settings/` · `status/` · `training/` · `tts/` · `video/` |
| … | 165 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `conversation-state.service.js` (+3)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+188)
- `whatsapp.service.js` ← imported by `bot/shared/handlers/exam-checker.handler.js:11:1bba4f75` · `bot/shared/handlers/flow-response.handler.js:53:1bba4f75` (+165)
- … 276 more → `CLAUDE.index.md`

## Never (human)
- Don't edit mocks without matching the real signature (`__mocks__/menu.service.js:4`)
- Feature doors are the only senders of their opening message (`assessment-entry.service.js` header)
- Never add a per-region or per-generation lesson-plan table or env flag; extend the existing one, book as separator (docs/lesson-plan-data-model-debt.md)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/lp-v8/lp-shelf-plumbing.test.js` (lp-feedback.service.js, lp-shelf.service.js, lp-v8-catalog.service.js, lp-v8-delivery.service.js, lp-voicenote-script.service.js, whatsapp.service.js)
- … 745 more → `CLAUDE.index.md`

## Related (generated)
- skills: `ab-testing`? · `coaching`? · `cross-agent-safety`? · `debugging`? · `digital-coach`? · `reading-assessment`? (+1)
- docs: `AGENTS.md`? · `CLAUDE.md`? · `bot/README.md`? · `bot/shared/CLAUDE.md`? · `bot/shared/services/monitoring/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? (+16)
