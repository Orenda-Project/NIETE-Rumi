# fln — Reading Hour & Numeracy (FLN) lesson pages, sound player and leader send/share
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/fln kg=f86541ec8626 gen=f6a079220098 overflow=55 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `FlnRoutes.tsx` — route table under /portal/fln/*, all behind FlnGate
- `PlanPage.tsx` — plan page /portal/fln/p/:id
- `tests/` — vitest: `cd portal && npx vitest run src/portal/fln`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `lib/` | FLN path and sign-in return helpers → `lib/CLAUDE.md` |
| `login/` | FLN banner and next= exports used by the portal sign-in page → `login/CLAUDE.md` |
| `plan/` | Parts of the FLN plan page: header, sections, moves, media, time bar → `plan/CLAUDE.md` |
| `player/` | FLN sound player engine and its pill/tile controls → `player/CLAUDE.md` |
| `send/` | → (no door; 2 files) |
| … | 23 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `strings.ts` ← imported by `portal/src/portal/fln/FlnBandBody.tsx:26:2f8deb7e` · `portal/src/portal/fln/FlnContext.tsx:7:8d6a1774` (+13)
- `types.ts` ← imported by `portal/src/portal/fln/FlnBandBody.tsx:27:09b7cd91` · `portal/src/portal/fln/FlnContext.tsx:8:93f16bf1` (+12)
- `api.ts` ← imported by `portal/src/portal/fln/FlnBand.tsx:12:3367dabe` · `portal/src/portal/fln/FlnBandBody.tsx:25:3367dabe` (+3)
- … 13 more → `CLAUDE.index.md`

## Never (human)
- Use plain fetch in fln/api.ts, never services/api.ts: its 401 handler drops the target page (api.ts:2)
- Import nothing from K-5 lesson-plan A/B code (tests/fln-ab-isolation.client.test.ts:6)
- /fln/me is read on every mount, never cached: shared phones change hands (FlnGate.tsx:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/fln/tests/counts.test.tsx` (FlnBand.tsx, FlnContext.tsx, LessonList.tsx, PlanPage.tsx, strings.ts, types.ts)
- `portal/src/portal/fln/tests/band.test.tsx` (FlnBand.tsx, FlnBandBody.tsx, strings.ts, types.ts)
- … 19 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/coach/training/CLAUDE.index.md`? · `portal/src/portal/fln/CLAUDE.index.md`? · `portal/src/portal/fln/CLAUDE.md`? · `portal/src/portal/fln/lib/CLAUDE.md`? · `portal/src/portal/fln/login/CLAUDE.md`? (+12)
