# rm — RM (regional manager) sector screens behind portal_coachip_rm
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/rm kg=639ea8a7dece gen=27da8eeffbe0 overflow=23 rendered=2026-10-29 kg.py=1.1.0 -->

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
| `api.ts` | Client for /api/portal/coachip/rm/* (R17-R21) and /coachip/me |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `text.tsx` ← imported by `portal/src/portal/rm/RmGate.tsx:6:acd18cca` · `portal/src/portal/rm/RmNav.tsx:11:acd18cca` (+14)
- `types.ts` ← imported by `portal/src/portal/rm/api.ts:9:e90fdcfa` · `portal/src/portal/rm/components/CircleRow.tsx:9:6bc27568` (+9)
- `api.ts` ← imported by `portal/src/portal/rm/RmGate.tsx:5:363724b9` · `portal/src/portal/rm/components/CircleRow.tsx:8:dbdfd669` (+6)
- `RmGate.tsx` ← imported by `portal/src/portal/rm/RmNav.tsx:10:394056ad` · `portal/src/portal/rm/pages/RmCircle.tsx:10:61676df7` (+5)
- … 6 more → `CLAUDE.index.md`

## Never (human)
- POST bodies carry exactly the contract's keys, no free text (api.ts:4, A11)
- RM pages sit behind RmGate, never CoachGate (RmGate.tsx:10)
- rm.copy.ts is generated; never hand-edit (rm.copy.ts:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/training/CoachAppGuard.dual.test.tsx` (paths.ts)
- `portal/src/portal/coach/training/CoachAppGuard.rm.test.tsx` (paths.ts)
- … 11 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`?
