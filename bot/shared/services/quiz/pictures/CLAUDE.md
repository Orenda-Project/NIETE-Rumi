# pictures — Colour picture bank (Fluent Emoji glyphs) the web quiz draws nouns with

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/quiz/pictures kg=f5333abd59e0 gen=b75d8e85bd95 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `index.js` — colorInner(noun) and emojiNoun(emoji) lookups used by web-quiz figures
- `build_color_bank.js` — regenerates color_glyphs.json from the Fluent Emoji SVGs
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `index.js` | Picture bank lookup: colorInner(noun) and emojiNoun(emoji) return colour SVG for web-quiz figures and picture options |
| `build_color_bank.js` | Script that builds color_glyphs.json from Fluent Emoji Flat SVGs for the figure engine's pictogram nouns |
| `color_glyphs.json` | Generated bank of inlined flat-colour SVG glyphs (72-unit grid) per noun; read by pictures/index.js |
| `bank_map.json` | Maps picture-bank word keys to Fluent Emoji names and hex codepoints; input to the colour-glyph bank |
| `LICENSE-fluentui-emoji.txt` | MIT licence text for the Microsoft Fluent Emoji glyphs bundled in the picture bank |

## Who reads this (generated)
- `index.js` ← imported by `bot/shared/services/quiz/web-quiz-figure.js:32:7e5af4f3` · `bot/shared/services/quiz/web-quiz.service.js:37:7e5af4f3`
- `color_glyphs.json` ← imported by `bot/shared/services/quiz/pictures/index.js:19:a291fa48`

## Never (human)
- color_glyphs.json is built by build_color_bank.js (index.js:3-4); regenerate, do not hand-edit
- Keep the MIT notice beside the bundled glyphs (LICENSE-fluentui-emoji.txt:1-3)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/quiz/web-quiz/web-quiz-pictures.test.js` (build_color_bank.js)
- `bot/tests/quiz/web-quiz/web-quiz-seed-picture.test.js` (index.js)

## Related (generated)
- docs: `bot/shared/services/quiz/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`?
