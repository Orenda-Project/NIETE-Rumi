# schema — Tests that repo migrations and the reference schema declare live DB columns

<!-- kg:meta repo=NIETE-Rumi dir=tests/schema kg=be1ade6b9581 gen=9a1894bc4924 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `coaching-sessions-observe-columns.test.js` — four observe columns declared idempotently
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/schema --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `coaching-sessions-observe-columns.test.js` | Pins that the four observe columns of coaching_sessions are declared by an idempotent migration and the reference schema |

## Who reads this (generated)
- (none)

## Never (human)
- Columns present in live DBs must be declared by a repo migration and the reference schema (coaching-sessions-observe-columns.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/schema/CLAUDE.md`?
