# coaching — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/coaching -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fidelity/` | Tests for lesson-plan fidelity: grader, scorer, orchestrator, LP linking and selection → `fidelity/CLAUDE.md` |
| `live-moves/` | Tests for live moves: the live list of v10 card moves ticked during a lesson → `live-moves/CLAUDE.md` |
| `report-transformers/` | Tests for per-framework report transformers that shape analysis into reportData → `report-transformers/CLAUDE.md` |
| `video-reco/` | Tests for video recommendation: clip pick, copy, name redaction, strip, send and A/B → `video-reco/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `ab-v10-arms.test.js` | Pins which v10 A/B group (A-D) a teacher's school falls in via niete_coaching_ab_assignment; null when off (ab-v10-arms) |
| `ab-v10-switch.test.js` | Pins the v10 coaching test master switch app_settings.ab_v10_enabled: fail-closed on missing row, junk or read error |
| `analysis-output-language.test.js` | Analysis prompt and reflective extraction run in the teacher's stored language, not the transcriber's label |
| `analysis-processor-prior-action.test.js` | Scoring call gets the teacher's prior action record only when the uptake loop is on (analysis-processor.service) |
| `analyze-pedagogy-framework-dispatch.test.js` | Conformance: the framework argument to analyzePedagogy drives prompts; default stays inline OECD (gpt5-mini.service) |
| `angle-ladder-without-reflection.test.js` | The angle ladder ask works on the no-reflection path, with real cue and model line (commitment-card, uptake-loop) |
| `assistant-recording-minimum.test.js` | Every assistant prompt variant states the recording minimum derived from the routing constant (classroom-audio.config) |
| `audio-document-oversize.test.js` | Webhook refuses an audio DOCUMENT over 100 MB though Meta sends no file_size; real handleDocumentMessage path |
| `audio-never-writes-language.test.js` | Classroom audio must not write a teacher's stored language; write gated by a flag default OFF, verbal override untouched |
| `bd-0c01q-fico-v4.test.js` | bd-0c01q: FICO v4 framework, 26 indicators, three count-based rungs, applicable-only; red-first prompt and scoring rules |
| `bd-0c01q-observe-scale.test.js` | bd-0c01q: /observe HITL form takes its rating scale from the FICO framework, never pre-selects non-applicable indicators |
| `bd-0c80s-guard-ignores-observe.test.js` | bd-0c80s: in-flight guard ignores a coach's observation OF the teacher so a first recording is not deferred |
| `bd-0wws3e-lp-pdf-nul-and-corpus-link.test.js` | bd-0wws3e: Urdu LP PDF extraction strips NUL bytes, links own corpus LP by lesson_id, saves safely (extraction worker) |
| `bd-1mcpe-per-photo-captions.test.js` | bd-1mcpe: one report caption per framed photo from that photo's own description, first clause only (photo-note) |
| `bd-1t1wz-fico-bilingual-headings.test.js` | bd-1t1wz: Urdu DC report carries bracketed Urdu FICO section labels, English variant stays English (fico-adapter) |
| `bd-1t1wz-fico-domain-whys.test.js` | bd-1t1wz: narrative prompt asks a grounded one-line why per FICO domain in en and ur, preferring coach-edited evidence |
| `bd-1t1wz-hero-why-render.test.js` | bd-1t1wz: hero report template renders the localised why line under each scored bar, nothing when absent |
| `bd-1t1wz-translit-net.test.js` | bd-1t1wz: code-switch net in narrative.service covers transliteration forms found in prod audit; runs on commitment card |
| `bd-2457-niete-lever-constraint.test.js` | bd-2457 (NIETE port): constrains the /observe debrief step-3 lever question in the FICO and MEWAKA frameworks |
| `bd-2700-stale-thresholds-configurable.test.js` | bd-2700: stale-session reminder (2h) and auto-complete (12h) thresholds are env-configurable with prod defaults |
| `bd-2c1gj-lp-select-confirm.test.js` | bd-2c1gj: tapping a recent lesson plan asks Yes/Cancel first, nothing linked until confirmed; Urdu copy, 20-char buttons |
| `bd-3ipd2-photo-capture-routing.test.js` | bd-3ipd2: pure routing helpers deciding when an image document counts as a classroom photo (photo-capture-routing) |
| `bd-47vud-caption-no-dangling-cut.test.js` | bd-47vud: over-cap (110 char) photo captions end on a whole phrase, not a dangling word (photo-note) |
| `bd-59840-honest-wait-no-ack.test.js` | bd-59840: step 1/5 wait copy states minutes for long recordings; post-transcription acknowledgement removed |
| `bd-5lrgh-lp-mismatch-reason.test.js` | bd-5lrgh: a lesson-plan mismatch is explained with a catalogue line in en/ur, only for flagged mismatches scoring 0 |
| `bd-5lrgh-mismatch-line-only.test.js` | bd-5lrgh follow-up: Section B mismatch line is the catalogue sentence only; narrative never asked to explain it |
| `bd-5n1a2-flow-generator-shape.test.js` | bd-5n1a2: generated FICO observe Flow asset has per-move fidelity slots matching the endpoint and Meta caps |
| `bd-5n1a2-flow-move-blocks.test.js` | bd-5n1a2: review Flow shows measured fidelity per move as the scorer computes it (composeMoveBlocks, buildScreenPrefill) |
| `bd-5n1a2-overall-pct-zero.test.js` | bd-5n1a2: hero report derives overall from groups when flat pct is absent, so no false 0% (score-adapter.service) |
| `bd-5rz1v-internal-coaching-routes.test.js` | bd-5rz1v: /api/internal/coaching/* routes pass a library lesson-plan pick through and 400 on unwritten plans |
| `bd-5rz1v-portal-lesson-plan-library.test.js` | bd-5rz1v: the four lookups behind a portal library lesson-plan pick reuse the WhatsApp teacher's existing paths |
| `bd-5rz1v-portal-library-plan.test.js` | bd-5rz1v: startPortalSession and afterTranscription link a portal recording to a library or recent lesson plan |
| `bd-5rz1v.6-internal-observe-routes.test.js` | bd-5rz1v.6: internal API behind a coach's portal observation passes named fields, needs shared secret and user |
| `bd-5tgzv-resend-as-image.test.js` | bd-5tgzv: a deduped report resend uses the same delivery (image vs document) as the first report (audio-hash-cache) |
| `bd-60106-late-reflective-answer.test.js` | bd-60106: a late reflective answer is recorded however long it took; routing is clock-free (reflective-answer-routing) |
| `bd-60106-reflection-count-single-source.test.js` | bd-60106: the reflection count told to a teacher derives from NUM_REFLECTIVE_QUESTIONS (reflection-progress) |
| `bd-6fdy3-reflection-redesign.test.js` | bd-6fdy3: redesigned single reflection question (impasse, if-then, guardrails, judgemental-word filter) |
| `bd-78i2k-portal-audio-source.test.js` | bd-78i2k: transcription reads portal-session audio from R2 (audio_url) and WhatsApp audio by media id |
| `bd-7beiz-audio-hash-dedupe.test.js` | bd-7beiz: sha256 audio hash and recent-duplicate-session lookup so the same recording scores the same (audio-hash-cache) |
| `bd-7beiz-dedupe-call-site.test.js` | bd-7beiz: the dedupe branch as wired in transcription-processor skips upload and transcription on a resubmission |
| `bd-7kc2z-reflection-silent-mode.test.js` | bd-7kc2z: reflective debrief in silent (portal) mode returns the question and sends nothing to WhatsApp |
| `bd-809g50-portal-plan-race.test.js` | bd-809g50: a portal analysis waits for the teacher's lesson-plan read to finish before grading (analysis-processor) |
| `bd-8s2xb-photo-prompt-modes.test.js` | bd-8s2xb T1-T3: FICO prompt photo channel per mode (text, off, image, both) in fico-framework |
| `bd-8s2xb-photo-surfaces.test.js` | bd-8s2xb T10-T12: photo note reaches the hero report caption and the coach draft keeps its Photo: prefix |
| `bd-8s2xb-processor-photo-channel.test.js` | bd-8s2xb T5-T9: analysis processor downloads and describes photos, persists photo_mode and counts (analysis-processor) |
| `bd-8s2xb-scorer-image-encode.test.js` | bd-8s2xb T8: encodeForScorer rotates, downsizes to 768 and base64-encodes; library failure rejects (scorer-image) |
| `bd-8s2xb-scoring-call-images.test.js` | bd-8s2xb T4: image modes attach photos to the scoring call only, via real analyzePedagogy with the FICO module |
| `bd-9h2mm-processor-marks-section-b.test.js` | bd-9h2mm: processor marks Section B not-assessed when no lesson plan or fidelity engine failed (analysis-processor) |
| `bd-9h2mm-section-b-not-assessed.test.js` | bd-9h2mm: Section B leaves the FICO total when no fidelity was measured and every surface says so |
| `bd-9h2mm-voice-not-assessed.test.js` | bd-9h2mm: voice-note payload hands the model no lesson-plan fidelity figure for an unassessed section |
| `bd-aqotzx-portal-class-check.test.js` | bd-aqotzx: portal recording that is not a class waits for the teacher's answer before analysis (portal-class-check) |
| `bd-azzhu-survey-after-voice.test.js` | bd-azzhu: coaching usefulness survey goes out once right after the voice debrief with session-bound buttons |
| `bd-b3pop-photo-vision-v2.test.js` | bd-b3pop.15/.17: vision pass v2, one reading per re-encoded photo, high detail, JSON, pinned prompts (photo-analysis) |
| `bd-b3pop-processor-photo-evidence.test.js` | bd-b3pop: chain processor, vision v2, photo evidence schema and fidelity grader prompt, run for real |
| `bd-b3pop-report-photo-strip.test.js` | bd-b3pop.17: a photo the vision pass excluded is not framed in the teacher report strip (classroom-photo-vm) |
| `bd-b3pop-telemetry-kept-from-prompts.test.js` | bd-b3pop: grading and photo telemetry never reaches voice-note or debrief-guide prompts (report-generator) |
| `bd-b3pop-vision-options.test.js` | bd-b3pop.15: vision.service analyzeImage accepts prompt/temperature/token/format/timeout options; default unchanged |
| `bd-bmc9a0.2-iab-save-and-24h.test.js` | bd-bmc9a0.2: IAB save-recording and a switch giving unreflected IAB lessons 24h (not 12h) before auto-complete |
| `bd-c5reix-portal-duplicate-quiet.test.js` | bd-c5reix D7: dedupe backstop on a portal recording reuses the prior score and sends nothing to WhatsApp |
| `bd-c5reix-portal-start-and-routes.test.js` | bd-c5reix: portal submit with a WhatsApp-kept recording key starts a session; same key again is 409 already_sent |
| `bd-c5reix-r2-metadata.test.js` | bd-c5reix: R2 uploadBuffer stores sha256 and length as object metadata and returns them on HEAD (shared/storage/r2) |
| `bd-c5reix-save-bound-and-ended-sessions.test.js` | bd-c5reix: keepRecording save is time-bounded so the link still goes; an ended session does not use up the recording |
| `bd-c5reix-whatsapp-recording-kept.test.js` | bd-c5reix: keepRecording saves a 15+ minute WhatsApp lesson for the app under the portal audio tree, deduped |
| `bd-c5zs1-editable-fidelity.test.js` | bd-c5zs1: coach edits measured fidelity in the v4 review Flow; composeEditableFidelity prefill, rescore from edits |
| `bd-cbe2d-photo-scoring-fallback.test.js` | bd-cbe2d: a rejected image scoring call retries text-only so photos never fail a session; provenance kept |
| `bd-di5ap-no-premature-praise.test.js` | bd-di5ap: removes the Long Lesson Detected warning and the model call between transcription and the photo prompt |
| `bd-erpvf-hitl-duplicate-recording.test.js` | bd-erpvf: a coach's /observe recording is analysed once; prior leader observation lookup and en/ur refusal string |
| `bd-fe35j9-urdu-pdf-vision-retry.test.js` | bd-fe35j9: extraction worker retries a rejected typed-Urdu LP PDF through the vision model (lesson-plan-extraction) |
| `bd-fgj73x.7-portal-short-recording.test.js` | bd-fgj73x.7: a portal recording under 15 minutes (900 s) is closed with no flow or report (portal-short-recording) |
| `bd-fmf24g.10-report-narrative.test.js` | bd-fmf24g.10: hero report narrative is persisted into analysis_data without clobbering other keys (narrative-store) |
| `bd-fmf24g.66-late-plan-recompute.test.js` | bd-fmf24g.66: Section B is recomputed when a coach-attached plan finishes extracting mid-analysis (analysis-processor) |
| `bd-fmf24g.76-dc-no-class-and-ten-photos.test.js` | bd-fmf24g.76: v2 portal DC start asks no class (subject resolved as on WhatsApp) and accepts up to ten photos |
| `bd-fmf24g.9-teacher-class-reaches-analyser.test.js` | bd-fmf24g.9: the teacher's class pick reaches the analyser as subject/grade and wins over a plan (analysis-processor) |
| `bd-fmf24g.9-teacher-class.test.js` | bd-fmf24g.9: the v2 app class pick is stored and is tier 0 of resolveLessonSubject; disagreement reported only |
| `bd-fmr3s-session-complete-merged.test.js` | bd-fmr3s (DC:137): session-complete line and commitment question are one message, completion leading, in Urdu too |
| `bd-gdfl3-voice-reads-measured-fidelity.test.js` | bd-gdfl3: the voice note speaks the same measured fidelity figure the report shows, not a stale whole-plan estimate |
| `bd-gfsja-report-language-join.test.js` | bd-gfsja: report language comes from the joined preferred_language, not an English floor (report-generator, pdf-report) |
| `bd-gr48y-photo-into-analysis.test.js` | bd-gr48y: metadata.photoAnalysis reaches framework.buildAnalysisPrompt as its 4th arg (gpt5-mini.service) |
| `bd-gr48y-processor-vision.test.js` | bd-gr48y: processAnalysis runs the vision pass when photos exist and feeds analyzePedagogy photoAnalysis |
| `bd-h9gnk-midflight-watchdog.test.js` | bd-h9gnk: watchdog classifies sessions stuck mid-flight past a 45-minute grace and recovers them (stale-recovery) |
| `bd-hr97y-dc-dedupe-no-window.test.js` | bd-hr97y: DC duplicate-recording lookup has no time window; an old identical recording is reused, not rescored |
| `bd-j3j4b-photo-gate-sweep.test.js` | bd-j3j4b/bd-5knlj: shouldAutoAdvancePhotoGate and gateThresholdFor advance sessions stranded at the photo/LP gate |
| `bd-jbjrx-step-language.test.js` | bd-jbjrx/bd-8ctnq: the five DC step messages follow the chosen language and the step counter uses digits |
| `bd-jud1e-lpfidelity-denominator.test.js` | bd-jud1e: applyLpFidelity keeps the applicable-aware denominator; only computeScores writes overall_max_marks |
| `bd-lfzoz-internal-coaching-routes.test.js` | bd-lfzoz: bot internal API /api/internal/coaching/* for portal-uploaded recordings; refuses requests without userId |
| `bd-lfzoz-portal-coaching.test.js` | bd-lfzoz: portal-coaching.service presigns audio PUTs and starts a session from a portal-uploaded recording |
| `bd-lfzoz-portal-pipeline.test.js` | bd-lfzoz: the three places a portal row (R2 key portal_<id>) differs from WhatsApp: hand-off, handlers, stale recovery |
| `bd-pv2tl-classroom-photo-vm.test.js` | bd-pv2tl: report photo strip builder caps at 2, returns base64 data URIs, skips a failed download (classroom-photo-vm) |
| `bd-pzs9a-photo-add-another.test.js` | bd-pzs9a: Add another keeps the session on the photo step; a redelivered tap is not counted twice (add-another) |
| `bd-s192t-fallback-copy.test.js` | bd-s192t.4: Section B fallback copy states the true cause per failure state (observe-draft.service) |
| `bd-s192t-roles-threading.test.js` | bd-s192t.1: regression for the 44fe3ae roles ReferenceError; runs the real transcription chain (audio.service) |
| `bd-s7c31y-portal-report-no-step-messages.test.js` | bd-s7c31y: a teacher's portal DC recording gets no Step 4/5 or 5/5 WhatsApp text from the report job |
| `bd-sk206-step5-single-voice-message.test.js` | bd-sk206: Step 5 sends one text before the voice note, not two; retired caption is not sent in either language |
| `bd-tbprit.1-coach-disagreement-evidence.test.js` | bd-tbprit.1: pure evidence a coach sees per reason behind a teacher's Not accurate (coach-disagreement-evidence) |
| `bd-tbprit.1-coach-disagreements-service.test.js` | bd-tbprit.1: coach disagreements list in the portal, To do vs Done ordering and row shape (coach-disagreements.service) |
| `bd-tbprit.10-coach-pattern-card.test.js` | bd-tbprit.10: coach card carries the Is this a pattern data (last 12 lessons, missed step) (coach-disagreements.service) |
| `bd-tbprit.10-coach-pattern.test.js` | bd-tbprit.10: patternOf computes trend, average/best, recordings a week and the most-missed step (disagreement-pattern) |
| `bd-tbprit.11-coach-plan-card.test.js` | bd-tbprit.11: coach card carries the saved plan (no AI cache/timestamps) and the teacher's number as wa.me digits |
| `bd-tbprit.11-coach-plan.test.js` | bd-tbprit.11: server half of the Coaching suggestion box: savePlan and publicPlan, teacher-was-right flag with Undo |
| `bd-tbprit.12-coach-done-undo.test.js` | bd-tbprit.12: markDone and markUndone move a coach's own card between Done and To do; other coaches' cards untouched |
| `bd-tbprit.16-coach-next-visit.test.js` | bd-tbprit.16: list rows expose nextVisit from coach_plan.addedToVisitAt for the For your next visit group |
| `bd-tbprit.2-coach-disagreement-clip.test.js` | bd-tbprit.2: 60 s mp3 clip cut by ffmpeg starting 15 s before the grader timestamp (coach-disagreement-clip) |
| `bd-tbprit.7-coach-list-prototype.test.js` | bd-tbprit.7: coach list rows per the prototype: teacher, school, unread dot, tags with numbers, recordingRate |
| `bd-tbprit.9-coach-clip-window.test.js` | bd-tbprit.9: clip with an end time plays exactly at..to (max ten minutes) via GET /clip (coach-disagreements.routes) |
| `bd-tbprit.9-coach-recording-length.test.js` | bd-tbprit.9: recording length on the coach card; under 15 min tags the row Short recording (coach-disagreements) |
| `bd-u35ex-photo-done-handler.test.js` | bd-u35ex: source guard that the image handler handles photo_done_ and photo_more_ buttons; LP step commits after prompt |
| `bd-v0toag.1.2-check-back-sent.test.js` | bd-v0toag.1.2: coaching.report.check_back_sent logged when a prior commitment is returned on the next recording |
| `bd-v0toag.1.2-move-committed.test.js` | bd-v0toag.1.2: coaching.report.move_committed logged only on a Yes tap (card_yes_) (card-response.service) |
| `bd-v0toag.1.2-report-events.test.js` | bd-v0toag.1.2/.1.3: coaching.report.generated and .sent log events with uuid userId and sessionId, no table writes |
| `bd-v0toag.1.2-report-generator-events.test.js` | bd-v0toag.1.2/.1.3: generateReport emits report.generated once rendered and report.sent only after WhatsApp accepts |
| `bd-v0toag.1.4-urdu-span-font.test.js` | bd-v0toag.1.4: every Urdu-script span in the hero report is drawn in an Urdu-capable font, no tofu boxes |
| `bd-v0toag.1.5-one-next-step.test.js` | bd-v0toag.1.5: horizon, try box and stored focus all come from one selected step; v10 groups C and D only |
| `bd-v0toag.100.10-no-technology-ask.test.js` | bd-v0toag.100.10: Taleemabad technology use (C10) is never picked as the one thing to try (prioritized-action) |
| `bd-v0toag.19-report-link-send.test.js` | bd-v0toag.19: groups C and D get a cta_url button to /cr/<token> after the report image; text fallback on failure |
| `bd-v0toag.38.9-agree-ping-service.test.js` | bd-v0toag.38.9: Do you agree coach ping via template coach_visit_request_v2 (six params), reasons and card link |
| `bd-v0toag.38.9-coach-note-store.test.js` | bd-v0toag.38.9: teacher voice note for her coach is stored/presigned via the dashboard's own R2 SDK (coach-note-store) |
| `bd-v0toag.45-coach-visit-service.test.js` | bd-v0toag.45: ask-my-coach-to-visit parts: coach_visit_request_v1 template (en_US+ur, 3 params) and V1.6.7 migration |
| `bd-v0toag.49-useful-survey.test.js` | bd-v0toag.49: Do you agree with this report survey for groups A/B only while the test is on; Urdu; send never throws |
| `bd-v0toag.49-useful-wiring.test.js` | bd-v0toag.49: Was this useful survey wired end to end: asked after voice debrief, coaching_fb_ taps routed |
| `bd-v0toag.57-report-card.test.js` | bd-v0toag.57: pure report-card content shared by the /cr page and the slim WhatsApp image (stepOf, wells) (report-card) |
| `bd-v0toag.57-slim-report.test.js` | bd-v0toag.57: groups C and D get a slim ICT-3 report image linking to the /cr page (slimReportFor) |
| `bd-v0toag.79-neutral-question.test.js` | bd-v0toag.79: report feedback question asks what the teacher thinks, not whether she agrees (leading-question fix) |
| `bd-v0toag.80-metrics-write.test.js` | bd-v0toag.80: agree thumb and reason update coaching_quality_metrics, never insert a third row when two exist |
| `bd-v0toag.85-urdu-wells.test.js` | bd-v0toag.85: Urdu report card uses the stored Urdu strength_note, not English grader text, for what went well |
| `bd-we73k-pasted-lesson-plan.test.js` | bd-we73k: a lesson plan pasted as chat text at the coaching LP step is attached to the waiting session |
| `bd-x3k1q-session-complete-boundary.test.js` | bd-x3k1q (DC:133): coaching session announces it is complete, in the teacher's language, before the next feature speaks |
| `bd-xc6jv-narrative-applicable.test.js` | bd-xc6jv: non-applicable indicators (maths for an Urdu lesson) are never named as weaknesses in the narrative |
| `bd-yy4l2-hots-scorecard-derive.test.js` | bd-yy4l2: HOTS scorecard re-derives per-area scores from scrambled goalN_* slots instead of rendering 0/N (hots-adapter) |
| `bd1sddt-skip-reflection.test.js` | bd-1sddt: skipReflection flag queues a report-only recovery for sessions stranded at the photo/LP gate |
| `bd2413-output-language.test.js` | bd-2413 (FEAT-106): coaching output language follows preferred/locked language; off-market languages rejected |
| `bd2414-contextual-voice-closer.test.js` | bd-2414 (FEAT-106): reflection closing voice note is a contextual acknowledgement in the teacher's language |
| `bd2415-narrative-codeswitch.test.js` | bd-2415 (FEAT-106): fixCodeswitch undoes literal Urdu translations of pedagogy terms; prompt keeps concepts in English |
| `bd2416-voice-gender.test.js` | bd-2416 (FEAT-106): voice debrief uses female first person for Rumi's own voice, gender-neutral for the teacher |
| `bd2417-stale-recovery.test.js` | bd-2417 (FEAT-106): worker auto-confirms sessions stuck at the confirmation gate (classifyStuckInitiatedSession) |
| `bd2636-classroom-photo-status.test.js` | bd-2636: photo gate accepts both awaiting_photo and AWAITING_CLASSROOM_PHOTO statuses (coaching-photo-status) |
| `bd2651-voice-language-rules.test.js` | bd-2651: shared Urdu voice-language rules (Nastaliq, no Roman-Urdu, no Hindi vocabulary) in acknowledgement builder |
| `bd2662-meaningful-remark.test.js` | bd-2662: reflective closing remark is a why-it-matters coaching insight, not an echo (reflective-acknowledgement) |
| `bd3b0co-language-unify.test.js` | bd-3b0co: report language unified on determineOutputLanguage; no teacher-facing site falls back to transcript_language |
| `brief-loop-source.test.js` | leader-source.buildBrief carries the open uptake-loop target into the coach Support Brief, behind the flag |
| `brief-loop.test.js` | Coach Support Brief opens with open target, attempts and last lesson (observe-brief-card, observe-visit-flow) |
| `card-buttons-routed.test.js` | Commitment-card Yes / Maybe later / Not for me buttons are routed and record teacher_response (card-response.service) |
| `card-v2-loop.test.js` | Commitment card v2 with the loop on: target, attempt, angle, no repeated framing, one move (commitment-card.service) |
| `coaching-breakdown-unknown-domains.test.js` | A session scored on domains the framework does not list still shows its real domains, never 0 of 0 (coaching-breakdown) |
| `coaching-card.test.js` | bd-615/616/617: prioritized action generation and coaching card canvas image (prioritized-action, card services) |
| `coaching-confirm-language.test.js` | Classroom-audio confirmation message and buttons speak the teacher's language within code-point caps (coaching-session) |
| `coaching-debrief-config.test.js` | Conformance: coaching-debrief.config is the single source for reflective question count; loop bound derives from it |
| `coaching-feedback.test.js` | Post-coaching micro-survey: was this useful, and what could we do better on a thumbs down (coaching-feedback.service) |
| `coaching-flow-integration.test.js` | bd-622/bd-618 wiring: LP selection list vs buttons in the coaching flow and the coaching card in the report flow |
| `coaching-latin-runs.test.js` | An English phrase with & inside an Urdu hero report or commitment card is one LTR isolate and the & is never cut |
| `commitment-card-content.test.js` | Commitment card content: Q3 extraction with last-answer fallback and per-language prompt rules (commitment-card.service) |
| `commitment-card-fallback.test.js` | Commitment card graceful-degrade ladder: missing or too-short Q3 falls to the rule-based card (commitment-card.service) |
| `continue-coaching-tap.test.js` | Stale-session Continue coaching tap honours NUM_REFLECTIVE_QUESTIONS and queues the report when all are answered |
| `corpus-time-anchor.test.js` | bd-gr4fy.5.13: reflective corpus time anchors are in the teacher's script and spelled right (corpus-prompt) |
| `devanagari-guard.test.js` | bd-bfy69: devanagari-guard detects Devanagari in real prod-derived strings and guarantees none is rendered |
| `devanagari-transcribe-recovery.test.js` | bd-bfy69: source assertions on audio.service for the three layers: no Hindi hint, forced-Urdu retry, guard |
| `document-audio-routing.test.js` | WhatsApp documents with an audio MIME route to the coaching audio pipeline; PDFs fall through; 100 MB cap |
| `elevenlabs-lazy-openai.test.js` | Regression: ElevenLabsService builds its OpenAI TTS-fallback client lazily, so requiring the module never needs a key |
| `enhance-carries-first-pass-keys.test.js` | The reflection-enhancement pass carries every first-pass key (focus_area, uptake) and framework scores still win |
| `fallback-card-skips-non-applicable.test.js` | Rule-based fallback card never names a non-applicable indicator and reads the scale from the framework |
| `feat106-answer-acknowledgement.test.js` | FEAT-106 #4a (bd-2374): acknowledgement prompt and generator after the single reflective answer |
| `feat106-change1-one-reflective-question.test.js` | FEAT-106 CHANGE 1 (bd-2346): exactly one reflection question per observation, then the flow stops |
| `feat106-change4b-no-double-card.test.js` | FEAT-106 CHANGE 4b (bd-2346): the action ships once inside the hero card; no standalone commitment-card image |
| `feat106-image-idempotency.test.js` | FEAT-106 #2 (bd-2371): an at-least-once redelivered lesson-plan image is processed once (image-message.handler) |
| `feat106-jargon-simplify.test.js` | FEAT-106 #9 (bd-2373): simplifyPedagogyJargon glosses scaffolding, extension etc. in the card and report |
| `feat106-lp-content-validation.test.js` | FEAT-106 #8 (bd-2372): isLikelyLessonPlan rejects a leave/application letter sent as a lesson plan |
| `feat106-multiaudio-guard.test.js` | FEAT-106 #3 (bd-2376): mid-flight status and defer rules for a second recording while the first is processing |
| `feat106-soniox-cleanup.test.js` | FEAT-106 (bd-2378): planSonioxDeletions removes old completed Soniox transcriptions, never in-flight ones |
| `feat106-soniox-models.test.js` | FEAT-106 #1 (bd-2377): Soniox v5 primary / v4 backup constants, env-overridable, and request-body builder |
| `feat106-urdu-tts-normalizer.test.js` | FEAT-106 #4b (bd-2375): normalizeForUrduTTS spells small digits as words for the Sara voice, keeps large numbers |
| `feat106-whisper-chunking.test.js` | FEAT-106 #1 (bd-2377): planWhisperChunks splits audio over the 25 MB Whisper cap for the last-resort transcriber |
| `fico-framework-ict.test.js` | bd-2039: FICO framework carries the canonical ICT rubric (sections B/C/D/F, B1-B7), registry and region-config |
| `fico-framework.test.js` | FICO framework module-interface contract and max-marks consistency (fico-framework) |
| `fico-subject-conditional-rule.test.js` | Section F subject rule flips with subject confidence: high confidence scores only the matching subject row |
| `fidelity-phase-loop.test.js` | choosePhaseTarget and derivePhaseUptake coach the lesson phase a teacher repeatedly fails (uptake-loop.service) |
| `fidelity-phase-wiring.test.js` | Wiring for the phase loop: loadRecentFidelity feeds the carry step, which computes a phase target for graded lessons |
| `first-use-intro-one-message.test.js` | First-use AI coach intro film arrives as one message with the intro line as caption (feature-intro.service) |
| `framework-prompt-heard-language.test.js` | Framework prompts keep output language and heard (spoken) language as two separate values (fico-framework) |
| `framework-registry.test.js` | bd-596: framework-registry getFramework and framework-selector return the right module per framework name |
| `framework-selection-reason.test.js` | FEAT-060 (bd-2105): selectFrameworkWithReason returns the framework plus why (user preference, region map, default) |
| `framework-wiring.test.js` | bd-609: region to framework is env-driven (REGION_FRAMEWORK_MAP) with default fallback, wired into analysis (registry) |
| `gender-neutral-urdu-address.test.js` | bd-gr4fy.5.12: Urdu reflective question and commitment card never put the teacher in a gendered verb form |
| `guide-previous-focus.test.js` | Coach debrief guide opens with the previous-visit block: ask, attempt number, last lesson, hand-over (debrief-guide) |
| `hero-narrative-corpus.test.js` | bd-1842/1843: reflective_corpus flows into the hero narrative prompt and output guards (narrative.service) |
| `hero-partial-note.test.js` | bd-1r3k2h: hero image report shows the partial-report note when the reflection was skipped (hero template/service) |
| `hero-render-fallback.test.js` | Hero render failure falls back to the PDFKit renderer; PDFKit is never called when hero succeeds (renderer-registry) |
| `hero-report-english-chrome.test.js` | FEAT-106 CHANGE 4 (bd-2346): hero card chrome labels render in English even for an Urdu report |
| `hero-report-language-resolution.test.js` | bd-gipr1: report language is constrained to the offered languages; caller, analysis, transcript fallback order |
| `hero-report-urdu-font-fallback.test.js` | bd-osmk0: Urdu content in a Latin-branch report still gets an Urdu-capable font, no tofu boxes (hero template) |
| `hero-uptake-block.test.js` | Hero report uptake block (Last time we asked: Done / Getting there / Not this time) from loop state, never a score |
| `hots-framework-alignment.test.js` | NOTION-327d-a9: HOTS framework has 16 indicators across 5 areas, max 48, aligned to PESRP/PECTAA |
| `hots-framework.test.js` | bd-593: HOTS framework module interface, max marks 48 and report transformer integration (hots-framework) |
| `incomplete-fico-analysis.test.js` | An incomplete FICO analysis is retried once and never scored 0 for missing sections; logs coaching.analysis.sections |
| `inflight-guard-document-door.test.js` | bd-1r3k2h: a recording sent as a file mid-analysis is deferred like a voice note (coaching-inflight-guard, COA09) |
| `load-prior-action.test.js` | loadPriorAction returns the newest action record from self-serve or a coach /observe visit (coaching-trend.service) |
| `lp-coaching-link.test.js` | bd-619/620/621: LP selection list builder, LP linker and coaching integration (lp-selection-list, lp-coaching-linker) |
| `lp-extraction-payload.test.js` | bd-dflr7: extraction worker stores full lesson_plan_text in the completed payload and hooks fidelity recompute |
| `lp-list-selection-handler.test.js` | bd-wa5io: LP list taps (lp_none_, lp_upload_, plan pick) route to handleLpListSelection and trigger late recompute |
| `lp-observation-prompt.test.js` | bd-5knlj: LP Yes/No prompt on a leader observation asks about the teacher's plan; self-record copy unchanged |
| `lp-response-marker.test.js` | bd-5knlj: handleLessonPlanResponse(No) writes lesson_plan_link_method=none beside has_lesson_plan=false |
| `lp-vision-ocr.test.js` | bd-o1m1m: scanned multi-page LP PDFs are rendered and OCRed per page via a vision model (lp-vision-ocr.service) |
| `meta-bill-nc1-confirm-carries-wait.test.js` | Meta bill NC1: the confirm prompt carries the 15-minute wait and the Yes tap gets an hourglass reaction, not a text |
| `meta-bill-nc2-report-caption.test.js` | Meta bill NC2/NC5: Step 5/5 and auto-complete notice ride on the report image caption; 1,024 code-point fallback |
| `meta-bill-nc3-lp-outcome-on-step2.test.js` | Meta bill NC3: the lesson-plan outcome rides on Step 2/5 instead of its own message (webhook and LP processor) |
| `meta-bill-nc4-photo-step.test.js` | Meta bill NC4: classroom-photo step sends fewer bubbles: offer carries the instruction, one receipt per photo burst |
| `meta-bill-nc4-prior-reminder-wiring.test.js` | Meta bill NC4: prior-commitment reminder merges into the photo offer, one bubble, via the real transcription job |
| `meta-bill-nc5-sweeper-repeats.test.js` | Meta bill NC5: stale sweep sends one reminder per teacher per sweep, for the newest session, through the real jobs |
| `meta-bill-wamid-wiring.test.js` | Meta bill: the webhook and image handler hand the inbound wamid down so card, photo and Yes taps can react |
| `multi-framework-report-integration.test.js` | bd-610: end-to-end pipeline from analysis data to reportData per framework (OECD 5 goals + debrief, HOTS 5 goals) |
| `next-step.test.js` | bd-v0toag.1.5: selectNextStep picks ONE step per report and focusPatch stores it (next-step, next-step-store) |
| `observation-score-bands.test.js` | Observation score bands stay portal-only: coaching report image and card keep numbers, no band word replaces a score |
| `observe-draft-uptake-record.test.js` | /observe writes the uptake loop record in the same update as observer_review_complete when the loop is on |
| `observe-form-fidelity-why-line.test.js` | Coach's editable Section B form shows the grader's rationale for every move verdict (observe-draft.service) |
| `observe-gates.test.js` | bd-9hzdn.1/.3: after an /observe transcription the flag gates photo/LP prompts in the observer's language |
| `oecd-framework.test.js` | bd-592: OECD framework module interface and max marks 103 (oecd-framework) |
| `practice-tag.test.js` | bd-v0toag.22: practiceTag maps each plan move to a high-leverage practice (FICO section C code) by rule order |
| `practice-why.test.js` | bd-v0toag.55: every practice tag has an English and Urdu one-line why, distinct per practice (practice-why) |
| `prompt-uptake-block.test.js` | Phase 2 uptake loop: the PRIOR ACTION block rides in the existing scoring call and never moves a score (fico-framework) |
| `reflection-language-anchor.test.js` | Reflection language is anchored to the teacher's stored preference, not the recogniser's per-turn label |
| `reflective-conversation-v12-wiring.test.js` | Source-level guard: reflective-conversation.service calls the v12 question generator and reads the stored corpus |
| `reflective-corpus-extraction.test.js` | v12 extractReflectiveCorpus shape and fallback profile, plus the enhance-LLM corpus re-attach landmine regression |
| `reflective-language-no-global-write.test.js` | Reflective conversation never calls setUserLanguage, so an answer cannot corrupt the global preferred_language |
| `reflective-question-voice-gateway.test.js` | The reflective question is spoken via the voice gateway; a voice failure falls back to text and the session continues |
| `reflective-v12-question-chain.test.js` | v12 Q1/Q2/Q3 reflective question chain: corpus-only Q1, conversation-aware Q2/Q3, guardrail retries |
| `render-commitment-card-image.test.js` | Commitment card HTML template smoke: language to script and direction, per-language labels (card-template) |
| `report-artifact-content-type.test.js` | Coaching report PNG is stored and served as image/png under a .png key, never as a PDF (shared/storage/r2) |
| `report-delivery-shape-dispatch.test.js` | FEAT-098: report delivery branches on generatePDFReport return shape; hero PNG sent as image, temp file cleaned |
| `report-generator-uptake-record.test.js` | Carry step at report time: loop grades the prior action, advances state, writes the record into prioritized_action |
| `report-link-token.test.js` | bd-v0toag.18: report link token opens one report read-only, lasts 120 days, round-trips (report-link-token) |
| `report-page-style.test.js` | bd-v0toag.55: report page shell escaping, ltr/rtl direction, private page, step and bar colours, dark mode |
| `report-page-view.test.js` | bd-v0toag.18/.55: pure HTML of the /cr report page: card and detailed screens, escaping, https-only links, RTL |
| `report-renderer-registry.test.js` | Report renderer registry conformance: hero renderer is the default for all five frameworks (renderer-registry) |
| `report-tracking-wiring.test.js` | bd-v0toag.12: report generator hands each send a tracker so image, voice note and buttons are recorded with wamids |
| `report-tracking.test.js` | bd-v0toag.12: each report part logs coaching.report.sent or .failed with Meta wamid and the school's group |
| `report-view-model.test.js` | bd-v0toag.55: pure view model for the /cr report page shaped to the ICT-3 template (coaching-report-view) |
| `report-voicenote-gateway.test.js` | Report voice note speaks via the voice gateway (Soniox) and stores its real audio duration (report-generator.service) |
| `score-adapters.test.js` | Per-framework score adapter conformance: normalised groups, scores and percentages (score-adapter dispatch) |
| `section-b-mode-history.test.js` | loadRecentSectionBModes feeds uptake-loop target choice: prefer C/D/F when the teacher usually attaches a plan |
| `section-b-proxy-target.test.js` | Section B is a coachable loop target only in proxy mode, never derived mode; C, D and F always eligible |
| `send-lp-prompt.test.js` | bd-lqpog/bd-zrlcp: sendLpPrompt routes list payloads to interactive message and falls back when a list is refused |
| `short-recording-tiers.test.js` | Which short recordings get length guidance (declared intent, sounds like a lesson) vs none (short-recording-guidance) |
| `stale-sweep-single-send.test.js` | The stale-session sweep messages a teacher once even with several worker copies running (stale-session.worker) |
| `subject-reaches-analyser.test.js` | The resolved subject reaches the analyser for uploaded and corpus LP paths and is persisted (analysis-processor) |
| `subject-resolution.test.js` | Pure subject resolution: canonicalSubject for prod spellings and parseCorpusLessonId grade/subject (subject-resolution) |
| `subject-unconfirmed-render.test.js` | The subject-not-confirmed note renders inside the Section F why line in English and in RTL Urdu (hero report) |
| `subject-unconfirmed-report-line.test.js` | When subject cannot be established the report says so: catalogue line in en/ur and attachSubjectNote on Section F |
| `target-coherence.test.js` | One target per report: narrative horizon, commitment card and hero box all name the scorer's focus_area (resolveTarget) |
| `teach-framework.test.js` | bd-594: Teach framework module interface and max marks 50 (teach-framework) |
| `thing-to-try-judge.test.js` | bd-v0toag.100.8: the next-recording check judges the ask itself (judgePrompt, readVerdict) (thing-to-try-judge) |
| `thing-to-try-pick.test.js` | bd-v0toag.20: pickThingToTry chooses from missed plan moves; withThingToTry carries it by scope until done |
| `thing-to-try-scope.test.js` | bd-v0toag.100.8: a thing to try is scoped to one subject and grade; activeThing picks the newest matching session |
| `thing-to-try-wiring.test.js` | bd-v0toag.8: plan PDF caption and prior-commitment reminder wired into the transcription job (thing-to-try) |
| `thing-to-try.test.js` | bd-v0toag.8: the one thing to try for groups C/D: thingToTryOf reads the stored record, replacesReminder (thing-to-try) |
| `truncation-coach-line.test.js` | Coach is told when the recording appears truncated: en/ur line on the Section B header (observe-draft, observe-strings) |
| `tts-language-clamp.test.js` | The speech synthesiser is never handed an unoffered language code; a fallback is logged loudly |
| `uptake-loop-acceptance.test.js` | Deterministic acceptance harness for the uptake loop over real FICO v4 session fixtures: coherence and five more checks |
| `uptake-loop-core.test.js` | Uptake loop pure core: ladder, caps, chooseTarget, count bars for every C/D/F indicator; uptake is never a mark |
| `uptake-loop-flag.test.js` | The uptake loop is inert unless UPTAKE_LOOP_ENABLED is set, read at call time (uptake-loop-flags) |
| `urdu-tts-decimals.test.js` | Urdu TTS reads decimals as point and keeps sentence-ending full stops (urdu-tts-normalizer, elevenlabs.service) |
| `voice-debrief-says-score.test.js` | bd-1r3k2h/bd-895yd: voice debrief prompt tells the coach to say the overall score as a number, in Urdu script too |

## Who reads this (all, generated)
- env `DEFAULT_COACH_ROLE_LABEL` read at `tests/coaching/lp-coaching-link.test.js:123:9dd9b3fe`
- env `ELEVENLABS_API_KEY` read at `tests/coaching/urdu-tts-decimals.test.js:12:6b9b8a4e`
- env `INTERNAL_API_KEY` read at `tests/coaching/bd-5rz1v-internal-coaching-routes.test.js:31:180f6cef` · `tests/coaching/bd-5rz1v.6-internal-observe-routes.test.js:32:180f6cef` · `tests/coaching/bd-c5reix-portal-start-and-routes.test.js:112:180f6cef` · `tests/coaching/bd-lfzoz-internal-coaching-routes.test.js:35:180f6cef`
- env `LP_EXTRACTION_VISION_MODEL` read at `tests/coaching/lp-vision-ocr.test.js:44:6310a7c6`
- env `LP_FIDELITY_ENABLED` read at `tests/coaching/bd-2c1gj-lp-select-confirm.test.js:213:274a8cc3`
- env `OBSERVE_FICO_FLOW_HAS_FIDELITY` read at `tests/coaching/bd-5n1a2-flow-move-blocks.test.js:83:78acb549` · `tests/coaching/bd-9h2mm-section-b-not-assessed.test.js:263:78acb549` · `tests/coaching/bd-c5zs1-editable-fidelity.test.js:91:78acb549` · `tests/coaching/bd-s192t-fallback-copy.test.js:13:78acb549` · `tests/coaching/observe-gates.test.js:145:78acb549` · `tests/coaching/truncation-coach-line.test.js:89:a5a7ba2f`
- env `OPENAI_API_KEY` read at `tests/coaching/bd-0wws3e-lp-pdf-nul-and-corpus-link.test.js:22:334ba0e9` · `tests/coaching/bd-fe35j9-urdu-pdf-vision-retry.test.js:21:334ba0e9` · `tests/coaching/bd-jbjrx-step-language.test.js:44:334ba0e9` · `tests/coaching/bd-we73k-pasted-lesson-plan.test.js:35:334ba0e9` · `tests/coaching/urdu-tts-decimals.test.js:13:e5dc7491`
- env `OPENROUTER_API_KEY` read at `tests/coaching/bd-0wws3e-lp-pdf-nul-and-corpus-link.test.js:21:6d424b49` · `tests/coaching/bd-fe35j9-urdu-pdf-vision-retry.test.js:20:6d424b49` · `tests/coaching/bd-jbjrx-step-language.test.js:45:6d424b49` · `tests/coaching/bd-we73k-pasted-lesson-plan.test.js:34:6d424b49`
- env `REGION_COACH_ROLE_LABEL_MAP` read at `tests/coaching/lp-coaching-link.test.js:124:2cb2f904`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `tests/coaching/bd-0wws3e-lp-pdf-nul-and-corpus-link.test.js:20:cd796d8a` · `tests/coaching/bd-fe35j9-urdu-pdf-vision-retry.test.js:19:cd796d8a` · `tests/coaching/bd-jbjrx-step-language.test.js:43:cd796d8a` · `tests/coaching/bd-we73k-pasted-lesson-plan.test.js:33:cd796d8a`
- env `SUPABASE_URL` read at `tests/coaching/bd-0wws3e-lp-pdf-nul-and-corpus-link.test.js:19:d1ac37ba` · `tests/coaching/bd-fe35j9-urdu-pdf-vision-retry.test.js:18:d1ac37ba` · `tests/coaching/bd-jbjrx-step-language.test.js:42:d1ac37ba` · `tests/coaching/bd-we73k-pasted-lesson-plan.test.js:32:d1ac37ba`
- env `UPTAKE_ACCEPTANCE` read at `tests/coaching/uptake-loop-acceptance.test.js:19:b5d1776e`
- env `UPTAKE_LOOP_ENABLED` read at `tests/coaching/uptake-loop-flag.test.js:4:43293fb3`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.index.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.md`? · `bot/shared/services/coaching/coaching-card/CLAUDE.index.md`? · `bot/shared/services/coaching/coaching-card/CLAUDE.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.index.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.md`? · `bot/shared/services/coaching/frameworks/CLAUDE.index.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.index.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.md`? · `bot/shared/services/coaching/report-renderers/CLAUDE.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.index.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.md`? · `bot/shared/services/coaching/report-v2/CLAUDE.index.md`? · `bot/shared/services/coaching/report-v2/CLAUDE.md`? · `bot/shared/services/coaching/report-v2/score-adapters/CLAUDE.index.md`? · `bot/shared/services/coaching/report-v2/score-adapters/CLAUDE.md`? · `bot/shared/services/observe/CLAUDE.index.md`? · `bot/shared/services/observe/assignment/CLAUDE.md`? · `bot/shared/services/observe/observe2/CLAUDE.index.md`? · `bot/shared/templates/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/workers/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/services/CLAUDE.index.md`? · `dashboard/services/CLAUDE.md`? · `docs/CLAUDE.index.md`? · `docs/customization.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/coaching/CLAUDE.index.md`? · `tests/coaching/CLAUDE.md`? · `tests/coaching/fidelity/CLAUDE.index.md`? · `tests/coaching/fidelity/CLAUDE.md`? · `tests/coaching/live-moves/CLAUDE.md`? · `tests/coaching/report-transformers/CLAUDE.md`? · `tests/coaching/video-reco/CLAUDE.index.md`? · `tests/coaching/video-reco/CLAUDE.md`?
