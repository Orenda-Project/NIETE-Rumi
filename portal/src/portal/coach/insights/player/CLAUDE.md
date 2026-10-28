# player — Moment player: plays a lesson clip with plan chapters (S4)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/insights/player kg=17a2472f365d gen=eafcafaa4d68 overflow=9 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `MomentPlayer.tsx` — plays /coachip/m/<id>/clip with fallbacks and clock
- `ChapterStrip.tsx` — plan steps as verdict segments
- Tests in tests/; run `cd portal && npx vitest run src/portal/coach/insights/player`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `tests/` | Tests of the moment player and that the kit AudioPlayer is untouched → `tests/CLAUDE.md` |
| `LessonClock.tsx` | Player clocks as ASCII LTR atoms carrying data-clock for the count contract |
| `CLAUDE.md` | (unmapped) |
| `MomentPlayer.tsx` | Moment player playing /coachip/m/<id>/clip with fallbacks, chapters, pair and clock (bd-sex15q.16) |
| `PairCard.tsx` | What good sounds like card: a peer's moment with its own player, or the library example |
| `CLAUDE.index.md` | (unmapped) |
| … | 5 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `LessonClock.tsx` ← imported by `portal/src/portal/coach/insights/player/FullRecordingLink.tsx:7:4393f3e4` · `portal/src/portal/coach/insights/player/Moment.tsx:8:4393f3e4` (+1)
- `MomentPlayer.tsx` ← imported by `portal/src/portal/coach/insights/player/Moment.tsx:9:026f428f` · `portal/src/portal/coach/insights/player/index.ts:2:82b991d8`
- `PairCard.tsx` ← imported by `portal/src/portal/coach/insights/player/Moment.tsx:10:4bd766aa` · `portal/src/portal/coach/insights/player/MomentPlayer.tsx:10:bb6e42fd`
- … 4 more → `CLAUDE.index.md`

## Never (human)
- The clip source is the route, never a URL from a payload (player/MomentPlayer.tsx:16, B4)
- A step the clip did not reach is grey, never red (player/ChapterStrip.tsx:8)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/insights/player/tests/MomentPlayer.test.tsx`? (MomentPlayer.tsx, index.ts)
- `portal/src/portal/coach/insights/player/tests/Moment.test.tsx`? (Moment.tsx)

## Related (generated)
- docs: `portal/src/portal/coach/insights/CLAUDE.index.md`? · `portal/src/portal/coach/insights/CLAUDE.md`? · `portal/src/portal/coach/insights/player/CLAUDE.index.md`? · `portal/src/portal/coach/insights/player/CLAUDE.md`? · `portal/src/portal/coach/insights/player/tests/CLAUDE.md`?
