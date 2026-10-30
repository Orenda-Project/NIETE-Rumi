# people — Coach Schools and Teachers area: rows, frame, copy and visit-status tone
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/people kg=2e9c4be6bfec gen=d914a0e02a52 overflow=11 rendered=2026-10-30 kg.py=1.1.0 -->

## Entry points
- `rows.tsx` — school and teacher rows on the kit HistoryRow
- `ManageSchool.tsx` — add/remove teacher and remove school group
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/people`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | English and Urdu words of the coach Schools and Teachers area, following the ontology |
| `PeopleFrame.tsx` | Frame of Schools and Teachers pages: coach gate, TeacherPage, pending banner (bd-4404s7.6) |
| `schoolsReady.test.tsx` | Pins that My schools opens school and teacher pages and links only to ready pages |
| `checks.test.tsx` | Source-scan and 56px target checks for Schools and Teachers screens (bd-4404s7.6) |
| `level.tsx` | (unmapped) |
| `rows.tsx` | School and teacher rows on the kit HistoryRow with round avatars and flat stats |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `PeopleFrame.tsx` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:10:5c9f8184` · `portal/src/portal/coach/card/DaysUsedPage.tsx:5:70e8f104` (+15)
- `copy.ts` ← imported by `portal/src/portal/coach/card/SchoolCardPage.tsx:12:50f56fe6` · `portal/src/portal/coach/card/TeacherCardPage.tsx:9:50f56fe6` (+12)
- `level.tsx` ← imported by `portal/src/portal/coach/card/FeatureGridPage.tsx:12:2e133d28` · `portal/src/portal/coach/card/SchoolCardPage.tsx:11:365d4e40` (+8)
- … 3 more → `CLAUDE.index.md`

## Never (human)
- Pages link only to pages the coach app shows (people/schoolsReady.test.tsx:10)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/pages/CoachEditTeacher.test.tsx` (copy.ts)
- `portal/src/portal/coach/pages/CoachManageSchools.test.tsx` (copy.ts)
- … 4 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/coach/pages/CLAUDE.md`? · `portal/src/portal/coach/training/CLAUDE.md`? · `portal/src/portal/hooks/CLAUDE.md`? · `portal/src/portal/newui/checks/CLAUDE.md`?
