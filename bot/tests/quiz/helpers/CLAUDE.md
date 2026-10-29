# helpers — Render-and-measure helpers that read PDFs and pages back as ink for layout tests

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/quiz/helpers kg=feeff1b3e299 gen=34a00a6d9d69 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `pdf-layout.js` — rasterises a PDF with pdftoppm and reports per-page ink extent
- `line-ink.js` — measures vertical ink gaps between rendered Nastaliq lines in Chromium
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `pdf-layout.js` | Test helper that rasterises a printed PDF with pdftoppm and reports per-page ink extent for layout tests |
| `line-ink.js` | Test helper that reads a rendered page as lines of ink (DOM Range per word) to detect Nastaliq line collisions |

## Who reads this (generated)
- (none)

## Never (human)
- pdf-layout.js needs poppler's pdftoppm; a checkout with the browser but no pdftoppm must fail, naming it (pdf-layout.js:13-17)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/tests/quiz/CLAUDE.md`?
