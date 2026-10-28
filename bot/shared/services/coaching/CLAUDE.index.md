# coaching — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `classroom-photo/` | Classroom photo step: capture, taps, vision reading, evidence cleaning → `classroom-photo/CLAUDE.md` |
| `coaching-card/` | Commitment card: content, HTML template and PNG render, button replies → `coaching-card/CLAUDE.md` |
| `fidelity/` | Lesson-plan fidelity (Section B): grade moves vs transcript, score in code → `fidelity/CLAUDE.md` |
| `frameworks/` | Observation frameworks (FICO, OECD, HOTS, MEWAKA, Teach): prompts and scoring → `frameworks/CLAUDE.md` |
| `live-moves/` | Live move ticking while a teacher records in the app (group D only) → `live-moves/CLAUDE.md` |
| `lp-coaching/` | Lesson-plan step of a coaching session: list, link, upload, paste → `lp-coaching/CLAUDE.md` |
| `reflective-questions/` | Reflective question generation: prompts, language profiles, guardrails, LLM ladder → `reflective-questions/CLAUDE.md` |
| `report-renderers/` | Registry choosing the report renderer (hero PNG or PDFKit fallback) → `report-renderers/CLAUDE.md` |
| `report-transformers/` | Per-framework transformers from analysis_data to the generic reportData → `report-transformers/CLAUDE.md` |
| `report-v2/` | Hero report: score view model, narrative, templates, PNG image → `report-v2/CLAUDE.md` |
| `templates/` | HTML template for the MEWAKA PDF report → `templates/CLAUDE.md` |
| `video-reco/` | Training-video recommendation engine for coaching reports (VIDREC) → `video-reco/CLAUDE.md` |
| `weekly-report/` | Group B weekly usage report sent Saturday as a Meta template → `weekly-report/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `ab-v10-arms.js` | Resolves a teacher's v10 A/B group (plan x report arms) from their school's draw row; null when switch off/undrawn |
| `ab-v10-switch.js` | Fail-closed 30s-cached reader of app_settings.ab_v10_enabled, the master switch for the v10 coaching test |
| `ack-reaction.js` | Sends a free emoji reaction (falls back to text) instead of a billed ack text on a teacher's tap or photo |
| `analysis-processor.service.js` | Runs the GPT pedagogical analysis of a coaching session, sends progress, stores results, starts the reflective chat |
| `audio-hash-cache.js` | Hashes coaching audio and reuses/refuses duplicate recordings so identical audio yields the same score (bd-7beiz) |
| `coaching-breakdown.service.js` | Shapes one coaching session's FICO/framework scores into a screen-ready breakdown for the portal |
| `coaching-feedback.service.js` | Post-report "Was this useful?" two-tap survey, asking a reason only on thumbs-down, with metrics write-back |
| `coaching-helpers.service.js` | Static helpers for coaching: output-language choice, quality-metric recording, cost calculation |
| `coaching-inflight-guard.js` | Defers a second classroom recording while an analysis is mid-flight, unless the earlier one is stale (bd-2376) |
| `coaching-job-queue.service.js` | Queues coaching transcription, analysis and report jobs to SQS with routing metadata |
| `coaching-photo-status.js` | Single source of truth for the two photo-step status/state namings the image handler must accept (bd-2636) |
| `coaching-session.service.js` | Coaching session lifecycle: create, confirm/cancel, status and conversation-state, registration checks |
| `coaching-stale-recovery.js` | Pure planners classifying sessions stuck at the confirmation gate or mid-flight for the worker to resume or abandon |
| `coaching-trend.service.js` | Loads recent completed sessions into sparkline trend points, prior action, Section B modes and fidelity for reports |
| `continue-coaching.service.js` | Testable handler for the stale reminder's "Continue coaching" tap that reopens the reflective conversation |
| `diarization-from-tokens.js` | Pure builder turning Soniox tokens into diarization segments and silence markers (diarization_data, bd-2kxxa.5) |
| `finish-early.service.js` | Guarded handler for the stale reminder's "Get Report Now" tap, refusing ended sessions (bd-n9832) |
| `iab-unreflected-switch.js` | Switch dc_iab_unreflected_report_24h: delays auto-completion of unreflected portal lessons to 24h (bd-bmc9a0.2) |
| `kiswahili-style.js` | Kiswahili style directive and preferred phrasings injected into teacher-facing coaching prompts |
| `lesson-plan-classifier.js` | Pure check deciding whether parsed upload data looks like a lesson plan, not a letter (bd-2372) |
| `lesson-plan-processor.service.js` | Handles Yes/No lesson-plan replies, downloads and extracts plan documents, stores to R2, queues analysis |
| `media-attach.service.js` | Attaches a coach's photo or lesson plan to the right observation or parks it and asks which one (R165) |
| `media-session-resolver.js` | One rule picking which coaching session an arriving photo or LP belongs to, replacing newest-first (R165) |
| `media-target.service.js` | Redis memory of which observation a coach's next photo/LP is for, plus parked media until it arrives (R165) |
| `next-step-store.js` | Read-merge-writes the report's chosen next step into analysis_data.focus_area, non-fatal (bd-v0toag.1.5) |
| `next-step.js` | Pure selectNextStep: one indicator that the horizon, commitment card and focus_area all name (bd-v0toag.1.5) |
| `pedagogy-jargon.js` | Glosses a curated set of coach-jargon terms inline once per text, in English or Urdu (bd-2373) |
| `photo-capture-routing.js` | Pure rules deciding whether an image is a classroom photo to capture or hold, and appending photos (bd-3ipd2) |
| `photo-gate-sweep.js` | Pure check for sessions stranded at the photo/LP gate that the worker auto-advances after a threshold (bd-j3j4b) |
| `portal-class-check.js` | LLM check that a portal upload sounds like a class; pauses at awaiting_class_confirm if not (bd-aqotzx) |
| `portal-coaching.service.js` | Bot-side logic for teacher recordings uploaded from the portal, reached via the internal API (bd-lfzoz) |
| `portal-lesson-plan-library.service.js` | Lookups behind picking a lesson plan from the portal library, mirroring WhatsApp paths (bd-5rz1v) |
| `portal-observe-marker.js` | Narrow read telling failure paths whether a session id is a coach's portal observation; false on any error |
| `portal-short-recording.js` | Closes portal DC uploads under 900s as cancelled 'too_short' before transcription (bd-fgj73x.7) |
| `practice-tag.js` | Pure map from a plan move's phase/type/text to a FICO section C practice code (bd-v0toag.22) |
| `practice-why.js` | One-line en/ur reason each high-leverage practice matters, shown under the thing to try (bd-v0toag.55) |
| `reflection-progress.js` | Single place turning answered-reflection counts into the numbers and copy shown to teachers |
| `reflective-acknowledgement.js` | Builds a warm line naming what the teacher said after the reflective answer; injected generator (bd-2374) |
| `reflective-answer-routing.js` | Plans how a text message routes while a reflective debrief is open, without the old updated_at timeout |
| `reflective-conversation.service.js` | Runs the multi-turn reflective Q&A with teachers, stores answers and triggers report generation |
| `report-card.js` | Pure wording shared by the /cr report page and slim WhatsApp image for the v10 report card (bd-v0toag.57) |
| `report-commit-prompt.js` | Sends the post-report Yes/Later/No commit prompt once per session, skipped under the share template (bd-v0toag.124) |
| `report-events.js` | Emits coaching.report.* log events to niete-logs by user uuid and session id; logging only (bd-v0toag.1.2) |
| `report-generator.service.js` | Orchestrates coaching report generation and delivery: reflections, hero/PDF render, voice debrief, commit, costs |
| `report-link-send.js` | Sends groups C and D a cta_url button opening their /cr report page right after the report; never throws (bd-v0toag.19) |
| `report-link-token.js` | Signs and verifies the 120-day HMAC token and URL for the read-only /cr/<token> coaching report page (bd-v0toag.18) |
| `report-piece-once.js` | Redis SET NX claim so each report piece (image, voice, commit prompt) is sent once per session (NC5) |
| `report-tracking.js` | Per-report tracker logging coaching.report.sent/failed with the Meta wamid and school group (bd-v0toag.12) |
| `report-window-send.js` | Sends the report as the approved share template when the 24h window is closed, and gates follow-ups (bd-v0toag.106) |
| `session-ownership.js` | Distinguishes who drives a coaching session (coach vs observed teacher) to stop inbound-match hijacks (bd-wwcgf) |
| `session-terminal.js` | Terminal-status guard: refuses stale button taps and writes that would revive cancelled observations (bd-n9832) |
| `short-recording-guidance.js` | Classifies sub-threshold recordings that look like attempted lessons and picks one honest guidance sentence |
| `silence-detector.service.js` | Detects silence gaps in classroom transcripts and infers likely activity (wait time, board writing, group work) |
| `slim-report.js` | Builds the slim report image for v10 groups C/D with the one thing to try; null for A/B or switch off (bd-v0toag.57) |
| `subject-resolution.js` | Single owner resolving a lesson's subject with a confidence, feeding FICO Section F's subject-gated indicators |
| `target-resolver.js` | Validates the scorer's focus_area into the ONE indicator every report surface names as the growth target |
| `thing-to-try-judge.js` | LLM judges whether a recording showed the ask (did/partly/not_done/couldnt_tell) with quoted evidence (bd-v0toag.100.8) |
| `thing-to-try-pick.js` | Picks and stores the one thing to try (first not_done tagged move) and resolves whether the last ask was done |
| `thing-to-try-scope.js` | Scopes a thing to try to one grade:subject and finds the active one among stored rows (bd-v0toag.100.8) |
| `thing-to-try.js` | Shows the stored thing to try on the next plan caption and in place of the "Quick reminder" for groups C/D |
| `transcript-enhancer.service.js` | GPT post-pass on transcripts: speaker attribution, phonetic English, utterance tags, SLO mastery, climate |
| `transcription-processor.service.js` | Coaching transcription workflow: downloads audio, stores to R2, Soniox diarized transcription, progress, errors |
| `uptake-loop.service.js` | Pure feedback-uptake loop: one target carried forward, counted, closed after two wins, handed to a coach after four |
| `whatsapp-recording.service.js` | Keeps a WhatsApp classroom recording in R2 (no table) for the app's Digital Coaching flow (bd-c5reix) |

## Who reads this (all, generated)
- `ab-v10-arms.js` ← imported by `bot/shared/handlers/voice-message.handler.js:45:8fd81169` · `bot/shared/services/lp-v10-card.service.js:15:7958ce0c` · `bot/shared/services/nudges/lp-coaching-ask.service.js:54:8719f779` · `bot/shared/services/coaching/coaching-feedback.service.js:36:1497e976` (+9: `python3 kg/kg.py who-reads ab-v10-arms.js`)
- `ab-v10-switch.js` ← imported by `bot/shared/services/coaching/ab-v10-arms.js:14:34a430f6` · `bot/shared/services/coaching/report-generator.service.js:39:34a430f6` · `bot/shared/services/coaching/report-tracking.js:13:34a430f6` · `bot/shared/services/coaching/thing-to-try-pick.js:16:34a430f6`
- `ack-reaction.js` ← imported by `bot/shared/services/coaching-orchestrator.service.js:54:ba7e7fa7` · `bot/shared/services/lp-feedback.service.js:59:1700f1dd` · `bot/shared/services/lp612-feedback.shared.js:16:1700f1dd` · `bot/shared/services/coaching/classroom-photo/add-another.service.js:161:55a55ca5` (+3: `python3 kg/kg.py who-reads ack-reaction.js`)
- `analysis-processor.service.js` ← imported by `bot/shared/services/coaching-orchestrator.service.js:26:462a1f23`
- `audio-hash-cache.js` ← imported by `bot/shared/services/observe/observe-debrief.service.js:1002:a6d74c9e` · `bot/shared/services/coaching/transcription-processor.service.js:180:25d1f364` · `bot/shared/services/coaching/whatsapp-recording.service.js:71:493931f1`
- `coaching-breakdown.service.js` ← imported by `bot/shared/routes/internal-api.routes.js:2052:f4c582fd`
- `coaching-feedback.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:353:aeabfaf6` · `bot/whatsapp-bot.js:863:acb3df5a` · `bot/shared/services/coaching/report-generator.service.js:568:fdca79bf`
- `coaching-helpers.service.js` ← imported by `bot/shared/services/coaching-orchestrator.service.js:30:59783ea8` · `bot/shared/services/coaching/analysis-processor.service.js:213:81ec52c0` · `bot/shared/services/coaching/report-generator.service.js:27:81ec52c0`
- `coaching-inflight-guard.js` ← imported by `bot/shared/handlers/voice-message.handler.js:35:b8459a52` · `bot/shared/services/nudges/lp-coaching-ask.service.js:53:482ce0a2` · `bot/whatsapp-bot.js:2598:7935e34b` · `bot/shared/services/coaching/portal-coaching.service.js:351:960a1333`
- `coaching-job-queue.service.js` ← imported by `bot/shared/services/coaching-orchestrator.service.js:29:a4aeeac0` · `bot/shared/services/observe/observe-capture.service.js:110:0dc01d6a` · `bot/shared/services/observe/observe-debrief.service.js:773:0dc01d6a` · `bot/shared/services/observe/observe-resume.service.js:257:7f14ed15` (+14: `python3 kg/kg.py who-reads coaching-job-queue.service.js`)
- `coaching-session.service.js` ← imported by `bot/shared/services/coaching-orchestrator.service.js:23:28501aa4` · `bot/shared/services/coaching/analysis-processor.service.js:19:9735ef3f` · `bot/shared/services/coaching/lesson-plan-processor.service.js:18:9735ef3f` · `bot/shared/services/coaching/reflective-conversation.service.js:20:9735ef3f` (+2: `python3 kg/kg.py who-reads coaching-session.service.js`)
- `coaching-stale-recovery.js` ← imported by `bot/shared/services/observe/observe-resume.service.js:183:fd49d006` · `bot/workers/stale-session.worker.js:30:ce1057d9`
- `coaching-trend.service.js` ← imported by `bot/shared/services/observe/assignment/leader-source.js:25:48ab1197` · `bot/shared/services/observe/observe-debrief.service.js:575:3ccaf540` · `bot/shared/services/observe/observe-draft.service.js:604:3ccaf540` · `bot/shared/services/coaching/analysis-processor.service.js:271:21c0dbc4` (+2: `python3 kg/kg.py who-reads coaching-trend.service.js`)
- `continue-coaching.service.js` ← imported by `bot/whatsapp-bot.js:1111:57f42595`
- `diarization-from-tokens.js` ← imported by `bot/shared/services/coaching/fidelity/section-b-backfill.service.js:109:ee7532b3` · `bot/shared/services/coaching/transcription-processor.service.js:30:99ddd465`
- `finish-early.service.js` ← imported by `bot/whatsapp-bot.js:1121:dcaadc16`
- `iab-unreflected-switch.js` ← imported by `bot/workers/stale-session.worker.js:31:fd2159ea`
- `kiswahili-style.js` ← imported by `bot/shared/services/coaching/report-v2/narrative.service.js:26:8753282b`
- `lesson-plan-classifier.js` ← imported by `bot/shared/services/observe/observe2/added-plan.js:187:476e5ca1` · `bot/workers/lesson-plan-extraction.worker.js:15:478d647a`
- `lesson-plan-processor.service.js` ← imported by `bot/shared/services/coaching-orchestrator.service.js:25:b9ac6375` · `bot/shared/services/coaching/lp-coaching/lp-text-paste.service.js:80:55161f2e`
- `media-attach.service.js` ← imported by `bot/shared/handlers/image-message.handler.js:112:727b6ff8` · `bot/whatsapp-bot.js:2080:3ec9e505`
- `media-session-resolver.js` ← imported by `bot/shared/services/coaching/lp-coaching/lp-text-paste.service.js:66:6269c41a` · `bot/shared/services/coaching/media-attach.service.js:31:ad031232`
- `media-target.service.js` ← imported by `bot/whatsapp-bot.js:1042:db4683e7` · `bot/shared/services/coaching/classroom-photo/add-another.service.js:38:71ff2a0e` · `bot/shared/services/coaching/classroom-photo/photo-yes.service.js:80:a4f02dd1` · `bot/shared/services/coaching/lp-coaching/lp-list-selection.handler.js:86:a6997a8c` (+2: `python3 kg/kg.py who-reads media-target.service.js`)
- `next-step-store.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:386:fb519b81`
- `next-step.js` ← imported by `bot/shared/services/coaching/coaching-card/commitment-card.service.js:24:41e73e8d` · `bot/shared/services/coaching/report-generator.service.js:370:3050d7a4` · `bot/shared/services/coaching/video-reco/engine.js:211:e9ed1454`
- `pedagogy-jargon.js` ← imported by `bot/shared/services/coaching/coaching-card/commitment-card.service.js:23:68a47754`
- `photo-capture-routing.js` ← imported by `bot/whatsapp-bot.js:2489:ee73662a` · `bot/shared/services/coaching/classroom-photo/add-another.service.js:36:b4b419b3` · `bot/shared/services/coaching/classroom-photo/capture.service.js:11:90b1f674` · `bot/shared/services/coaching/media-attach.service.js:32:a3e09db8` (+1: `python3 kg/kg.py who-reads photo-capture-routing.js`)
- `photo-gate-sweep.js` ← imported by `bot/workers/stale-session.worker.js:70:5fcebf1b`
- `portal-class-check.js` ← imported by `bot/shared/routes/internal-api.routes.js:2967:e1e4e1dc` · `bot/workers/stale-session.worker.js:1181:d9e5f831` · `bot/shared/services/coaching/transcription-processor.service.js:560:b4110117`
- `portal-coaching.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:1933:a26f97d4` · `bot/shared/handlers/voice-message.handler.js:754:a26f97d4` · `bot/shared/routes/internal-api.routes.js:2865:b94c35e2` · `bot/shared/services/observe/observe-draft.service.js:437:63c336c4` (+12: `python3 kg/kg.py who-reads portal-coaching.service.js`)
- `portal-lesson-plan-library.service.js` ← imported by `bot/shared/services/observe/portal-observe.service.js:70:a6fed6a9` · `bot/shared/services/coaching/portal-coaching.service.js:197:fd610871`
- `portal-observe-marker.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:825:ef7f59a2` · `bot/shared/services/coaching/transcription-processor.service.js:744:ef7f59a2`
- `portal-short-recording.js` ← imported by `bot/shared/services/coaching/transcription-processor.service.js:108:e2c4f583`
- `practice-tag.js` ← imported by `bot/shared/services/coaching/thing-to-try-pick.js:18:c203c4de`
- `practice-why.js` ← imported by `dashboard/services/coaching-report-view.js:9:30393c81` · `bot/shared/services/coaching/report-v2/hero-report.service.js:17:a8a4b0f7`
- `reflection-progress.js` ← imported by `bot/workers/stale-session.worker.js:74:b05475fa` · `bot/shared/services/coaching/finish-early.service.js:54:fb9bdf25` · `bot/shared/services/coaching/report-generator.service.js:22:fb9bdf25` · `bot/shared/services/coaching/report-transformers/_shared.js:8:c7c49364` (+1: `python3 kg/kg.py who-reads reflection-progress.js`)
- `reflective-acknowledgement.js` ← imported by `bot/shared/services/coaching/reflective-conversation.service.js:27:b54cb2ca`
- `reflective-answer-routing.js` ← imported by `bot/shared/handlers/text-message.handler.js:18:69b37a88`
- `reflective-conversation.service.js` ← imported by `bot/shared/services/coaching-orchestrator.service.js:27:49ceecee` · `bot/shared/services/coaching/analysis-processor.service.js:737:25690236` · `bot/shared/services/coaching/continue-coaching.service.js:83:25690236` · `bot/shared/services/coaching/portal-coaching.service.js:194:c8d00dfd`
- `report-card.js` ← imported by `dashboard/services/coach-school-card.service.js:34:bc0a2f23` · `dashboard/services/coaching-report-view.js:11:3227e3c1` · `dashboard/services/thing-to-try.service.js:21:803d86a3` · `bot/shared/services/coaching/report-v2/hero-report.service.js:16:f1bc8698` (+1: `python3 kg/kg.py who-reads report-card.js`)
- `report-commit-prompt.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:672:25246669`
- `report-events.js` ← imported by `bot/shared/services/coaching/coaching-card/card-response.service.js:59:3b9e09e4` · `bot/shared/services/coaching/report-generator.service.js:437:a31287a6` · `bot/shared/services/coaching/transcription-processor.service.js:589:2b213bee`
- `report-generator.service.js` ← imported by `bot/shared/services/coaching-orchestrator.service.js:28:14793149` · `bot/shared/services/coaching/analysis-processor.service.js:181:31f92cbb`
- `report-link-send.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:530:30cbf6d4`
- `report-link-token.js` ← imported by `dashboard/routes/coaching-report.routes.js:24:5cc24bfb` · `dashboard/routes/video-reco.routes.js:22:5bae98fd` · `bot/shared/services/coaching/report-link-send.js:31:18bf3ed7` · `bot/shared/services/coaching/slim-report.js:14:70c357aa`
- `report-piece-once.js` ← imported by `bot/shared/services/coaching/reflective-conversation.service.js:182:3ab89ed5` · `bot/shared/services/coaching/report-commit-prompt.js:15:3ab89ed5` · `bot/shared/services/coaching/report-generator.service.js:238:3ab89ed5` · `bot/shared/services/coaching/video-reco/send.js:35:f3a28220`
- `report-tracking.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:38:61aae2f0`
- `report-window-send.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:526:d7257433`
- `session-ownership.js` ← imported by `bot/shared/services/coaching/classroom-photo/add-another.service.js:37:084a45c2` · `bot/shared/services/coaching/lp-coaching/lp-step.service.js:203:75f5c01c` · `bot/shared/services/coaching/media-session-resolver.js:65:b25e1166`
- `session-terminal.js` ← imported by `bot/shared/routes/observe-mewaka-endpoint.js:47:ad89bafb` · `bot/shared/routes/observe2-check-endpoint.js:293:da379b38` · `bot/shared/services/observe/observe-debrief.service.js:21:2890d4c6` · `bot/shared/services/observe/observe-draft.service.js:24:d7356d17` (+15: `python3 kg/kg.py who-reads session-terminal.js`)
- `short-recording-guidance.js` ← imported by `bot/shared/handlers/voice-message.handler.js:1270:662b4d74`
- `slim-report.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:1049:fbbaf027`
- `subject-resolution.js` ← imported by `bot/shared/services/observe/observe2/moments.js:328:b63272bf` · `bot/workers/lesson-plan-extraction.worker.js:366:2f94894c` · `dashboard/services/subject-vocabulary.service.js:33:4afe7aea` · `bot/shared/services/coaching/analysis-processor.service.js:78:661de54c` (+4: `python3 kg/kg.py who-reads subject-resolution.js`)
- `target-resolver.js` ← imported by `bot/shared/services/coaching/next-step.js:15:c6ce00b8` · `bot/shared/services/coaching/report-generator.service.js:1043:939f011e` · `bot/shared/services/coaching/report-v2/hero-report.service.js:22:64774bf1` · `bot/shared/services/coaching/uptake-loop.service.js:25:939f011e`
- `thing-to-try-judge.js` ← imported by `bot/shared/services/coaching/thing-to-try-pick.js:21:6652edf2`
- `thing-to-try-pick.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:649:96dd87d9` · `bot/shared/services/coaching/slim-report.js:15:dcb5dd65`
- `thing-to-try-scope.js` ← imported by `dashboard/services/thing-to-try.service.js:22:54d02cb6` · `bot/shared/services/coaching/thing-to-try-pick.js:20:046dcc89` · `bot/shared/services/coaching/thing-to-try.js:16:046dcc89`
- `thing-to-try.js` ← imported by `bot/shared/services/lp-v8-delivery.service.js:30:257887eb` · `bot/shared/services/coaching/report-generator.service.js:395:f9d6c779` · `bot/shared/services/coaching/transcription-processor.service.js:27:b7a3e8ce`
- `transcription-processor.service.js` ← imported by `bot/shared/services/coaching-orchestrator.service.js:24:399075a1` · `bot/shared/services/observe/observe-debrief.service.js:1060:edb708bf`
- `uptake-loop.service.js` ← imported by `bot/shared/services/observe/observe-draft.service.js:605:6b491bf0` · `bot/shared/services/coaching/coaching-card/commitment-card.service.js:25:74509e41` · `bot/shared/services/coaching/report-generator.service.js:310:82fa41a6`
- `whatsapp-recording.service.js` ← imported by `bot/shared/handlers/voice-message.handler.js:899:00b0f509` · `bot/shared/routes/internal-api.routes.js:2937:0ed8c8ff` · `bot/whatsapp-bot.js:2586:bceb2cff` · `dashboard/routes/portal.routes.js:7695:53ed0710`
- column `coaching_quality_metrics.coaching_session_id` (written by `coaching-feedback.service.js`, `coaching-helpers.service.js`) ← read by `dashboard/services/coaching-useful.js:55:c80c29ea` · `bot/shared/services/coaching/coaching-feedback.service.js:100:cfde5128` · `bot/shared/services/coaching/coaching-helpers.service.js:117:3fc9162f` · `bot/shared/services/coaching/weekly-report/reader.js:104:0ea80de6`
- column `coaching_sessions.analysis_data` (written by `analysis-processor.service.js`, `next-step-store.js`, `report-generator.service.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:53:c286009d` · `bot/shared/routes/observe2-check-endpoint.js:297:ed6f6cd9` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:285:4fa90499` (+33: `python3 kg/kg.py who-reads coaching_sessions.analysis_data`)
- column `coaching_sessions.audio_duration_seconds` (written by `coaching-session.service.js`) ← read by `bot/shared/services/observe/observe2/moments.js:404:a886f531` · `dashboard/index.js:1735:3cfaf0ad` · `dashboard/routes/portal.routes.js:7831:3f51afc5` · `dashboard/services/coach-disagreements.service.js:146:f870796e` (+3: `python3 kg/kg.py who-reads coaching_sessions.audio_duration_seconds`)
- column `coaching_sessions.audio_hash` (written by `transcription-processor.service.js`) ← read by `bot/shared/services/coaching/audio-hash-cache.js:105:1e6aef16` · `bot/shared/services/coaching/whatsapp-recording.service.js:167:fa514cd4`
- column `coaching_sessions.audio_id` (written by `coaching-session.service.js`, `portal-coaching.service.js`) ← read by `bot/shared/services/observe/observe-resume.service.js:38:8fd2adae` · `bot/workers/stale-session.worker.js:618:ed0bd7f6`
- column `coaching_sessions.audio_url` (written by `portal-coaching.service.js`) ← read by `bot/shared/services/observe/portal-observe.service.js:220:ef3f2846` · `bot/workers/stale-session.worker.js:141:134f4724` · `dashboard/index.js:1644:6a7b9c1c` · `dashboard/routes/portal.routes.js:7773:e2da0b61` (+5: `python3 kg/kg.py who-reads coaching_sessions.audio_url`)
- column `coaching_sessions.completed_at` (written by `coaching-session.service.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:54:49ce5d2c`
- column `coaching_sessions.conversation_state` (written by `coaching-session.service.js`, `portal-coaching.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:2034:a619795a` · `bot/shared/services/observe/observe-resume.service.js:38:8fd2adae` · `bot/workers/stale-session.worker.js:141:134f4724` · `dashboard/routes/portal.routes.js:7773:e2da0b61` (+9: `python3 kg/kg.py who-reads coaching_sessions.conversation_state`)
- column `coaching_sessions.created_at` (written by `coaching-session.service.js`, `portal-coaching.service.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/handlers/text-message.handler.js:1924:e8356999` · `bot/shared/handlers/voice-message.handler.js:745:e8356999` · `bot/shared/routes/transcript-quiz-flow-endpoint.js:285:4fa90499` (+40: `python3 kg/kg.py who-reads coaching_sessions.created_at`)
- column `coaching_sessions.failed_step` (written by `coaching-session.service.js`, `portal-class-check.js`, `portal-coaching.service.js`) ← read by `dashboard/routes/portal.routes.js:7787:64b2e2da`
- column `coaching_sessions.has_lesson_plan` (written by `lesson-plan-processor.service.js`) ← read by `dashboard/routes/portal.routes.js:7831:3f51afc5` · `bot/shared/services/coaching/portal-class-check.js:135:60fc760c`
- column `coaching_sessions.lesson_plan_extraction_status` (written by `lesson-plan-processor.service.js`) ← read by `bot/shared/services/coaching/analysis-processor.service.js:655:62a21fe2`
- column `coaching_sessions.lesson_plan_format` (written by `lesson-plan-processor.service.js`) ← read by `bot/workers/lesson-plan-extraction.worker.js:59:76f602d8` · `bot/shared/services/coaching/portal-class-check.js:135:60fc760c`
- column `coaching_sessions.lesson_plan_r2_key` (written by `lesson-plan-processor.service.js`) ← read by `bot/workers/lesson-plan-extraction.worker.js:59:76f602d8` · `bot/shared/services/coaching/portal-class-check.js:135:60fc760c`
- column `coaching_sessions.lesson_plan_text` (written by `lesson-plan-processor.service.js`) ← read by `bot/workers/stale-session.worker.js:141:134f4724` · `bot/scripts/generate-coaching-excel.js:34:be418e61` · `bot/shared/services/coaching/fidelity/fidelity-recompute.service.js:58:2e68ba58`
- column `coaching_sessions.lesson_plan_url` (written by `lesson-plan-processor.service.js`) ← read by `bot/workers/lesson-plan-extraction.worker.js:59:76f602d8` · `bot/scripts/generate-coaching-excel.js:33:8b17db77`
- column `coaching_sessions.prioritized_action` (written by `report-generator.service.js`) ← read by `dashboard/routes/portal.routes.js:7406:9dea480b` · `dashboard/services/thing-to-try.service.js:45:33bc352a` · `bot/shared/services/coaching/coaching-card/card-response.service.js:41:a366302c` · `bot/shared/services/coaching/coaching-trend.service.js:138:1f9a2623` (+3: `python3 kg/kg.py who-reads coaching_sessions.prioritized_action`)
- column `coaching_sessions.reminder_sent_at` (written by `continue-coaching.service.js`) ← read by `bot/workers/stale-session.worker.js:141:134f4724`
- column `coaching_sessions.report_pdf_url` (written by `report-generator.service.js`) ← read by `bot/shared/services/share-send.service.js:144:3077d0b0` · `dashboard/index.js:1952:2fb4f18f` · `bot/scripts/generate-coaching-excel.js:36:6523a5b4` · `bot/shared/services/coaching/audio-hash-cache.js:103:744abaff`
- column `coaching_sessions.status` (written by `analysis-processor.service.js`, `coaching-session.service.js`, `portal-class-check.js`, `portal-coaching.service.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` · `bot/shared/handlers/text-message.handler.js:1923:21a55915` · `bot/shared/handlers/voice-message.handler.js:744:21a55915` (+40: `python3 kg/kg.py who-reads coaching_sessions.status`)
- column `coaching_sessions.user_id` (written by `coaching-session.service.js`, `portal-coaching.service.js`) ← read by `bot/shared/calls/call-context.repo.js:65:219f5683` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` · `bot/shared/handlers/text-message.handler.js:1922:a819c701` · `bot/shared/handlers/voice-message.handler.js:743:a819c701` (+51: `python3 kg/kg.py who-reads coaching_sessions.user_id`)
- column `coaching_sessions.voice_debrief_url` (written by `report-generator.service.js`) ← read by `dashboard/index.js:1594:e56beb09` · `bot/scripts/generate-coaching-excel.js:35:d03a047f`
- table `coaching_sessions` whole row (`*`) (written by `analysis-processor.service.js`, `coaching-session.service.js`, `continue-coaching.service.js`, `lesson-plan-processor.service.js`, `next-step-store.js`, `portal-class-check.js`, `portal-coaching.service.js`, `report-generator.service.js`, `session-terminal.js`, `transcription-processor.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:1921:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? · `bot/shared/services/coaching-orchestrator.service.js:225:d2b02c3e`? (+11: `python3 kg/kg.py who-reads coaching_sessions`)
- table `coaching_quality_metrics` (written by `coaching-feedback.service.js`, `coaching-helpers.service.js`) ← read by `dashboard/services/coaching-useful.js:54:9e0b92a8`? · `bot/shared/services/coaching/coaching-feedback.service.js:99:df6ad5d9`? · `bot/shared/services/coaching/coaching-helpers.service.js:115:d42443b2`? · `bot/shared/services/coaching/weekly-report/reader.js:103:527a292b`?
- table `coaching_sessions` (written by `analysis-processor.service.js`, `coaching-session.service.js`, `continue-coaching.service.js`, `lesson-plan-processor.service.js`, `next-step-store.js`, `portal-class-check.js`, `portal-coaching.service.js`, `report-generator.service.js`, `session-terminal.js`, `transcription-processor.service.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+86: `python3 kg/kg.py who-reads coaching_sessions`)
- env `COACHING_PHOTO_MODE` read at `bot/shared/services/coaching/analysis-processor.service.js:302:1daedf18`
- env `COACHING_PHOTO_VISION` read at `bot/shared/services/coaching/analysis-processor.service.js:323:732bb4b0`
- env `INTERNAL_API_KEY` read at `bot/shared/services/coaching/report-link-token.js:40:237d5f3b`
- env `LANGUAGE_AUDIO_AUTOFLIP` read at `bot/shared/services/coaching/transcription-processor.service.js:334:2d46a578`
- env `PORTAL_URL` read at `bot/shared/services/coaching/report-link-token.js:82:5940e29a`
- env `SUBJECT_DOWNLOAD_WINDOW_HOURS` read at `bot/shared/services/coaching/subject-resolution.js:92:23b033ce`
- env `SUPABASE_URL` read at `bot/shared/services/coaching/report-link-token.js:28:a60b88ec`

## Tests (all, generated)
- `ab-v10-arms.js` ← `tests/coaching/ab-v10-arms.test.js` · `tests/coaching/bd-v0toag.19-report-link-send.test.js` · `tests/coaching/bd-v0toag.57-slim-report.test.js` · `tests/coaching/video-reco/r7s-pick-waves.test.js` · `tests/lp-v8/bd-v0toag.46-record-line.test.js`
- `ab-v10-switch.js` ← `tests/coaching/ab-v10-switch.test.js` · `tests/lp-v8/leader-reader-pdf.test.js`
- `ack-reaction.js` ← `tests/meta-bill-cut/fx4-round3.test.js`
- `analysis-processor.service.js` ← `bot/tests/coaching/subject-tier3-app-opens.test.js` · `bot/tests/observe/observe-pipeline-fork.test.js` · `tests/coaching/analysis-output-language.test.js` · `tests/coaching/analysis-processor-prior-action.test.js` · `tests/coaching/bd-1mcpe-per-photo-captions.test.js` · `tests/coaching/bd-809g50-portal-plan-race.test.js` (+15: `python3 kg/kg.py who-reads bot/shared/services/coaching/analysis-processor.service.js`)
- `audio-hash-cache.js` ← `tests/coaching/bd-5tgzv-resend-as-image.test.js` · `tests/coaching/bd-7beiz-audio-hash-dedupe.test.js` · `tests/coaching/bd-c5reix-portal-duplicate-quiet.test.js` · `tests/coaching/bd-erpvf-hitl-duplicate-recording.test.js` · `tests/coaching/bd-hr97y-dc-dedupe-no-window.test.js` · `tests/observe2/recording-routing.test.js`
- `coaching-breakdown.service.js` ← `tests/coaching/bd-9h2mm-section-b-not-assessed.test.js` · `tests/coaching/coaching-breakdown-unknown-domains.test.js` · `tests/coaching/observation-score-bands.test.js`
- `coaching-feedback.service.js` ← `tests/coaching/bd-azzhu-survey-after-voice.test.js` · `tests/coaching/bd-v0toag.49-useful-survey.test.js` · `tests/coaching/bd-v0toag.80-metrics-write.test.js` · `tests/coaching/coaching-feedback.test.js` · `tests/coaching/meta-bill-nc2-report-caption.test.js` · `tests/meta-bill-cut/fx4-round3.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/coaching/coaching-feedback.service.js`)
- `coaching-helpers.service.js` ← `tests/coaching/bd-59840-honest-wait-no-ack.test.js` · `tests/coaching/bd-azzhu-survey-after-voice.test.js` · `tests/coaching/bd-fmr3s-session-complete-merged.test.js` · `tests/coaching/bd-v0toag.49-useful-wiring.test.js` · `tests/coaching/bd-x3k1q-session-complete-boundary.test.js` · `tests/coaching/bd2413-output-language.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/coaching/coaching-helpers.service.js`)
- `coaching-inflight-guard.js` ← `tests/coaching/bd-0c80s-guard-ignores-observe.test.js` · `tests/coaching/feat106-multiaudio-guard.test.js` · `tests/coaching/inflight-guard-document-door.test.js`
- `coaching-job-queue.service.js` ← `bot/tests/observe/bd-9tqqi-cancel-ack-buttons.test.js` · `bot/tests/observe/bd-gfg9m-bound-send.test.js` · `bot/tests/observe/observe-debrief-capture.test.js` · `bot/tests/observe/observe-debrief-requeue.test.js` · `bot/tests/observe/observe-send.test.js` · `bot/tests/observe/observe-teacher-pick.test.js` (+7: `python3 kg/kg.py who-reads bot/shared/services/coaching/coaching-job-queue.service.js`)
- `coaching-photo-status.js` ← `tests/coaching/bd2636-classroom-photo-status.test.js`
- `coaching-session.service.js` ← `bot/tests/coaching/bd-n9832-terminal-guard-owners.test.js` · `bot/tests/coaching/bd-rw4so-confirm-refusal-language.test.js` · `bot/tests/lp-v8/lp-shelf-flush-points.test.js` · `bot/tests/observe/observe-pipeline-fork.test.js` · `tests/coaching/coaching-confirm-language.test.js` · `tests/coaching/meta-bill-nc1-confirm-carries-wait.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/services/coaching/coaching-session.service.js`)
- `coaching-stale-recovery.js` ← `bot/tests/observe/bd-go4tl-midflight-observe.test.js` · `tests/coaching/bd-aqotzx-portal-class-check.test.js` · `tests/coaching/bd-h9gnk-midflight-watchdog.test.js` · `tests/coaching/bd-lfzoz-portal-pipeline.test.js` · `tests/coaching/bd2417-stale-recovery.test.js`
- `coaching-trend.service.js` ← `bot/tests/observe/visit-leader-source.test.js` · `bot/tests/observe/visit-trend-filter.test.js` · `tests/coaching/fidelity-phase-wiring.test.js` · `tests/coaching/load-prior-action.test.js` · `tests/coaching/report-generator-uptake-record.test.js` · `tests/coaching/section-b-mode-history.test.js`
- `continue-coaching.service.js` ← `bot/tests/observe/cancelled-observation-stays-cancelled.test.js` · `tests/coaching/continue-coaching-tap.test.js`
- `lesson-plan-classifier.js` ← `tests/coaching/feat106-lp-content-validation.test.js`
- `lesson-plan-processor.service.js` ← `bot/tests/observe/cancelled-observation-stays-cancelled.test.js` · `bot/tests/observe/coach-language-bound-observation.test.js` · `tests/coaching/bd-we73k-pasted-lesson-plan.test.js` · `tests/coaching/lp-response-marker.test.js` · `tests/coaching/meta-bill-nc3-lp-outcome-on-step2.test.js` · `tests/meta-bill-cut/fx4-round3.test.js`
- `media-attach.service.js` ← `bot/tests/observe/bd-2kxxa2-media-target.test.js` · `tests/child-test/L4/media-claim.test.js` · `tests/coaching/meta-bill-nc4-photo-step.test.js` · `tests/meta-bill-cut/fx3-photo-burst-lock.test.js`
- `media-session-resolver.js` ← `bot/tests/observe/bd-2kxxa2-media-target.test.js` · `bot/tests/observe/bd-wwcgf-teacher-gets-observer-form.test.js`
- `media-target.service.js` ← `bot/tests/observe/bd-2kxxa2-media-target.test.js` · `tests/coaching/bd-pzs9a-photo-add-another.test.js`
- `next-step-store.js` ← `tests/coaching/next-step.test.js`
- `next-step.js` ← `tests/coaching/bd-v0toag.100.10-no-technology-ask.test.js` · `tests/coaching/next-step.test.js` · `tests/observe2/work-on-coaching-areas.test.js`
- `pedagogy-jargon.js` ← `tests/coaching/feat106-jargon-simplify.test.js`
- `photo-capture-routing.js` ← `tests/coaching/bd-3ipd2-photo-capture-routing.test.js` · `tests/coaching/bd-fmf24g.76-dc-no-class-and-ten-photos.test.js` · `tests/coaching/bd-pzs9a-photo-add-another.test.js`
- `photo-gate-sweep.js` ← `tests/coaching/bd-j3j4b-photo-gate-sweep.test.js`
- `portal-class-check.js` ← `tests/coaching/bd-aqotzx-portal-class-check.test.js`
- `portal-coaching.service.js` ← `tests/coaching/bd-fgj73x.7-portal-short-recording.test.js` · `tests/coaching/bd-lfzoz-portal-pipeline.test.js` · `tests/observe/bd-5rz1v.6-portal-observe-transcription.test.js`
- `portal-short-recording.js` ← `tests/coaching/bd-fgj73x.7-portal-short-recording.test.js`
- `practice-tag.js` ← `tests/coaching/practice-tag.test.js` · `tests/coaching/practice-why.test.js`
- `practice-why.js` ← `tests/coaching/practice-why.test.js`
- `reflection-progress.js` ← `tests/coaching/bd-60106-reflection-count-single-source.test.js`
- `reflective-acknowledgement.js` ← `tests/coaching/bd2651-voice-language-rules.test.js` · `tests/coaching/bd2662-meaningful-remark.test.js` · `tests/coaching/feat106-answer-acknowledgement.test.js`
- `reflective-answer-routing.js` ← `tests/coaching/bd-60106-late-reflective-answer.test.js` · `tests/handlers/coaching-slash-exit.test.js`
- `reflective-conversation.service.js` ← `bot/tests/observe/observe-pipeline-fork.test.js` · `bot/tests/whatsapp/send-audio-absent-temp-dir.test.js` · `tests/coaching/bd1sddt-skip-reflection.test.js` · `tests/coaching/meta-bill-nc5-sweeper-repeats.test.js` · `tests/coaching/reflection-language-anchor.test.js` · `tests/coaching/reflective-question-voice-gateway.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/coaching/reflective-conversation.service.js`)
- `report-card.js` ← `tests/coaching/bd-v0toag.57-report-card.test.js` · `tests/coaching/bd-v0toag.85-urdu-wells.test.js`
- `report-commit-prompt.js` ← `bot/tests/coaching/bd-v0toag-124-commit-prompt-template.test.js`
- `report-events.js` ← `tests/coaching/bd-v0toag.1.2-report-events.test.js`
- `report-generator.service.js` ← `bot/tests/coaching/bd-v0toag-106-report-window-template.test.js` · `bot/tests/observe/observe-pipeline-fork.test.js` · `tests/coaching/bd-9h2mm-voice-not-assessed.test.js` · `tests/coaching/bd-azzhu-survey-after-voice.test.js` · `tests/coaching/bd-b3pop-telemetry-kept-from-prompts.test.js` · `tests/coaching/bd-bmc9a0.2-iab-save-and-24h.test.js` (+21: `python3 kg/kg.py who-reads bot/shared/services/coaching/report-generator.service.js`)
- `report-link-send.js` ← `tests/coaching/bd-v0toag.19-report-link-send.test.js` · `tests/coaching/video-reco/report-generator.video-reco-send.test.js`
- `report-link-token.js` ← `tests/coaching/bd-v0toag.19-report-link-send.test.js` · `tests/coaching/bd-v0toag.38.9-agree-ping-service.test.js` · `tests/coaching/bd-v0toag.57-slim-report.test.js` · `tests/coaching/report-link-token.test.js` · `tests/coaching/video-reco/link-token.test.js` · `tests/portal/bd-v0toag.18-report-page.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/coaching/report-link-token.js`)
- `report-piece-once.js` ← `bot/tests/coaching/bd-v0toag-124-commit-prompt-template.test.js`
- `report-tracking.js` ← `tests/coaching/report-tracking-wiring.test.js` · `tests/coaching/report-tracking.test.js`
- `report-window-send.js` ← `bot/tests/coaching/bd-v0toag-106-report-window-template.test.js` · `bot/tests/coaching/bd-v0toag-127-template-error-detail.test.js`
- `session-ownership.js` ← `bot/tests/observe/bd-wwcgf-teacher-gets-observer-form.test.js`
- `session-terminal.js` ← `bot/tests/coaching/bd-n9832-terminal-guard-owners.test.js` · `bot/tests/observe/cancelled-observation-stays-cancelled.test.js`
- `short-recording-guidance.js` ← `tests/coaching/short-recording-tiers.test.js`
- `silence-detector.service.js` ← `bot/tests/services/silence-detector.test.js`
- `slim-report.js` ← `tests/coaching/bd-v0toag.57-slim-report.test.js`
- `subject-resolution.js` ← `tests/coaching/bd-fmf24g.76-dc-no-class-and-ten-photos.test.js` · `tests/coaching/fico-subject-conditional-rule.test.js` · `tests/coaching/subject-resolution.test.js` · `tests/lp-v8/split-lesson-consumers.test.js`
- `target-resolver.js` ← `tests/coaching/next-step.test.js` · `tests/coaching/target-coherence.test.js` · `tests/coaching/uptake-loop-acceptance.test.js` · `tests/observe2/end-of-visit.test.js` · `tests/observe2/target-rubric.test.js` · `tests/observe2/work-on-coaching-areas.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/coaching/target-resolver.js`)
- `thing-to-try-judge.js` ← `tests/coaching/thing-to-try-judge.test.js`
- `thing-to-try-pick.js` ← `tests/coaching/bd-v0toag.57-slim-report.test.js` · `tests/coaching/thing-to-try-pick.test.js`
- `thing-to-try-scope.js` ← `tests/coaching/thing-to-try-scope.test.js`
- `thing-to-try.js` ← `tests/coaching/thing-to-try.test.js`
- `transcript-enhancer.service.js` ← `bot/tests/services/transcript-enhancer.test.js`
- `transcription-processor.service.js` ← `bot/tests/observe/bd-2kxxa3-debrief-transcription-failure.test.js` · `bot/tests/observe/debrief-failure-class-recorded.test.js` · `bot/tests/observe/observe-debrief-capture.test.js` · `bot/tests/services/transcription-processor.test.js` · `tests/coaching/bd-7beiz-dedupe-call-site.test.js` · `tests/coaching/bd-c5reix-portal-duplicate-quiet.test.js` (+15: `python3 kg/kg.py who-reads bot/shared/services/coaching/transcription-processor.service.js`)
- `uptake-loop.service.js` ← `tests/coaching/angle-ladder-without-reflection.test.js` · `tests/coaching/card-v2-loop.test.js` · `tests/coaching/fidelity-phase-loop.test.js` · `tests/coaching/section-b-mode-history.test.js` · `tests/coaching/section-b-proxy-target.test.js` · `tests/coaching/uptake-loop-acceptance.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/coaching/uptake-loop.service.js`)

## Related (all, generated)
- skills: `coaching`?
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.index.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.md`? · `bot/shared/services/coaching/coaching-card/CLAUDE.index.md`? · `bot/shared/services/coaching/coaching-card/CLAUDE.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.index.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.md`? · `bot/shared/services/coaching/frameworks/CLAUDE.index.md`? · `bot/shared/services/coaching/frameworks/CLAUDE.md`? · `bot/shared/services/coaching/live-moves/CLAUDE.index.md`? · `bot/shared/services/coaching/live-moves/CLAUDE.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.index.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.md`? · `bot/shared/services/coaching/report-renderers/CLAUDE.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.index.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.md`? · `bot/shared/services/coaching/report-v2/CLAUDE.index.md`? · `bot/shared/services/coaching/report-v2/CLAUDE.md`? · `bot/shared/services/coaching/templates/CLAUDE.md`? · `bot/shared/services/coaching/video-reco/CLAUDE.index.md`? · `bot/shared/services/coaching/video-reco/CLAUDE.md`? · `bot/shared/services/coaching/weekly-report/CLAUDE.index.md`? · `bot/shared/services/coaching/weekly-report/CLAUDE.md`? · `bot/tests/coaching/CLAUDE.index.md`? · `bot/tests/coaching/CLAUDE.md`? · `bot/tests/lp-v8/CLAUDE.index.md`? · `bot/tests/observe/CLAUDE.index.md`? · `bot/tests/services/CLAUDE.index.md`? · `bot/tests/services/CLAUDE.md`? · `bot/tests/whatsapp/CLAUDE.md`? · `docs/agent-customization.md`?
