# helpers — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/quiz/helpers -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `filtering-chain.js` | Helper: Supabase query stub that APPLIES filters, for the lp_v8 offer suites (vs supabase-chain's canned replay) |
| `g1-numbers-urdu-fixture.js` | Helper: synthetic Grade 1 numbers 0-4 lesson quizzed in Urdu, shaped like a sandbox quiz that failed validation |
| `key-verify-agree.js` | Helper: a blind key-solver stub that agrees with every answer key, installed into the generate step's verifyKeys seam |
| `key-verify-fixture.js` | Helper: Urdu letters-lesson fixture whose sandbox quiz shipped two wrong answer keys, for key-verify tests |
| `lp-key-check-fixture.js` | Helper: Grade 3 Urdu singular/plural lesson fixture whose quiz keyed the lesson's own planted misconception as correct |
| `lp-offer-scenarios.js` | Helper: the LP quiz offer's send shapes (en/ur) as shared fixtures for the golden and its guarding suite |
| `memory-db.js` | Helper: stateful Supabase stub that remembers writes, so a second /quiz lesson claim (double tap) sees the first |
| `memory-supabase.js` | Helper: stateful in-memory Supabase client for suites driving a chain of real services against one set of rows |
| `no-picture-repair.js` | Helper: disables the extra add-a-picture model call (runFigureDensity) in suites whose subject is something else |
| `nudge-contract-mocks.js` | Helper: in-memory teacher-nudges store with the UNIQUE (user_id, nudge_date, kind) and conditional quiz_id-null claim |
| `proper-fraction-fixture.js` | Helper: Proper Fraction lesson fixture whose staging quiz shipped a wrong key (4/8) that the blind solve agreed with |
| `supabase-chain.js` | Helper: chainable Supabase query stub recording calls and replaying a canned result for the transcript-quiz suites |
| `type-floor.js` | Helper: type-floor auditor for teacher-facing rendered artefacts; reports font sizes below the readable minimum |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `tests/quiz/CLAUDE.md`?
