# helpers — Shared stubs and fixtures for quiz suites: Supabase fakes, lesson fixtures
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/quiz/helpers kg=735b5a5dc933 gen=499ab309eff4 overflow=2 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `memory-supabase.js` — stateful Supabase stand-in for chained services
- `supabase-chain.js` — canned-result chain stub
- Run from repo root: `node tests/run.js tests/quiz/helpers --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `supabase-chain.js` | Helper: chainable Supabase query stub recording calls and replaying a canned result for the transcript-quiz suites |
| `key-verify-agree.js` | Helper: a blind key-solver stub that agrees with every answer key, installed into the generate step's verifyKeys seam |
| `memory-db.js` | Helper: stateful Supabase stub that remembers writes, so a second /quiz lesson claim (double tap) sees the first |
| `memory-supabase.js` | Helper: stateful in-memory Supabase client for suites driving a chain of real services against one set of rows |
| `no-picture-repair.js` | Helper: disables the extra add-a-picture model call (runFigureDensity) in suites whose subject is something else |
| `filtering-chain.js` | Helper: Supabase query stub that APPLIES filters, for the lp_v8 offer suites (vs supabase-chain's canned replay) |
| `nudge-contract-mocks.js` | Helper: in-memory teacher-nudges store with the UNIQUE (user_id, nudge_date, kind) and conditional quiz_id-null claim |
| `lp-key-check-fixture.js` | Helper: Grade 3 Urdu singular/plural lesson fixture whose quiz keyed the lesson's own planted misconception as correct |
| `lp-offer-scenarios.js` | Helper: the LP quiz offer's send shapes (en/ur) as shared fixtures for the golden and its guarding suite |
| `g1-numbers-urdu-fixture.js` | Helper: synthetic Grade 1 numbers 0-4 lesson quizzed in Urdu, shaped like a sandbox quiz that failed validation |
| `key-verify-fixture.js` | Helper: Urdu letters-lesson fixture whose sandbox quiz shipped two wrong answer keys, for key-verify tests |
| … | 2 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/quiz/CLAUDE.md`?
