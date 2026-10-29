# insights — COACHIP coach screens (This week, Listen, Schools, Stats) behind portal_coachip
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/insights kg=c8c478ee1f3a gen=8bb29741182d overflow=49 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `api.ts` — client for /api/portal/coachip/* (dashboard routes/portal-coachip.routes.js)
- `InsightsGate.tsx` — switch-off means nothing renders and no request fires
- Tests in tests/ and player/tests/; run `cd portal && npx vitest run src/portal/coach/insights`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `components/` | Small COACHIP pieces shared by coach insight pages and RM pages → `components/CLAUDE.md` |
| `pages/` | COACHIP page components: one file per screen → `pages/CLAUDE.md` |
| `player/` | Moment player: plays a lesson clip with plan chapters (S4) → `player/CLAUDE.md` |
| `tests/` | Goldens for each COACHIP coach page plus shared harness and fixtures → `tests/CLAUDE.md` |
| `count.tsx` | DOM count contract: Num, CountSpan, Window provider and domContract so every shown number is marked |
| … | 12 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `types.ts` ← imported by `portal/src/portal/coachip-ui/Count.tsx:5:9b94861d` · `portal/src/portal/rm/RmGate.tsx:4:3d087302` (+44)
- `text.tsx` ← imported by `portal/src/portal/coachip-ui/LangToggle.tsx:3:913bacae` · `portal/src/portal/rm/components/CircleRow.tsx:7:f215ee4b` (+37)
- `count.tsx` ← imported by `portal/src/portal/coachip-ui/Count.tsx:3:429b8095` · `portal/src/portal/rm/components/CircleRow.tsx:5:9f5bc583` (+34)
- `format.ts` ← imported by `portal/src/portal/coachip-ui/Count.tsx:4:76f6a588` · `portal/src/portal/rm/components/CircleRow.tsx:6:160e7b1a` (+27)
- … 9 more → `CLAUDE.index.md`

## Never (human)
- copy.ts is generated from contracts COPY.md; never hand-edit (copy.ts:3)
- A teacher's code_id travels only in a POST body, never a path (api.ts:4, B21)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/insights/player/tests/MomentPlayer.test.tsx` (copy.ts, count.tsx, types.ts)
- `portal/src/portal/coach/insights/tests/ThisWeek.test.tsx` (copy.ts, count.tsx, format.ts)
- … 28 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.md`?
