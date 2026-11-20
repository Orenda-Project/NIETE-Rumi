# attendance — Teacher Attendance: class selector, roll call, month view, register download
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/attendance kg=b6b69509408f gen=3fe895718874 overflow=21 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `AttendanceHub.tsx` — selector page; `MarkPage.tsx` — roll call; `routes.tsx` — all under /portal/teacher/attendance
- `api.ts` — /api/portal/teacher/attendance calls; `model.ts` — pure rules
- `model.test.ts` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/attendance`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `staff.test.tsx` | (unmapped) |
| `model.ts` | Pure Attendance rules: class grouping and search, status counts, mark payload, date window; invents no counts |
| `paths.ts` | Path builders for Attendance pages under /portal/teacher/attendance: mark, view, download |
| `checks.test.tsx` | Style and copy guard for Attendance pages: logical start/end, motion-safe, copy.ts words, 56px targets (bd-fmf24g.7) |
| … | 11 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `model.ts` ← imported by `portal/src/portal/teacher/attendance/AttendanceHub.tsx:11:5be71c60` · `portal/src/portal/teacher/attendance/DownloadPage.tsx:11:849961a5` (+4)
- `paths.ts` ← imported by `portal/src/portal/teacher/attendance/AttendanceHub.tsx:12:ad1dfc51` · `portal/src/portal/teacher/attendance/DownloadPage.tsx:12:3fd9cc25` (+4)
- `api.ts` ← imported by `portal/src/portal/teacher/attendance/DownloadPage.tsx:9:b8315a9c` · `portal/src/portal/teacher/attendance/MarkPage.tsx:8:23c4530a` (+2)
- … 6 more → `CLAUDE.index.md`

## Never (human)
- No invented counts, school days or percentages; all come from the API (model.ts:4)
- Roll-call names wrap to two lines, never cut to the first name (mark-names.test.tsx, bd-qvnzh5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/attendance/staff.test.tsx` (AttendanceHub.tsx, DownloadPage.tsx, MarkPage.tsx, ViewPage.tsx, copy.ts, paths.ts)
- `portal/src/portal/teacher/attendance/checks.test.tsx` (copy.ts, paths.ts, routes.tsx, ui.tsx)
- … 7 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`?
