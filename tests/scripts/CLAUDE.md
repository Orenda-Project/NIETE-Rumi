# scripts — Tests scripts/smoke-test.js, plus the tiny modules it loads as fixtures

<!-- kg:meta repo=NIETE-Rumi dir=tests/scripts kg=4b18609709eb gen=8a30a9fd931c overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `smoke-test.test.js` — smoke-test loads the bot entry, workers and routes (bd-v0toag.71)
- `fixtures/smoke/` — modules that load, throw or miss a require
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/scripts --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 4 test files) |
| `smoke-test.test.js` | bd-v0toag.71: pins scripts/smoke-test.js loading the bot entry, workers and routes and failing on any load error |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
- Smoke-test must exit non-zero on any load error (smoke-test.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `scripts/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/scripts/CLAUDE.md`?
