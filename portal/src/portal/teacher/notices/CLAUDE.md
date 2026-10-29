# notices — Shell notices: Being made strip, ready banner, Home Ready for you, evening reminder card
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/notices kg=9a5270121f18 gen=76eb5cc687c7 overflow=38 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `tracker.ts` — app-wide job tracker; `NoticeHost.tsx` — strip and banners mounted by PortalLayout
- `serverNotices.ts` — server list client; `RemindCard.tsx` — web-push opt-in card
- `tracker.test.ts` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/notices`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `tracker.ts` | App-wide tracker polling papers and grades 6-12 plan renders once, persisting to storage; feeds strip, banner and Home |
| `wiring.test.tsx` | Pins that Check and make and plan pages hand jobs to the shell tracker, and the waiting pages' words (bd-fmf24g.15) |
| `model.ts` | Notice item model: kinds (paper, lesson plan, observation), states, ids, expected times and poll intervals |
| … | 14 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `tracker.ts` ← imported by `portal/src/portal/coach/observe/ObservePage.tsx:5:72d45190` · `portal/src/portal/coach/observe/sender.ts:7:240a3291` (+6)
- `copy.ts` ← imported by `portal/src/portal/coach/pages/CoachSending.tsx:4:c0782935` · `portal/src/portal/teacher/assessment/RequestPage.tsx:31:a1ddbfc0` (+3)
- `model.ts` ← imported by `portal/src/portal/coach/observe/sender.ts:6:ed644ba8` · `portal/src/portal/teacher/assessment/useJobs.ts:5:a8cb86da` (+3)
- … 6 more → `CLAUDE.index.md`

## Never (human)
- A coach's observation upload lives in the tab only: never written to storage (tracker.ts:118, bd-4404s7.4)
- RemindCard draws only on a push-capable plain browser and when the server says portal:true (RemindCard.tsx:13-14)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/assessment/fde.r8.banner.test.tsx` (NoticeHost.tsx, model.ts, tracker.ts)
- `portal/src/portal/teacher/notices/NoticeHost.test.tsx` (NoticeHost.tsx, model.ts, tracker.ts)
- … 18 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/remind/CLAUDE.md`?
