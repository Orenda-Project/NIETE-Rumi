# L5 — Scoring engine: windows, story, spoken maths, thresholds, assembler, scoreBlock

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L5 kg=714533ea0892 gen=198a39697896 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `score-block.test.js` — scoreBlock end to end, only vendors mocked
- `thresholds.test.js` — the bar each ai_marks field needs
- Run from repo root: `node tests/run.js tests/child-test/L5 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 2 test files) |
| `maths-spoken.test.js` | Tests spoken maths scoring: numbers aligned in order, wrong number kept with what was heard, stop after 4 wrong in a row |
| `assemble.test.js` | Tests the v1 battery ai_marks assembler (first sounds, made-up words, v1 strip maths); v1 switches pinned for this file |
| `story-pure.test.js` | Tests story scoring: attempted is capped by what the child said; a non-reader cannot have attempted 60 words |
| `windows.test.js` | Tests the window cutter: fuzzy phrase finding of coach cue lines and story/questions/phonics windows per block |
| `maths-photo.test.js` | Tests scoreStrip on a maths strip photo with only OpenRouter mocked: positional id matching, wrong-form cap |
| `number-grammar.test.js` | Tests the Urdu/English number grammar: Urdu 1-100 irregular words and spelling-variant normalisation |
| `thresholds.test.js` | Tests scoring/thresholds: every ai_marks field has a bar or NEVER, and prefill() decides per field bar |
| `score-block.test.js` | scoreBlock end to end (L4-L5 contract) with only Soniox/SpeechAce/OpenRouter/R2/ffmpeg mocked; Urdu and English blocks |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- env read here: `CHILD_TEST_BATTERY` · `CHILD_TEST_MATHS_MODE`

## Never (human)
- Tests here pin the v1 battery switches; v2 is the default since bd-s1oo0.46.3 (tests/child-test/L5/assemble.test.js:1)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L5/CLAUDE.md`?
