# look-gate — Phone-size layout gate for child-facing web quiz screens

<!-- kg:meta repo=NIETE-Rumi dir=scripts/qa/look-gate kg=a0d9e244bd45 gen=654759b9cd66 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `build_pages.js` — builds the pages to check
- `run_look.py` — opens, measures and writes the verdict
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
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
- docs: `scripts/qa/CLAUDE.index.md`? · `scripts/qa/CLAUDE.md`? · `scripts/qa/look-gate/CLAUDE.md`?
