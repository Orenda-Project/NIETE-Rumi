# render-matrix — Render matrix: every web-quiz item shape drawn and checked for defects

<!-- kg:meta repo=NIETE-Rumi dir=scripts/qa/render-matrix kg=8151db5393b8 gen=93ab36484352 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `build_matrix.js` — builds cases from real code and manifests
- `run_matrix.py` — browser assertions on question and feedback screens
- `vm_page.js` — browserless render proof
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `build_matrix.js` | Generates every web-quiz item shape x mutation as real page payloads in the real page shell for the render matrix |
| `vm_page.js` | Boots dashboard wq.js in a Node vm with a fake DOM to prove every matrix case renders and no raw TeX leaks |
| `run_matrix.py` | Serves matrix pages with a stub API and asserts layout, maths and picture defects in headless Chromium on a phone UA |

## Who reads this (generated)
- env read here: `LOG_LEVEL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/quiz/web-quiz-render-matrix.test.js` (build_matrix.js, vm_page.js)

## Related (generated)
- docs: `scripts/qa/CLAUDE.md`?
