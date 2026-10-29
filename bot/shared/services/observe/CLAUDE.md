# observe — /observe: coach observations, debrief, report to teacher, scheduling, calendar
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/observe kg=269f13cce093 gen=3233559baa62 overflow=283 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `observe-debrief.service.js` — guided debrief entry, recording intake, coach feedback
- `observe-send.service.js` — preview, confirm and delivery of the report to the teacher
- `observe-language.js` — the one owner of which language an observe surface speaks
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `assignment/` | Which schools and teachers a coach sees in the visit picker, and in what order → `assignment/CLAUDE.md` |
| `observe2/` | /observe2: FICO ICT live field form, checked moments, brief and indicator levels → `observe2/CLAUDE.md` |
| `observe-strings.js` | All /observe user-facing strings per language, one function returning the full set (FEAT-053 bd-12/14) |
| `observe-debrief.service.js` | Guided debrief for leader observations: entry choice, pending list, recording intake, coach feedback (bd-21/22) |
| … | 39 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `bound-teacher.js` (+3)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+173)
- column `users.phone_number` (written by `bound-teacher.js` (+2)) ← read by `bot/shared/calls/call-context.repo.js:37:2b4c151c` · `bot/shared/database/queries.js:106:fef21f32` (+90)
- … 101 more → `CLAUDE.index.md`

## Never (human)
- Don't read `session.users` for language: use observe-language (observe-language.js:22)
- Don't add callers of `leader_teachers`; deprecated (tests/observe/leader-teachers-deprecated.test.js:2)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/observe/bd-5rz1v.6-portal-observe-worker.test.js` (observe-coach-card.js, observe-debrief.service.js, observe-draft.service.js, observe-send.service.js, observe-state.service.js, observe-strings.js, portal-observe.service.js)
- `bot/tests/observe/bd-jrxo3-no-bare-capture.test.js` (observe-audio-router.js, observe-binding.service.js, observe-capture.service.js, observe-debrief.service.js, observe-state.service.js, observe-strings.js)
- … 160 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`?
