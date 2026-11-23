# observe2 — Tests /observe2, the live field-form coaching visit: form, moments, check, brief
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/observe2 kg=25bd967a97e8 gen=a80bef38ca36 overflow=40 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `start.test.js` — command to live form; `moments.test.js` — recording to check
- `field-form-flow-contract.test.js` — committed Flow JSON must equal its generator
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/observe2 --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 14 files: 0 test + 14 support) |
| `helpers/` | Shared stand-ins for the observe2 tests (not tests themselves) → `helpers/CLAUDE.md` |
| `end-of-visit.test.js` | Pins observe2 submit handing off to /observe's end: saved observation, debrief recording ask, brief naming the teacher |
| `work-on-coaching-areas.test.js` | Pilot R20/R21: five extra "Work on first" focus areas within the 30-code-point option cap, none duplicated |
| `external-plan.test.js` | Pins adding a non-Rumi lesson plan in the form (photos, PDF/Word, typed text) and grading it after the recording |
| `record-first.test.js` | Pilot R19: a recording with no form waiting becomes its own observe2 visit; the coach fills the form afterwards |
| `lesson-plan-and-fidelity.test.js` | Pins round 2: plan chosen in the form before seal, fidelity screen confirmed by the coach and re-scored, ten photos |
| `fico17*` | 5 files; most used `fico17-v6-check.test.js`: (unmapped) |
| `moments*` | 7 files; most used `moments-v3.test.js`: (unmapped) |
| `recording*` | 3 files; most used `recording-routing.test.js`: Pins that a lesson-length recording goes to the waiting observe2 form, not general chat; armed debrief still wins |
| `start.test.js` | Pins /observe2 from command to the live form: gate, visit planner marker, record created, period question |
| … | 54 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- docs/flows/observe2-*.json must equal the generator output (field-form-flow-contract.test.js:6)
- Form Init values follow Meta's validator types (helpers/meta-init-types.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/observe/observe2/CLAUDE.md`? · `bot/shared/services/roster/CLAUDE.md`? · `tests/CLAUDE.md`?
