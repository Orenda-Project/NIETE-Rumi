# flow-response — flow-response handler routing of WhatsApp Flow completions (NFM_REPLY)

<!-- kg:meta repo=NIETE-Rumi dir=tests/flow-response kg=662b9f32dbf9 gen=185c4bf51ecc overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `endpoint-flow-routing.test.js` — endpoint-only Flows recognised, not "Unknown flow ID"
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/flow-response --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `endpoint-flow-routing.test.js` | flow-response.handler recognises the 8 endpoint-only Flows' NFM_REPLY as completions, not "Unknown flow ID" |
| `exam-confirm-routing.test.js` | bd-1875: flow-response routes the exam-confirm NFM completion to handleExamFlow with parsed confirmed_students |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
- An unconfigured, unrelated flow id still falls through to "Unknown flow ID" (tests/flow-response/endpoint-flow-routing.test.js:95)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/flow-response/CLAUDE.md`?
