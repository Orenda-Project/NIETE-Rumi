# weekly-report — Jest suites for the weekly usage report and its fake supabase

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/coaching/weekly-report kg=fad7cc0ce0f8 gen=e1240fecaaed overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `job.test.js` — prepare and send behaviour
- `fake-supabase.js` — shared recording fake, not a test
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `migration.test.js` | Pins migration V1.6.12 allowing every nudge kind and seeding the weekly report switch off with empty templates |
| `message.test.js` | Pins buildMessage: weekly_usage_v1 for active weeks, quiet template with no numbers, teacher name handling |
| `weekend.test.js` | Pins weekend rows counting only for lesson plans and activation, not days used (bd-v0toag.32.1) |
| `job.test.js` | Pins weekly-report job prepare (one row per group B teacher per week) and send (template or logged skip) |
| `reader.test.js` | Pins weekly-report reader: group B cohort and bounded per-teacher week reads incl. weekend look-back |
| `register-script.test.js` | Pins the Meta template registration payloads: two names x en_US/ur, all UTILITY |
| `summarise.test.js` | Pins summarise counting lesson plans, recordings, days used, thumbs and quiet-week logic |
| `switch.test.js` | Pins weekly-report switch: fail-closed 30s cache and the approved-template list in app_settings |
| `week.test.js` | Pins weekOf Monday-Friday PKT week and the Saturday 09:00-21:00 send window |
| `weekly-usage-template.test.js` | Pins the two weekly usage UTILITY template definitions: variable counts and code-point limits |
| `fake-supabase.js` | Recording stand-in for the supabase query builder shared by the weekly-report suites; not collected by jest |
| `worker-wiring.test.js` | Pins that sqs-worker loads the weekly report job inside the gated teacher-nudge block (Class Q) |

## Who reads this (generated)
- (none)

## Never (human)
- worker-wiring.test.js pins the job loaded in the gated sqs-worker block (worker-wiring.test.js:2, Class Q)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/coaching/weekly-report/CLAUDE.md`? · `bot/tests/coaching/CLAUDE.md`?
