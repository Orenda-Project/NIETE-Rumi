# observations — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/observations -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `Observations.test.tsx` | Pins Observations page: next visit, in-progress stage only, no visit state, reports and visit report (bd-fmf24g.4) |
| `ObservationsHome.tsx` | Observations main page (Next visit, In progress, Reports) and the coach-visit report page wrapper |
| `api.ts` | Observations reads: GET /teacher/visits and coach visits from GET /coaching-sessions, with reportGroups shaping |
| `checks.test.tsx` | Style and copy guard for the Observations page: logical start/end, motion-safe, label-only copy (bd-fmf24g.4) |
| `copy.ts` | English and Urdu words for the Observations screens (OBSERVATIONS bilingual), registered as COPY_ENTRY |
| `observations.ur.test.tsx` | Renders Observations main page and a visit report in Urdu with the bot's Urdu band words (bd-fmf24g.13.2) |
| `paths.ts` | Path builders for Observations: OBS_HOME and the report path reusing the shared coaching ReportPage |
| `routes.tsx` | Registers lazy Observations home and visit-report pages under /portal/teacher/observations via TeacherGate |

## Who reads this (all, generated)
- `ObservationsHome.tsx` ← imported by `portal/src/portal/teacher/principal/PrincipalObservations.tsx:17:bc14f843` · `portal/src/portal/teacher/observations/routes.tsx:6:af920adc`
- `api.ts` ← imported by `portal/src/portal/teacher/observations/ObservationsHome.tsx:18:f775a727`
- `copy.ts` ← imported by `portal/src/portal/teacher/principal/PickTeacher.tsx:9:b4a946db` · `portal/src/portal/teacher/principal/PrincipalObservations.tsx:16:b4a946db` · `portal/src/portal/teacher/observations/ObservationsHome.tsx:19:376d03b0`
- `paths.ts` ← imported by `portal/src/portal/teacher/coaching/CoachingHome.tsx:20:614029b8` · `portal/src/portal/teacher/home/chips.ts:4:614029b8` · `portal/src/portal/teacher/home/look/cardWords.ts:4:55f11086` · `portal/src/portal/teacher/principal/PickTeacher.tsx:10:224e17b0` (+4: `python3 kg/kg.py who-reads paths.ts`)

## Tests (all, generated)
- `ObservationsHome.tsx` ← `portal/src/portal/teacher/observations/Observations.test.tsx` · `portal/src/portal/teacher/observations/observations.ur.test.tsx`
- `api.ts` ← `portal/src/portal/teacher/observations/observations.ur.test.tsx`
- `copy.ts` ← `portal/src/portal/teacher/observations/Observations.test.tsx` · `portal/src/portal/teacher/observations/checks.test.tsx` · `portal/src/portal/teacher/observations/observations.ur.test.tsx`
- `paths.ts` ← `portal/src/portal/teacher/observations/Observations.test.tsx` · `portal/src/portal/teacher/observations/observations.ur.test.tsx` · `portal/src/portal/teacher/principal/PrincipalObserve.test.tsx` · `portal/src/portal/teacher/principal/PrincipalV2Observe.test.tsx`
- `routes.tsx` ← `portal/src/portal/teacher/observations/Observations.test.tsx` · `portal/src/portal/teacher/observations/observations.ur.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/teacher/CLAUDE.md`?
