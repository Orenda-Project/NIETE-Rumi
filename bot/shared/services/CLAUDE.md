# services — Flat service layer: LP delivery, WhatsApp, LLM, audio, doors, portal links
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services kg=023a463e25f3 gen=91df083cee1e overflow=1008 rendered=2026-10-30 kg.py=1.1.0 -->

## Entry points
- `whatsapp.service.js` — every outbound WhatsApp send, with code-point caps
- `llm-client.js` — provider factory behind every completion
- `conversation-state.service.js` — the one store for what a teacher is doing now
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 27 sub-dirs, each with `CLAUDE.md` | `assessment/` · `attendance/` · `authz/` · `cache/` · `child-test/` · `classes/` · `coaching/` · `exam-checker/` · `fa-video/` · `fflp/` · `first-touch/` · `monitoring/` · `nudges/` · `observe/` · `push/` · `queue/` · `quiz/` · `reading/` · `remark/` · `roster/` · `sa-game/` · `schools/` · `settings/` · `status/` · `training/` · `tts/` · `video/` |
| … | 156 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `conversation-state.service.js` (+3)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+175)
- `whatsapp.service.js` ← imported by `bot/shared/handlers/exam-checker.handler.js:11:1bba4f75` · `bot/shared/handlers/flow-response.handler.js:53:1bba4f75` (+162)
- … 266 more → `CLAUDE.index.md`

## Never (human)
- Don't edit mocks without matching the real signature (`__mocks__/menu.service.js:4`)
- Feature doors are the only senders of their opening message (`assessment-entry.service.js` header)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/lp-v8/lp-shelf-plumbing.test.js` (lp-feedback.service.js, lp-shelf.service.js, lp-v8-catalog.service.js, lp-v8-delivery.service.js, lp-voicenote-script.service.js, whatsapp.service.js)
- … 719 more → `CLAUDE.index.md`

## Related (generated)
- skills: `ab-testing`? · `coaching`? · `cross-agent-safety`? · `debugging`? · `digital-coach`? · `gherkin-spec-sync`? (+2)
- docs: `AGENTS.md`? · `CLAUDE.md`? · `bot/README.md`? · `bot/shared/CLAUDE.md`? · `bot/shared/services/monitoring/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? (+16)
