# notices — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/notices -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `NoticeHost.test.tsx` | Pins the shell notices on a real screen: Being made strip, ready and failed banners, tap targets (bd-fmf24g.15) |
| `NoticeHost.tsx` | Shell-mounted notices on every teacher v2 screen: Being made strip above the menu, ready/failed banner, tap handling |
| `ReadyForYou.test.tsx` | Pins Home's Ready for you: server-listed unopened items within 24 weekday hours, max 2, gone once opened (bd-fmf24g.15) |
| `ReadyForYou.tsx` | Home card listing finished papers and lesson plans not yet opened (max 2 plus See all); Open tells the server |
| `RemindCard.test.tsx` | Pins the Evening reminder card: drawn only on a plain push-capable browser when the server says portal:true |
| `RemindCard.tsx` | Home 'Evening reminder' web-push opt-in card (portal_push_remind): /sw.js plus POST subscribe; hidden in apps |
| `checks.test.tsx` | Design-rule guard for notices: start/end only, motion-safe, no words in components, 56px targets, label-only copy |
| `copy.ts` | English and Urdu sentence words for notices not covered by the kit labels, registered as COPY_ENTRY (bd-fmf24g.15) |
| `merge.test.ts` | Tests mergeServer folding the server's items into the device's followed items so Home survives refresh or a new phone |
| `model.ts` | Notice item model: kinds (paper, lesson plan, observation), states, ids, expected times and poll intervals |
| `observation.test.tsx` | Pins a coach's background observation upload as a third notice kind: pushed not polled, never persisted (bd-4404s7.4) |
| `serverNotices.ts` | Client for the server's notices routes: fetchNotices and reportNotice, mapping ISO times to ms and item addresses |
| `tracker.test.ts` | Tests the shell job tracker: stable ids, paper and plan ready/failed transitions, error codes, network mocked only |
| `tracker.ts` | App-wide tracker polling papers and grades 6-12 plan renders once, persisting to storage; feeds strip, banner and Home |
| `useNoticeWords.ts` | Hook giving a notice's kind, class line and title words in the teacher's language for strip, banner and Home |
| `useOpenNotice.ts` | Hook opening a finished notice item: paper page or lesson-plan viewer with DC prefill, for banner and Home card |
| `wiring.test.tsx` | Pins that Check and make and plan pages hand jobs to the shell tracker, and the waiting pages' words (bd-fmf24g.15) |

## Who reads this (all, generated)
- `NoticeHost.tsx` ← imported by `portal/src/portal/components/PortalLayout.tsx:24:6a75df37`
- `ReadyForYou.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:8:23ed8f25` · `portal/src/portal/teacher/pages/Home.tsx:11:4c5cbbf0`
- `RemindCard.tsx` ← imported by `portal/src/portal/teacher/home/look/LookHome.tsx:10:d27b9a04` · `portal/src/portal/teacher/pages/Home.tsx:13:3d38321c`
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachSending.tsx:4:c0782935` · `portal/src/portal/teacher/assessment/RequestPage.tsx:31:a1ddbfc0` · `portal/src/portal/teacher/coaching/NewObservation.tsx:28:a1ddbfc0` · `portal/src/portal/teacher/lessons/PreparingPage.tsx:9:a1ddbfc0` (+1: `python3 kg/kg.py who-reads copy.ts`)
- `model.ts` ← imported by `portal/src/portal/coach/observe/sender.ts:6:ed644ba8` · `portal/src/portal/teacher/assessment/useJobs.ts:5:a8cb86da` · `portal/src/portal/teacher/notices/NoticeHost.tsx:18:e50cc637` · `portal/src/portal/teacher/notices/serverNotices.ts:4:f3309312` (+1: `python3 kg/kg.py who-reads model.ts`)
- `serverNotices.ts` ← imported by `portal/src/portal/teacher/notices/tracker.ts:8:e14efeb5`
- `tracker.ts` ← imported by `portal/src/portal/coach/observe/ObservePage.tsx:5:72d45190` · `portal/src/portal/coach/observe/sender.ts:7:240a3291` · `portal/src/portal/teacher/assessment/useJobs.ts:6:e91cf5c8` · `portal/src/portal/teacher/home/look/LookHome.tsx:9:353dd602` (+4: `python3 kg/kg.py who-reads tracker.ts`)
- `useNoticeWords.ts` ← imported by `portal/src/portal/teacher/notices/NoticeHost.tsx:16:f9ce316e` · `portal/src/portal/teacher/notices/ReadyForYou.tsx:3:f9ce316e`
- `useOpenNotice.ts` ← imported by `portal/src/portal/teacher/notices/NoticeHost.tsx:17:a963b389` · `portal/src/portal/teacher/notices/ReadyForYou.tsx:4:a963b389`

## Tests (all, generated)
- `NoticeHost.tsx` ← `portal/src/portal/teacher/assessment/fde.r8.banner.test.tsx` · `portal/src/portal/teacher/notices/NoticeHost.test.tsx` · `portal/src/portal/teacher/notices/observation.test.tsx`
- `ReadyForYou.tsx` ← `portal/src/portal/teacher/notices/ReadyForYou.test.tsx`
- `RemindCard.tsx` ← `portal/src/portal/teacher/notices/RemindCard.test.tsx`
- `copy.ts` ← `portal/src/portal/coach/pages/CoachObserveFlow.test.tsx` · `portal/src/portal/teacher/notices/checks.test.tsx` · `portal/src/portal/teacher/notices/wiring.test.tsx`
- `model.ts` ← `portal/src/portal/teacher/assessment/fde.r8.banner.test.tsx` · `portal/src/portal/teacher/notices/NoticeHost.test.tsx` · `portal/src/portal/teacher/notices/merge.test.ts` · `portal/src/portal/teacher/notices/observation.test.tsx` · `portal/src/portal/teacher/notices/tracker.test.ts` · `portal/src/portal/teacher/notices/wiring.test.tsx`
- `tracker.ts` ← `portal/src/portal/coach/observe/sender.test.ts` · `portal/src/portal/coach/pages/CoachBack.test.tsx` · `portal/src/portal/coach/pages/CoachObserveFlow.test.tsx` · `portal/src/portal/coach/pages/CoachOwnPlan.test.tsx` · `portal/src/portal/components/PortalLayout.notices.test.tsx` · `portal/src/portal/teacher/assessment/fde.r5.test.tsx` (+11: `python3 kg/kg.py who-reads portal/src/portal/teacher/notices/tracker.ts`)

## Related (all, generated)
- docs: `portal/src/portal/coach/observe/CLAUDE.index.md`? · `portal/src/portal/coach/pages/CLAUDE.index.md`? · `portal/src/portal/components/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.index.md`? · `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/assessment/CLAUDE.index.md`? · `portal/src/portal/teacher/lessons/CLAUDE.index.md`? · `portal/src/portal/teacher/notices/CLAUDE.index.md`? · `portal/src/portal/teacher/notices/CLAUDE.md`? · `portal/src/portal/teacher/remind/CLAUDE.md`? · `portal/src/portal/teacher/ui/CLAUDE.index.md`?
