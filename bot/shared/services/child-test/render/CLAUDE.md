# render — Renders child cards, print packs and coach sheets from the item bank
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/render kg=579c6e7d6a7f gen=0e436aa51007 overflow=17 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `index.js` — renderInlineCards, renderPrintableCard, renderCoachSheet
- `upload.js` — R2 keys, upload and presign of stimulus cards
- `v3.js` — v3 print pack, child booklets (bd-s1oo0.50.4)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `html.js` | Pure item-bank-to-HTML for child cards, printable card and coach sheet; child side carries no ids or answers |
| `.v*.js` | 2 versions — v3 imported; v3: Builds the v3 print pack: child stimulus booklets and coach sheets from the v3 bank (bd-s1oo0.50.4, L38) |
| `fonts.js` | Base64-embeds the Andika and Urdu fonts as @font-face for the Chromium that renders child-test cards (bd-s1oo0.2) |
| `index.js` | Renders inline PNG cards, A4 printable card and coach sheet PDFs from the item bank (bd-s1oo0.2, L2) |
| … | 5 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `fonts.js` ← imported by `bot/shared/services/child-test/render/html.js:14:d3e47dca` · `bot/shared/services/child-test/render/v2.js:22:d3e47dca` (+1)
- `html.js` ← imported by `bot/shared/services/child-test/render/index.js:13:8769a13c` · `bot/shared/services/child-test/render/v2.js:23:e93b4249` (+1)
- `sizing.js` ← imported by `bot/shared/services/child-test/render/html.js:15:c50859c3` · `bot/shared/services/child-test/render/index.js:14:c50859c3`
- `source.js` ← imported by `bot/shared/services/child-test/render/index.js:15:10208a13` · `bot/shared/services/child-test/render/v2.js:801:10208a13`
- … 2 more → `CLAUDE.index.md`

## Never (human)
- Always send stimulus through a presigned URL; R2's private address gave HTTP 400 (upload.js:8)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/child-test/L10/coach-sheet-print.test.js` (html.js, index.js)
- `tests/child-test/L2/render-html.test.js` (html.js, sizing.js)
- … 10 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.md`? · `bot/shared/services/child-test/render/CLAUDE.index.md`? · `bot/shared/services/child-test/render/CLAUDE.md`?
