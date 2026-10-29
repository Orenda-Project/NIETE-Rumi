# __golden__ — Recorded-from-base JSON goldens that pin web-quiz switch-off output
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/quiz/web-quiz/__golden__ kg=4a53dc6651e3 gen=32e4db7c89ce overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `class-link-run-off.json` — run row and hub_open event snapshot read by web-quiz-class-link-run.test.js
- `class-round-pages.json` — page digests read by class-round-retired-still.test.js
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `pic-polish-cases.js` | Shared case list for the share-picture polish switch's off/on hashes, used by the test and the one-off recorder |
| `web*` | 3 files; most used `web-quiz-art-pic-polish-on.json`: Switch-ON golden hashes for share-picture polish, loaded by pic-polish-cases and web-quiz-art-pic-polish.test.js |
| `class*` | 4 files; most used `class-round-pages.json`: Per-page sha256/byte golden of the retired class-round pages, loaded by class-round-retired-still.test.js |
| `one-voice-off.json` | OFF-switch golden of a web-quiz payload, loaded by web-quiz-one-voice-per-quiz.test.js |
| `quiz-report-renders.json` | Golden array of quiz-report render sha256 hashes, loaded by quiz-report-renders.test.js |
| `teacher-report-fold-by-child.off.json` | OFF-switch golden of the teacher report payload, loaded by teacher-report-fold-by-child.test.js |
| `teacher-report-library-send.author.json` | Golden of a library-send teacher report payload, loaded by teacher-report-library-send.test.js |

## Who reads this (generated)
- (none)

## Never (human)
- Never rewrite a golden from new code: write only from the ORIGINAL base with GOLDEN_WRITE=1 (web-quiz-class-link-run.test.js:10)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/tests/quiz/web-quiz/CLAUDE.md`?
