# helpers — Shared test doubles: Supabase table double and switch-off matrix

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/helpers kg=77e1c0c68308 gen=f78e4c7e21c3 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `table-double.js` — PostgREST-faithful in-memory tables; unknown filters throw
- `switch-off-matrix.js` — app_settings values that must all read as OFF
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `switch-off-matrix.js` | Test helper: shared matrix of app_settings values that must read as OFF, used by the switch golden tests |
| `table-double.js` | Test helper: in-memory Supabase/PostgREST table double with SQL NULL filter rules, unknown filters throw |
| `switch-off-matrix.test.js` | Tests the switch-off matrix helper: the frozen off values and throwOn failing only one switch's read |
| `table-double.test.js` | Tests the table double: eq/neq/is-null/not semantics follow PostgREST and writes answer the rows written |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/tests/CLAUDE.md`?
