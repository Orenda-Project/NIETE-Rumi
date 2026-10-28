# check-flow — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/child-test/check-flow -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `bars.js` | Per-field confidence bars for the coach check Flow, read from scoring/thresholds with defaults and a test pin |
| `check-store.js` | Reads and writes the check Flow needs (sessions, blocks, coach marks written once, timing); delegates to child-test... |
| `completion.js` | Handles the check Flow's nfm_reply completion: confirms in one line or warns the coach when a session is not checked |
| `context.js` | Loads a session's context per request for the token's coach only; builds the child label and AI status |
| `example.js` | Made-up Grade 3 child and marks used as the Flow JSON's example data in Meta's builder and mockups |
| `flow.js` | Builds the child-test check WhatsApp Flow JSON where a coach confirms or corrects AI marks |
| `index.js` | Public entry of the check Flow: sendCheck, handleCheckCompletion, prefill and diff helpers used by webhook and app... |
| `items.js` | Reads one form's items (questions, made-up words, numbers, sums) from the item bank for the check screens |
| `prefill.js` | Turns a block's AI marks into check screen fields (prefilled vs empty, chip lists) and reads coach answers back into... |
| `review-flow.js` | Builds the v2 end-of-visit REVIEW Flow JSON: 15 slots of question text with Right/Wrong/Didn't answer (bd-s1oo0.46.4) |
| `review-v3.js` | Pure half of the v3 end-of-visit results and review for the full battery: per-child summary lines per task |
| `review-view.js` | Pure half of the v2 review: picks doubtful answers and builds every word the coach reads (bd-s1oo0.46.4) |
| `review.js` | End-of-visit review I/O: asks the coach only doubtful verdicts across a visit's children, max 15 (bd-s1oo0.46.4) |
| `send-check.js` | Sends the 'Check' Flow message when a child's marks are back, with headline numbers and what the coach must fill in |
| `slots.js` | Frozen count of item slots per check screen, since the Flow JSON is static and unused slots are hidden |
| `strings.js` | Every coach-facing word of the check Flow in Urdu and English, gender-neutral; filled in by the endpoint |
| `token.js` | Builds and parses the check Flow token (coachUserId:child-test-check:sessionId) and the CHILD_TEST_ENABLED guard |

## Who reads this (all, generated)
- `bars.js` ← imported by `bot/shared/services/child-test/check-flow/index.js:21:075a4b90` · `bot/shared/services/child-test/check-flow/prefill.js:29:8f619ef1`
- `check-store.js` ← imported by `bot/shared/routes/child-test-check-endpoint.js:27:4f120452` · `bot/shared/services/child-test/conversation/nudge.js:67:864112f0` · `bot/shared/services/child-test/conversation/recovery.js:112:864112f0` · `bot/shared/services/child-test/check-flow/completion.js:14:8d541bc4` (+2: `python3 kg/kg.py who-reads check-store.js`)
- `completion.js` ← imported by `bot/shared/services/child-test/check-flow/index.js:18:a15fc021`
- `context.js` ← imported by `bot/shared/routes/child-test-check-endpoint.js:28:88b8609b` · `bot/shared/services/child-test/check-flow/completion.js:11:1320dfeb` · `bot/shared/services/child-test/check-flow/send-check.js:13:1320dfeb`
- `example.js` ← imported by `bot/shared/services/child-test/check-flow/flow.js:30:d2e284a4`
- `flow.js` ← imported by `bot/scripts/setup/register-child-test-check-flow.js:52:7da3d937` · `bot/scripts/generate-child-test-check-flow-json.js:12:80331a30`
- `index.js` ← imported by `bot/shared/services/child-test/app/app-api.service.js:526:d361a842` · `bot/whatsapp-bot.js:1933:051e3080`
- `items.js` ← imported by `bot/shared/services/child-test/check-flow/context.js:9:7ba3371e` · `bot/shared/services/child-test/check-flow/index.js:22:7ba3371e` · `bot/shared/services/child-test/check-flow/review-flow.js:21:7ba3371e` · `bot/shared/services/child-test/check-flow/review.js:38:7ba3371e`
- `prefill.js` ← imported by `bot/shared/routes/child-test-check-endpoint.js:26:78eee537` · `bot/shared/services/child-test/check-flow/flow.js:28:3dbfc205` · `bot/shared/services/child-test/check-flow/index.js:20:8f86ffc8` · `bot/shared/services/child-test/check-flow/send-check.js:14:3356c2c4`
- `review-flow.js` ← imported by `bot/scripts/setup/create-child-test-review-flow-draft.js:33:321de5c6` · `bot/scripts/generate-child-test-review-flow-json.js:12:b50c3294`
- `review-v3.js` ← imported by `bot/shared/services/child-test/check-flow/review.js:44:c650959d`
- `review-view.js` ← imported by `bot/shared/services/child-test/check-flow/review-flow.js:20:c53231d5` · `bot/shared/services/child-test/check-flow/review.js:42:f3a324bb`
- `review.js` ← imported by `bot/shared/services/child-test/check-flow/completion.js:15:7ce9324a` · `bot/shared/services/child-test/check-flow/index.js:23:7ce9324a`
- `send-check.js` ← imported by `bot/shared/services/child-test/check-flow/index.js:17:31cd62cd`
- `slots.js` ← imported by `bot/shared/services/child-test/check-flow/flow.js:27:503db1e0` · `bot/shared/services/child-test/check-flow/prefill.js:28:503db1e0`
- `strings.js` ← imported by `bot/shared/routes/child-test-check-endpoint.js:29:0aca506a` · `bot/shared/services/child-test/check-flow/completion.js:13:52365221` · `bot/shared/services/child-test/check-flow/context.js:10:52365221` · `bot/shared/services/child-test/check-flow/flow.js:29:52365221` (+1: `python3 kg/kg.py who-reads strings.js`)
- `token.js` ← imported by `bot/shared/routes/child-test-check-endpoint.js:30:52e2fbe4` · `bot/shared/services/child-test/check-flow/completion.js:12:eb846b68` · `bot/shared/services/child-test/check-flow/context.js:11:65cbfffe` · `bot/shared/services/child-test/check-flow/index.js:19:5d29cc0a` (+2: `python3 kg/kg.py who-reads token.js`)
- column `child_test_blocks.block` (written by `check-store.js`) ← read by `bot/shared/services/child-test/sa/score.js:927:93be78de`
- column `child_test_blocks.session_id` (written by `check-store.js`) ← read by `bot/shared/services/child-test/sa/score.js:927:93be78de` · `scripts/child-test/smoke-sandbox.js:122:b9d4320e`
- table `child_test_blocks` (written by `check-store.js`) ← read by `bot/shared/services/child-test/sa/score.js:902:c318f982`? · `scripts/child-test/smoke-sandbox.js:83:c2d8ba96`?
- table `child_test_sessions` (written by `check-store.js`) ← read by `bot/shared/services/child-test/sa/score.js:1061:a92c1089`? · `scripts/child-test/smoke-sandbox.js:120:09a87965`?
- env `CHILD_TEST_CHECK_FLOW_ID` read at `bot/shared/services/child-test/check-flow/send-check.js:90:18e8fb00`
- env `CHILD_TEST_ENABLED` read at `bot/shared/services/child-test/check-flow/token.js:15:a0340365`
- env `CHILD_TEST_REVIEW_FLOW_ID` read at `bot/shared/services/child-test/check-flow/review.js:287:d71b758f`

## Tests (all, generated)
- `bars.js` ← `tests/child-test/L14/check-play.test.js` · `tests/child-test/L21/check-message.test.js` · `tests/child-test/L24/questions-bar.test.js` · `tests/child-test/L6/endpoint.test.js` · `tests/child-test/L6/marks.test.js` · `tests/child-test/L6/prefill.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/child-test/check-flow/bars.js`)
- `check-store.js` ← `tests/child-test/L25/no-roll.test.js`
- `context.js` ← `tests/child-test/L25/no-roll.test.js`
- `flow.js` ← `tests/child-test/L0/check-count-inputs.test.js` · `tests/child-test/L0/check-flow-meta-types.test.js` · `tests/child-test/L16/assist-mode.test.js` · `tests/child-test/L6/check-flow-contract.test.js`
- `index.js` ← `tests/child-test/L0/check-count-inputs.test.js` · `tests/child-test/L16/assist-mode.test.js` · `tests/child-test/L16/coach-catch-prefilled.test.js` · `tests/child-test/L16/one-rule-both-channels.test.js` · `tests/child-test/L21/check-message.test.js` · `tests/child-test/L28/review.test.js` (+8: `python3 kg/kg.py who-reads bot/shared/services/child-test/check-flow/index.js`)
- `items.js` ← `bot/scripts/e2e/child-test-sim/driver.js` · `bot/scripts/e2e/child-test-sim/replay-check.js` · `tests/child-test/L14/check-play.test.js` · `tests/child-test/L6/marks.test.js` · `tests/child-test/L6/prefill.test.js`
- `prefill.js` ← `bot/scripts/e2e/child-test-sim/replay-check.js` · `tests/child-test/L0/check-count-inputs.test.js` · `tests/child-test/L14/check-play.test.js` · `tests/child-test/L16/assist-mode.test.js` · `tests/child-test/L16/coach-catch-prefilled.test.js` · `tests/child-test/L16/one-rule-both-channels.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/services/child-test/check-flow/prefill.js`)
- `review-flow.js` ← `tests/child-test/L28/review-flow-contract.test.js` · `tests/child-test/L39/review-v3-flow-contract.test.js`
- `review-v3.js` ← `tests/child-test/L39/review-v3-flow-contract.test.js` · `tests/child-test/L40/review-seam.test.js`
- `review-view.js` ← `tests/child-test/L32/coach-switch.test.js`
- `review.js` ← `tests/child-test/L28/review-flow-contract.test.js` · `tests/child-test/L28/review.test.js` · `tests/child-test/L31/review-polish.test.js` · `tests/child-test/L34/review-reach.test.js` · `tests/child-test/L39/review-v3.test.js`
- `slots.js` ← `bot/scripts/e2e/child-test-sim/check-play.js`
- `strings.js` ← `bot/scripts/e2e/child-test-sim/check-play.js` · `tests/child-test/L0/check-count-inputs.test.js` · `tests/child-test/L16/assist-mode.test.js` · `tests/child-test/L6/check-flow-contract.test.js`

## Related (all, generated)
- docs: `bot/scripts/e2e/child-test-sim/CLAUDE.index.md`? · `bot/scripts/e2e/child-test-sim/CLAUDE.md`? · `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.index.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.md`? · `tests/child-test/L0/CLAUDE.md`? · `tests/child-test/L14/CLAUDE.md`? · `tests/child-test/L16/CLAUDE.md`? · `tests/child-test/L21/CLAUDE.md`? · `tests/child-test/L24/CLAUDE.md`? · `tests/child-test/L25/CLAUDE.md`? · `tests/child-test/L28/CLAUDE.md`? · `tests/child-test/L31/CLAUDE.md`? · `tests/child-test/L32/CLAUDE.md`? · `tests/child-test/L34/CLAUDE.md`? · `tests/child-test/L39/CLAUDE.md`? · `tests/child-test/L40/CLAUDE.md`? · `tests/child-test/L6/CLAUDE.index.md`? · `tests/child-test/L6/CLAUDE.md`?
