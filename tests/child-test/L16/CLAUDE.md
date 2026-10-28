# L16 — Prefill modes strict vs assist, one shared rule, Urdu made-up-word bar

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L16 kg=c0d94ebfdfa6 gen=b4b09b631afc overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `assist-mode.test.js` — CHILD_TEST_PREFILL_MODE
- `one-rule-both-channels.test.js` — app and WhatsApp share the rule
- Run from repo root: `node tests/run.js tests/child-test/L16 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `assist-mode.test.js` | bd-s1oo0.21 (L16): CHILD_TEST_PREFILL_MODE strict vs assist; assist fills every AI mark and flags unsure fields |
| `one-rule-both-channels.test.js` | bd-s1oo0.16/.21: app and WhatsApp channels share one prefill rule and one marks diff; app-api.service must not drift |
| `coach-catch-prefilled.test.js` | bd-s1oo0.21 (L16): simulated coach catches wrong pre-filled marks at separate marked and unmarked rates (check-play) |
| `urdu-nonword-confidence.test.js` | bd-s1oo0.21 (L16): Urdu made-up-word confidence is a real value (Soniox agreement) so it can pre-fill above the 0.65 bar |
| `CLAUDE.md` | (unmapped) |
| `replay-check.test.js` | bd-s1oo0.21 (L16): replay-check scores one run's AI marks offline in strict and assist, with a coach catch model |

## Who reads this (generated)
- env read here: `CHILD_TEST_BATTERY` · `CHILD_TEST_MATHS_MODE` · `CHILD_TEST_PREFILL_MODE` · `PATH`

## Never (human)
- strict is the default: a mark below its bar arrives empty (tests/child-test/L16/assist-mode.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/child-test/app/CLAUDE.index.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.index.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.md`? · `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L16/CLAUDE.md`?
