# tests — Goldens and rules tests for the RM screens
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/rm/tests kg=5759557ad11b gen=955a8895301a overflow=6 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `harness.tsx` — rmWorld and renderRm on top of the coach insights harness
- Covers ../pages and ../components; run `cd portal && npx vitest run src/portal/rm/tests`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `harness.tsx` | RM test harness on top of the coach insights harness: rmWorld, renderRm, gets |
| `CLAUDE.md` | (unmapped) |
| `CLAUDE.index.md` | (unmapped) |
| `FollowUpPicker.test.tsx` | Pins the follow-up picker: five exact keys on Send, one to three schools, compose preview |
| `RmCircle.test.tsx` | Pins S10 circle: single-line rows, gloss on open, clip errors, Set sector step payload |
| `r6_rm_deck.test.tsx` | Pins the R6 RM deck restyle: hero ring, sections, sheet-fixed picker, Urdu line breaks (bd-sex15q.47) |
| `RmHome.test.tsx` | Pins S8 sector card in both languages: counts, groups, moves, circle, empty and stale states |
| `copy.test.ts` | COPY section 6 lint over every RM string |
| `rmMomentAsRm.test.ts` | Pins that the RM client asks GET /coachip/m/:id with ?as=rm |
| `sector_step_today.test.tsx` | Pins that Set this sector step posts today's Karachi date and says so (fix-r5 s2 item 11) |
| `RmCoach.test.tsx` | Pins S9 coach page blocks under the count contract and not-available for another sector |
| `RmStats.test.tsx` | Pins RM Stats rows, marker and the Coaches tab groups |
| `b10_words.test.tsx` | Pins that zero-base counts are words, never 0 of 0 (fix-r5 s2 items 3 and 5) |
| `layout_s2.test.tsx` | Pins RM layout asks as classes: stacked rows under 640px, picker, unvisited line (fix-r5 s2) |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Pages must show no teacher identity; tests use expectNoTeacher (harness.tsx:65)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `portal/scripts/urdu-fit/CLAUDE.md`? · `portal/src/portal/coach/insights/CLAUDE.index.md`? · `portal/src/portal/rm/CLAUDE.index.md`? · `portal/src/portal/rm/CLAUDE.md`? · `portal/src/portal/rm/components/CLAUDE.index.md`? · `portal/src/portal/rm/components/CLAUDE.md`? (+3)
