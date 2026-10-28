# L15 — Why the sim scored below the offline eval: compare gaps, no_json evidence

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L15 kg=0aa6697ebde4 gen=a4c5fc8e8f5b overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `compare-fixture-gaps.test.js` — sim compares only shared fields
- Run from repo root: `node tests/run.js tests/child-test/L15 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `compare-fixture-gaps.test.js` | L15 (bd-s1oo0.20): sim compares only what key and bot share; real quick sums are not compared with the bank-scored count |
| `no-json-detail.test.js` | L15 (bd-s1oo0.20): a story reply with no JSON leaves evidence (finish_reason, lengths) in meta via chatJSON detail |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `scripts/child-test/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L15/CLAUDE.md`?
