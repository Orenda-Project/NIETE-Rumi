# services — Flat service layer: LP delivery, WhatsApp, LLM, audio, doors, portal links
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services kg=b92cdc72c68b gen=24bfcdce0425 overflow=1401 rendered=2026-11-25 kg.py=1.1.0 -->

## Entry points
- `whatsapp.service.js` — every outbound WhatsApp send, with code-point caps
- `llm-client.js` — provider factory behind every completion
- `conversation-state.service.js` — the one store for what a teacher is doing now
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 33 sub-dirs, each with `CLAUDE.md` | `ab-tracker/` · `assessment/` · `attendance/` · `authz/` · `cache/` · `child-test/` · `classes/` · `coaching/` · `data-analyst/` · `exam-checker/` · `fa-video/` · `feedback/` · `fflp/` · `first-touch/` · `identity/` · `lp-v10-card/` · `monitoring/` · `nudges/` · `observe/` · `push/` · `queue/` · `quiz/` · `reading/` · `remark/` · `roster/` · `sa-game/` · `schools/` · `settings/` · `status/` · `teacher-activity/` · `training/` · `tts/` · `video/` |
| … | 240 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `conversation-state.service.js` (+4)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+221)
- … 367 more → `CLAUDE.index.md`

## Never (human)
- Don't edit mocks without matching the real signature (`__mocks__/menu.service.js:4`)
- Feature doors are the only senders of their opening message (`assessment-entry.service.js` header)
- Never add a per-region or per-generation lesson-plan table or env flag; extend the existing one, book as separator (docs/lesson-plan-data-model-debt.md)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/lp612/own-goal-k5.test.js` (lp-k5-own-goal.js, lp-k5-own.js, lp612-own-goal.js, lp612-own-goal.store.js, lp612-own-instruction.js, lp612-own-review.js, lp612-own-reviewer.js)
- … 949 more → `CLAUDE.index.md`

## Related (generated)
- skills: `ab-bandit`? · `coaching`? · `cross-agent-safety`? · `debugging`? · `digital-coach`? · `reading-assessment`? (+1)
- docs: `AGENTS.md`? · `CLAUDE.md`? · `bot/README.md`? · `bot/shared/CLAUDE.md`? · `bot/shared/services/monitoring/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? (+18)
