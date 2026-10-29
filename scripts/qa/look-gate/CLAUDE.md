# look-gate — Phone-size layout gate for child-facing web quiz screens

<!-- kg:meta repo=NIETE-Rumi dir=scripts/qa/look-gate kg=7d209546cf08 gen=b8c95d48f0bf overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `build_pages.js` — builds the pages to check
- `run_look.py` — opens, measures and writes the verdict
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `build_pages.js` | Builds child-screen HTML from real page shells with invented boots for the look gate; flags toggle new looks |
| `look_probe.js` | In-page probe returning gutter, tap-target, emoji, button, fold and radii measurements for a child screen |
| `run_look.py` | Opens every look-gate page as a phone in EN and UR at 360/390 widths, measures it, and writes a PASS/FAIL verdict |

## Who reads this (generated)
- env read here: `LOOK_WIDTHS`

## Never (human)
- Gate pages use invented children only, never real ones (build_pages.js:14)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `scripts/qa/CLAUDE.md`?
