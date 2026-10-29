# rm — RM (regional manager) sector screens behind portal_coachip_rm
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/rm kg=d532378f242a gen=2e2ae4412267 overflow=26 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `RmGate.tsx` — one GET /coachip/me per mount; renders only when rm is set
- `api.ts` — client for /api/portal/coachip/rm/* (dashboard routes/portal-coachip.routes.js)
- Tests in tests/; run `cd portal && npx vitest run src/portal/rm`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `components/` | RM page pieces: cards, rows, follow-up picker and frame → `components/CLAUDE.md` |
| `pages/` | RM page components: Sector, Coaches, one coach, Circle, Stats → `pages/CLAUDE.md` |
| `tests/` | Goldens and rules tests for the RM screens → `tests/CLAUDE.md` |
| `text.tsx` | How RM COPY strings reach screens: rt() and rtx() with the count contract |
| `rm.copy.ts` | Generated RM strings, English and Urdu, from contracts COPY.md; never hand-edited |
| `types.ts` | Wire shapes of RM payloads (R17-R21); imports coach fragments and holds no teacher data |
| `paths.ts` | Every RM address under /portal/rm; path ids are coach users.id only |
| … | 7 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `text.tsx` ← imported by `portal/src/portal/rm/RmGate.tsx:10:acd18cca` · `portal/src/portal/rm/RmNav.tsx:11:acd18cca` (+14)
- `types.ts` ← imported by `portal/src/portal/rm/api.ts:9:e90fdcfa` · `portal/src/portal/rm/components/CircleRow.tsx:9:6bc27568` (+9)
- `api.ts` ← imported by `portal/src/portal/rm/RmGate.tsx:6:363724b9` · `portal/src/portal/rm/components/CircleRow.tsx:8:dbdfd669` (+6)
- `paths.ts` ← imported by `portal/src/portal/coach/insights/components/MoreCoachip.tsx:10:86f47e88` · `portal/src/portal/coach/profile/CoachMore.tsx:16:da52aa9a` (+6)
- … 7 more → `CLAUDE.index.md`

## Never (human)
- POST bodies carry exactly the contract's keys, no free text (api.ts:4, A11)
- RM pages sit behind RmGate, never CoachGate (RmGate.tsx:10)
- rm.copy.ts is generated; never hand-edit (rm.copy.ts:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/rm/tests/r6c_fix.test.tsx` (held.ts, rm.copy.ts, routes.tsx)
- `portal/src/portal/coach/training/CoachAppGuard.dual.test.tsx` (paths.ts)
- … 12 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`?
