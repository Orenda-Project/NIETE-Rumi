# attendance — Teacher Attendance: class selector, roll call, month view, register download
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/attendance kg=3230debcf137 gen=c6358c5a378b overflow=19 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `AttendanceHub.tsx` — selector page; `MarkPage.tsx` — roll call; `routes.tsx` — all under /portal/teacher/attendance
- `api.ts` — /api/portal/teacher/attendance calls; `model.ts` — pure rules
- `model.test.ts` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/attendance`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | English and Urdu words, month and weekday names for Attendance screens, registered as COPY_ENTRY |
| `model.ts` | Pure Attendance rules: class grouping and search, status counts, mark payload, date window; invents no counts |
| `checks.test.tsx` | Style and copy guard for Attendance pages: logical start/end, motion-safe, copy.ts words, 56px targets (bd-fmf24g.7) |
| `paths.ts` | Path builders for Attendance pages under /portal/teacher/attendance: mark, view, download |
| … | 10 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/teacher/attendance/AttendanceHub.tsx:10:ec07487d` · `portal/src/portal/teacher/attendance/DownloadPage.tsx:10:ec07487d` (+4)
- `model.ts` ← imported by `portal/src/portal/teacher/attendance/AttendanceHub.tsx:12:320700ef` · `portal/src/portal/teacher/attendance/DownloadPage.tsx:12:80bfb06a` (+4)
- `paths.ts` ← imported by `portal/src/portal/teacher/attendance/AttendanceHub.tsx:13:ad1dfc51` · `portal/src/portal/teacher/attendance/DownloadPage.tsx:13:b69e9cbc` (+3)
- … 6 more → `CLAUDE.index.md`

## Never (human)
- No invented counts, school days or percentages; all come from the API (model.ts:4)
- Roll-call names wrap to two lines, never cut to the first name (mark-names.test.tsx, bd-qvnzh5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/attendance/checks.test.tsx` (copy.ts, paths.ts, routes.tsx, ui.tsx)
- `portal/src/portal/teacher/attendance/attendance.ur.test.tsx` (AttendanceHub.tsx, copy.ts, model.ts)
- … 5 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`?
