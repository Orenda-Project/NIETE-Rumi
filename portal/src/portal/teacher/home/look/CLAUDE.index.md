# look — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/home/look -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `FeatureRows.test.tsx` | Pins the look's 8 feature rows, two per line, tinted icon wells by kind, server order when whole |
| `FeatureRows.tsx` | Home look's eight white feature rows with green or slate icon wells, in the server's tile order when it is whole |
| `HomeBand.test.tsx` | Pins the look's navy band in shape A (two rows) and shape B (one row): date and school rules, greeting never cut |
| `HomeBand.tsx` | Navy band of the Home look (portal_teacher_home_look): mark, date, school, language pill, greeting in bandShape layout |
| `LanguagePill.test.tsx` | Pins the language pill: names the other language, saves via PUT /me/language then switches, 44px target |
| `LanguagePill.tsx` | Single pill in the Home band naming the language not in use; saves through useLanguageSwitch, disabled while saving |
| `LookCard.test.tsx` | Pins the look's one Home card for all five rungs in English and Urdu: tint, medal, taps, cool-down |
| `LookCard.tsx` | Home look's single card shape for all five rungs: medal, eyebrow, title, full-width primary and text-link secondary |
| `LookHome.test.tsx` | Pins the whole Home look through the real Home page: band, card, progress strip, rows, reminder, flag combinations |
| `LookHome.tsx` | Composes the Home look: band, climbing card or strip, 8 feature rows and reminder, with slot and rows wait budgets |
| `LookScores.test.tsx` | Pins the 'Your progress' strip: chip taps, label shown only beside one chip, 44px chips, label hidden under 344px |
| `LookScores.tsx` | Home look's 'Your progress' strip rendering the score chips from chips.ts as pale-slate 44px pills |
| `bandShape.test.ts` | Tests bandShape width estimate (code points, Urdu vs Latin) choosing one or two rows, always one under 344px |
| `bandShape.ts` | Chooses the Home band's one-row or two-row shape from an estimated greeting width and viewport width |
| `cardWords.test.ts` | Tests cardWords: full-kind and slim-kind labels and hrefs match NextCard/SlimCard, and the look's titles per kind |
| `cardWords.ts` | Single source of the Home card's words and tap targets for NextCard, SlimCard and the look's card |
| `lookIcons.test.tsx` | Guards that all 13 lookIcons keys resolve to lucide components (catches a renamed glyph) |
| `lookIcons.tsx` | Map of the 13 lucide glyphs the Home look draws: features, menu Home and More, language pill, lesson card, strip |

## Who reads this (all, generated)
- `FeatureRows.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:21:a2b5b62b`
- `HomeBand.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:18:fe5d3aad`
- `LanguagePill.tsx` ← imported by `portal/src/portal/teacher/home/look/HomeBand.tsx:11:c1dee953`
- `LookCard.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:19:b78f8101`
- `LookHome.tsx` ← imported by `portal/src/portal/teacher/pages/Home.tsx:19:08e9c818`
- `LookScores.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:20:a0e68a89`
- `bandShape.ts` ← imported by `portal/src/portal/teacher/home/look/HomeBand.tsx:12:ad7206d3`
- `cardWords.ts` ← imported by `portal/src/portal/teacher/home/NextCard.tsx:8:1111e866` · `portal/src/portal/teacher/home/SlimCard.tsx:8:6e07efd2` · `portal/src/portal/teacher/home/look/LookCard.tsx:9:e9d3dd51`
- `lookIcons.tsx` ← imported by `portal/src/portal/teacher/TeacherNavigation.tsx:11:b6d4ed6d` · `portal/src/portal/teacher/home/look/FeatureRows.tsx:9:f0c318d3`

## Tests (all, generated)
- `FeatureRows.tsx` ← `portal/src/portal/teacher/home/look/FeatureRows.test.tsx`
- `HomeBand.tsx` ← `portal/src/portal/teacher/home/look/HomeBand.test.tsx` · `portal/src/portal/teacher/home/look/LanguagePill.test.tsx`
- `LanguagePill.tsx` ← `portal/src/portal/teacher/home/look/LanguagePill.test.tsx`
- `LookCard.tsx` ← `portal/src/portal/teacher/home/look/LookCard.test.tsx`
- `LookHome.tsx` ← `portal/src/portal/teacher/home/look/LookHome.test.tsx`
- `LookScores.tsx` ← `portal/src/portal/teacher/home/look/LookScores.test.tsx`
- `bandShape.ts` ← `portal/src/portal/teacher/home/look/bandShape.test.ts`
- `cardWords.ts` ← `portal/src/portal/teacher/home/look/cardWords.test.ts`
- `lookIcons.tsx` ← `portal/src/portal/teacher/home/look/lookIcons.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/teacher/home/CLAUDE.md`? · `portal/src/portal/teacher/pages/CLAUDE.md`?
