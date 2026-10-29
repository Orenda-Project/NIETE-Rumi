# icons — Teacher feature art, menu glyphs, shared icon motion, NIETE lattice
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/icons kg=c87dd9901030 gen=81be9f3bdf62 overflow=13 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `index.ts` — barrel; `FeatureArt.tsx` — 48px illustrations; `FeatureGlyph.tsx` — 24px menu glyphs
- `FeatureMotion.tsx` and `featureMotion.css` — one shared timer, CSS keyframes
- `icons.test.tsx` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/icons`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `index.ts` | Barrel exporting the teacher feature icons: features, FeatureArt, FeatureGlyph, FeatureMotion |
| `features.ts` | Teacher and coach feature lists, order and hues (FEATURE_HUE) shared by the icon art, glyphs and tiles |
| `FeatureArt.tsx` | 48px spot illustrations per feature (Digital Coaching is a phone) in ink outline and hue, with optional shared motion |
| `NieteLattice.tsx` | NIETE brand diamond lattice redrawn as thin 45-degree line art, used decoratively in the Home band |
| … | 7 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `index.ts` ← imported by `portal/src/portal/coach/card/SlimHome.tsx:5:cea5fb4f` · `portal/src/portal/coach/insights/components/MoreCoachip.tsx:11:2cbe5904` (+20)
- `features.ts` ← imported by `portal/src/portal/coach/card/SchoolCardPage.tsx:16:0a302a7a` · `portal/src/portal/coach/card/TeacherCardPage.tsx:5:0a302a7a` (+9)
- `FeatureArt.tsx` ← imported by `portal/src/portal/coach/card/parts.tsx:5:f39dad9e` · `portal/src/portal/teacher/home/NextCard.tsx:2:f9b3f4a5` (+5)
- `NieteLattice.tsx` ← imported by `portal/src/portal/auth/AuthFrame.tsx:8:94edcb97` · `portal/src/portal/teacher/home/look/HomeBand.tsx:4:6ff5aaa7` (+2)
- … 3 more → `CLAUDE.index.md`

## Never (human)
- No icon motion under prefers-reduced-motion (featureMotion.css:4, :46); all play on one shared timer (bd-fmf24g.18)
- Menu glyphs never move; Digital Coaching art is a phone (icons.test.tsx, motion.test.tsx)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/icons/NieteLattice.test.tsx` (NieteLattice.tsx)
- `portal/src/portal/teacher/icons/coachArt.test.tsx` (index.ts)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/teacher/CLAUDE.md`?
