# L38 — Battery v3 print pack: booklets, coach cards, PRINT_ME_v3

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L38 kg=70a943e56994 gen=68919aa5e0f1 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `print-pack-v3.test.js` — HTML of booklets and cards
- `real-render-v3.test.js` — real Chromium
- Run from repo root: `node tests/run.js tests/child-test/L38 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 test files) |
| `print-pack-v3.test.js` | L38 (bd-s1oo0.50.4): v3 print pack: child booklets one task per side, maths by grade, coach cards, PRINT_ME_v3 |
| `CLAUDE.md` | (unmapped) |
| `sum-sign.test.js` | L38 (bd-s1oo0.50.4): v3 print takes the sum's sign from the task since the bank has no op, so subtraction prints minus |
| `real-render-v3.driver.js` | Driver for real-render-v3.test.js: renders the v3 print pack in real Chromium, prints page counts, overflow and scales |
| `real-render-v3.test.js` | L38 (bd-s1oo0.50.4): real-browser check that v3 booklets and coach cards are A4, whole sheets, no overflow |

## Who reads this (generated)
- env read here: `CHILD_TEST_BANK_V3` · `CHILD_TEST_RENDER_REAL`

## Never (human)
- Real render runs in a child process because the root suite stubs playwright-core (tests/child-test/L38/real-render-v3.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/data/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/conversation/CLAUDE.index.md`? · `bot/shared/services/child-test/render/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? (+1)
