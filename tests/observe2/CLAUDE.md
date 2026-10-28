# observe2 — Tests /observe2, the live field-form coaching visit: form, moments, check, brief
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/observe2 kg=07b4c24d5423 gen=7553362db86d overflow=33 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `start.test.js` — command to live form; `moments.test.js` — recording to check
- `field-form-flow-contract.test.js` — committed Flow JSON must equal its generator
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/observe2 --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `helpers/` | Shared stand-ins for the observe2 tests (not tests themselves) → `helpers/CLAUDE.md` |
| `end-of-visit.test.js` | Pins observe2 submit handing off to /observe's end: saved observation, debrief recording ask, brief naming the teacher |
| `work-on-coaching-areas.test.js` | Pilot R20/R21: five extra "Work on first" focus areas within the 30-code-point option cap, none duplicated |
| `external-plan.test.js` | Pins adding a non-Rumi lesson plan in the form (photos, PDF/Word, typed text) and grading it after the recording |
| `lesson-plan-and-fidelity.test.js` | Pins round 2: plan chosen in the form before seal, fidelity screen confirmed by the coach and re-scored, ten photos |
| `record-first.test.js` | Pilot R19: a recording with no form waiting becomes its own observe2 visit; the coach fills the form afterwards |
| `recording*` | 3 files; most used `recording-routing.test.js`: Pins that a lesson-length recording goes to the waiting observe2 form, not general chat; armed debrief still wins |
| … | 33 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `OBSERVE_FICO_FLOW_HAS_FIDELITY` · `OBSERVE_MEWAKA_FLOW_ID` · `WHATSAPP_BOT_SRC`

## Never (human)
- docs/flows/observe2-*.json must equal the generator output (field-form-flow-contract.test.js:6)
- Form Init values follow Meta's validator types (helpers/meta-init-types.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.index.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.index.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/report-v2/CLAUDE.index.md`? (+12)
