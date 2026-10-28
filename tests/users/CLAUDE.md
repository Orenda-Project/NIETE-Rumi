# users — Tests user-row invariants: one name column and one teacher-level reader

<!-- kg:meta repo=NIETE-Rumi dir=tests/users kg=ec0d729875a4 gen=f664607d3e86 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `bd-60092-one-name-column.test.js` — shipped code must not reference first_name/last_name
- `teacher-level.test.js` — teacherLevelOf reads every band from one column
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/users --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `bd-60092-one-name-column.test.js` | bd-60092: guard that shipped code references no dropped first_name/last_name columns, only users.name |
| `teacher-level.test.js` | Pins teacherLevelOf as the one teacher-band reader: all bands, normalised, unknown tokens dropped |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
- users.name is the only name column; no code may touch dropped first_name or last_name (bd-60092-one-name-column.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/utils/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/users/CLAUDE.md`?
