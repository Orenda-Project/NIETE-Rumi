# coach — Coach app v2 root: gate, flag hook, shared UI, copy and time rules
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach kg=985d54a3f034 gen=55fdf6b8cd9e overflow=63 rendered=2026-11-25 kg.py=1.1.0 -->

## Entry points
- `CoachGate.tsx` — only a coach with portal_coach_v2 sees /portal/coach screens
- `ui.tsx` — shared coach building blocks (Card, Chip, CoachPage, useLoad)
- Tests colocated, vitest: `cd portal && npx vitest run src/portal/coach` (also runs every subdir)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 16 sub-dirs, each with `CLAUDE.md` | `analytics/` · `card/` · `coachTraining/` · `disagreements/` · `feedback/` · `flow/` · `home/` · `insights/` · `observe/` · `pages/` · `people/` · `profile/` · `report/` · `reports/` · `schedule/` · `training/` |
| `ui.tsx` | Coach app v2 building blocks: Card, Chip, PendingBanner, CoachPage, useLoad, 56px targets (bd-o15qnr) |
| `types.ts` | TypeScript shapes of /api/portal/coach/* answers from dashboard/services/coach-v2.service.js (bd-o15qnr) |
| … | 27 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `ui.tsx` ← imported by `portal/src/portal/teacher/principal/HomeV6.tsx:16:48115d2d` · `portal/src/portal/teacher/principal/MySchool.tsx:2:89e0875d` (+59)
- `types.ts` ← imported by `portal/src/portal/services/api.ts:13:e1bc00c4` · `portal/src/portal/teacher/principal/NewVisit.tsx:6:f956b29a` (+29)
- `time.ts` ← imported by `portal/src/portal/teacher/principal/HomeV6.tsx:17:8ff16d19` · `portal/src/portal/teacher/principal/ObserveV6.tsx:21:8ff16d19` (+16)
- … 4 more → `CLAUDE.index.md`

## Never (human)
- Flags are fail-closed: only a literal true turns v2 on (useCoachV2.ts:9)
- Visit times mirror dashboard/lib/visit-time.js; keep them in step (time.ts:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/CoachGate.test.tsx` (CoachGate.tsx, useCoachV2.ts)
- `portal/src/portal/coach/flow/v6.test.tsx` (observeDraft.ts, time.ts)
- … 47 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/coach/home/CLAUDE.md`? · `portal/src/portal/hooks/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
