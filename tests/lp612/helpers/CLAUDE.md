# helpers — Shared harnesses and doubles for the lp612 E2E and unit suites

<!-- kg:meta repo=NIETE-Rumi dir=tests/lp612/helpers kg=d8b76ebb4be0 gen=bcbb737d1d00 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `lp612-db-double.js` — PostgREST double used where requestLesson and the worker run together
- `religious-e2e.js` — shared harness for the religious-marks delivery suites
- Not tests themselves (no .test.js); used by ../*.test.js under `node tests/run.js tests/lp612`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `religious-e2e.js` | Test helper: shared E2E harness for the religious-marks delivery suites (bd-c61xh), llm-client and author doubled |
| `religious-marks.js` | Test helper: shared harness for RELIGIOUS_MARKS unit suites, split out of the false-positives test (bd-xo6mb) |
| `lp612-db-double.js` | Test helper: PostgREST double for the lp612 lane with per-call canned results; used by requestLesson and worker E2Es |
| `overlay-chrome-e2e.js` | Test helper (bd-yhd16): E2E harness running the Urdu-tap chain for real with model, R2, PostgREST, SQS and Meta doubled |
| `overlay-chrome.js` | Test helper (bd-yhd16): fixtures for the Urdu-chrome reuse gate, varying whether ur_overlay carries provenance pointers |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/lp612/CLAUDE.index.md`? · `tests/lp612/CLAUDE.md`? · `tests/lp612/helpers/CLAUDE.md`?
