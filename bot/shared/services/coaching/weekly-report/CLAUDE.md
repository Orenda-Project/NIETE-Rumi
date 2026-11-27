# weekly-report — Group B weekly usage report sent Saturday as a Meta template
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/weekly-report kg=3857463f319a gen=cfd90c80a1e6 overflow=7 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `job.js` — prepare and send, registers in the nudge sweeper
- `switch.js` — switch and approved-template list
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `summarise.js` | Pure counting of a teacher's week: lesson plans, recordings, days used, thumbs, quiet-week test |
| `switch.js` | Fail-closed app_settings switch and Meta-approved template list gating the weekly usage report |
| `week.js` | Pure PKT calendar for the weekly report: Monday key, Saturday send window, weekend look-back |
| `message.js` | Turns a teacher's week summary into the weekly_usage_v1 or quiet template call (bd-v0toag.32) |
| `job.js` | Teacher-nudge sweeper kind that prepares and sends the group B weekly usage template on Saturdays (bd-v0toag.32) |
| `reader.js` | Bounded per-teacher reads behind the weekly report: group B cohort and one week's activity; throws on read error |

## Who reads this (generated)
- `message.js` ← imported by `bot/shared/services/quiz/web-quiz-evening-round.js:1220:c0a1ec83` · `bot/shared/services/coaching/weekly-report/job.js:20:bc995631`
- `summarise.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:19:934b7eba` · `bot/shared/services/coaching/weekly-report/message.js:13:8fb51b5e`
- `week.js` ← imported by `bot/shared/services/nudges/weak-skill-jugnu/job.js:23:c64a117a` · `bot/shared/services/coaching/weekly-report/job.js:18:6cec1210`
- `job.js` ← imported by `bot/workers/sqs-worker.js:2247:3f57026f`
- `reader.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:16:73533146`
- `switch.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:17:2a9c4c5a`

## Never (human)
- No free-form fallback when the template is unapproved (job.js:10)
- Reader must throw on a failed read, never show a false 0 (reader.js:11)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/coaching/weekly-report/message.test.js` (message.js, summarise.js)
- `bot/tests/coaching/weekly-report/weekend.test.js` (summarise.js, week.js)
- … 7 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`?
