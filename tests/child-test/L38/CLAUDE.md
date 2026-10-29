# L38 — Battery v3 print pack: booklets, coach cards, PRINT_ME_v3

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L38 kg=dbf304f2fae3 gen=628fe898d60d overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `print-pack-v3.test.js` — HTML of booklets and cards
- `real-render-v3.test.js` — real Chromium
- Run from repo root: `node tests/run.js tests/child-test/L38 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 files: 0 test + 1 support) |
| `print-pack-v3.test.js` | L38 (bd-s1oo0.50.4): v3 print pack: child booklets one task per side, maths by grade, coach cards, PRINT_ME_v3 |
| `sum-sign.test.js` | L38 (bd-s1oo0.50.4): v3 print takes the sum's sign from the task since the bank has no op, so subtraction prints minus |
| `real-render-v3.driver.js` | Driver for real-render-v3.test.js: renders the v3 print pack in real Chromium, prints page counts, overflow and scales |
| `real-render-v3.test.js` | L38 (bd-s1oo0.50.4): real-browser check that v3 booklets and coach cards are A4, whole sheets, no overflow |

## Who reads this (generated)
- (none)

## Never (human)
- Real render runs in a child process because the root suite stubs playwright-core (tests/child-test/L38/real-render-v3.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/child-test/CLAUDE.md`?
