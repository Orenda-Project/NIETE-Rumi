# L2 — Child stimulus cards: HTML builders, inline render, R2 upload, presigned links

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L2 kg=5d14c4d6d073 gen=e4471699b13a overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `render-html.test.js` — what the child's cards show
- `real-render.test.js` — real Chromium via real-render.driver.js
- Run from repo root: `node tests/run.js tests/child-test/L2 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 test files) |
| `render-html.test.js` | L2 (bd-s1oo0.2): HTML builders for the child's cards: story tokens in order, no item numbers, Urdu RTL with Nastaliq |
| `inline-cards.test.js` | L2 (bd-s1oo0.2): renderInlineCards and html-to-pdf htmlToElementImages multi-element capture; playwright-core mocked |
| `upload.test.js` | L2 (bd-s1oo0.2): uploads inline cards to R2 under the contract key layout and returns presigned links (mocked S3) |
| `CLAUDE.md` | (unmapped) |
| `real-render.driver.js` | Driver that renders every G3/G5 Form A card in real Chromium and prints one JSON result line for real-render.test.js |
| `real-render.test.js` | L2 (bd-s1oo0.2): real-Chromium render keeps every story token in order, cards bubble-shaped at 1080 px wide |

## Who reads this (generated)
- env read here: `CHILD_TEST_BANK` · `CHILD_TEST_FORMS` · `CHILD_TEST_GRADES` · `CHILD_TEST_PROOF_DIR` · `CHILD_TEST_RENDER_REAL`

## Never (human)
- The real-render test needs its driver process because the root suite stubs playwright-core (tests/child-test/L2/real-render.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/child-test/render/CLAUDE.index.md`? · `bot/shared/services/child-test/render/CLAUDE.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L2/CLAUDE.md`?
