# weekly-report — Group B weekly usage report sent Saturday as a Meta template
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/weekly-report kg=fcb4e0fc0281 gen=7fc2f643c966 overflow=5 rendered=2026-10-29 kg.py=1.1.0 -->

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
| `job.js` | Teacher-nudge sweeper kind that prepares and sends the group B weekly usage template on Saturdays (bd-v0toag.32) |
| `message.js` | Turns a teacher's week summary into the weekly_usage_v1 or quiet template call (bd-v0toag.32) |
| `reader.js` | Bounded per-teacher reads behind the weekly report: group B cohort and one week's activity; throws on read error |

## Who reads this (generated)
- `summarise.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:19:934b7eba` · `bot/shared/services/coaching/weekly-report/message.js:13:8fb51b5e`
- `job.js` ← imported by `bot/workers/sqs-worker.js:2033:3f57026f`
- `message.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:20:bc995631`
- `reader.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:16:73533146`
- `switch.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:17:2a9c4c5a`
- `week.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:18:6cec1210`

## Never (human)
- No free-form fallback when the template is unapproved (job.js:10)
- Reader must throw on a failed read, never show a false 0 (reader.js:11)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/coaching/weekly-report/message.test.js` (message.js, summarise.js)
- `bot/tests/coaching/weekly-report/weekend.test.js` (summarise.js, week.js)
- `bot/tests/coaching/weekly-report/job.test.js` (job.js)
- `bot/tests/coaching/weekly-report/migration.test.js` (switch.js)
- … 5 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`?
