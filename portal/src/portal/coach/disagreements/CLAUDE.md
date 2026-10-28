# disagreements — Coach view of teachers who answered Not accurate, with coaching suggestion
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/disagreements kg=7690c1d484c6 gen=215ecfc600fb overflow=59 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `DisagreementsPage.tsx` — To do and Done list; `DisagreementCard.tsx` is one teacher
- `api.ts` — client for /api/portal/coach/disagreements (routes/coach-disagreements.routes.js)
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/disagreements`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `api.ts` | Client for /api/portal/coach/disagreements (dashboard/routes/coach-disagreements.routes.js) and its shapes |
| `copy.ts` | English and Urdu words of the disagreement list and card screens (bd-tbprit.3) |
| `api.test.ts` | Pins the disagreements API client: clip URL, routes, fail-closed flag, copy, savePlan and suggestion posts |
| `CLAUDE.index.md` | (unmapped) |
| `cardParts.tsx` | Card pieces: clip provider, Listen button, grader item row, reason block and full report link |
| … | 30 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `api.ts` ← imported by `portal/src/portal/coach/disagreements/CoachingBox.tsx:5:45720fde` · `portal/src/portal/coach/disagreements/DisagreementCard.tsx:7:8a044fee` (+11)
- `copy.ts` ← imported by `portal/src/portal/coach/disagreements/CoachingBox.tsx:7:8edf7546` · `portal/src/portal/coach/disagreements/DisagreementCard.tsx:8:8edf7546` (+9)
- … 16 more → `CLAUDE.index.md`

## Never (human)
- Clips are streamed by the server, never offered as a download (api.ts:9)
- Language pill writes through the one writer useLanguageSwitch (disagreements/appBar.tsx:12)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/disagreements/CoachingBox.test.tsx` (CoachingBox.tsx, api.ts, cardParts.tsx)
- `portal/src/portal/coach/disagreements/api.test.ts` (api.ts, coachingCopy.ts, copy.ts)
- … 13 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/lib/CLAUDE.index.md`? · `portal/src/portal/coach/CLAUDE.index.md`? · `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/coach/disagreements/CLAUDE.index.md`? · `portal/src/portal/coach/disagreements/CLAUDE.md`? · `portal/src/portal/lib/CLAUDE.index.md`? (+6)
