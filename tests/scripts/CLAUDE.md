# scripts — Tests scripts/smoke-test.js, plus the tiny modules it loads as fixtures

<!-- kg:meta repo=NIETE-Rumi dir=tests/scripts kg=aaac9b5ea1d9 gen=1cf5a23f573a overflow=0 rendered=2026-11-25 kg.py=1.1.0 -->

## Entry points
- `smoke-test.test.js` — smoke-test loads the bot entry, workers and routes (bd-v0toag.71)
- `fixtures/smoke/` — modules that load, throw or miss a require
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/scripts --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 5 files: 0 test + 5 support) |
| `fico17-v6-replay.test.js` | (unmapped) |
| `backfill-fln-lesson-keys.test.js` | (unmapped) |
| `load-school-districts.test.js` | (unmapped) |
| `recover-lost-lp-feedback.test.js` | (unmapped) |
| `smoke-test.test.js` | bd-v0toag.71: pins scripts/smoke-test.js loading the bot entry, workers and routes and failing on any load error |
| `require-resolution.test.js` | (unmapped) |
| `no-dropped-name-columns.test.js` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
- Smoke-test must exit non-zero on any load error (smoke-test.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/CLAUDE.md`?
