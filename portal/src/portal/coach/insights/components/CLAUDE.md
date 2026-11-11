# components — Small COACHIP pieces shared by coach insight pages and RM pages
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/insights/components kg=e35613b19620 gen=d8dfa06acd52 overflow=27 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `Frame.tsx` — frame, band, trust line used by every insight page
- `StateBlock.tsx` — empty/failed/loading block (also used by RM pages)
- No tests here; covered by ../tests via `cd portal && npx vitest run src/portal/coach/insights`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `StateBlock.tsx` | Empty, failed and loading block for screens with nothing to show; also used by RM pages |
| `Frame.tsx` | Frame of every coach insight page: gate, layout, COACHIP shell, band, trust line, cards |
| `WRow.tsx` | Hairline weakness row frame shared by coach and sector rows |
| `bidi.ts` | Isolates school names and counts in mixed Urdu/Latin lines so they never break or mis-attach |
| `SchoolRow.tsx` | One school on S3 with teacher codes, graded counts and a Trend disclosure |
| `StepRow.tsx` | One open step on S1 with strip of next recordings and It worked / Not yet chip |
| … | 12 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `StateBlock.tsx` ← imported by `portal/src/portal/coach/insights/pages/Listen.tsx:7:844365d7` · `portal/src/portal/coach/insights/pages/MomentRoute.tsx:6:9fe5cbbe` (+13)
- `Frame.tsx` ← imported by `portal/src/portal/coach/insights/pages/Listen.tsx:6:d9aad737` · `portal/src/portal/coach/insights/pages/MomentRoute.tsx:5:d9aad737` (+9)
- `WRow.tsx` ← imported by `portal/src/portal/coach/insights/pages/Schools.tsx:7:66865abc` · `portal/src/portal/coach/insights/pages/ThisWeek.tsx:21:66865abc` (+2)
- `bidi.ts` ← imported by `portal/src/portal/coach/insights/pages/Weakness.tsx:21:a3853dc3` · `portal/src/portal/coach/insights/components/ListenRow.tsx:10:3bb0aae4` (+1)
- … 14 more → `CLAUDE.index.md`

## Never (human)
- parts.tsx duplicates two helpers on purpose to keep the coach-entry bundle under 250,000 B gz (parts.tsx:6)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/insights/tests/r6c_fix.test.tsx` (MoreCoachip.tsx)
- `portal/src/portal/fln/tests/bidi.test.tsx`? (bidi.ts)
- … 1 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/coach/insights/CLAUDE.md`?
