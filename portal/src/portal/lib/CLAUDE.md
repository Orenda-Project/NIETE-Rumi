# lib — Portal helpers: recording, uploads, routing, flags, API-adjacent logic
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/lib kg=c2b5da58572e gen=ba497d820117 overflow=242 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `recordingSession.tsx` — provider holding the live lesson recording above the routes; start of the recorder chain
- `coachingSend.ts` — Send to Digital Coach: R2 presign/PUT then start; read before touching uploads
- Tests sit beside sources (*.test.ts(x)), vitest jsdom: `cd portal && npx vitest run src/portal/lib (covers every lib/*.test.ts(x), incl. live/ and assess/)`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `assess/` | Coach Learning-assessment support: results maths, copy, offline visit store → `assess/CLAUDE.md` |
| `childTest/` | Coach child-test block machine, check form, local recordings and uploader → `childTest/CLAUDE.md` |
| `live/` | Live moves while a teacher records: tick state and Soniox stream tee → `live/CLAUDE.md` |
| … | 79 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `recordingSession.tsx` ← imported by `portal/src/App.tsx:27:274089c5` · `portal/src/portal/coach/profile/CoachMore.tsx:4:63eb10bd` (+20)
- `coachingUpload.ts` ← imported by `portal/src/portal/coach/observe/format.ts:2:b413a3d0` · `portal/src/portal/coach/observe/sender.ts:3:5ddbff68` (+17)
- … 46 more → `CLAUDE.index.md`

## Never (human)
- Keep leaderRole.ts in lock-step with the bot's LEADER_ROLES and dashboard/lib/leader-role.js (lib/leaderRole.ts:10)
- scoreBands.ts is a copy of the bot's bot/shared/config/score-bands.js; change both or neither (lib/scoreBands.ts:8)
- Browser upload rules must stay in step with the bot's KINDS list (lib/coachingUpload.ts:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/newui/coaching/RecordPage.test.tsx` (coachingUpload.ts, keepAwake.ts, lessonHandoff.ts, recordingSession.tsx, recordingStore.ts, recordingSupport.ts, useNewUi.ts)
- `portal/src/portal/newui/coaching/RecordPage.live.test.tsx` (coachingUpload.ts, lessonHandoff.ts, recordingSession.tsx, recordingStore.ts, recordingSupport.ts, useNewUi.ts)
- … 126 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/views/CLAUDE.md`? · `docs/app-funnel-telemetry.md`? · `portal/src/portal/CLAUDE.md`?
