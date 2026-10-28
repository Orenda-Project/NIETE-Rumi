# render — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/child-test/render -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `fonts.js` | Base64-embeds the Andika and Urdu fonts as @font-face for the Chromium that renders child-test cards (bd-s1oo0.2) |
| `html.js` | Pure item-bank-to-HTML for child cards, printable card and coach sheet; child side carries no ids or answers |
| `index.js` | Renders inline PNG cards, A4 printable card and coach sheet PDFs from the item bank (bd-s1oo0.2, L2) |
| `sizing.js` | Type-size and card-width constants so stimulus text stays legible inside a phone chat bubble (bd-s1oo0.2) |
| `source.js` | Resolves the item-bank form a render reads, from the accessor or an injected bank (bd-s1oo0.2) |
| `upload.js` | R2 key layout, upload and presign of stimulus cards; always sent via presigned URL (bd-s1oo0.2) |
| `v2.js` | Builds the v2 print pack (laminated per-grade task cards, coach sheet) for operators once a term (bd-s1oo0.46.5) |
| `v3.js` | Builds the v3 print pack: child stimulus booklets and coach sheets from the v3 bank (bd-s1oo0.50.4, L38) |

## Who reads this (all, generated)
- `fonts.js` ← imported by `bot/shared/services/child-test/render/html.js:14:d3e47dca` · `bot/shared/services/child-test/render/v2.js:22:d3e47dca` · `bot/shared/services/child-test/render/v3.js:27:d3e47dca`
- `html.js` ← imported by `bot/shared/services/child-test/render/index.js:13:8769a13c` · `bot/shared/services/child-test/render/v2.js:23:e93b4249` · `bot/shared/services/child-test/render/v3.js:28:e93b4249`
- `sizing.js` ← imported by `bot/shared/services/child-test/render/html.js:15:c50859c3` · `bot/shared/services/child-test/render/index.js:14:c50859c3`
- `source.js` ← imported by `bot/shared/services/child-test/render/index.js:15:10208a13` · `bot/shared/services/child-test/render/v2.js:801:10208a13`
- `v2.js` ← imported by `bot/scripts/child-test/build-print-pack-v2.js:23:56da8e11` · `bot/shared/services/child-test/render/v3.js:30:d93c26a3`
- `v3.js` ← imported by `bot/scripts/child-test/build-print-pack-v3.js:21:b01ffbae`

## Tests (all, generated)
- `html.js` ← `tests/child-test/L10/coach-sheet-print.test.js` · `tests/child-test/L11/protocol.test.js` · `tests/child-test/L2/render-html.test.js` · `tests/child-test/L20/strip-render.test.js`
- `index.js` ← `tests/child-test/L10/coach-sheet-print.test.js` · `tests/child-test/L11/coach-sheet-seconds.test.js` · `tests/child-test/L2/inline-cards.test.js`
- `sizing.js` ← `tests/child-test/L2/render-html.test.js`
- `upload.js` ← `tests/child-test/L2/upload.test.js`
- `v2.js` ← `tests/child-test/L29/print-pack-v2.test.js` · `tests/child-test/L33/coach-card.test.js` · `tests/child-test/L34/coach-card-reach.test.js`
- `v3.js` ← `tests/child-test/L38/print-pack-v3.test.js` · `tests/child-test/L38/sum-sign.test.js`

## Related (all, generated)
- docs: `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.md`? · `bot/shared/services/child-test/render/CLAUDE.index.md`? · `bot/shared/services/child-test/render/CLAUDE.md`? · `tests/child-test/L10/CLAUDE.md`? · `tests/child-test/L11/CLAUDE.md`? · `tests/child-test/L2/CLAUDE.md`? · `tests/child-test/L20/CLAUDE.md`? · `tests/child-test/L29/CLAUDE.md`? · `tests/child-test/L33/CLAUDE.md`? · `tests/child-test/L34/CLAUDE.md`? · `tests/child-test/L38/CLAUDE.md`?
