# coach — Coach app v2 root: gate, flag hook, shared UI, copy and time rules
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach kg=dfafb27c487a gen=459604e06fed overflow=41 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `CoachGate.tsx` — only a coach with portal_coach_v2 sees /portal/coach screens
- `ui.tsx` — shared coach building blocks (Card, Chip, CoachPage, useLoad)
- Tests colocated, vitest: `cd portal && npx vitest run src/portal/coach` (also runs every subdir)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 12 sub-dirs, each with `CLAUDE.md` | `analytics/` · `card/` · `disagreements/` · `home/` · `insights/` · `observe/` · `pages/` · `people/` · `profile/` · `reports/` · `schedule/` · `training/` |
| `ui.tsx` | Coach app v2 building blocks: Card, Chip, PendingBanner, CoachPage, useLoad, 56px targets (bd-o15qnr) |
| `types.ts` | TypeScript shapes of /api/portal/coach/* answers from dashboard/services/coach-v2.service.js (bd-o15qnr) |
| `useCoachV2.ts` | Hook reading /config for portal_coach_v2; null while loading, true only for literal true (bd-o15qnr) |
| … | 21 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `ui.tsx` ← imported by `portal/src/portal/coach/analytics/CoachAnalytics.tsx:11:3065a692` · `portal/src/portal/coach/card/FeatureGridPage.tsx:4:a108a8ec` (+37)
- `types.ts` ← imported by `portal/src/portal/services/api.ts:13:e1bc00c4` · `portal/src/portal/coach/analytics/model.ts:1:ed880149` (+19)
- `CoachGate.tsx` ← imported by `portal/src/portal/coach/card/SlimHome.tsx:9:561961fe` · `portal/src/portal/coach/disagreements/frame.tsx:5:561961fe` (+9)
- `time.ts` ← imported by `portal/src/portal/coach/home/VisitCards.tsx:5:6e4fb0ef` · `portal/src/portal/coach/pages/CoachNewVisit.tsx:8:2855461c` (+6)
- … 3 more → `CLAUDE.index.md`

## Never (human)
- Flags are fail-closed: only a literal true turns v2 on (useCoachV2.ts:9)
- Visit times mirror dashboard/lib/visit-time.js; keep them in step (time.ts:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/CoachGate.test.tsx` (CoachGate.tsx, useCoachV2.ts)
- `portal/src/portal/coach/pages/CoachRound3.test.tsx` (copy.ts, time.ts)
- … 28 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/hooks/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
