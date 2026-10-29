# lib — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/vendor/lp-v9/diagrams/lib -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `degenerate.js` | checkDegenerate(svg): flags diagrams that are faithful but teach nothing, e.g. a degenerate parallelogram |
| `imagesize.js` | Reads pixel size and MIME type of JPEG/PNG/GIF/WebP buffers without dependencies, for aspect ratios |
| `measure.js` | Deterministic text-width measurement from a Helvetica AFM advance table for build-time diagram layout |
| `pictogram.js` | Early-years pictogram support: looks up noun keys in the OpenMoji set and embeds them with attribution in the SVG desc |
| `svg.js` | The Svg builder every diagram type draws with: title strip, caption strip and outer svg framing |
| `tex.js` | Verbatim copy of bot/shared/utils/tex-to-unicode.js kept inside the hermetic vendor tree (bd-3emr5, SYNC 3.12) |
| `tokens.js` | Design tokens (navy, amber, leaf palette) for diagram SVGs, emitted as CSS vars with fallbacks |

## Who reads this (all, generated)
- `degenerate.js` ← imported by `bot/vendor/lp-v9/diagrams/index.js:131:5a5444de`
- `imagesize.js` ← imported by `bot/vendor/lp-v9/diagrams/types/labelled_figure.js:17:97a009dc`
- `measure.js` ← imported by `bot/vendor/lp-v9/diagrams/index.js:126:e8130734` · `bot/vendor/lp-v9/diagrams/types/numberline.js:14:3f94a543` · `bot/vendor/lp-v9/diagrams/lib/degenerate.js:21:d7eecac2` · `bot/vendor/lp-v9/diagrams/lib/svg.js:19:4ffddc69`
- `pictogram.js` ← imported by `bot/shared/services/quiz/lp-quiz-digest.service.js:270:d46a64c1` · `bot/shared/services/quiz/quiz-figure-child-view.js:22:95e7f17c` · `bot/shared/services/quiz/transcript-quiz-author.service.js:17:8a3298ef` · `bot/shared/services/quiz/transcript-quiz-rewrite.js:861:8a3298ef` (+8: `python3 kg/kg.py who-reads pictogram.js`)
- `svg.js` ← imported by `bot/shared/services/quiz/transcript-quiz-figure-gates.js:17:1d566be0` · `bot/vendor/lp-v9/diagrams/types/chem_equation.js:25:2648d588` · `bot/vendor/lp-v9/diagrams/types/graph.js:13:2648d588` · `bot/vendor/lp-v9/diagrams/types/word_blank.js:42:2648d588` (+31: `python3 kg/kg.py who-reads svg.js`)
- `tex.js` ← imported by `bot/vendor/lp-v9/diagrams/index.js:36:47099245`
- `tokens.js` ← imported by `bot/shared/services/quiz/transcript-quiz-figure.js:33:d10794d8` · `bot/vendor/lp-v9/diagrams/types/flow.js:16:3e2a839f` · `bot/vendor/lp-v9/diagrams/types/geometry.js:22:3e2a839f` · `bot/vendor/lp-v9/diagrams/types/mindmap.js:18:3e2a839f` (+4: `python3 kg/kg.py who-reads tokens.js`)

## Tests (all, generated)
- `pictogram.js` ← `tests/quiz/pictogram-school-bag.test.js` · `tests/quiz/pictograms-lesson-objects.test.js` · `tests/quiz/transcript-quiz-figure-early-years.test.js` · `tests/quiz/transcript-quiz-figure-eval6.test.js` · `tests/quiz/transcript-quiz-figure-manipulatives.test.js` · `tests/quiz/transcript-quiz-word-blank.test.js`
- `svg.js` ← `tests/lp612/figure-widen-repair.test.js` · `tests/quiz/transcript-quiz-figure-adaptive-scale.test.js` · `tests/quiz/transcript-quiz-figure-part-labels.test.js` · `tests/quiz/transcript-quiz-figure-phone-scale.test.js`

## Related (all, generated)
- docs: `bot/vendor/lp-v9/SYNC.md`? · `bot/vendor/lp-v9/diagrams/CLAUDE.md`?
