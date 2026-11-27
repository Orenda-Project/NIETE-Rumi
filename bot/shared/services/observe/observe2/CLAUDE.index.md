# observe2 — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/observe/observe2 -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
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
| `retire.js` | (unmapped) |
| `rubric.js` | (unmapped) |
| `rules.js` | Turns the coach's evidence into a level on each of the 17 FICO ICT indicators using workbook thresholds |
| `shadow-v6.js` | (unmapped) |
| `start.js` | Takes /observe2 from the command to the live form in the coach's hands via the visit planner |
| `strings.js` | Chat lines the observe2 coach reads, per language (en, ur), as data |

## Who reads this (all, generated)
- `added-plan.js` ← imported by `bot/shared/routes/observe2-form-endpoint.js:568:a926747d` · `bot/shared/services/observe/observe2/moments.js:437:bdeb2fcc`
- `analysis.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:341:4f57b36d`
- `brief.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:51:e74ee918` · `bot/shared/routes/observe2-form-endpoint.js:53:e74ee918` · `bot/shared/services/observe/observe2/analysis.js:28:d24a68d0`
- `capture-link.js` ← imported by `bot/shared/services/coaching/transcription-processor.service.js:795:c5ac431e` · `bot/shared/services/observe/observe-capture.service.js:141:085a4ade` · `bot/shared/services/observe/observe-who.service.js:272:a9002db2`
- `evidence-check.flow.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:46:ac3410e7` · `bot/scripts/generate-observe2-flow-json.js:14:a0d6e6fe`
- `fico17.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:42:008d225a` · `bot/shared/services/coaching/target-resolver.js:22:979a2ef9` · `bot/shared/services/observe/observe2/analysis.js:27:78dc65ad` · `bot/shared/services/observe/observe2/brief.js:25:cdcc00c1` (+5: `python3 kg/kg.py who-reads fico17.js`)
- `field-form.flow.js` ← imported by `bot/shared/routes/observe2-form-endpoint.js:50:75e0c6ce` · `bot/scripts/generate-observe2-flow-json.js:13:fa226541` · `bot/shared/services/observe/observe2/rules.js:604:7719bf8c`
- `field-form.store.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:38:9d1f3626` · `bot/shared/routes/observe2-form-endpoint.js:46:9d1f3626` · `bot/shared/services/observe/obs612/fico-s-dc.js:119:cb8f5088` · `bot/shared/services/observe/obs612/portal.js:54:97d4f984` (+10: `python3 kg/kg.py who-reads field-form.store.js`)
- `focus-areas.js` ← imported by `bot/shared/services/observe/observe2/analysis.js:30:da728786` · `bot/shared/services/observe/observe2/brief.js:27:84b4f23d`
- `gate.js` ← imported by `bot/shared/services/observe/observe2/start.js:21:b75fdd99`
- `hold.js` ← imported by `bot/shared/services/observe/observe-audio-router.js:124:c705aacb`
- `label-check.js` ← imported by `bot/scripts/fico17-v6-replay.js:454:2343017c` · `bot/shared/services/observe/observe2/moments.js:36:e6990389` · `bot/shared/services/observe/observe2/shadow-v6.js:54:e6990389`
- `llm-reply.js` ← imported by `bot/scripts/fico17-v6-replay.js:455:532845da` · `bot/shared/services/observe/observe2/label-check.js:31:8604a88e` · `bot/shared/services/observe/observe2/moments.js:37:8604a88e` · `bot/shared/services/observe/observe2/shadow-v6.js:55:8604a88e`
- `moment-types.js` ← imported by `bot/scripts/fico17-v6-replay.js:384:5e98e0c9` · `bot/shared/routes/observe2-check-endpoint.js:48:1e8e13a7` · `bot/shared/services/observe/observe2/label-check.js:28:66e4a5fe` · `bot/shared/services/observe/observe2/moments.js:57:feb966ed` (+1: `python3 kg/kg.py who-reads moment-types.js`)
- `moments.js` ← imported by `bot/scripts/fico17-v6-replay.js:451:a2cf7311` · `bot/shared/routes/observe2-form-endpoint.js:450:f3eb7056` · `bot/shared/services/coaching/transcription-processor.service.js:681:649bfc00` · `bot/shared/services/observe/observe-resume.service.js:120:da8694ff` (+1: `python3 kg/kg.py who-reads moments.js`)
- `quote-check.js` ← imported by `bot/scripts/fico17-v6-replay.js:453:90b9437f` · `bot/shared/services/observe/observe2/label-check.js:29:8102501b` · `bot/shared/services/observe/observe2/moments.js:35:2512c22b` · `bot/shared/services/observe/observe2/shadow-v6.js:53:2512c22b`
- `retire.js` ← imported by `bot/shared/handlers/text-message.handler.js:1118:3f7e0d0c` · `bot/shared/services/observe/observe2/hold.js:42:89cfcab9`
- `rubric.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:47:d3060c2f` · `bot/shared/routes/observe2-form-endpoint.js:52:3653a83c` · `bot/shared/services/observe/obs612/visit.js:293:dde98832` · `bot/shared/services/observe/observe2/analysis.js:37:40e7b5ac` (+6: `python3 kg/kg.py who-reads rubric.js`)
- `rules.js` ← imported by `bot/scripts/fico17-v6-replay.js:452:046f76f1` · `bot/shared/routes/observe2-check-endpoint.js:39:db03d371` · `bot/shared/routes/observe2-form-endpoint.js:47:599c638c` · `bot/shared/services/observe/observe2/analysis.js:29:a15dc482` (+4: `python3 kg/kg.py who-reads rules.js`)
- `shadow-v6.js` ← imported by `bot/shared/services/observe/observe2/moments.js:609:ae1e3a55`
- `start.js` ← imported by `bot/shared/handlers/flow-response.handler.js:755:b6625bf3` · `bot/shared/handlers/text-message.handler.js:1123:45962a07` · `bot/shared/services/observe/obs612/visit.js:313:64b8e199` · `bot/shared/services/observe/observe-capture.service.js:217:c63a5597` (+2: `python3 kg/kg.py who-reads start.js`)
- `strings.js` ← imported by `bot/shared/routes/observe2-check-endpoint.js:50:8ace723d` · `bot/shared/routes/observe2-form-endpoint.js:51:8ace723d` · `bot/shared/services/coaching/frameworks/fico17-v6/teacher-report.js:22:b1cdcb7f` · `bot/shared/services/coaching/report-transformers/fico-report-transformer.js:29:55d379ba` (+10: `python3 kg/kg.py who-reads strings.js`)
- column `coaching_sessions.status` (written by `moments.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:57:23fca46d` · `bot/shared/handlers/text-message.handler.js:1985:21a55915` · `bot/shared/handlers/voice-message.handler.js:772:21a55915` (+42: `python3 kg/kg.py who-reads coaching_sessions.status`)
- column `coaching_sessions.updated_at` (written by `capture-link.js`, `moments.js`) ← read by `bot/shared/handlers/text-message.handler.js:2096:a619795a` · `bot/shared/services/coaching/frameworks/fico17-v6/late-write.js:48:d2d332ea` · `bot/shared/services/coaching/lp-coaching/lp-step.service.js:197:6d171412` · `bot/shared/services/coaching/portal-class-check.js:181:5720b09e` (+4: `python3 kg/kg.py who-reads coaching_sessions.updated_at`)
- column `coaching_sessions.user_id` (written by `capture-link.js`) ← read by `bot/shared/calls/call-context.repo.js:65:219f5683` · `bot/shared/calls/call-tools.repo.js:57:23fca46d` · `bot/shared/handlers/text-message.handler.js:1984:a819c701` · `bot/shared/handlers/voice-message.handler.js:771:a819c701` (+56: `python3 kg/kg.py who-reads coaching_sessions.user_id`)
- column `observation_field_forms.answers` (written by `field-form.store.js`) ← read by `bot/scripts/fico17-v6-replay.js:149:00742f6f` · `bot/shared/services/child-test/app/app-api.service.js:243:bbf37085` · `bot/shared/services/child-test/app/sa-api.service.js:104:d5a7d17b`
- column `observation_field_forms.checked_at` (written by `field-form.store.js`) ← read by `bot/scripts/fico17-v6-replay.js:149:00742f6f`
- column `observation_field_forms.coaching_session_id` (written by `field-form.store.js`) ← read by `bot/scripts/fico17-v6-replay.js:149:00742f6f`
- column `observation_field_forms.observer_user_id` (written by `field-form.store.js`) ← read by `bot/scripts/fico17-v6-replay.js:149:00742f6f` · `bot/shared/services/child-test/app/app-api.service.js:243:bbf37085` · `bot/shared/services/child-test/app/sa-api.service.js:104:d5a7d17b` · `bot/shared/services/child-test/conversation/context.js:50:0950e2a7` (+1: `python3 kg/kg.py who-reads observation_field_forms.observer_user_id`)
- column `observation_field_forms.period_minutes` (written by `field-form.store.js`) ← read by `bot/scripts/fico17-v6-replay.js:149:00742f6f`
- column `observation_field_forms.rubric_version` (written by `field-form.store.js`) ← read by `bot/scripts/fico17-v6-replay.js:149:00742f6f`
- column `observation_field_forms.sealed_at` (written by `field-form.store.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:243:bbf37085`
- column `observation_field_forms.teacher_user_id` (written by `field-form.store.js`) ← read by `bot/scripts/fico17-v6-replay.js:149:00742f6f` · `bot/shared/services/child-test/conversation/context.js:50:0950e2a7`
- column `observation_field_forms.visit_context` (written by `field-form.store.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:243:bbf37085` · `bot/shared/services/child-test/app/sa-api.service.js:104:d5a7d17b` · `bot/shared/services/child-test/conversation/context.js:50:0950e2a7` · `bot/shared/services/child-test/store.js:156:5f914959`
- table `coaching_sessions` whole row (`*`) (written by `capture-link.js`, `moments.js`) ← read by `bot/shared/handlers/voice-message.handler.js:770:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:170:d2b02c3e`? · `bot/shared/services/coaching-orchestrator.service.js:226:d2b02c3e`? · `bot/shared/services/coaching/analysis-processor.service.js:136:a23aff58`? (+9: `python3 kg/kg.py who-reads coaching_sessions`)
- table `coaching_sessions` (written by `capture-link.js`, `moments.js`) ← read by `bot/scripts/fico17-v6-replay.js:87:0a1853f5`? · `bot/scripts/quiz/backfill-quiz-lesson-links.js:76:0b673d4d`? · `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:56:4a173bcd`? (+102: `python3 kg/kg.py who-reads coaching_sessions`)
- table `observation_field_forms` (written by `field-form.store.js`) ← read by `bot/scripts/fico17-v6-replay.js:148:9911ecb6`? · `bot/shared/services/child-test/app/app-api.service.js:242:9343047e`? · `bot/shared/services/child-test/app/sa-api.service.js:103:cff3d781`? · `bot/shared/services/child-test/conversation/context.js:49:88aad8a1`? (+3: `python3 kg/kg.py who-reads observation_field_forms`)
- env `COACHING_PHOTO_VISION` read at `bot/shared/services/observe/observe2/moments.js:384:1da2c00c`
- env `OBSERVE2_CHECK_FLOW_ID` read at `bot/shared/services/observe/observe2/moments.js:356:78e28554`
- env `OBSERVE2_CHECK_V6_FLOW_ID` read at `bot/shared/services/observe/observe2/moments.js:355:e1458542`
- env `OBSERVE2_FIELD_FORM_FLOW_ID` read at `bot/shared/services/observe/observe2/start.js:153:54362101`
- env `OBSERVE_VISIT_FLOW_ID` read at `bot/shared/services/observe/observe2/start.js:62:deb1c880`

## Tests (all, generated)
- `added-plan.js` ← `tests/observe2/added-plan-defaults.test.js`
- `analysis.js` ← `tests/coaching/fico17-v6-hitl-report-evidence.test.js` · `tests/coaching/fix-misc-hero-headline.test.js` · `tests/coaching/r2-hero-v6.test.js` · `tests/fixtures/report-prompt-pins.js` · `tests/observe2/end-of-visit.test.js` · `tests/observe2/fico17-v6-check.test.js` (+13: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/analysis.js`)
- `brief.js` ← `tests/observe2/check-endpoint.test.js` · `tests/observe2/coach-notes-brief.test.js` · `tests/observe2/external-plan.test.js` · `tests/observe2/fico17-v6-check.test.js` · `tests/observe2/fico17-v6-report.test.js` · `tests/observe2/lesson-plan-and-fidelity.test.js` (+7: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/brief.js`)
- `capture-link.js` ← `tests/observe2/record-first.test.js` · `tests/observe2/recording-routing.test.js`
- `evidence-check.flow.js` ← `tests/observe2/evidence-check-flow-contract.test.js` · `tests/observe2/fico17-v6-check.test.js` · `tests/observe2/fico17-v6-coach-check.test.js` · `tests/observe2/fico17-v6-missed.test.js` · `tests/observe2/fico17-v6-override.test.js` · `tests/observe2/fix-misc-d2-prefill.test.js` (+7: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/evidence-check.flow.js`)
- `fico17.js` ← `tests/child-test/L4/observe2-offer.test.js` · `tests/observe2/c5-relabel.test.js` · `tests/observe2/check-endpoint.test.js` · `tests/observe2/coach-notes-brief.test.js` · `tests/observe2/end-of-visit.test.js` · `tests/observe2/evidence-check-flow-contract.test.js` (+13: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/fico17.js`)
- `field-form.flow.js` ← `tests/child-test/L4/observe2-offer.test.js` · `tests/observe2/c5-relabel.test.js` · `tests/observe2/check-endpoint.test.js` · `tests/observe2/classroom-photos.test.js` · `tests/observe2/coach-notes-form.test.js` · `tests/observe2/external-plan.test.js` (+10: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/field-form.flow.js`)
- `field-form.store.js` ← `tests/child-test/L4/observe2-offer.test.js` · `tests/coaching/bd-hk2jm3-fde-ict-only.test.js` · `tests/coaching/bd-ra8xu.64.8-coach-in-doubt-v6.test.js` · `tests/coaching/fico-s-routing.test.js` · `tests/llm/observe2-moments-job.test.js` · `tests/observe/obs612-capture.test.js` (+42: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/field-form.store.js`)
- `focus-areas.js` ← `tests/observe2/fico17-v6-report.test.js`
- `gate.js` ← `tests/observe2/start.test.js`
- `hold.js` ← `tests/observe2/obs612-hold-routing.test.js` · `tests/observe2/retire-hold.test.js`
- `label-check.js` ← `tests/observe2/moments-v3.test.js` · `tests/observe2/r2-moments.test.js` · `tests/scripts/fico17-v6-replay.test.js`
- `llm-reply.js` ← `tests/scripts/fico17-v6-replay.test.js`
- `moment-types.js` ← `tests/observe2/fico17-v6-missed.test.js` · `tests/observe2/moments-v3.test.js` · `tests/observe2/r2-moments.test.js`
- `moments.js` ← `tests/llm/observe2-moments-job.test.js` · `tests/observe2/added-plan-defaults.test.js` · `tests/observe2/end-of-visit.test.js` · `tests/observe2/external-plan.test.js` · `tests/observe2/fico17-v6-coach-check.test.js` · `tests/observe2/lesson-plan-and-fidelity.test.js` (+13: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/moments.js`)
- `quote-check.js` ← `tests/observe2/moments-v3.test.js` · `tests/observe2/r2-moments.test.js` · `tests/scripts/fico17-v6-replay.test.js`
- `retire.js` ← `tests/observe2/retire-dispatch.test.js` · `tests/observe2/retire-hold.test.js` · `tests/observe2/retire.test.js`
- `rubric.js` ← `tests/coaching/bd-9bppaz-principal-role-rubric.test.js` · `tests/coaching/bd-pdliko-coach-flag-removed.test.js` · `tests/coaching/fico17-v6-grade-gate.test.js` · `tests/coaching/obs612-grade-override.test.js` · `tests/coaching/r2-dc.test.js` · `tests/observe/obs612-lesson.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/rubric.js`)
- `rules.js` ← `tests/observe2/c5-relabel.test.js` · `tests/observe2/field-form-flow-contract.test.js` · `tests/observe2/materials-used.test.js` · `tests/observe2/moments-v3.test.js` · `tests/observe2/part2-checking-moves.test.js` · `tests/observe2/parts-by-phase.test.js` (+6: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/rules.js`)
- `shadow-v6.js` ← `tests/observe2/r2-moments.test.js` · `tests/observe2/shadow-v6-late.test.js` · `tests/observe2/shadow-v6.test.js`
- `start.js` ← `tests/child-test/L4/text-dispatch.test.js` · `tests/observe/obs612-lesson.test.js` · `tests/observe2/command-dispatch.test.js` · `tests/observe2/record-first.test.js` · `tests/observe2/recording-intake.test.js` · `tests/observe2/recording-photo-pause.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/start.js`)
- `strings.js` ← `bot/tests/i18n/slash-command-bidi.test.js` · `tests/coaching/bd-erpvf-hitl-duplicate-recording.test.js` · `tests/coaching/fico17-v6-d2-wording.test.js` · `tests/coaching/r2-hero-v6.test.js` · `tests/observe2/fico17-v6-check.test.js` · `tests/observe2/fico17-v6-missed.test.js` (+14: `python3 kg/kg.py who-reads bot/shared/services/observe/observe2/strings.js`)

## Related (all, generated)
- docs: `bot/shared/services/observe/CLAUDE.md`?
