# L29 — v2 print pack: A4 cards per grade and set, coach page, setup picture, PRINT_ME

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L29 kg=551aec7acd65 gen=d1491dba7c0c overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `print-pack-v2.test.js` — HTML of every side
- `real-render-v2.test.js` — real Chromium page counts
- Run from repo root: `node tests/run.js tests/child-test/L29 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `print-pack-v2.test.js` | L29 (bd-s1oo0.46.5): v2 print pack: per grade/set three A4 cards, coach page, setup picture and PRINT_ME in print order |
| `CLAUDE.md` | (unmapped) |
| `real-render-v2.driver.js` | Driver for real-render-v2.test.js: renders the v2 print pack in real Chromium and prints page counts and overflow list |
| `real-render-v2.test.js` | L29 (bd-s1oo0.46.5): real-browser check that the v2 print pack has right A4 pages and no overflow after the fit pass |

## Who reads this (generated)
- env read here: `CHILD_TEST_BANK` · `CHILD_TEST_RENDER_REAL`

## Never (human)
- Real render runs in a child process because the root suite stubs playwright-core (tests/child-test/L29/real-render-v2.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/data/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/render/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L29/CLAUDE.md`?
