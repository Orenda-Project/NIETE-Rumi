# __fixtures__ — Shared JSON fixtures for the lp612 suites (base lesson, colliding books, page-truth)

<!-- kg:meta repo=NIETE-Rumi dir=tests/lp612/__fixtures__ kg=6febbf120b0b gen=03687084e64a overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `v9_gate_base.lp.json` — the valid v9 lesson most author/gate/religious tests clone
- Data only, no tests here; loaded by ../*.test.js (root jest, `node tests/run.js tests/lp612`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `page-truth/` | Page-truth mini book fixtures read by the lp612 author/pagetruth tests → `page-truth/CLAUDE.md` |
| `v9_gate_base.lp.json` | Fixture: a valid v9 grade-9 maths lesson-plan JSON used as the base for lp612 author/gate/religious-marks tests |
| `CLAUDE.md` | (unmapped) |
| `lp612-colliding-books.json` | Fixture: lp612 catalogue segments from two books whose chapter keys collide, used by chapter-book-collision.test.js |
| `prod_2026-09-06_halicin_molecule.json` | Fixture: two molecule specs from the first Urdu tap on prod (failed vs delivered); used by figure-widen-repair.test.js |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/lp612/CLAUDE.index.md`? · `tests/lp612/CLAUDE.md`? · `tests/lp612/__fixtures__/CLAUDE.md`? · `tests/lp612/__fixtures__/page-truth/CLAUDE.md`?
