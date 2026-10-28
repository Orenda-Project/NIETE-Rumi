# coaching — Coaching pipeline: recording to analysis, reflection, report, video clips, weekly report
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching kg=ea09c9a291b6 gen=64454e1a556a overflow=301 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `coaching-session.service.js` — session lifecycle and status writes; the funnel every job uses
- `analysis-processor.service.js` — GPT analysis step, then hands to the reflective chat
- `report-generator.service.js` — builds and sends the report; read it for the send order
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 13 sub-dirs, each with `CLAUDE.md` | `classroom-photo/` · `coaching-card/` · `fidelity/` · `frameworks/` · `live-moves/` · `lp-coaching/` · `reflective-questions/` · `report-renderers/` · `report-transformers/` · `report-v2/` · `templates/` · `video-reco/` · `weekly-report/` |
| `CLAUDE.index.md` | (unmapped) |
| … | 38 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `analysis-processor.service.js` (+9)) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+88)
- … 86 more → `CLAUDE.index.md`

## Never (human)
- Never write status without the terminal guard; stale taps revived cancelled sessions (session-terminal.js:5, bd-n9832)
- Never edit a coaching file's switch to fail open; ab-v10-switch.js:5 reads a bad row or error as off
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/observe/observe-pipeline-fork.test.js` (analysis-processor.service.js, coaching-session.service.js, reflective-conversation.service.js, report-generator.service.js)
- `tests/coaching/bd-v0toag.57-slim-report.test.js` (ab-v10-arms.js, report-link-token.js, slim-report.js, thing-to-try-pick.js)
- … 177 more → `CLAUDE.index.md`

## Related (generated)
- skills: `coaching`?
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.index.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.md`? (+30)
