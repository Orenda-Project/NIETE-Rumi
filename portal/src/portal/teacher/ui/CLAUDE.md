# ui — Teacher UI kit: shared components, styles, bidi and copy defaults (see README.md)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/ui kg=88c81bdc9dfd gen=f2fcb51953fb overflow=167 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `README.md` — catalogue of every kit component, props and the rules; `index.ts` — barrel
- `checks.test.tsx` — kit-wide design rules; `copy.ts` — default words (TEACHER_UI, en and ur)
- `checks.test.tsx` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/ui`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `styles.ts` | Shared class strings for the teacher kit (CHIP_TONE, CARD, CARD_SELECTED) in the v28 coach-v2 look |
| `index.ts` | Barrel for the teacher UI kit behind portal_teacher_v2: every shared component, helper and style |
| `useKitCopy.ts` | Hook returning the kit's default words in the page's language for components' copy props (bd-fmf24g.13) |
| `copy.ts` | Teacher kit's own English and Urdu default words (TEACHER_UI) for its components' copy props |
| … | 85 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `styles.ts` ← imported by `portal/src/portal/coach/disagreements/CoachingBox.tsx:4:d8e874ab` · `portal/src/portal/coach/disagreements/DisagreementCard.tsx:6:cbd9177e` (+114)
- `index.ts` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:5:537d2327` · `portal/src/portal/coach/analytics/model.ts:2:0fe353a8` (+96)
- … 52 more → `CLAUDE.index.md`

## Never (human)
- Kit components use start/end only, motion under motion-safe:, 56px targets (checks.test.tsx:20, :37)
- Mixed-script runs on Urdu pages go through isolateRuns (bidi.ts header, language-protocol section 8)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/ui/checks.test.tsx` (ClassPicker.tsx, DateRangeBar.tsx, GradeSubjectButton.tsx, HistoryList.tsx, HistoryRow.tsx, ListRow.tsx, ProgressSteps.tsx, VoiceNote.tsx, copy.ts)
- `portal/src/portal/teacher/ui/bidi.test.tsx` (GradeSubjectButton.tsx, HistoryRow.tsx, ListRow.tsx, StatusChip.tsx, bidi.ts)
- … 38 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/components/CLAUDE.md`? · `portal/src/portal/coach/insights/components/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/ui/README.md`?
