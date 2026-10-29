# plan — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/fln/plan -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `Details.tsx` | Lesson goal and "Full details" expander: SLOs, Bring, Before class, Summary reference fields |
| `Header.tsx` | Navy plan header: subject/level/position kicker, title in plan language, chips, total time; headerChips helper |
| `MediaImage.tsx` | Plan picture in aspect-ratio reserved box; lazy-loaded, retries once from orig, tap for full screen |
| `MediaVideo.tsx` | Tap-to-play plan video with poster and size button; offers 360p copy after 5s wait, retries from orig |
| `Move.tsx` | One numbered lesson move: step text, Say/Ask/Answer label, and its audio pills, images, videos, PDFs |
| `Section.tsx` | Lesson section as a closed-by-default disclosure band: colour stripe, name, minutes, first move, expands in place |
| `SoundGrid.tsx` | "Sounds in this lesson" tile grid, one per distinct clip; hidden on screeners/no-audio plans; warms clips on mount |
| `TimeBar.tsx` | Plan time bar: one coloured segment per section sized by minutes, section names beneath, Urdu-aware labels |
| `plan.css` | Plan page card styles scoped under .fln-root .fln-plan; Nastaliq line-height, 48px tap targets, 64px band header |
| `text.tsx` | Plan text helpers: Chrome and isolate wrap digit/Latin runs in <bdi> on RTL pages; markdown-subset text, ownNumbered |

## Who reads this (all, generated)
- `Details.tsx` ← imported by `portal/src/portal/fln/PlanPage.tsx:25:bcc18fe2`
- `Header.tsx` ← imported by `portal/src/portal/fln/PlanPage.tsx:26:98d6a589`
- `MediaImage.tsx` ← imported by `portal/src/portal/fln/plan/Move.tsx:10:9892b17d`
- `MediaVideo.tsx` ← imported by `portal/src/portal/fln/plan/Move.tsx:11:834c998d`
- `Move.tsx` ← imported by `portal/src/portal/fln/plan/Details.tsx:9:838e865d` · `portal/src/portal/fln/plan/Section.tsx:14:838e865d`
- `Section.tsx` ← imported by `portal/src/portal/fln/PlanPage.tsx:27:36578531`
- `SoundGrid.tsx` ← imported by `portal/src/portal/fln/player/index.ts:27:ea02ee03` · `portal/src/portal/fln/player/bench/states.tsx:12:a3b8fb4e`
- `TimeBar.tsx` ← imported by `portal/src/portal/fln/PlanPage.tsx:28:42558ea6`
- `plan.css` ← imported by `portal/src/portal/fln/PlanPage.tsx:36:1a56d79d`
- `text.tsx` ← imported by `portal/src/portal/fln/LessonList.tsx:19:a1032afc` · `portal/src/portal/fln/PlanPage.tsx:29:a1032afc` · `portal/src/portal/fln/plan/Details.tsx:10:a4dbffd4` · `portal/src/portal/fln/plan/Header.tsx:8:4de07fe8` (+5: `python3 kg/kg.py who-reads text.tsx`)

## Tests (all, generated)
- `MediaImage.tsx` ← `portal/src/portal/fln/tests/move.test.tsx`
- `MediaVideo.tsx` ← `portal/src/portal/fln/tests/low-r5.test.tsx` · `portal/src/portal/fln/tests/move.test.tsx`
- `Move.tsx` ← `portal/src/portal/fln/tests/move.test.tsx` · `portal/src/portal/fln/tests/narration.test.tsx`
- `SoundGrid.tsx` ← `portal/src/portal/fln/tests/ui-owner.test.tsx` · `portal/src/portal/fln/tests/ui.test.tsx`
- `TimeBar.tsx` ← `portal/src/portal/fln/tests/low-r5.test.tsx`
- `text.tsx` ← `portal/src/portal/fln/tests/qa-r1.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/fln/CLAUDE.md`?
