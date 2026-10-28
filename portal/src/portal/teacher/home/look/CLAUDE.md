# look — Teacher Home 'look' (portal_teacher_home_look): navy band, one card, rows, progress strip
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/home/look kg=81661d4d21c1 gen=e5a24dfbe5cb overflow=29 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `LookHome.tsx` — composes band, card, strip, rows; `HomeBand.tsx` and `bandShape.ts` — band layout
- `LookCard.tsx` — one card for five rungs; `cardWords.ts` — words and tap targets
- `LookHome.test.tsx` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/home/look`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `LookHome.test.tsx` | Pins the whole Home look through the real Home page: band, card, progress strip, rows, reminder, flag combinations |
| `LookCard.test.tsx` | Pins the look's one Home card for all five rungs in English and Urdu: tint, medal, taps, cool-down |
| `CLAUDE.index.md` | (unmapped) |
| `FeatureRows.test.tsx` | Pins the look's 8 feature rows, two per line, tinted icon wells by kind, server order when whole |
| … | 16 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `cardWords.ts` ← imported by `portal/src/portal/teacher/home/NextCard.tsx:8:1111e866` · `portal/src/portal/teacher/home/SlimCard.tsx:8:6e07efd2` (+1)
- `lookIcons.tsx` ← imported by `portal/src/portal/teacher/TeacherNavigation.tsx:11:b6d4ed6d` · `portal/src/portal/teacher/home/look/FeatureRows.tsx:9:f0c318d3`
- `FeatureRows.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:21:a2b5b62b`
- … 6 more → `CLAUDE.index.md`

## Never (human)
- The look rides on the card switch: the look without the card is off (LookHome.test.tsx:92)
- Band language pill saves via the one writer then switches the page (LanguagePill.tsx:)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/home/look/LanguagePill.test.tsx` (HomeBand.tsx, LanguagePill.tsx)
- `portal/src/portal/teacher/home/look/FeatureRows.test.tsx` (FeatureRows.tsx)
- … 7 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.index.md`? · `portal/src/portal/teacher/home/CLAUDE.index.md`? · `portal/src/portal/teacher/home/CLAUDE.md`? · `portal/src/portal/teacher/home/look/CLAUDE.index.md`? · `portal/src/portal/teacher/home/look/CLAUDE.md`? (+2)
