# L22 — Realtime timing and echo fidelity: time from send, pacer skips, reaction tally

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L22 kg=99a0a0b07592 gen=8f6bae5218e1 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `coach-realtime-from-send.test.js` — time counts from the bot's send
- `echo-pacer-skip.test.js` — skipped is not a 429
- Run from repo root: `node tests/run.js tests/child-test/L22 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `echo-pacer-skip.test.js` | bd-s1oo0.30 (L22): a reaction the pacer skipped is echoed with local skipped, not as a Meta 429 refusal |
| `coach-realtime-from-send.test.js` | bd-s1oo0.30 (L22): in --realtime the child's speaking time counts from when the bot sent the prompt, not when seen |
| `replies-axiom-signals.test.js` | bd-s1oo0.30 (L22): sandbox reply reader drops reactions from replies and tallies them by cause (delivered/refused/skip) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/child-test/CLAUDE.md`? · `tests/child-test/L22/CLAUDE.md`?
