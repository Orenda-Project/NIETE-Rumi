# observations — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/observations -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `Observations.test.tsx` | Pins Observations page: next visit, in-progress stage only, no visit state, reports and visit report (bd-fmf24g.4) |
| `ObservationsHome.tsx` | Observations main page (Next visit, In progress, Reports) and the coach-visit report page wrapper |
| `api.ts` | Observations reads: GET /teacher/visits and coach visits from GET /coaching-sessions, with reportGroups shaping |
| `checks.test.tsx` | Style and copy guard for the Observations page: logical start/end, motion-safe, label-only copy (bd-fmf24g.4) |
| `copy.ts` | English and Urdu words for the Observations screens (OBSERVATIONS bilingual), registered as COPY_ENTRY |
| `observations.ur.test.tsx` | Renders Observations main page and a visit report in Urdu with the bot's Urdu band words (bd-fmf24g.13.2) |
| `paths.ts` | Path builders for Observations: OBS_HOME and the report path reusing the shared coaching ReportPage |
| `routes.tsx` | Registers lazy Observations home and visit-report pages under /portal/teacher/observations via TeacherGate |

## Who reads this (all, generated)
- `ObservationsHome.tsx` ← imported by `portal/src/portal/teacher/observations/routes.tsx:6:af920adc`
- `api.ts` ← imported by `portal/src/portal/teacher/observations/ObservationsHome.tsx:16:f775a727`
- `copy.ts` ← imported by `portal/src/portal/teacher/observations/ObservationsHome.tsx:17:376d03b0`
- `paths.ts` ← imported by `portal/src/portal/teacher/home/chips.ts:4:614029b8` · `portal/src/portal/teacher/home/look/cardWords.ts:4:55f11086` · `portal/src/portal/teacher/observations/ObservationsHome.tsx:18:93d6f216` · `portal/src/portal/teacher/observations/api.ts:8:fd15bb81` (+1: `python3 kg/kg.py who-reads paths.ts`)

## Tests (all, generated)
- `ObservationsHome.tsx` ← `portal/src/portal/teacher/observations/Observations.test.tsx` · `portal/src/portal/teacher/observations/observations.ur.test.tsx`
- `api.ts` ← `portal/src/portal/teacher/observations/observations.ur.test.tsx`
- `copy.ts` ← `portal/src/portal/teacher/observations/Observations.test.tsx` · `portal/src/portal/teacher/observations/checks.test.tsx` · `portal/src/portal/teacher/observations/observations.ur.test.tsx`
- `paths.ts` ← `portal/src/portal/teacher/observations/Observations.test.tsx` · `portal/src/portal/teacher/observations/observations.ur.test.tsx`
- `routes.tsx` ← `portal/src/portal/teacher/observations/Observations.test.tsx` · `portal/src/portal/teacher/observations/observations.ur.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/lessons/CLAUDE.index.md`? · `portal/src/portal/teacher/observations/CLAUDE.index.md`? · `portal/src/portal/teacher/observations/CLAUDE.md`?
