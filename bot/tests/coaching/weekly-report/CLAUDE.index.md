# weekly-report — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests/coaching/weekly-report -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `fake-supabase.js` | Recording stand-in for the supabase query builder shared by the weekly-report suites; not collected by jest |
| `job.test.js` | Pins weekly-report job prepare (one row per group B teacher per week) and send (template or logged skip) |
| `message.test.js` | Pins buildMessage: weekly_usage_v1 for active weeks, quiet template with no numbers, teacher name handling |
| `migration.test.js` | Pins migration V1.6.12 allowing every nudge kind and seeding the weekly report switch off with empty templates |
| `reader.test.js` | Pins weekly-report reader: group B cohort and bounded per-teacher week reads incl. weekend look-back |
| `register-script.test.js` | Pins the Meta template registration payloads: two names x en_US/ur, all UTILITY |
| `summarise.test.js` | Pins summarise counting lesson plans, recordings, days used, thumbs and quiet-week logic |
| `switch.test.js` | Pins weekly-report switch: fail-closed 30s cache and the approved-template list in app_settings |
| `week.test.js` | Pins weekOf Monday-Friday PKT week and the Saturday 09:00-21:00 send window |
| `weekend.test.js` | Pins weekend rows counting only for lesson plans and activation, not days used (bd-v0toag.32.1) |
| `weekly-usage-template.test.js` | Pins the two weekly usage UTILITY template definitions: variable counts and code-point limits |
| `worker-wiring.test.js` | Pins that sqs-worker loads the weekly report job inside the gated teacher-nudge block (Class Q) |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/shared/services/coaching/weekly-report/CLAUDE.index.md`? · `bot/shared/services/coaching/weekly-report/CLAUDE.md`? · `bot/shared/services/nudges/CLAUDE.index.md`? · `bot/shared/services/nudges/CLAUDE.md`? · `bot/shared/templates/CLAUDE.index.md`? · `bot/shared/templates/CLAUDE.md`? · `bot/tests/coaching/CLAUDE.index.md`? · `bot/tests/coaching/CLAUDE.md`? · `bot/tests/coaching/weekly-report/CLAUDE.index.md`? · `bot/tests/coaching/weekly-report/CLAUDE.md`?
