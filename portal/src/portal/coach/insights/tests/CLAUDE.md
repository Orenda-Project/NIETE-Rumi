# tests — Goldens for each COACHIP coach page plus shared harness and fixtures
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/insights/tests kg=b130dadf1306 gen=833dcce3b289 overflow=7 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `harness.tsx` — mocks, serve() and boot() every page test starts from
- `fixtures.json` — fictional API v1.4 payloads (also loaded by rm/tests)
- Covers ../pages and ../components; run `cd portal && npx vitest run src/portal/coach/insights/tests`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__snapshots__/` | → (not mapped: excluded; 8 files) |
| `harness.tsx` | Shared harness for coach insight page tests: mocks, serve(), boot(), renderAt, contract checks |
| `routing.flagOff.test.tsx` | Pins coach routing with COACHIP off versus on: home, menu, reachable pages (B7/B8) |
| `r6b_more.test.tsx` | (unmapped) |
| `r6b_fix.test.tsx` | (unmapped) |
| `more.flagOff.test.tsx` | Pins coach More with and without COACHIP: extra rows, RM link and the .cp look |
| `ThisWeek.test.tsx` | Pins S1 This week in both languages: first card, note posts, step strip, phonics, empty states |
| `Listen.test.tsx` | Pins Listen tab: base line, W chips, newest-first rows, one inline player, empty and error states |
| `Move.test.tsx` | Pins S5 move page: library words verbatim, check rule, FLN send, debrief line, flag-off redirect |
| `Results.test.tsx` | Pins S7 Results: counts at five tested, send links, debrief line, empty states |
| `Schools.test.tsx` | Pins Schools tab: API order, WRow per school, never-visited line, error and switch-off |
| `Stats.test.tsx` | Pins S6 Stats: payload order rows, opening states, change pill rule, FICO panel, sparkline |
| `Weakness.test.tsx` | Pins S2 one-fold page and Set step posting exactly six keys, 201 and 409 outcomes |
| … | 7 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Fixtures stay fictional, codes only (fixtures.json _meta.fictional)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `portal/scripts/urdu-fit/CLAUDE.md`? · `portal/src/portal/coach/insights/CLAUDE.md`? · `portal/src/portal/coach/insights/pages/CLAUDE.md`? · `portal/src/portal/coach/profile/CLAUDE.md`? · `portal/src/portal/coach/training/CLAUDE.md`? · `portal/src/portal/coachip-ui/CLAUDE.md`? (+2)
