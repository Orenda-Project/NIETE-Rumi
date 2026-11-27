# coach — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coach -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `analytics/` | Coach Analytics: lifetime numbers over the coach's own teachers → `analytics/CLAUDE.md` |
| `card/` | School card: per-school and per-teacher coach views behind a switch → `card/CLAUDE.md` |
| `coachTraining/` | (no description yet) → `coachTraining/CLAUDE.md` |
| `disagreements/` | Coach view of teachers who answered Not accurate, with coaching suggestion → `disagreements/CLAUDE.md` |
| `feedback/` | (no description yet) → `feedback/CLAUDE.md` |
| `flow/` | (no description yet) → `flow/CLAUDE.md` |
| `home/` | Coach Home on the kit: visits today and feature tiles → `home/CLAUDE.md` |
| `insights/` | COACHIP coach screens (This week, Listen, Schools, Stats) behind portal_coachip → `insights/CLAUDE.md` |
| `observe/` | Observe frame, copy and background sender for the coach's observations → `observe/CLAUDE.md` |
| `pages/` | Coach v2 page components: schedule, observe flow, people, reports → `pages/CLAUDE.md` |
| `people/` | Coach Schools and Teachers area: rows, frame, copy and visit-status tone → `people/CLAUDE.md` |
| `profile/` | Coach More page and own profile → `profile/CLAUDE.md` |
| `report/` | (no description yet) → `report/CLAUDE.md` |
| `reports/` | Coach Reports lists and the four observation steps (form, debrief, feedback, send) → `reports/CLAUDE.md` |
| `schedule/` | Coach Schedule pieces: booked list, clash rules, tiles and copy → `schedule/CLAUDE.md` |
| `training/` | Coach app guard and read-only Training Library → `training/CLAUDE.md` |
| `CoachGate.test.tsx` | Pins CoachGate: a v2 coach with the flag sees the screen; others go to My Patch (bd-o15qnr) |
| `CoachGate.tsx` | Route gate letting only a coach with portal_coach_v2 see /portal/coach screens; others go to My Patch (bd-o15qnr) |
| `PendingBanner.test.tsx` | Pins the always-on pending-reports banner on coach pages and the ?show=waiting Reports filter (bd-o15qnr.21) |
| `canvasColours.test.tsx` | Pins coach-app colours against the v22 canvas: visit rows, feature hues, round avatars, chips (bd-o15qnr.12) |
| `copy.ts` | All English and Urdu words of the coach app v2 shared screens (bd-o15qnr) |
| `observeDraft.ts` | In-memory holder of the recording waiting on Check and send, per visit (bd-o15qnr.9) |
| `routes.test.ts` | Pins that every coach v2 route exists, is lazy-chunked and gates itself through CoachPage (bd-o15qnr) |
| `time.test.ts` | Pins coach visit time rules: any half hour plus old slots, shown as 12-hour (bd-o15qnr, bd-4404s7.3) |
| `time.ts` | Coach visit time helpers: allowed slots, 24h to 12h, Karachi day, hours-until (mirrors dashboard/lib/visit-time.js) |
| `types.ts` | TypeScript shapes of /api/portal/coach/* answers from dashboard/services/coach-v2.service.js (bd-o15qnr) |
| `ui.tsx` | Coach app v2 building blocks: Card, Chip, PendingBanner, CoachPage, useLoad, 56px targets (bd-o15qnr) |
| `useCoachV2.test.ts` | Pins useCoachV2: true only for config coachV2 true, fail-closed, per-user memory (bd-o15qnr) |
| `useCoachV2.ts` | Hook reading /config for portal_coach_v2; null while loading, true only for literal true (bd-o15qnr) |
| `uxMusts.test.tsx` | (unmapped) |

## Who reads this (all, generated)
- `CoachGate.tsx` ← imported by `portal/src/portal/coach/card/SlimHome.tsx:10:561961fe` · `portal/src/portal/coach/coachTraining/CoachTrainingModulePage.tsx:3:561961fe` · `portal/src/portal/coach/coachTraining/CoachTrainingPage.tsx:1:561961fe` · `portal/src/portal/coach/disagreements/frame.tsx:5:561961fe` (+13: `python3 kg/kg.py who-reads CoachGate.tsx`)
- `copy.ts` ← imported by `portal/src/portal/coach/ui.tsx:9:748640c8`
- `observeDraft.ts` ← imported by `portal/src/portal/coach/observe/ObservationNotes.tsx:6:5d7ef35b` · `portal/src/portal/coach/observe/PhoneRecord.tsx:12:d86ff27b` · `portal/src/portal/coach/observe/sender.ts:9:9d38b364` · `portal/src/portal/coach/pages/CoachAttach.tsx:13:1e9ccad8` (+2: `python3 kg/kg.py who-reads observeDraft.ts`)
- `time.ts` ← imported by `portal/src/portal/teacher/principal/HomeV6.tsx:17:8ff16d19` · `portal/src/portal/teacher/principal/ObserveV6.tsx:21:8ff16d19` · `portal/src/portal/teacher/principal/observe.tsx:6:8ff16d19` · `portal/src/portal/coach/flow/BookedRow.tsx:11:6e4fb0ef` (+15: `python3 kg/kg.py who-reads time.ts`)
- `types.ts` ← imported by `portal/src/portal/services/api.ts:14:e1bc00c4` · `portal/src/portal/teacher/principal/NewVisit.tsx:6:f956b29a` · `portal/src/portal/teacher/principal/ObserveV6.tsx:22:369aa622` · `portal/src/portal/teacher/principal/PickTeacher.tsx:20:477d60b5` (+27: `python3 kg/kg.py who-reads types.ts`)
- `ui.tsx` ← imported by `portal/src/portal/teacher/principal/HomeV6.tsx:16:48115d2d` · `portal/src/portal/teacher/principal/MySchool.tsx:2:89e0875d` · `portal/src/portal/teacher/principal/NewVisit.tsx:4:47b54df2` · `portal/src/portal/teacher/principal/ObserveV6.tsx:20:f9f21354` (+58: `python3 kg/kg.py who-reads ui.tsx`)
- `useCoachV2.ts` ← imported by `portal/src/portal/components/PortalLayout.tsx:9:039ef563` · `portal/src/portal/components/PortalNavigation.tsx:12:039ef563` · `portal/src/portal/components/assess/AssessActions.tsx:3:d0b2fe8b` · `portal/src/portal/pages/LeaderHome.tsx:10:51ff04bb` (+3: `python3 kg/kg.py who-reads useCoachV2.ts`)

## Tests (all, generated)
- `CoachGate.tsx` ← `portal/src/portal/coach/CoachGate.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.loop.test.tsx`
- `copy.ts` ← `portal/src/portal/coach/pages/CoachRound3.test.tsx`
- `observeDraft.ts` ← `portal/src/portal/coach/flow/v6.test.tsx` · `portal/src/portal/coach/observe/inAppBack.test.tsx` · `portal/src/portal/coach/observe/keptLink.test.tsx` · `portal/src/portal/coach/observe/keptNeedsYou.test.tsx` · `portal/src/portal/coach/observe/resumeKept.test.tsx` · `portal/src/portal/coach/observe/sender.test.ts` (+13: `python3 kg/kg.py who-reads portal/src/portal/coach/observeDraft.ts`)
- `time.ts` ← `portal/src/portal/coach/card/flowV2.test.tsx` · `portal/src/portal/coach/flow/concept1.test.tsx` · `portal/src/portal/coach/flow/flowV2.test.tsx` · `portal/src/portal/coach/flow/inProgress45.test.tsx` · `portal/src/portal/coach/flow/stopped245.test.tsx` · `portal/src/portal/coach/flow/v6.test.tsx` (+5: `python3 kg/kg.py who-reads portal/src/portal/coach/time.ts`)
- `types.ts` ← `portal/src/portal/coach/pages/CoachObservation.obs612.test.tsx` · `portal/src/portal/coach/reports/data.test.ts` · `portal/src/portal/coach/schedule/model.test.ts`
- `ui.tsx` ← `portal/src/portal/coach/PendingBanner.test.tsx` · `portal/src/portal/coach/canvasColours.test.tsx` · `portal/src/portal/coach/pages/CoachFeedback1.test.tsx` · `portal/src/portal/coach/pages/CoachReports.test.tsx` · `portal/src/portal/coach/reports/CoachReportsAll.test.tsx`
- `useCoachV2.ts` ← `portal/src/portal/coach/CoachGate.test.tsx` · `portal/src/portal/coach/insights/tests/harness.tsx` · `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx` · `portal/src/portal/coach/people/schoolsReady.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.dual.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.loop.test.tsx` (+11: `python3 kg/kg.py who-reads portal/src/portal/coach/useCoachV2.ts`)

## Related (all, generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/coach/home/CLAUDE.md`? · `portal/src/portal/hooks/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
