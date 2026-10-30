# people — Coach Schools and Teachers area: rows, frame, copy and visit-status tone
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/people kg=9629b6ad60c7 gen=7592b50513b9 overflow=6 rendered=2026-10-30 kg.py=1.1.0 -->

## Entry points
- `rows.tsx` — school and teacher rows on the kit HistoryRow
- `ManageSchool.tsx` — add/remove teacher and remove school group
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/people`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `PeopleFrame.tsx` | Frame of Schools and Teachers pages: coach gate, TeacherPage, pending banner (bd-4404s7.6) |
| `schoolsReady.test.tsx` | Pins that My schools opens school and teacher pages and links only to ready pages |
| `copy.ts` | English and Urdu words of the coach Schools and Teachers area, following the ontology |
| `checks.test.tsx` | Source-scan and 56px target checks for Schools and Teachers screens (bd-4404s7.6) |
| `rows.tsx` | School and teacher rows on the kit HistoryRow with round avatars and flat stats |
| … | 3 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `PeopleFrame.tsx` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:10:5c9f8184` · `portal/src/portal/coach/card/DaysUsedPage.tsx:5:70e8f104` (+14)
- `copy.ts` ← imported by `portal/src/portal/coach/card/TeacherCardPage.tsx:7:50f56fe6` · `portal/src/portal/coach/pages/CoachAddSchool.tsx:9:50f56fe6` (+9)
- `rows.tsx` ← imported by `portal/src/portal/coach/card/DaysUsedPage.tsx:6:d9a31d0d` · `portal/src/portal/coach/card/HerItemsPage.tsx:7:d9a31d0d` (+7)
- `ManageSchool.tsx` ← imported by `portal/src/portal/coach/card/SchoolCardPage.tsx:9:bf2e7884` · `portal/src/portal/coach/pages/CoachSchool.tsx:9:bf2e7884`
- … 1 more → `CLAUDE.index.md`

## Never (human)
- Pages link only to pages the coach app shows (people/schoolsReady.test.tsx:10)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/pages/CoachEditTeacher.test.tsx` (copy.ts)
- `portal/src/portal/coach/pages/CoachManageSchools.test.tsx` (copy.ts)
- … 2 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/coach/pages/CLAUDE.md`? · `portal/src/portal/coach/training/CLAUDE.md`? · `portal/src/portal/hooks/CLAUDE.md`? · `portal/src/portal/newui/checks/CLAUDE.md`?
