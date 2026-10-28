# child-test — Jest tests for the child test: draw, SA scorer, results dashboard, voice, stop rules
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/child-test kg=63d2fdc1dd11 gen=fff8643cb86e overflow=44 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `sa-score.test.js` — the SA scorer's core behaviour
- `sa-bank.test.js` — rules the generated SA bank must hold
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `sa-rdf-w3.test.js` | Pins the RDF auto/manual W3 form shape: task list, official items with src, one-at-a-time display, coach_text |
| `record-sa-voice-v4.test.js` | Pins record-sa-voice.js --set v4: whole bank re-voiced per provider into sa/v4 keys with respellings and tashdeed |
| `sa-runtime.test.js` | Pins runtime batteries sa.<form>.<lang>.json validating in the engine (sa-core) with blocks, islands and stop rules |
| `sa-score-timeouts.test.js` | Pins bounded outbound calls and the 90s sweep deadline so the SA scorer cannot be pinned by a hung call |
| `sa-bank.test.js` | Pins the generated SA battery bank: official sourcing, response modes, stop rules, en+ur copy and gender-neutral lines |
| `sa-practice-only.test.js` | Pins child_test_practice_only: practice coaches get only is_probable_test schools, isPracticeCoach, pilot unchanged |
| `sa-voice-sustained-sounds.test.js` | Pins letter-sound clips saying each sound once (continuants held) using ffmpeg silencedetect on served clips |
| `sa-any-school.test.js` | Pins the sa_any_school switch: school list scope, list opening and seating at any live school, fail-closed reads |
| `sa-restart.test.js` | Pins sa_end_test_restart: restartAttempt sets aside the ended attempt's rows, moves events, refuses when off |
| `CLAUDE.md` | (unmapped) |
| … | 44 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Results reads never carry a child's name, roll, student id or draw (sa-sessions.test.js:5, asserted at :169)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/child-test/CLAUDE.md`? · `bot/shared/data/child-test/CLAUDE.index.md`? · `bot/shared/data/child-test/CLAUDE.md`? · `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/app/CLAUDE.index.md`? · `bot/shared/services/child-test/app/CLAUDE.md`? (+17)
