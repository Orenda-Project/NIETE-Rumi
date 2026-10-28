# share — Client for sharing a paper or plan to WhatsApp from the teacher app

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/share kg=75d1f128517a gen=b2aa712a42fe overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `api.ts` — shareToWhatsApp and useShareAvailable against /api/portal/share; used by ../ui/ShareActions.tsx
- No tests here; ../ui/ShareActions.test.tsx covers it (`cd portal && npx vitest run src/portal/teacher/ui`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `api.ts` | Share API: shareToWhatsApp and useShareAvailable on /api/portal/share; unreachable server is failed, never sent |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- `api.ts` ← imported by `portal/src/portal/teacher/assessment/PaperPage.tsx:12:49f449b2` · `portal/src/portal/teacher/assessment/RequestPage.tsx:9:49f449b2` (+2)

## Never (human)
- Failing to reach the server is `failed`, never `sent` (api.ts:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/coaching/ReportPage.iabRows.test.tsx` (api.ts)
- `portal/src/portal/teacher/coaching/ReportPage.quiz.test.tsx` (api.ts)
- `portal/src/portal/teacher/coaching/ReportPage.test.tsx` (api.ts)
- `portal/src/portal/teacher/coaching/ReportPage.videoReco.test.tsx` (api.ts)
- `portal/src/portal/teacher/lessons/LessonPages.test.tsx` (api.ts)
- `portal/src/portal/teacher/lessons/leaders.test.tsx` (api.ts)

## Related (generated)
- docs: `portal/src/portal/teacher/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/coaching/CLAUDE.index.md`? · `portal/src/portal/teacher/lessons/CLAUDE.index.md`? · `portal/src/portal/teacher/share/CLAUDE.md`?
