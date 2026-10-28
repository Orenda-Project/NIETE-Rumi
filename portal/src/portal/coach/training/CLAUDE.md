# training — Coach app guard and read-only Training Library
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/training kg=e373b2256c37 gen=756181c9179b overflow=21 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `appReady.ts` — allow-list of ready coach features, menu and landing
- `CoachAppGuard.tsx` — redirects a v2 coach off pages that are not ready
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/training`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `appReady*` | 3 files; most used `appReady.ts`: Allow-list of coach app v2 features, menu, landing and path-ready rules (bd-s42dye.2) |
| `CLAUDE.index.md` | (unmapped) |
| `CoachAppGuard*` | 5 files; most used `CoachAppGuard.dual.test.tsx`: Pins where a user with both coachip and coachipRm lands, by coachesHere (fix-r5 s5) |
| `CLAUDE.md` | (unmapped) |
| `nav.test.tsx` | Pins coach menu on ready features: Training Library, Lesson Plans, My schools, More |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `appReady.ts` ← imported by `portal/src/portal/coach/insights/InsightsGate.tsx:6:f4172066` · `portal/src/portal/coach/insights/paths.ts:1:72012f5c` (+8)
- `CoachAppGuard.tsx` ← imported by `portal/src/App.tsx:25:dd40c5c7` · `portal/src/portal/coach/card/harness.testdata.tsx:43:4b3728bb`
- `copy.ts` ← imported by `portal/src/portal/teacher/copyRegistry.ts:7:3ff9d825` · `portal/src/portal/coach/training/LibraryPages.tsx:21:f965f797`
- … 2 more → `CLAUDE.index.md`

## Never (human)
- Library reads only the four library endpoints; no writes (training/libraryApi.ts:4, bd-s42dye.1)
- Guard and CoachGate must agree on v2 or the coach ping-pongs (CoachAppGuard.loop.test.tsx:12)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx` (CoachAppGuard.tsx, appReady.ts)
- `portal/src/portal/coach/people/schoolsReady.test.tsx` (CoachAppGuard.tsx, appReady.ts)
- … 13 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.index.md`? · `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/coach/card/CLAUDE.index.md`? · `portal/src/portal/coach/card/CLAUDE.md`? · `portal/src/portal/coach/insights/CLAUDE.index.md`? · `portal/src/portal/coach/insights/tests/CLAUDE.index.md`? (+14)
