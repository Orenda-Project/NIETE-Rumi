# icons — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/icons -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `FeatureArt.tsx` | 48px spot illustrations per feature (Digital Coaching is a phone) in ink outline and hue, with optional shared motion |
| `FeatureGlyph.tsx` | 24px single-colour menu glyphs per feature using currentColor, with --cut knockouts for filled details |
| `FeatureMotion.tsx` | One shared timer so every opted-in feature icon plays together on open, then again after a 30-60s gap |
| `NieteLattice.test.tsx` | Pins NieteLattice as line art: one colour, decorative, takes colour and strength, unique pattern ids (bd-fmf24g.22) |
| `NieteLattice.tsx` | NIETE brand diamond lattice redrawn as thin 45-degree line art, used decoratively in the Home band |
| `coachArt.test.tsx` | Pins the coach's Schedule (rose), Schools (teal) and Reports (olive) art, glyph, hue and shared motion (bd-4404s7.1) |
| `featureMotion.css` | CSS keyframes for the small feature-icon movements (arrive, again), disabled under reduced motion (bd-fmf24g.18) |
| `features.ts` | Teacher and coach feature lists, order and hues (FEATURE_HUE) shared by the icon art, glyphs and tiles |
| `icons.test.tsx` | Tests FeatureArt illustrations and size/label behaviour for all seven teacher features (bd-fmf24g.2.1) |
| `index.ts` | Barrel exporting the teacher feature icons: features, FeatureArt, FeatureGlyph, FeatureMotion |
| `motion.test.tsx` | Pins icon motion: all icons play together on mount, one shared 30-60s timer, none under reduced motion or hidden |

## Who reads this (all, generated)
- `FeatureArt.tsx` ← imported by `portal/src/portal/coach/card/parts.tsx:5:f39dad9e` · `portal/src/portal/coach/card/scores.tsx:6:f39dad9e` · `portal/src/portal/teacher/home/NextCard.tsx:2:f9b3f4a5` · `portal/src/portal/teacher/home/SlimCard.tsx:3:f9b3f4a5` (+4: `python3 kg/kg.py who-reads FeatureArt.tsx`)
- `FeatureGlyph.tsx` ← imported by `portal/src/portal/teacher/icons/index.ts:4:99c8f172`
- `FeatureMotion.tsx` ← imported by `portal/src/portal/teacher/icons/FeatureArt.tsx:3:c809c6b1` · `portal/src/portal/teacher/icons/index.ts:5:11571eb9`
- `NieteLattice.tsx` ← imported by `portal/src/portal/auth/AuthFrame.tsx:8:94edcb97` · `portal/src/portal/teacher/home/look/HomeBand.tsx:4:6ff5aaa7` · `portal/src/portal/teacher/ui/HomeGreeting.tsx:6:7dc51989` · `portal/src/portal/teacher/icons/index.ts:6:013f2db6`
- `featureMotion.css` ← imported by `portal/src/portal/teacher/icons/FeatureArt.tsx:4:ce13a128`
- `features.ts` ← imported by `portal/src/portal/coach/card/SchoolCardPage.tsx:17:0a302a7a` · `portal/src/portal/coach/card/TeacherCardPage.tsx:5:0a302a7a` · `portal/src/portal/coach/card/parts.tsx:6:0456a423` · `portal/src/portal/coach/card/scores.tsx:7:0a302a7a` (+8: `python3 kg/kg.py who-reads features.ts`)
- `index.ts` ← imported by `portal/src/portal/coach/card/SlimHome.tsx:5:cea5fb4f` · `portal/src/portal/coach/insights/components/MoreCoachip.tsx:12:2cbe5904` · `portal/src/portal/coach/observe/ObservePage.tsx:7:2b885504` · `portal/src/portal/coach/pages/CoachHome.tsx:6:cea5fb4f` (+18: `python3 kg/kg.py who-reads index.ts`)

## Tests (all, generated)
- `NieteLattice.tsx` ← `portal/src/portal/teacher/icons/NieteLattice.test.tsx`
- `index.ts` ← `portal/src/portal/teacher/icons/coachArt.test.tsx` · `portal/src/portal/teacher/icons/icons.test.tsx` · `portal/src/portal/teacher/icons/motion.test.tsx` · `portal/src/portal/teacher/ui/coachKit1.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/teacher/CLAUDE.md`?
