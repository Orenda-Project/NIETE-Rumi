# observe2 — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/observe2 -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `helpers/` | Shared stand-ins for the observe2 tests (not tests themselves) → `helpers/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `added-plan-defaults.test.js` | Proves the default lazy-required collaborators of the added-plan and photo-evidence readers reach the real modules |
| `check-endpoint.test.js` | Pins POST /api/flows/observe2-check: moments screens, pre-filled levels, sealed pick, then the brief |
| `check-resume.test.js` | A visit whose "check the moments" message never arrived (Meta #131042 outage) can be resumed from the menu worklist |
| `classroom-photos.test.js` | Pins the observe2 form's photo step: take or upload up to ten photos, picker types, saved to the form store |
| `coach-notes-brief.test.js` | Pilot R13: notes the coach typed in the live form reach the debrief brief verbatim, grouped by part |
| `coach-notes-form.test.js` | Pilot R13: Part 2 returns with saved values; re-sent Part 1 does not blank it; init values are strings |
| `command-dispatch.test.js` | Drives the real handleTextMessage: /observe2 reaches its own handler, /observe the classic one; period buttons route |
| `completion-routing.test.js` | Pins that flow-type-detector claims both observe2 form completions so they are not misread as attendance |
| `end-of-visit.test.js` | Pins observe2 submit handing off to /observe's end: saved observation, debrief recording ask, brief naming the teacher |
| `evidence-check-flow-contract.test.js` | Contract guard: docs/flows/observe2-evidence-check.json equals buildEvidenceCheckFlow(); nine screens, forward-only |
| `external-plan.test.js` | Pins adding a non-Rumi lesson plan in the form (photos, PDF/Word, typed text) and grading it after the recording |
| `field-form-flow-contract.test.js` | Contract guard: docs/flows/observe2-field-form.json equals buildFieldFormFlow(); Ifs and init types agree |
| `field-form-store.test.js` | Pins field-form.store guarantees: parts save only unsealed, seal once, recording links once, DB errors surface |
| `form-endpoint.test.js` | Pins POST /api/flows/observe2-form screen by screen: Part 1, validation, Part 2 continue, sealed form refusal |
| `heard-empty.test.js` | bd-eal7zn.3: a moments screen with no moments says so plainly instead of showing a blank question |
| `lesson-plan-and-fidelity.test.js` | Pins round 2: plan chosen in the form before seal, fidelity screen confirmed by the coach and re-scored, ten photos |
| `materials-used.test.js` | Pilot R17: Part 1 asks which teaching materials were used, as a named tick-list, required once materials were used |
| `moments-cutoff-reason.test.js` | bd-08qvls.1: a moments or label-check reply is "cut off" by finish_reason, not by token count, through completeJson |
| `moments-cutoff.test.js` | bd-eal7zn.3: a moments reply that hit the output limit is retried once, then fails visibly, never "found 0 moments" |
| `moments-label-check.test.js` | bd-eal7zn.8: second-look label check keeps, relabels or drops each moment; counters stored and levels recomputed |
| `moments-quote-check.test.js` | bd-eal7zn.3: each moment's quote is verified against the transcript in code (kept, repaired, re-timed, dropped) |
| `moments-why.test.js` | bd-eal7zn.3: the moments prompt (v2) asks for evidence first and a never-a-moment list, no stretched types |
| `moments.test.js` | Pins the recording-to-check path: capture joins the open form, moments are found and stored, acks per state |
| `notes-before-debrief.test.js` | Pilot R23: coach's own notes are shown before the debrief conversation, with the sealed line and recording steps |
| `part2-checking-moves.test.js` | Pilot R4: Part 2 checking-move ticks (check for understanding, re-explaining a common mistake) feed FICO indicators |
| `parts-by-phase.test.js` | Pilot R4/R10: Part 1 and Part 2 follow lesson-plan steps (guided vs independent practice), not the clock |
| `period-list-routing.test.js` | Executes obs2_period ids through the real webhook: a list_reply row and the older button both reach handlePeriodButton |
| `plan-list-app-plans.test.js` | bd-eal7zn.2: "Which plan?" lists plans the teacher read in the app (niete_lp_opens), fitting Dropdown caps |
| `plan-not-read-words.test.js` | bd-eal7zn.2: when an added plan can't be read the brief and debrief form say exactly that and what to do |
| `record-first.test.js` | Pilot R19: a recording with no form waiting becomes its own observe2 visit; the coach fills the form afterwards |
| `recording-intake.test.js` | Pilot R2: after the seal the chat says to send long recordings as a document, never Share-to-WhatsApp audio |
| `recording-photo-pause.test.js` | Pilot R12: pre-lesson copy says use the recorder app, as a WhatsApp voice note stops when the camera opens |
| `recording-routing.test.js` | Pins that a lesson-length recording goes to the waiting observe2 form, not general chat; armed debrief still wins |
| `report-horizon.test.js` | Pilot R3: the teacher report names the coach's "Work on first" pick as the area to grow, matching the brief |
| `rules.test.js` | Pins the observe2 rules.js mapping of form and confirmed moments to levels on the 17 FICO ICT indicators |
| `rumi-plan-upload.test.js` | bd-eal7zn.2: a file that is one of Rumi's own plan PDFs is graded from the stored plan, not its garbled text layer |
| `start-origin.test.js` | Pins that the visit planner Start records which flow armed the recording (observe2 marker vs classic /observe) |
| `start.test.js` | Pins /observe2 from command to the live form: gate, visit planner marker, record created, period question |
| `target-rubric.test.js` | Pins that observe2's fico17 target stays distinct from FICO V4 indicator ids (C1, D1...) in the report's focus pick |
| `thinking.test.js` | Pilot R16: a Thinking group surfaces children's thinking on the six already-scored indicators, no new scored one |
| `who-typed-name-dispatch.test.js` | Runs the real text handler: a typed teacher name reaches observe-who for a leader awaiting "Someone else" |
| `who-typed-name.test.js` | Pins "Which teacher did you observe?" typed-name fallback: tap asks for name, one clear match binds like a list tap |
| `work-on-coaching-areas.test.js` | Pilot R20/R21: five extra "Work on first" focus areas within the 30-code-point option cap, none duplicated |
| `work-on-more.test.js` | Pilot R14: "Work on first", "Also work on" and "Following the plan's steps" selections; repeats refused |

## Who reads this (all, generated)
- env `OBSERVE_FICO_FLOW_HAS_FIDELITY` read at `tests/observe2/plan-not-read-words.test.js:45:3bd67597`
- env `OBSERVE_MEWAKA_FLOW_ID` read at `tests/observe2/record-first.test.js:71:3232e9a7` · `tests/observe2/recording-routing.test.js:48:3232e9a7`
- env `WHATSAPP_BOT_SRC` read at `tests/observe2/record-first.test.js:284:50aeb596`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.index.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.index.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/report-v2/CLAUDE.index.md`? · `bot/shared/services/coaching/video-reco/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.index.md`? · `bot/shared/services/observe/observe2/CLAUDE.index.md`? · `bot/shared/services/observe/observe2/CLAUDE.md`? · `bot/shared/services/roster/CLAUDE.index.md`? · `bot/shared/services/roster/CLAUDE.md`? · `dashboard/services/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/observe2/CLAUDE.index.md`? · `tests/observe2/CLAUDE.md`? · `tests/observe2/helpers/CLAUDE.md`?
