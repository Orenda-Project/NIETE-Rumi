# tests — Tests for the FLN pages, player, gate, share and flag-off goldens
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/fln/tests kg=b7efe555f899 gen=d7ff6d67d1c7 overflow=20 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `golden.flagOff.test.tsx` — snapshots: FLN off leaves K-5 pages byte-identical
- `fixtures/` — synthetic plans and player mocks (no corpus text)
- Vitest, jsdom: `cd portal && npx vitest run src/portal/fln` (vitest.config.ts)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 3 files: 0 test + 3 support) |
| `__snapshots__/` | → (not mapped: excluded; 1 files) |
| `readers.test.tsx` | Vitest: teacher Home/Recent/All-lesson-plans readers handle kind 'fln' plans and link to the FLN plan path |
| `counts.test.tsx` | Vitest (R5 Q1): band, list and plan kicker use the placement count of the grade the teacher is viewing |
| `rootScope.test.tsx` | Vitest (R5 RT5-ROOT100VH): full-height page rule applies only to the gate root, not embedded .fln-root surfaces |
| `hiddenBand.page.test.tsx` | Vitest (bd-4tsjcr): teacher of Grades 6-12 only gets no FLN band, page identical to switch-off; coach still gets it |
| `low-r5.test.tsx` | Vitest for the R5 LOW batch: singular counts, no mid-word time-bar breaks, Urdu "MB" label and other QA fixes |
| `listFixtures.ts` | Synthetic catalogue answers (levels, guide, screener, core rows, Urdu title, extended strand) for list/band/gate tests |
| `ui.test.tsx` | Vitest for SoundPill and SoundTile states (idle/loading/playing/error) against a recording fake player |
| `golden.flagOff.test.tsx` | Vitest with recorded snapshots: with FLN off, NewLessonPage and OpenPlanPage render byte-identical to pre-FLN |
| … | 20 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Fixtures are synthetic, never corpus text: the repo is public (fixtures/plans.ts:2-4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `portal/src/CLAUDE.md`? · `portal/src/portal/coach/insights/components/CLAUDE.md`? · `portal/src/portal/fln/CLAUDE.md`? · `portal/src/portal/fln/lib/CLAUDE.md`? · `portal/src/portal/fln/login/CLAUDE.md`? · `portal/src/portal/fln/plan/CLAUDE.md`? (+4)
