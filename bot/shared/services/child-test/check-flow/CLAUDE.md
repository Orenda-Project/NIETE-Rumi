# check-flow — WhatsApp Flow where a coach confirms or corrects the AI's marks
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/check-flow kg=1bcccca1c1e9 gen=ed1ce850010c overflow=59 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `index.js` — public entry: sendCheck, handleCheckCompletion, prefill helpers
- `prefill.js` — marks to screen fields and coach answers back to a diff
- `review.js` — end-of-visit review of doubtful answers (bd-s1oo0.46.4)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `index.js` | Public entry of the check Flow: sendCheck, handleCheckCompletion, prefill and diff helpers used by webhook and app... |
| `prefill.js` | Turns a block's AI marks into check screen fields (prefilled vs empty, chip lists) and reads coach answers back into... |
| `bars.js` | Per-field confidence bars for the coach check Flow, read from scoring/thresholds with defaults and a test pin |
| `items.js` | Reads one form's items (questions, made-up words, numbers, sums) from the item bank for the check screens |
| … | 12 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `check-store.js` ← imported by `bot/shared/routes/child-test-check-endpoint.js:27:4f120452` · `bot/shared/services/child-test/conversation/nudge.js:67:864112f0` (+4)
- `token.js` ← imported by `bot/shared/routes/child-test-check-endpoint.js:30:52e2fbe4` · `bot/shared/services/child-test/check-flow/completion.js:12:eb846b68` (+4)
- `strings.js` ← imported by `bot/shared/routes/child-test-check-endpoint.js:29:0aca506a` · `bot/shared/services/child-test/check-flow/completion.js:13:52365221` (+3)
- … 19 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/child-test/L0/check-count-inputs.test.js` (flow.js, index.js, prefill.js, strings.js)
- `tests/child-test/L16/assist-mode.test.js` (flow.js, index.js, prefill.js, strings.js)
- … 28 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/scripts/e2e/child-test-sim/CLAUDE.index.md`? · `bot/scripts/e2e/child-test-sim/CLAUDE.md`? · `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.index.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.md`?
