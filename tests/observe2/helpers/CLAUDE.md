# helpers — Shared stand-ins for the observe2 tests (not tests themselves)

<!-- kg:meta repo=NIETE-Rumi dir=tests/observe2/helpers kg=c384f8e21182 gen=7a0091a9113c overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `fake-supabase.js` — in-memory query builder recording chains and filters
- `meta-init-types.js` — Meta's Form init-value types by component
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/observe2/helpers --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fake-supabase.js` | Test helper: in-memory Supabase query-builder stand-in recording call chains and applying eq/is/gte filters |
| `meta-init-types.js` | Test helper: the value type Meta's Flow JSON 7.3 validator expects for each Form init value, by component |

## Who reads this (generated)
- (none)

## Never (human)
- Mock only at the Supabase boundary so guards like sealed_at IS NULL stay visible (fake-supabase.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/observe2/CLAUDE.md`?
