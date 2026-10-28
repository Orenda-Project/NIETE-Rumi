# L14 — Simulated coach plays the real check Flow (check-play, eval compare)

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L14 kg=e889b8ea0b54 gen=d4dc151248a0 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `check-play.test.js` — INIT, per-screen exchange, completion
- `eval-compare.test.js` — shared comparison functions
- Run from repo root: `node tests/run.js tests/child-test/L14 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `check-play.test.js` | Tests check-play: simulated coach plays the check Flow (INIT, per-screen data_exchange, nfm_reply) against fixture keys |
| `eval-compare.test.js` | Tests eval-compare: L5 comparison functions shared with the sim scorer score-run-compare (bd-s1oo0.18) |
| `CLAUDE.md` | (unmapped) |
| `coach-checks.test.js` | Tests sim driver runVisit submitting real checks via a checkPlayer, with timed actions per check card (bd-s1oo0.18) |
| `sim-stack-check-flow.test.js` | Pins that the sim stack gives the bot CHILD_TEST_CHECK_FLOW_ID so sendCheck works; env-names prints names only |

## Who reads this (generated)
- env read here: `PATH`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.index.md`? · `scripts/child-test/CLAUDE.index.md`? · `scripts/child-test/CLAUDE.md`? · `tests/child-test/CLAUDE.md`? (+1)
