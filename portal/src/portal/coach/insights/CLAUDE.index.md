# insights — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coach/insights -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `components/` | Small COACHIP pieces shared by coach insight pages and RM pages → `components/CLAUDE.md` |
| `pages/` | COACHIP page components: one file per screen → `pages/CLAUDE.md` |
| `player/` | Moment player: plays a lesson clip with plan chapters (S4) → `player/CLAUDE.md` |
| `tests/` | Goldens for each COACHIP coach page plus shared harness and fixtures → `tests/CLAUDE.md` |
| `InsightsGate.tsx` | Gate for COACHIP coach pages: needs v2 coach plus portal_coachip, else sends to Training Library (bd-sex15q.15) |
| `InsightsNav.tsx` | COACHIP menu: This week, Schools, Listen, Stats, More as phone bar and laptop rail (bd-sex15q.15) |
| `MomentSlot.tsx` | Mount point for the inline moment player on S2 and Listen, clip on tap only (bd-sex15q.15) |
| `api.ts` | Client for /api/portal/coachip/* routes (contracts API v1.4), plus home priming and error kinds |
| `copy.ts` | Generated COACHIP coach strings in English and Urdu from contracts COPY.md; never hand-edited |
| `count.tsx` | DOM count contract: Num, CountSpan, Window provider and domContract so every shown number is marked |
| `format.ts` | COACHIP formatter for dates, weekdays, n of d, clocks and plurals in English and Urdu digits |
| `paths.ts` | Every COACHIP coach address under /portal/coach/insights, ids limited to W and moment ids |
| `routes.tsx` | Route table of the coach insight pages mounted at /portal/coach/insights/* |
| `text.tsx` | How COPY strings reach screens: t(), tx() and T fill tokens, counts and dates as marked atoms |
| `types.ts` | Wire shapes of the coach insight API (contracts API v1.4); no teacher identity fields (B21) |
| `useCoachip.ts` | Hooks reading features.coachip and coachipRm from /config, fail-closed, per-user memory (bd-sex15q.15) |
| `useLoad.ts` | One read per screen returning data, error kind and retry; never cached |

## Who reads this (all, generated)
- `InsightsGate.tsx` ← imported by `portal/src/portal/coach/insights/components/Frame.tsx:4:7ac9f7b6` · `portal/src/portal/coach/insights/pages/Listen.tsx:3:7ac9f7b6` · `portal/src/portal/coach/insights/pages/MomentRoute.tsx:3:7ac9f7b6` · `portal/src/portal/coach/insights/pages/Move.tsx:5:7ac9f7b6` (+6: `python3 kg/kg.py who-reads InsightsGate.tsx`)
- `InsightsNav.tsx` ← imported by `portal/src/portal/components/PortalNavigation.tsx:14:1b10d051`
- `MomentSlot.tsx` ← imported by `portal/src/portal/coach/insights/components/ListenRow.tsx:4:efac3a07` · `portal/src/portal/coach/insights/pages/ThisWeekAside.tsx:4:efac3a07` · `portal/src/portal/coach/insights/pages/Weakness.tsx:12:efac3a07`
- `api.ts` ← imported by `portal/src/portal/coach/insights/components/NoteBanner.tsx:4:89488799` · `portal/src/portal/coach/insights/components/StateBlock.tsx:3:c2c65fbf` · `portal/src/portal/coach/insights/components/StepCard.tsx:4:f3c59eb6` · `portal/src/portal/coach/insights/components/StepRow.tsx:3:89488799` (+10: `python3 kg/kg.py who-reads api.ts`)
- `copy.ts` ← imported by `portal/src/portal/coach/profile/CoachMore.tsx:15:c789f19c` · `portal/src/portal/rm/text.tsx:8:e001d631` · `portal/src/portal/coach/insights/components/MoreCoachip.tsx:9:5bc1891d` · `portal/src/portal/coach/insights/components/StepRow.tsx:5:5bc1891d` (+5: `python3 kg/kg.py who-reads copy.ts`)
- `count.tsx` ← imported by `portal/src/portal/coachip-ui/Count.tsx:3:429b8095` · `portal/src/portal/rm/components/CircleRow.tsx:5:9f5bc583` · `portal/src/portal/rm/components/ClusterCard.tsx:2:68036beb` · `portal/src/portal/rm/components/CountLine.tsx:3:734909c6` (+32: `python3 kg/kg.py who-reads count.tsx`)
- `format.ts` ← imported by `portal/src/portal/coachip-ui/Count.tsx:4:76f6a588` · `portal/src/portal/rm/components/CircleRow.tsx:6:160e7b1a` · `portal/src/portal/rm/components/CoachGroups.tsx:4:1808efdc` · `portal/src/portal/rm/components/CountLine.tsx:4:10bc7a20` (+26: `python3 kg/kg.py who-reads format.ts`)
- `paths.ts` ← imported by `portal/src/portal/coach/insights/InsightsNav.tsx:11:6940919b` · `portal/src/portal/coach/insights/components/ListenRow.tsx:7:9a842038` · `portal/src/portal/coach/insights/components/NoteBanner.tsx:6:9a842038` · `portal/src/portal/coach/insights/components/StepCard.tsx:6:9a842038` (+9: `python3 kg/kg.py who-reads paths.ts`)
- `routes.tsx` ← imported by `portal/src/App.tsx:59:81251d5a`
- `text.tsx` ← imported by `portal/src/portal/coachip-ui/LangToggle.tsx:3:913bacae` · `portal/src/portal/rm/components/CircleRow.tsx:7:f215ee4b` · `portal/src/portal/rm/components/ClusterCard.tsx:3:f215ee4b` · `portal/src/portal/rm/components/FollowUpPicker.tsx:7:f215ee4b` (+35: `python3 kg/kg.py who-reads text.tsx`)
- `types.ts` ← imported by `portal/src/portal/coachip-ui/Count.tsx:5:9b94861d` · `portal/src/portal/rm/RmGate.tsx:5:3d087302` · `portal/src/portal/rm/api.ts:8:5f1c0dc1` · `portal/src/portal/rm/components/CoachGroups.tsx:5:f48407d3` (+42: `python3 kg/kg.py who-reads types.ts`)
- `useCoachip.ts` ← imported by `portal/src/portal/coach/card/harness.testdata.tsx:96:57b8a664` · `portal/src/portal/coach/profile/CoachMore.tsx:14:477e5217` · `portal/src/portal/coach/training/CoachAppGuard.tsx:10:8b7ea756` · `portal/src/portal/components/PortalNavigation.tsx:15:5176035e` (+1: `python3 kg/kg.py who-reads useCoachip.ts`)
- `useLoad.ts` ← imported by `portal/src/portal/rm/useRmLoad.ts:1:04df703b` · `portal/src/portal/coach/insights/pages/Listen.tsx:5:b37e540e` · `portal/src/portal/coach/insights/pages/MomentRoute.tsx:4:b37e540e` · `portal/src/portal/coach/insights/pages/Move.tsx:6:b37e540e` (+7: `python3 kg/kg.py who-reads useLoad.ts`)

## Tests (all, generated)
- `InsightsNav.tsx` ← `portal/src/portal/coachip-ui/tests/r6_coach_chrome.test.tsx`
- `api.ts` ← `portal/src/portal/coach/insights/tests/homeBoot.test.ts` · `portal/src/test/appBootPrime.test.tsx`
- `copy.ts` ← `portal/src/portal/coach/insights/player/tests/Moment.test.tsx` · `portal/src/portal/coach/insights/player/tests/MomentPlayer.test.tsx` · `portal/src/portal/coach/insights/tests/Listen.test.tsx` · `portal/src/portal/coach/insights/tests/Move.test.tsx` · `portal/src/portal/coach/insights/tests/Results.test.tsx` · `portal/src/portal/coach/insights/tests/Schools.test.tsx` (+11: `python3 kg/kg.py who-reads portal/src/portal/coach/insights/copy.ts`)
- `count.tsx` ← `portal/src/portal/coach/insights/player/tests/Moment.test.tsx` · `portal/src/portal/coach/insights/player/tests/MomentPlayer.test.tsx` · `portal/src/portal/coach/insights/tests/Listen.test.tsx` · `portal/src/portal/coach/insights/tests/Move.test.tsx` · `portal/src/portal/coach/insights/tests/Results.test.tsx` · `portal/src/portal/coach/insights/tests/Schools.test.tsx` (+8: `python3 kg/kg.py who-reads portal/src/portal/coach/insights/count.tsx`)
- `format.ts` ← `portal/src/portal/coach/insights/tests/ThisWeek.test.tsx` · `portal/src/portal/coach/insights/tests/format.test.ts` · `portal/src/portal/coach/insights/tests/r6c_results.test.tsx` · `portal/src/portal/coachip-ui/tests/Count.test.tsx` · `portal/src/portal/coachip-ui/tests/r6_rows.test.tsx` · `portal/src/portal/rm/tests/RmHome.test.tsx` (+2: `python3 kg/kg.py who-reads portal/src/portal/coach/insights/format.ts`)
- `routes.tsx` ← `portal/src/portal/coach/insights/tests/harness.tsx` · `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx`
- `types.ts` ← `portal/src/portal/coach/insights/player/tests/MomentPlayer.test.tsx` · `portal/src/portal/coach/insights/tests/r6b_fix.test.tsx`
- `useCoachip.ts` ← `portal/src/portal/coach/insights/tests/harness.tsx` · `portal/src/portal/coach/insights/tests/more.flagOff.test.tsx` · `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.dual.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.rm.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
