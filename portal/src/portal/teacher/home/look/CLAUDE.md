# look — Teacher Home 'look' (portal_teacher_home_look): navy band, one card, rows, progress strip
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/home/look kg=43bccd57491c gen=cc9d65581069 overflow=16 rendered=2026-11-25 kg.py=1.1.0 -->

## Entry points
- `LookHome.tsx` — composes band, card, strip, rows; `HomeBand.tsx` and `bandShape.ts` — band layout
- `LookCard.tsx` — one card for five rungs; `cardWords.ts` — words and tap targets
- `LookHome.test.tsx` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/home/look`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `LookHome*` | 4 files; most used `LookHome.test.tsx`: Pins the whole Home look through the real Home page: band, card, progress strip, rows, reminder, flag combinations |
| `LookCard.test.tsx` | Pins the look's one Home card for all five rungs in English and Urdu: tint, medal, taps, cool-down |
| `FeatureTiles.test.tsx` | (unmapped) |
| `LanguagePill.test.tsx` | Pins the language pill: names the other language, saves via PUT /me/language then switches, 44px target |
| `cardWords.ts` | Single source of the Home card's words and tap targets for NextCard, SlimCard and the look's card |
| … | 10 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `cardWords.ts` ← imported by `portal/src/portal/teacher/home/NextCard.tsx:8:1111e866` · `portal/src/portal/teacher/home/SlimCard.tsx:8:6e07efd2` (+1)
- `FeatureTiles.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:25:ff6c2cfd`
- `LanguagePill.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:8:114e146e`
- `LookCard.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:23:b78f8101`
- … 3 more → `CLAUDE.index.md`

## Never (human)
- The look rides on the card switch: the look without the card is off (LookHome.test.tsx:92)
- Band language pill saves via the one writer then switches the page (LanguagePill.tsx:)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/help/howToPill.test.tsx` (LanguagePill.tsx)
- `portal/src/portal/teacher/home/look/FeatureTiles.test.tsx` (FeatureTiles.tsx)
- … 6 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/teacher/home/CLAUDE.md`? · `portal/src/portal/teacher/icons/CLAUDE.md`?
