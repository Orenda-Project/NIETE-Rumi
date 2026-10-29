# scripts — Tests scripts/smoke-test.js, plus the tiny modules it loads as fixtures

<!-- kg:meta repo=NIETE-Rumi dir=tests/scripts kg=4b18609709eb gen=a2bc3649fcf2 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `smoke-test.test.js` — smoke-test loads the bot entry, workers and routes (bd-v0toag.71)
- `fixtures/smoke/` — modules that load, throw or miss a require
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/scripts --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 4 files: 0 test + 4 support) |
| `smoke-test.test.js` | bd-v0toag.71: pins scripts/smoke-test.js loading the bot entry, workers and routes and failing on any load error |

## Who reads this (generated)
- (none)

## Never (human)
- Smoke-test must exit non-zero on any load error (smoke-test.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/CLAUDE.md`?
