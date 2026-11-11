# helpers — Shared fake of the supabase query builder for portal route and service tests

<!-- kg:meta repo=NIETE-Rumi dir=tests/portal/helpers kg=a239d2c78d24 gen=31018da51958 overflow=0 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `fake-postgrest.js` — in-memory PostgREST stand-in; real query-building code runs against fake rows
- Used by tests/portal; run from repo root: `node tests/run.js tests/portal --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `region-registry-rows.js` | (unmapped) |
| `fake-postgrest.js` | Test helper: in-memory stand-in for the supabase-js query builder so real query code runs against fake rows |

## Who reads this (generated)
- (none)

## Never (human)
- Fake only the network boundary so a missing filter shows as a wrong answer (tests/portal/helpers/fake-postgrest.js:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/portal/CLAUDE.md`?
