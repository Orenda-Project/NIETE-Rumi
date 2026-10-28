# lib — Shared helpers for diagram types: SVG builder, text measure, tokens, degeneracy check
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/vendor/lp-v9/diagrams/lib kg=76fb73484ce3 gen=e7d15fd0744c overflow=13 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `svg.js` — builder every type draws with
- `measure.js` — deterministic text widths
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `svg.js` | The Svg builder every diagram type draws with: title strip, caption strip and outer svg framing |
| `pictogram.js` | Early-years pictogram support: looks up noun keys in the OpenMoji set and embeds them with attribution in the SVG desc |
| `tokens.js` | Design tokens (navy, amber, leaf palette) for diagram SVGs, emitted as CSS vars with fallbacks |
| `CLAUDE.md` | (unmapped) |
| `measure.js` | Deterministic text-width measurement from a Helvetica AFM advance table for build-time diagram layout |
| `CLAUDE.index.md` | (unmapped) |
| `tex.js` | Verbatim copy of bot/shared/utils/tex-to-unicode.js kept inside the hermetic vendor tree (bd-3emr5, SYNC 3.12) |
| … | 2 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `svg.js` ← imported by `bot/shared/services/quiz/transcript-quiz-figure-gates.js:17:1d566be0` · `bot/vendor/lp-v9/diagrams/types/chem_equation.js:25:2648d588` (+33)
- `pictogram.js` ← imported by `bot/shared/services/quiz/lp-quiz-digest.service.js:270:d46a64c1` · `bot/shared/services/quiz/quiz-figure-child-view.js:22:95e7f17c` (+10)
- `tokens.js` ← imported by `bot/shared/services/quiz/transcript-quiz-figure.js:33:d10794d8` · `bot/vendor/lp-v9/diagrams/types/flow.js:16:3e2a839f` (+6)
- `measure.js` ← imported by `bot/vendor/lp-v9/diagrams/index.js:126:e8130734` · `bot/vendor/lp-v9/diagrams/types/numberline.js:14:3f94a543` (+2)
- … 3 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/lp612/figure-widen-repair.test.js` (svg.js)
- `tests/quiz/pictogram-school-bag.test.js` (pictogram.js)
- … 8 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/vendor/lp-v9/CLAUDE.index.md`? · `bot/vendor/lp-v9/SYNC.md`? · `bot/vendor/lp-v9/diagrams/CLAUDE.index.md`? · `bot/vendor/lp-v9/diagrams/CLAUDE.md`? · `bot/vendor/lp-v9/diagrams/lib/CLAUDE.index.md`? · `bot/vendor/lp-v9/diagrams/lib/CLAUDE.md`? (+2)
