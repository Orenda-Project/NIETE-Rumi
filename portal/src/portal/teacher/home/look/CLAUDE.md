# look — Teacher Home 'look' (portal_teacher_home_look): navy band, one card, rows, progress strip
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/home/look kg=36803f623dcd gen=f425dcf71f4e overflow=26 rendered=2026-10-29 kg.py=1.1.0 -->

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
| `FeatureRows.test.tsx` | Pins the look's 8 feature rows, two per line, tinted icon wells by kind, server order when whole |
| `LanguagePill.test.tsx` | Pins the language pill: names the other language, saves via PUT /me/language then switches, 44px target |
| … | 14 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `cardWords.ts` ← imported by `portal/src/portal/teacher/home/NextCard.tsx:8:1111e866` · `portal/src/portal/teacher/home/SlimCard.tsx:8:6e07efd2` (+1)
- `lookIcons.tsx` ← imported by `portal/src/portal/teacher/TeacherNavigation.tsx:11:b6d4ed6d` · `portal/src/portal/teacher/home/look/FeatureRows.tsx:9:f0c318d3`
- `FeatureRows.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:21:a2b5b62b`
- `HomeBand.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:18:fe5d3aad`
- … 5 more → `CLAUDE.index.md`

## Never (human)
- The look rides on the card switch: the look without the card is off (LookHome.test.tsx:92)
- Band language pill saves via the one writer then switches the page (LanguagePill.tsx:)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/home/look/LanguagePill.test.tsx` (HomeBand.tsx, LanguagePill.tsx)
- `portal/src/portal/teacher/home/look/FeatureRows.test.tsx` (FeatureRows.tsx)
- … 7 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/teacher/home/CLAUDE.md`? · `portal/src/portal/teacher/pages/CLAUDE.md`?
