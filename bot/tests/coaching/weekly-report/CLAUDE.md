# weekly-report — Jest suites for the weekly usage report and its fake supabase
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/coaching/weekly-report kg=729ac57e772b gen=0077074a518b overflow=1 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `job.test.js` — prepare and send behaviour
- `fake-supabase.js` — shared recording fake, not a test
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `CLAUDE.index.md` | (unmapped) |
| `message.test.js` | Pins buildMessage: weekly_usage_v1 for active weeks, quiet template with no numbers, teacher name handling |
| `migration.test.js` | Pins migration V1.6.12 allowing every nudge kind and seeding the weekly report switch off with empty templates |
| `weekend.test.js` | Pins weekend rows counting only for lesson plans and activation, not days used (bd-v0toag.32.1) |
| `job.test.js` | Pins weekly-report job prepare (one row per group B teacher per week) and send (template or logged skip) |
| `reader.test.js` | Pins weekly-report reader: group B cohort and bounded per-teacher week reads incl. weekend look-back |
| `register-script.test.js` | Pins the Meta template registration payloads: two names x en_US/ur, all UTILITY |
| `summarise.test.js` | Pins summarise counting lesson plans, recordings, days used, thumbs and quiet-week logic |
| `switch.test.js` | Pins weekly-report switch: fail-closed 30s cache and the approved-template list in app_settings |
| `week.test.js` | Pins weekOf Monday-Friday PKT week and the Saturday 09:00-21:00 send window |
| `weekly-usage-template.test.js` | Pins the two weekly usage UTILITY template definitions: variable counts and code-point limits |
| `fake-supabase.js` | Recording stand-in for the supabase query builder shared by the weekly-report suites; not collected by jest |
| … | 1 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- worker-wiring.test.js pins the job loaded in the gated sqs-worker block (worker-wiring.test.js:2, Class Q)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/shared/services/coaching/weekly-report/CLAUDE.index.md`? · `bot/shared/services/coaching/weekly-report/CLAUDE.md`? · `bot/shared/services/nudges/CLAUDE.index.md`? · `bot/shared/services/nudges/CLAUDE.md`? · `bot/shared/templates/CLAUDE.index.md`? (+5)
