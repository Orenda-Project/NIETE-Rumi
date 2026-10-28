# wq — Browser code and assets for Jugnu's child web pages: quiz, hub, home, stories, challenge
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/public/wq kg=deeb66e53556 gen=5c706a81a550 overflow=63 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `wq.js` — quiz page /q/<code>; wq.css is the base stylesheet all child pages share
- `hub.js` — kid hub /h/<token>; it loads wq-home, wq-doors, wq-stories on demand
- `wq-challenge.js` — Challenge page /c/<token> with live reading and the trail
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `art/` | Grade and subject cover pictures (webp) for the child video library tiles → `art/CLAUDE.md` |
| `fonts/` | Urdu Nastaliq and digit font subsets (woff2) plus their OFL licence texts → `fonts/CLAUDE.md` |
| `jugnu/` | Jugnu mascot animations (webp, webm) per mood: hello, correct, notyet, idle, sleep → `jugnu/CLAUDE.md` |
| `snd/` | Sound sprite for the child pages' chimes and fanfare → `snd/CLAUDE.md` |
| `voice/` | Recorded voice clips and manifests for Jugnu's shared lines and the child welcome → `voice/CLAUDE.md` |
| `wq.js` | Web child quiz page /q/<code>: WQI item renderer, offline answer queue, /api/wq/* calls, results and scorecard |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| … | 54 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `wq-digits.js` ← imported by `dashboard/routes/web-quiz.routes.js:42:35273fa4`

## Never (human)
- Files are served immutable for a year at /wq (routes/web-quiz.routes.js:2143); callers append ?v=, so a changed file needs the edge's versionOf to change
- The reminder worker sw.js must stay without a fetch handler (sw.js:3; held by tests/push-remind-edge.service.test.js)
- Copied, with one flag added, into the main bot's dashboard repo public/wq (its PROVENANCE.md, bd-oiqv06.45); re-copy after a change here
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `dashboard/tests/web-quiz-items.service.test.js` (wq.js)
- `dashboard/tests/web-quiz-look-latin-feedback.service.test.js` (wq.js)
- … 9 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/public/CLAUDE.md`? · `dashboard/public/wq/CLAUDE.index.md`? · `dashboard/public/wq/CLAUDE.md`? · `dashboard/public/wq/art/CLAUDE.md`? · `dashboard/public/wq/fonts/CLAUDE.md`? · `dashboard/public/wq/jugnu/CLAUDE.md`? (+4)
