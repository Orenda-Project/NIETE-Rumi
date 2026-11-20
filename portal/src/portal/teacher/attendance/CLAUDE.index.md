# attendance — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/attendance -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `AttendanceHub.tsx` | Attendance main page: searchable class selector, not-marked first; opens roll call, View or Download |
| `DownloadPage.tsx` | A class's month register page: choose month, send the Excel register to WhatsApp via the bot delivery |
| `MarkPage.tsx` | Roll call page: everyone starts Present, P/A/L per child, All present, Save or Save changes for a marked day |
| `ViewPage.tsx` | One class's month view: calendar tinted by present share, day detail of who was away, per-child percentages |
| `api.ts` | Attendance data layer over /api/portal/teacher/attendance (classes, roster, day, month, mark, register) |
| `attendance.ur.test.tsx` | Renders the Attendance selector, chips, month and day names in Urdu; English dates unchanged (bd-fmf24g.13) |
| `checks.test.tsx` | Style and copy guard for Attendance pages: logical start/end, motion-safe, copy.ts words, 56px targets (bd-fmf24g.7) |
| `copy.ts` | English and Urdu words, month and weekday names for Attendance screens, registered as COPY_ENTRY |
| `mark-names.test.tsx` | Pins roll-call child names wrapping to two lines with 44px-wide P/A/L buttons, 56px tall (bd-qvnzh5) |
| `model.test.ts` | Tests Attendance rules in model.ts: selector order and search, mark-by-exception counts, POST body, 90-day window |
| `model.ts` | Pure Attendance rules: class grouping and search, status counts, mark payload, date window; invents no counts |
| `paths.ts` | Path builders for Attendance pages under /portal/teacher/attendance: mark, view, download |
| `routes.tsx` | Registers lazy Attendance pages (selector, mark, view, download) under /portal/teacher/attendance via TeacherGate |
| `staff.test.tsx` | (unmapped) |
| `ui.tsx` | Shared Attendance pieces: search box, load state, class status chip, class card and the Change tray |

## Who reads this (all, generated)
- `AttendanceHub.tsx` ← imported by `portal/src/portal/teacher/attendance/routes.tsx:6:abb02e8d`
- `DownloadPage.tsx` ← imported by `portal/src/portal/teacher/attendance/routes.tsx:7:87039563`
- `MarkPage.tsx` ← imported by `portal/src/portal/teacher/attendance/routes.tsx:8:84e5180d`
- `ViewPage.tsx` ← imported by `portal/src/portal/teacher/attendance/routes.tsx:9:e533376c`
- `api.ts` ← imported by `portal/src/portal/teacher/attendance/DownloadPage.tsx:9:b8315a9c` · `portal/src/portal/teacher/attendance/MarkPage.tsx:8:23c4530a` · `portal/src/portal/teacher/attendance/ViewPage.tsx:8:4b871c4b` · `portal/src/portal/teacher/attendance/ui.tsx:9:4c2f1710`
- `copy.ts` ← imported by `portal/src/portal/teacher/attendance/AttendanceHub.tsx:9:ec07487d` · `portal/src/portal/teacher/attendance/MarkPage.tsx:9:dee5da98` · `portal/src/portal/teacher/attendance/model.ts:6:6a283727` · `portal/src/portal/teacher/attendance/ui.tsx:7:8f48fd77`
- `model.ts` ← imported by `portal/src/portal/teacher/attendance/AttendanceHub.tsx:11:5be71c60` · `portal/src/portal/teacher/attendance/DownloadPage.tsx:11:849961a5` · `portal/src/portal/teacher/attendance/MarkPage.tsx:14:74d4b72c` · `portal/src/portal/teacher/attendance/ViewPage.tsx:10:fff2be2b` (+2: `python3 kg/kg.py who-reads model.ts`)
- `paths.ts` ← imported by `portal/src/portal/teacher/attendance/AttendanceHub.tsx:12:ad1dfc51` · `portal/src/portal/teacher/attendance/DownloadPage.tsx:12:3fd9cc25` · `portal/src/portal/teacher/attendance/MarkPage.tsx:15:1f10d335` · `portal/src/portal/teacher/attendance/ViewPage.tsx:11:939b34aa` (+2: `python3 kg/kg.py who-reads paths.ts`)
- `ui.tsx` ← imported by `portal/src/portal/teacher/attendance/AttendanceHub.tsx:13:4dd4933b` · `portal/src/portal/teacher/attendance/DownloadPage.tsx:13:28e4722c` · `portal/src/portal/teacher/attendance/MarkPage.tsx:16:0e90e997` · `portal/src/portal/teacher/attendance/ViewPage.tsx:12:28e4722c`

## Tests (all, generated)
- `AttendanceHub.tsx` ← `portal/src/portal/teacher/attendance/attendance.ur.test.tsx` · `portal/src/portal/teacher/attendance/staff.test.tsx`
- `DownloadPage.tsx` ← `portal/src/portal/teacher/attendance/staff.test.tsx`
- `MarkPage.tsx` ← `portal/src/portal/teacher/attendance/mark-names.test.tsx` · `portal/src/portal/teacher/attendance/staff.test.tsx`
- `ViewPage.tsx` ← `portal/src/portal/teacher/attendance/staff.test.tsx`
- `copy.ts` ← `portal/src/portal/teacher/attendance/attendance.ur.test.tsx` · `portal/src/portal/teacher/attendance/checks.test.tsx` · `portal/src/portal/teacher/attendance/staff.test.tsx`
- `model.ts` ← `portal/src/portal/teacher/attendance/attendance.ur.test.tsx` · `portal/src/portal/teacher/attendance/model.test.ts`
- `paths.ts` ← `portal/src/portal/teacher/attendance/checks.test.tsx` · `portal/src/portal/teacher/attendance/staff.test.tsx`
- `routes.tsx` ← `portal/src/portal/teacher/attendance/checks.test.tsx`
- `ui.tsx` ← `portal/src/portal/components/loadingStates.test.tsx` · `portal/src/portal/teacher/attendance/checks.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`?
