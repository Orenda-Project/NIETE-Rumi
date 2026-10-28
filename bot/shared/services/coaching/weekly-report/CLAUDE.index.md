# weekly-report — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/weekly-report -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `job.js` | Teacher-nudge sweeper kind that prepares and sends the group B weekly usage template on Saturdays (bd-v0toag.32) |
| `message.js` | Turns a teacher's week summary into the weekly_usage_v1 or quiet template call (bd-v0toag.32) |
| `reader.js` | Bounded per-teacher reads behind the weekly report: group B cohort and one week's activity; throws on read error |
| `summarise.js` | Pure counting of a teacher's week: lesson plans, recordings, days used, thumbs, quiet-week test |
| `switch.js` | Fail-closed app_settings switch and Meta-approved template list gating the weekly usage report |
| `week.js` | Pure PKT calendar for the weekly report: Monday key, Saturday send window, weekend look-back |

## Who reads this (all, generated)
- `job.js` ← imported by `bot/workers/sqs-worker.js:2033:3f57026f`
- `message.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:20:bc995631`
- `reader.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:16:73533146`
- `summarise.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:19:934b7eba` · `bot/shared/services/coaching/weekly-report/message.js:13:8fb51b5e`
- `switch.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:17:2a9c4c5a`
- `week.js` ← imported by `bot/shared/services/coaching/weekly-report/job.js:18:6cec1210`

## Tests (all, generated)
- `job.js` ← `bot/tests/coaching/weekly-report/job.test.js`
- `message.js` ← `bot/tests/coaching/weekly-report/message.test.js`
- `reader.js` ← `bot/tests/coaching/weekly-report/reader.test.js`
- `summarise.js` ← `bot/tests/coaching/weekly-report/message.test.js` · `bot/tests/coaching/weekly-report/summarise.test.js` · `bot/tests/coaching/weekly-report/weekend.test.js`
- `switch.js` ← `bot/tests/coaching/weekly-report/migration.test.js` · `bot/tests/coaching/weekly-report/switch.test.js` · `bot/tests/settings/switch-outage.test.js`
- `week.js` ← `bot/tests/coaching/weekly-report/week.test.js` · `bot/tests/coaching/weekly-report/weekend.test.js`

## Related (all, generated)
- docs: `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/weekly-report/CLAUDE.index.md`? · `bot/shared/services/coaching/weekly-report/CLAUDE.md`? · `bot/tests/coaching/weekly-report/CLAUDE.index.md`? · `bot/tests/coaching/weekly-report/CLAUDE.md`? · `bot/tests/settings/CLAUDE.md`?
