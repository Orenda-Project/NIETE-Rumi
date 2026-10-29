# hcp — HCP/Priority Dashboard portal routes under /api/portal/hcp/*
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/hcp kg=0910895237c3 gen=57b749100cc4 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `hcp-access-guard.test.js` — leaders only, each sees only their own patch (bd-6xrimn)
- `_shared.js` — jest.doMock plus fake-supabase boilerplate shared by the route tests
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/hcp --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `_shared.js` | Shared helpers for HCP portal-route tests: jest.doMock plus fake-supabase chain boilerplate for /api/portal/hcp/* |
| `hcp*` | 13 files; most used `hcp-malformed-json.test.js`: bd-nmwmr4.2: a malformed JSON body returns a 400 JSON, not a 500 template stack; error.ejs and index.js wiring |

## Who reads this (generated)
- (none)

## Never (human)
- A teacher session must never list teachers via hcp routes (bd-6xrimn, tests/hcp/hcp-access-guard.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/CLAUDE.md`?
