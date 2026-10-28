# lib — Renderer support: template, rich text, fonts, overlay, validation, fact lint
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/vendor/lp-v9/lib kg=c09a0e78e12d gen=49088efa7b7d overflow=31 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `template.js` — builds the two-page A4 HTML
- `validate.js` — schema choice by schema_version
- `overlay.js` — Urdu toggle
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `template.js` | Builds the self-contained two-page A4 LP HTML from an lp_doc: sections, chips, cards and layout |
| `overlay.js` | Applies the Urdu ur_overlay (JSON-pointer map) and printed label packs to a cloned lp_doc at render time |
| `fonts.js` | Resolves and base64-embeds fonts so rendered LP HTML and PDFs look identical on any machine |
| `rich.js` | Inline text pipeline for lp_doc strings: bold, KaTeX math and mhchem into HTML |
| `validate.js` | Schema validation shared by render, lint and tests; picks the 3.0 or 2.0 schema from schema_version |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| … | 8 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `fonts.js` ← imported by `bot/shared/services/quiz/quiz-math.js:205:f7f657cc` · `bot/shared/services/quiz/transcript-quiz-card.js:26:e409cd03` (+3)
- `overlay.js` ← imported by `bot/shared/services/lp612-author.service.js:63:a6ab6c97` · `bot/vendor/lp-v9/lint_lp.js:49:6395c51e` (+2)
- `rich.js` ← imported by `bot/shared/services/quiz/quiz-math.js:179:991497b6` · `bot/vendor/lp-v9/lint_lp.js:50:e778133a` (+2)
- `validate.js` ← imported by `bot/shared/services/lp612-author.service.js:60:8c195dd6` · `bot/vendor/lp-v9/lint_lp.js:48:3f517c5a` (+1)
- … 8 more → `CLAUDE.index.md`

## Never (human)
- Embed fonts as base64 so PDFs match on any machine (fonts.js:4)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/lp612/fbise-slo-chips.test.js` (overlay.js, template.js, validate.js)
- `tests/lp612/bidi-caps.test.js` (rich.js, template.js)
- … 15 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/tests/lp-v8/CLAUDE.index.md`? · `bot/vendor/lp-v9/CLAUDE.index.md`? · `bot/vendor/lp-v9/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `bot/vendor/lp-v9/lib/CLAUDE.index.md`? · `bot/vendor/lp-v9/lib/CLAUDE.md`? (+2)
