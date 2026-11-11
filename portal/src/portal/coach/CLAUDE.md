# coach — Coach app v2 root: gate, flag hook, shared UI, copy and time rules
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach kg=43e4e84b1d63 gen=156b5a8a4598 overflow=44 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `CoachGate.tsx` — only a coach with portal_coach_v2 sees /portal/coach screens
- `ui.tsx` — shared coach building blocks (Card, Chip, CoachPage, useLoad)
- Tests colocated, vitest: `cd portal && npx vitest run src/portal/coach` (also runs every subdir)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 15 sub-dirs, each with `CLAUDE.md` | `analytics/` · `card/` · `coachTraining/` · `disagreements/` · `feedback/` · `home/` · `insights/` · `observe/` · `pages/` · `people/` · `profile/` · `report/` · `reports/` · `schedule/` · `training/` |
| `ui.tsx` | Coach app v2 building blocks: Card, Chip, PendingBanner, CoachPage, useLoad, 56px targets (bd-o15qnr) |
| `types.ts` | TypeScript shapes of /api/portal/coach/* answers from dashboard/services/coach-v2.service.js (bd-o15qnr) |
| `uxMusts.test.tsx` | (unmapped) |
| … | 25 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `ui.tsx` ← imported by `portal/src/portal/teacher/principal/MySchool.tsx:3:89e0875d` · `portal/src/portal/teacher/principal/PickTeacher.tsx:12:7eccd2ae` (+47)
- `types.ts` ← imported by `portal/src/portal/services/api.ts:13:e1bc00c4` · `portal/src/portal/teacher/principal/PickTeacher.tsx:20:477d60b5` (+22)
- `CoachGate.tsx` ← imported by `portal/src/portal/coach/card/SlimHome.tsx:9:561961fe` · `portal/src/portal/coach/coachTraining/CoachTrainingModulePage.tsx:3:561961fe` (+14)
- … 4 more → `CLAUDE.index.md`

## Never (human)
- Flags are fail-closed: only a literal true turns v2 on (useCoachV2.ts:9)
- Visit times mirror dashboard/lib/visit-time.js; keep them in step (time.ts:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/CoachGate.test.tsx` (CoachGate.tsx, useCoachV2.ts)
- `portal/src/portal/coach/pages/CoachRound3.test.tsx` (copy.ts, time.ts)
- … 29 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/coach/home/CLAUDE.md`? · `portal/src/portal/coach/observe/CLAUDE.md`? · `portal/src/portal/coach/reports/CLAUDE.md`? · `portal/src/portal/coach/schedule/CLAUDE.md`? · `portal/src/portal/hooks/CLAUDE.md`? (+1)
