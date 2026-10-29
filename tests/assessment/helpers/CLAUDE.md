# helpers — Shared fakes and replay helpers for the assessment tests (not test files themselves)

<!-- kg:meta repo=NIETE-Rumi dir=tests/assessment/helpers kg=031f1c6aabc4 gen=7adfc447fbd0 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `fake-postgrest.js` — in-memory PostgREST used by versioned-editing tests (assessment-versions-service.test.js)
- `urdu-concept-once.js`, `urdu-spares.js` — Urdu replay helpers for fde-r11/r13-urdu and fde-recorded-replies tests
- No test files here: jest runs them via parents, `node tests/run.js tests/assessment --maxWorkers=2` from repo root
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fake-postgrest.js` | Test helper: small in-memory PostgREST fake (eq/neq/is/in filters, single/maybeSingle/head) for versioned-editing tests |
| `urdu-concept-once.js` | Test helper: lists Urdu Q1 items the full syllabus drops for asking antonym/synonym a second time (fde-layout, patterns) |
| `urdu-spares.js` | Test helper: fabricates fresh Urdu Section A top-up items so replayed model replies write new items, not held ones |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/assessment/CLAUDE.md`?
