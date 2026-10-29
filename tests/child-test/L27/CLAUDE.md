# L27 — v2 item bank and oral maths: windows, bars, scoreBlock under v2 switches

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L27 kg=530d53907d9d gen=22bf87702704 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `maths-oral.test.js` — cutting the maths note by cue lines
- `score-block-v2.test.js` — end to end, vendors mocked
- Run from repo root: `node tests/run.js tests/child-test/L27 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `oral-transcripts.js` | Scripted Soniox transcripts of the v2 maths voice note (coach reads script, child answers), no real child, for L27 tests |
| `maths-oral.test.js` | L27 (bd-s1oo0.46.3): oral maths windows: cut the maths voice note by script cues and find each item's answer in order |
| `oral-bars.test.js` | L27 (bd-s1oo0.46.3): oral maths bars in scoring/thresholds.js; below-bar fields go to the coach review, above stand |
| `score-block-v2.test.js` | L27 (bd-s1oo0.46.3): scoreBlock under v2 switches end to end with only HTTP/R2/ffmpeg mocked; ai-marks-v2 shape |
| `item-bank-v2.test.js` | L27 (bd-s1oo0.46.3): v2 item bank accessor: oral maths items by id, script and oral-set readers, v2 default switches |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/child-test/CLAUDE.md`?
