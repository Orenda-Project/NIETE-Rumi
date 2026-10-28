# observe2 — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/observe/observe2 -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `added-plan.js` | Stores and reads a lesson plan the coach adds in the observe2 form before the seal |
| `analysis.js` | Writes the checked observe2 record into coaching_sessions.analysis_data in /observe's FICO shape |
| `brief.js` | Builds the no-model coaching brief from the checked record: reflective questions, wins, focus |
| `capture-link.js` | Links a classroom recording to the coach's open observe2 field form via the database |
| `evidence-check.flow.js` | Builds the 'What Rumi heard' Flow JSON where the coach checks moments after sealing the form |
| `fico17.js` | The 17 FICO ICT indicators in plain words, grouped into four lesson moments, for observe2 |
| `field-form.flow.js` | Defines the live field form WhatsApp Flow the coach fills during the lesson (observe2) |
| `field-form.store.js` | Writes observation_field_forms, saving parts only while unsealed; child-test modules also read the table |
| `focus-areas.js` | Text the brief and record use for coaching focus areas like wait time and classroom rules (observe2) |
| `gate.js` | Pure gate: who may start /observe2 and whether this deployment can run it |
| `hold.js` | Holds a lesson recording that arrives with no form armed so the coach can fill the form later |
| `label-check.js` | Second model look at each moment's label after the quote check, before the coach sees it (bd-eal7zn.8) |
| `llm-reply.js` | Unwraps and cut-off-detects model replies for the observe2.moments job (bd-08qvls.1) |
| `moment-types.js` | Moment type labels and definitions shared by the moments prompt and the label check (bd-eal7zn.8) |
| `moments.js` | One model call over the timestamped transcript returning moments the coach later checks (observe2) |
| `quote-check.js` | Deterministic check that each moment's quote appears in the transcript (bd-eal7zn.3) |
| `rules.js` | Turns the coach's evidence into a level on each of the 17 FICO ICT indicators using workbook thresholds |
| `start.js` | Takes /observe2 from the command to the live form in the coach's hands via the visit planner |
| `strings.js` | Chat lines the observe2 coach reads, per language (en, ur), as data |

## Who reads this (all, generated)
- `added-plan.js` ← imported by `bot/shared/routes/observe2-form-endpoint.js:542:a926747d` · `bot/shared/services/observe/observe2/moments.js:323:bdeb2fcc`
- `analysis.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:292:4f57b36d`
- `brief.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:30:e74ee918` · `bot/shared/routes/observe2-form-endpoint.js:50:e74ee918` · `bot/shared/services/observe/observe2/analysis.js:28:d24a68d0`
- `capture-link.js` ← imported by `bot/shared/services/coaching/transcription-processor.service.js:264:c5ac431e` · `bot/shared/services/observe/observe-capture.service.js:97:085a4ade` · `bot/shared/services/observe/observe-who.service.js:249:a9002db2`
- `evidence-check.flow.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:29:4b4b404a` · `bot/scripts/generate-observe2-flow-json.js:14:a0d6e6fe`
- `fico17.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:28:008d225a` · `bot/shared/services/coaching/target-resolver.js:22:979a2ef9` · `bot/shared/services/observe/observe2/analysis.js:27:47daeb81` · `bot/shared/services/observe/observe2/brief.js:21:33cab8a8` (+4: `python3 kg/kg.py who-reads fico17.js`)
- `field-form.flow.js` ← imported by `bot/shared/routes/observe2-form-endpoint.js:48:75e0c6ce` · `bot/scripts/generate-observe2-flow-json.js:13:fa226541` · `bot/shared/services/observe/observe2/rules.js:454:7719bf8c`
- `field-form.store.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:26:9d1f3626` · `bot/shared/routes/observe2-form-endpoint.js:44:9d1f3626` · `bot/shared/services/observe/observe-audio-router.js:109:6ce727bb` · `bot/shared/services/observe/observe-debrief.service.js:323:6adc5262` (+5: `python3 kg/kg.py who-reads field-form.store.js`)
- `focus-areas.js` ← imported by `bot/shared/services/observe/observe2/analysis.js:30:2c9f695c` · `bot/shared/services/observe/observe2/brief.js:23:8a8babae`
- `gate.js` ← imported by `bot/shared/services/observe/observe2/start.js:21:b75fdd99`
- `hold.js` ← imported by `bot/shared/services/observe/observe-audio-router.js:124:c705aacb`
- `label-check.js` ← imported by `bot/shared/services/observe/observe2/moments.js:32:e6990389`
- `llm-reply.js` ← imported by `bot/shared/services/observe/observe2/label-check.js:31:8604a88e` · `bot/shared/services/observe/observe2/moments.js:33:8604a88e`
- `moment-types.js` ← imported by `bot/shared/services/observe/observe2/label-check.js:28:fea952ae` · `bot/shared/services/observe/observe2/moments.js:47:4f5b1a82`
- `moments.js` ← imported by `bot/shared/routes/observe2-form-endpoint.js:425:f3eb7056` · `bot/shared/services/coaching/transcription-processor.service.js:685:649bfc00` · `bot/shared/services/observe/observe-resume.service.js:127:da8694ff`
- `quote-check.js` ← imported by `bot/shared/services/observe/observe2/label-check.js:29:8102501b` · `bot/shared/services/observe/observe2/moments.js:31:2512c22b`
- `rules.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:27:82d170af` · `bot/shared/routes/observe2-form-endpoint.js:45:599c638c` · `bot/shared/services/observe/observe2/analysis.js:29:a15dc482` · `bot/shared/services/observe/observe2/brief.js:22:43627f94` (+2: `python3 kg/kg.py who-reads rules.js`)
- `start.js` ← imported by `bot/shared/handlers/flow-response.handler.js:749:b6625bf3` · `bot/shared/handlers/text-message.handler.js:1049:45962a07` · `bot/shared/services/observe/observe-capture.service.js:143:419f16fa` · `bot/shared/services/observe/observe-resume.service.js:121:27e71916` (+1: `python3 kg/kg.py who-reads start.js`)
- `strings.js` ← imported by `bot/shared/routes/observe2-form-endpoint.js:49:8ace723d` · `bot/shared/services/coaching/transcription-processor.service.js:267:0ad03971` · `bot/shared/services/observe/observe-capture.service.js:143:419f16fa` · `bot/shared/services/observe/observe2/analysis.js:31:5ae5958f` (+4: `python3 kg/kg.py who-reads strings.js`)
- column `coaching_sessions.status` (written by `moments.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` · `bot/shared/handlers/text-message.handler.js:1923:21a55915` · `bot/shared/handlers/voice-message.handler.js:744:21a55915` (+39: `python3 kg/kg.py who-reads coaching_sessions.status`)
- column `coaching_sessions.updated_at` (written by `capture-link.js`, `moments.js`) ← read by `bot/shared/handlers/text-message.handler.js:2034:a619795a` · `bot/shared/services/coaching/lp-coaching/lp-step.service.js:193:6d171412` · `bot/shared/services/coaching/portal-class-check.js:181:5720b09e` · `bot/shared/services/coaching/portal-coaching.service.js:354:fa39a4c5` (+3: `python3 kg/kg.py who-reads coaching_sessions.updated_at`)
- column `coaching_sessions.user_id` (written by `capture-link.js`) ← read by `bot/shared/calls/call-context.repo.js:65:219f5683` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` · `bot/shared/handlers/text-message.handler.js:1922:a819c701` · `bot/shared/handlers/voice-message.handler.js:743:a819c701` (+50: `python3 kg/kg.py who-reads coaching_sessions.user_id`)
- column `observation_field_forms.answers` (written by `field-form.store.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:185:bbf37085` · `bot/shared/services/child-test/app/sa-api.service.js:97:d5a7d17b`
- column `observation_field_forms.observer_user_id` (written by `field-form.store.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:185:bbf37085` · `bot/shared/services/child-test/app/sa-api.service.js:97:d5a7d17b` · `bot/shared/services/child-test/conversation/context.js:49:0950e2a7` · `bot/shared/services/child-test/store.js:156:5f914959`
- column `observation_field_forms.sealed_at` (written by `field-form.store.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:185:bbf37085`
- column `observation_field_forms.teacher_user_id` (written by `field-form.store.js`) ← read by `bot/shared/services/child-test/conversation/context.js:49:0950e2a7`
- column `observation_field_forms.visit_context` (written by `field-form.store.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:185:bbf37085` · `bot/shared/services/child-test/app/sa-api.service.js:97:d5a7d17b` · `bot/shared/services/child-test/conversation/context.js:49:0950e2a7` · `bot/shared/services/child-test/store.js:156:5f914959`
- table `coaching_sessions` whole row (`*`) (written by `capture-link.js`, `moments.js`) ← read by `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? · `bot/shared/services/coaching-orchestrator.service.js:225:d2b02c3e`? · `bot/shared/services/coaching/analysis-processor.service.js:124:a23aff58`? (+9: `python3 kg/kg.py who-reads coaching_sessions`)
- table `coaching_sessions` (written by `capture-link.js`, `moments.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+86: `python3 kg/kg.py who-reads coaching_sessions`)
- table `observation_field_forms` (written by `field-form.store.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:184:9343047e`? · `bot/shared/services/child-test/app/sa-api.service.js:96:cff3d781`? · `bot/shared/services/child-test/conversation/context.js:48:88aad8a1`? · `bot/shared/services/child-test/store.js:155:455ceb8f`? (+1: `python3 kg/kg.py who-reads observation_field_forms`)
- env `COACHING_PHOTO_VISION` read at `bot/shared/services/observe/observe2/moments.js:270:1da2c00c`
- env `OBSERVE2_CHECK_FLOW_ID` read at `bot/shared/services/observe/observe2/moments.js:242:fc747be9`
- env `OBSERVE2_FIELD_FORM_FLOW_ID` read at `bot/shared/services/observe/observe2/start.js:152:54362101`
- env `OBSERVE_VISIT_FLOW_ID` read at `bot/shared/services/observe/observe2/start.js:62:deb1c880`

## Tests (all, generated)
- `added-plan.js` ← `tests/observe2/added-plan-defaults.test.js`
- `analysis.js` ← `tests/observe2/end-of-visit.test.js` · `tests/observe2/materials-used.test.js` · `tests/observe2/part2-checking-moves.test.js` · `tests/observe2/parts-by-phase.test.js` · `tests/observe2/plan-not-read-words.test.js` · `tests/observe2/report-horizon.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/analysis.js`)
- `brief.js` ← `tests/observe2/check-endpoint.test.js` · `tests/observe2/coach-notes-brief.test.js` · `tests/observe2/external-plan.test.js` · `tests/observe2/lesson-plan-and-fidelity.test.js` · `tests/observe2/materials-used.test.js` · `tests/observe2/plan-not-read-words.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/brief.js`)
- `capture-link.js` ← `tests/observe2/record-first.test.js` · `tests/observe2/recording-routing.test.js`
- `evidence-check.flow.js` ← `tests/observe2/evidence-check-flow-contract.test.js` · `tests/observe2/heard-empty.test.js` · `tests/observe2/lesson-plan-and-fidelity.test.js` · `tests/observe2/notes-before-debrief.test.js` · `tests/observe2/thinking.test.js` · `tests/observe2/work-on-coaching-areas.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/evidence-check.flow.js`)
- `fico17.js` ← `tests/child-test/L4/observe2-offer.test.js` · `tests/observe2/check-endpoint.test.js` · `tests/observe2/coach-notes-brief.test.js` · `tests/observe2/end-of-visit.test.js` · `tests/observe2/evidence-check-flow-contract.test.js` · `tests/observe2/field-form-flow-contract.test.js` (+8: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/fico17.js`)
- `field-form.flow.js` ← `tests/child-test/L4/observe2-offer.test.js` · `tests/observe2/check-endpoint.test.js` · `tests/observe2/classroom-photos.test.js` · `tests/observe2/coach-notes-form.test.js` · `tests/observe2/external-plan.test.js` · `tests/observe2/field-form-flow-contract.test.js` (+7: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/field-form.flow.js`)
- `field-form.store.js` ← `tests/child-test/L4/observe2-offer.test.js` · `tests/llm/observe2-moments-job.test.js` · `tests/observe2/check-endpoint.test.js` · `tests/observe2/classroom-photos.test.js` · `tests/observe2/coach-notes-brief.test.js` · `tests/observe2/coach-notes-form.test.js` (+25: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/field-form.store.js`)
- `gate.js` ← `tests/observe2/start.test.js`
- `moments.js` ← `tests/llm/observe2-moments-job.test.js` · `tests/observe2/added-plan-defaults.test.js` · `tests/observe2/end-of-visit.test.js` · `tests/observe2/external-plan.test.js` · `tests/observe2/lesson-plan-and-fidelity.test.js` · `tests/observe2/moments-cutoff-reason.test.js` (+7: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/moments.js`)
- `rules.js` ← `tests/observe2/field-form-flow-contract.test.js` · `tests/observe2/materials-used.test.js` · `tests/observe2/part2-checking-moves.test.js` · `tests/observe2/parts-by-phase.test.js` · `tests/observe2/rules.test.js` · `tests/observe2/thinking.test.js`
- `start.js` ← `tests/child-test/L4/text-dispatch.test.js` · `tests/observe2/command-dispatch.test.js` · `tests/observe2/record-first.test.js` · `tests/observe2/recording-intake.test.js` · `tests/observe2/recording-photo-pause.test.js` · `tests/observe2/start.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/start.js`)
- `strings.js` ← `bot/tests/i18n/slash-command-bidi.test.js` · `tests/coaching/bd-erpvf-hitl-duplicate-recording.test.js` · `tests/observe2/moments-cutoff.test.js` · `tests/observe2/moments.test.js` · `tests/observe2/notes-before-debrief.test.js` · `tests/observe2/parts-by-phase.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/strings.js`)

## Related (all, generated)
- docs: `bot/shared/services/observe/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.md`? · `bot/shared/services/observe/observe2/CLAUDE.index.md`? · `bot/shared/services/observe/observe2/CLAUDE.md`? · `bot/tests/i18n/CLAUDE.md`? · `tests/child-test/L4/CLAUDE.index.md`? · `tests/coaching/CLAUDE.index.md`? · `tests/llm/CLAUDE.index.md`? · `tests/llm/CLAUDE.md`? · `tests/observe2/CLAUDE.index.md`?
