# coaching — Coaching pipeline: recording to analysis, reflection, report, video clips, weekly report
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching kg=6ea30dfc3774 gen=dbcb48423fb4 overflow=384 rendered=2026-11-25 kg.py=1.1.0 -->

## Entry points
- `coaching-session.service.js` — session lifecycle and status writes; the funnel every job uses
- `analysis-processor.service.js` — GPT analysis step, then hands to the reflective chat
- `report-generator.service.js` — builds and sends the report; read it for the send order
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 13 sub-dirs, each with `CLAUDE.md` | `classroom-photo/` · `coaching-card/` · `fidelity/` · `frameworks/` · `live-moves/` · `lp-coaching/` · `reflective-questions/` · `report-renderers/` · `report-transformers/` · `report-v2/` · `templates/` · `video-reco/` · `weekly-report/` |
| … | 90 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `analysis-processor.service.js` (+9)) ← read by `bot/scripts/fico17-v6-replay.js:87:0a1853f5`? · `bot/scripts/quiz/backfill-quiz-lesson-links.js:76:0b673d4d`? (+103)
- column `coaching_sessions.user_id` (written by `coaching-session.service.js` (+1)) ← read by `bot/shared/calls/call-context.repo.js:65:219f5683` · `bot/shared/calls/call-tools.repo.js:57:23fca46d` (+58)
- … 106 more → `CLAUDE.index.md`

## Never (human)
- Never write status without the terminal guard; stale taps revived cancelled sessions (session-terminal.js:5, bd-n9832)
- Never edit a coaching file's switch to fail open; ab-v10-switch.js:5 reads a bad row or error as off
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/bd-chz35n.25-report-delivery.test.js` (ab-v10-arms.js, report-delivery-switch.js, report-link-button.js, report-link-send.js, report-link-token.js, report-window-send.js)
- `bot/tests/observe/observe-pipeline-fork.test.js` (analysis-processor.service.js, coaching-session.service.js, reflective-conversation.service.js, report-generator.service.js)
- … 239 more → `CLAUDE.index.md`

## Related (generated)
- skills: `coaching`?
- docs: `bot/shared/services/CLAUDE.md`? · `docs/agent-customization.md`? · `docs/lesson-plan-data-model-debt.md`?
