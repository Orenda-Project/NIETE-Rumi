# plan — Parts of the FLN plan page: header, sections, moves, media, time bar
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/fln/plan kg=4d5c22c5b4ec gen=cca7fb106b95 overflow=13 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `Section.tsx` — closed-by-default disclosure band
- `Move.tsx` — one numbered move with its audio pills and media
- `text.tsx` — bidi-safe text helpers (no tests of its own here)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `text.tsx` | Plan text helpers: Chrome and isolate wrap digit/Latin runs in <bdi> on RTL pages; markdown-subset text, ownNumbered |
| `Move.tsx` | One numbered lesson move: step text, Say/Ask/Answer label, and its audio pills, images, videos, PDFs |
| `SoundGrid.tsx` | "Sounds in this lesson" tile grid, one per distinct clip; hidden on screeners/no-audio plans; warms clips on mount |
| `MediaVideo.tsx` | Tap-to-play plan video with poster and size button; offers 360p copy after 5s wait, retries from orig |
| `MediaImage.tsx` | Plan picture in aspect-ratio reserved box; lazy-loaded, retries once from orig, tap for full screen |
| `Details.tsx` | Lesson goal and "Full details" expander: SLOs, Bring, Before class, Summary reference fields |
| `Section.tsx` | Lesson section as a closed-by-default disclosure band: colour stripe, name, minutes, first move, expands in place |
| … | 3 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `text.tsx` ← imported by `portal/src/portal/fln/LessonList.tsx:19:a1032afc` · `portal/src/portal/fln/PlanPage.tsx:29:a1032afc` (+7)
- `Move.tsx` ← imported by `portal/src/portal/fln/plan/Details.tsx:9:838e865d` · `portal/src/portal/fln/plan/Section.tsx:14:838e865d`
- `SoundGrid.tsx` ← imported by `portal/src/portal/fln/player/index.ts:27:ea02ee03` · `portal/src/portal/fln/player/bench/states.tsx:12:a3b8fb4e`
- `Details.tsx` ← imported by `portal/src/portal/fln/PlanPage.tsx:25:bcc18fe2`
- … 6 more → `CLAUDE.index.md`

## Never (human)
- Text only, never HTML: React escapes every string (text.tsx:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/fln/tests/move.test.tsx` (MediaImage.tsx, MediaVideo.tsx, Move.tsx)
- `portal/src/portal/fln/tests/low-r5.test.tsx` (MediaVideo.tsx, TimeBar.tsx)
- … 4 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/fln/CLAUDE.md`?
