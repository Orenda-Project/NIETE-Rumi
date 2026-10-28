# services — Flat service layer: LP delivery, WhatsApp, LLM, audio, doors, portal links
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services kg=be63ae608993 gen=ffe4804e1f5b overflow=1001 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `whatsapp.service.js` — every outbound WhatsApp send, with code-point caps
- `llm-client.js` — provider factory behind every completion
- `conversation-state.service.js` — the one store for what a teacher is doing now
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 26 sub-dirs, each with `CLAUDE.md` | `assessment/` · `attendance/` · `authz/` · `cache/` · `child-test/` · `classes/` · `coaching/` · `exam-checker/` · `fflp/` · `first-touch/` · `monitoring/` · `nudges/` · `observe/` · `push/` · `queue/` · `quiz/` · `reading/` · `remark/` · `roster/` · `sa-game/` · `schools/` · `settings/` · `status/` · `training/` · `tts/` · `video/` |
| … | 99 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `conversation-state.service.js` (+3)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+171)
- `whatsapp.service.js` ← imported by `bot/shared/handlers/exam-checker.handler.js:11:1bba4f75` · `bot/shared/handlers/flow-response.handler.js:53:1bba4f75` (+161)
- … 190 more → `CLAUDE.index.md`

## Never (human)
- Don't edit mocks without matching the real signature (`__mocks__/menu.service.js:4`)
- Feature doors are the only senders of their opening message (`assessment-entry.service.js` header)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/lp-v8/lp-shelf-plumbing.test.js` (lp-feedback.service.js, lp-shelf.service.js, lp-v8-catalog.service.js, lp-v8-delivery.service.js, lp-voicenote-script.service.js, whatsapp.service.js)
- `tests/lp-v8/app-open-survey.test.js` (lp-app-open-survey.service.js, lp-feedback.service.js, lp-v8-catalog.service.js, lp-v8-delivery.service.js, lp612-feedback.service.js, whatsapp.service.js)
- … 712 more → `CLAUDE.index.md`

## Related (generated)
- skills: `ab-testing`? · `coaching`? · `cross-agent-safety`? · `debugging`? · `digital-coach`? · `gherkin-spec-sync`? (+2)
- docs: `AGENTS.md`? · `CLAUDE.md`? · `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/README.md`? · `bot/scripts/e2e/CLAUDE.index.md`? (+90)
