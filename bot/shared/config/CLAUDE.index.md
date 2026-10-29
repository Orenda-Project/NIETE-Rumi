# config — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/config -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__mocks__/` | → (no door; 1 files: 0 test + 1 support) |
| `app-settings-ttl.js` | Exports one shared TTL for app_settings switch caches (30s) that E2E lanes can shorten via env |
| `branding.js` | Env-overridable branding config for clones: welcome message, URL helpers returning null when unset |
| `capabilities.config.js` | Capability list that powers the "what can the bot do" detection; update when adding features |
| `classroom-audio.config.js` | Single home for what counts as a classroom recording (minimum minutes) so the chat assistant cannot invent one |
| `coaching-card.config.js` | Per-language copy for the coaching card header/footer, focus-area message and commit-prompt buttons |
| `coaching-debrief.config.js` | Coaching model, meta-prompt rules and NUM_REFLECTIVE_QUESTIONS for the post-analysis debrief |
| `coaching-messages.js` | i18n catalog of every system message the coaching pipeline sends teachers, with English fallback |
| `coaching-voice.js` | Builds the shared coaching-voice principles used by both reflective questions and the call persona (bd-1hae7.5) |
| `conversational-components.js` | Meta Conversational Components manifest: ice-breaker prompts, slash commands, welcome switch (bd-oak77.13) |
| `copy.v2.json` | Jugnu copy deck v2.4.1: every child, teacher and WhatsApp string in EN and UR, read via ux-strings and templates |
| `feature-availability.js` | Presence-based feature gating: a feature is on iff its required env keys are set |
| `feature-flags.js` | Bot-side fail-closed reader of app_settings feature flags and FDE subject lists; mirrors dashboard copy |
| `gamma-languages.config.js` | Language parameters (Urdu/Arabic RTL, fonts) passed through to the Gamma presentation API |
| `gender-neutral-address.js` | Urdu gender-neutral address and third-person rules for prompts, since user gender is unknown (bd-2453, bd-1hae7.19) |
| `language-config.js` | Per-language settings for reflective-question generation and regional adaptation |
| `language-prompts.js` | Language-specific prompt builders (discourse markers, code-switching, dialect targeting) per language code |
| `languages.js` | Language registry: single list (Urdu, English) every other language list derives from |
| `lesson-plan-generation.js` | One shared attempt-limit constant for queued lesson-plan render worker, queue service and health check |
| `lp612-families.js` | Subject-family mapping for the 6-12 LP author, ported from the upstream bake-off harness |
| `lp612-flags.js` | Flags and constants for runtime 6-12 lesson plans (LP_612_ENABLED, language menu, religious, template versions) |
| `lp612-subject-order.js` | Core-before-elective subject ordering and display names for the 6-12 subject menus (bd-y5vx3) |
| `menu-gates.js` | Presence-based booleans saying which menu features can actually start, read at call time |
| `meta-messaging-window.js` | The 24h Meta free-form window constant and 131047 error detection, one home for window checks and caches |
| `model-registry.js` | Single registry choosing an LLM per job with fallbacks and rollout buckets, replacing 12 env vars (bd-isn68) |
| `model-settings.js` | Async app_settings reader and sync cache feeding the model registry, fail-safe not fail-closed (bd-5rd2f) |
| `passage-backgrounds.json` | Generated per-level fallback colours and overlay opacity for reading passage backgrounds; read by passage services |
| `reading-benchmarks.js` | WCPM/LCPM fluency benchmark thresholds by grade and season for the reading benchmark service |
| `region-config.js` | Maps regions to default observation framework and coach-role display labels |
| `registration-data.js` | Static dropdown data (countries, regions, orgs, grades, subjects) feeding the registration Flow |
| `registration-roles.js` | Registration form may grant only Teacher or Principal; coach/AEO are admin-given (bd-3goqc0, bd-x7aprz.2) |
| `religious-reverence-rules.js` | Reverence rules injected into every conversational system prompt after the Covenant-of-Madina incident |
| `role-features.js` | Decides which role-shaped features (DC self-coaching vs HITL /observe) a user's menu offers |
| `score-bands.js` | Score-to-band thresholds and labels; observation scores show as a band, never a number (operator 2026-09-29) |
| `settings-config.js` | Dropdown data (languages, frameworks) for the settings WhatsApp Flow |
| `supabase-replica.js` | Read-only Supabase replica client with primary fallback, used by the live-calls stack (bd-vrbk4.2) |
| `supabase.js` | Supabase client singleton and cold-boot env gate that exits 78 when URL or service key is missing |
| `system-messages.js` | Legacy 9-language system message library (recovery/reset etc.) with getSystemMessage lookup by key and language |
| `tts-voices.js` | Per-language TTS pronunciation and script guidance; does NOT route (VOICE_MODELS in utils/constants.js does) |
| `uptake-loop-flags.js` | Single call-time switch isUptakeLoopEnabled for the feedback-uptake loop; unset means off |
| `ux-strings.js` | Teacher-facing fixed-copy catalog plus the language clamp deciding which language a surface may render |
| `voice-language-rules.js` | Shared Urdu/English rules for any TTS-spoken text: Nastaliq script, no Hindi vocabulary (bd-2651) |
| `web-quiz-brand.js` | Brand tokens (name, mark, colours, mascot, copy) for the web child quiz, resolved from app_settings/org/bot name |

## Who reads this (all, generated)
- `app-settings-ttl.js` ← imported by `bot/shared/services/app-redirect.service.js:244:da8192c7` · `bot/shared/services/quiz/story-teacher.service.js:39:039be3e4` · `bot/shared/services/quiz/web-quiz-book.js:34:0270cf2f` · `bot/shared/services/quiz/web-quiz-card.js:26:0270cf2f` (+3: `python3 kg/kg.py who-reads app-settings-ttl.js`)
- `branding.js` ← imported by `bot/shared/handlers/flow-response.handler.js:633:28ba89a8` · `bot/shared/handlers/portal-command.handler.js:21:f6ce7d02` · `bot/shared/routes/registration-endpoint.js:147:7a8e3c0a` · `bot/shared/services/app-redirect.service.js:82:2d68f758` (+17: `python3 kg/kg.py who-reads branding.js`)
- `capabilities.config.js` ← imported by `bot/shared/services/helper-agent.service.js:367:7bd0abf5`
- `classroom-audio.config.js` ← imported by `bot/shared/services/coaching/portal-coaching.service.js:42:3419ba03` · `bot/shared/services/coaching/portal-short-recording.js:16:1936ecc9` · `bot/shared/services/coaching/short-recording-guidance.js:49:566e3f5c` · `bot/shared/services/openai.service.js:5:963bea13`
- `coaching-card.config.js` ← imported by `bot/shared/services/coaching/coaching-card/card-image.service.js:12:a3506bc7` · `bot/shared/services/coaching/report-generator.service.js:609:11c3a014`
- `coaching-debrief.config.js` ← imported by `bot/shared/services/coaching/continue-coaching.service.js:26:50bb8b0b` · `bot/shared/services/coaching/reflection-progress.js:18:50bb8b0b` · `bot/shared/services/coaching/reflective-conversation.service.js:25:50bb8b0b` · `bot/shared/services/gpt5-mini.service.js:1594:425e6f0a`
- `coaching-messages.js` ← imported by `bot/shared/handlers/voice-message.handler.js:36:bcd76793` · `bot/shared/services/coaching/analysis-processor.service.js:22:b8fde5d4` · `bot/shared/services/coaching/coaching-session.service.js:18:b8fde5d4` · `bot/shared/services/coaching/continue-coaching.service.js:27:b8fde5d4` (+10: `python3 kg/kg.py who-reads coaching-messages.js`)
- `coaching-voice.js` ← imported by `bot/shared/calls/call-prompt.service.js:23:a4f86d30` · `bot/shared/services/coaching/reflective-questions/question-prompt.js:21:c96cd19f`
- `conversational-components.js` ← imported by `bot/shared/handlers/text-message.handler.js:50:5548731d` · `bot/scripts/set-conversational-components.js:34:a48af2cf`
- `copy.v2.json` ← imported by `bot/shared/templates/class-round.page.js:89:1d290c6f`
- `feature-availability.js` ← imported by `bot/scripts/setup/doctor.js:27:b39fb593` · `bot/shared/handlers/text-message.handler.js:82:ae3610c5` · `bot/shared/services/feature-keyword-detector.service.js:13:ae3610c5` · `bot/shared/services/feature-linker.service.js:23:ae3610c5` (+4: `python3 kg/kg.py who-reads feature-availability.js`)
- `feature-flags.js` ← imported by `bot/shared/handlers/flow-response.handler.js:1104:42775f89` · `bot/shared/routes/assessment-gen-endpoint.js:229:7d911ad0` · `bot/shared/routes/internal-api.routes.js:1483:288d36a4` · `bot/shared/services/assessment-entry.service.js:31:d0ef7535` (+7: `python3 kg/kg.py who-reads feature-flags.js`)
- `gamma-languages.config.js` ← imported by `bot/shared/services/content.service.js:4:488031ea`
- `gender-neutral-address.js` ← imported by `bot/shared/calls/call-prompt.service.js:24:867e2ac0` · `bot/shared/services/observe/observe-coach-feedback.js:17:2162f0c6` · `bot/shared/services/observe/observe-debrief-guide.js:23:2162f0c6` · `bot/shared/services/observe/observe-teacher-report.js:16:5976149f` (+1: `python3 kg/kg.py who-reads gender-neutral-address.js`)
- `language-config.js` ← imported by `bot/shared/services/gpt5-mini.service.js:1584:3cb050f1`
- `language-prompts.js` ← imported by `bot/shared/services/openai.service.js:4:52971b2a` · `bot/shared/services/video/video-script.service.js:10:ebbe105c`
- `languages.js` ← imported by `bot/shared/handlers/flow-response.handler.js:56:28620c16` · `bot/shared/routes/internal-api.routes.js:2458:15fe99b4` · `bot/shared/routes/pakistan-lp-endpoint.js:59:c771e67a` · `bot/shared/routes/registration-endpoint.js:77:a23d6135` (+38: `python3 kg/kg.py who-reads languages.js`)
- `lesson-plan-generation.js` ← imported by `bot/shared/services/lesson-plan-queue.service.js:15:9a5bc994` · `bot/shared/services/monitoring/lesson-plan-health.service.js:97:b0027c7c` · `bot/workers/lesson-plan-generation.worker.js:61:4d2fd6ae` · `bot/workers/sqs-worker.js:1357:0376e85f`
- `lp612-families.js` ← imported by `bot/shared/services/lp612-author.service.js:52:5f48950f` · `bot/workers/lp612-author.worker.js:63:0fb6b996`
- `lp612-flags.js` ← imported by `bot/shared/handlers/text-message.handler.js:51:9888d8eb` · `bot/shared/handlers/voice-message.handler.js:41:1a790c45` · `bot/shared/routes/pakistan-lp-endpoint.js:58:db38c478` · `bot/shared/services/coaching/portal-lesson-plan-library.service.js:63:95a0034b` (+10: `python3 kg/kg.py who-reads lp612-flags.js`)
- `lp612-subject-order.js` ← imported by `bot/shared/services/lp612-browse.service.js:51:33912d94` · `bot/shared/services/lp612-catalog.service.js:33:33912d94` · `bot/shared/services/lp612-render.service.js:46:191deb8a` · `bot/shared/services/lp612-serving.service.js:41:191deb8a` (+2: `python3 kg/kg.py who-reads lp612-subject-order.js`)
- `menu-gates.js` ← imported by `bot/shared/services/menu-match.service.js:46:cc44aa96` · `bot/shared/services/menu.service.js:108:cc44aa96` · `bot/shared/services/whatsapp.service.js:12:0077546e`
- `meta-messaging-window.js` ← imported by `bot/shared/services/observe/observe-send.service.js:23:1c4d2756` · `bot/shared/services/quiz/meta-window-cache.service.js:39:2897bde4` · `bot/shared/services/quiz/quiz-delivery.service.js:11:270445d1` · `bot/shared/services/whatsapp-send-pacer.js:50:971c5d57` (+1: `python3 kg/kg.py who-reads meta-messaging-window.js`)
- `model-registry.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:21:e1598755` · `bot/shared/services/child-test/scoring/models.js:7:98fff7c2` · `bot/shared/services/coaching/coaching-card/commitment-card.service.js:20:777e6bae` · `bot/shared/services/coaching/fidelity/fidelity-analyzer.js:39:777e6bae` (+28: `python3 kg/kg.py who-reads model-registry.js`)
- `model-settings.js` ← imported by `bot/shared/services/assessment/assessment-generation.service.js:22:b201504f` · `bot/shared/services/llm-client.js:422:4bdaf120` · `bot/shared/services/vision.service.js:16:e8026438`
- `passage-backgrounds.json` ← imported by `bot/shared/services/reading/passage-generation.service.js:35:164e702f`
- `reading-benchmarks.js` ← imported by `bot/shared/services/reading/benchmark.service.js:39:014b9dc7`
- `region-config.js` ← imported by `bot/shared/routes/settings-endpoint.js:28:6c2883c3` · `bot/shared/services/coaching/frameworks/framework-selector.js:33:8fae5ebf` · `bot/shared/services/coaching/report-generator.service.js:33:1058063a` · `bot/shared/services/coaching/report-transformers/fico-report-transformer.js:27:8f438357` (+6: `python3 kg/kg.py who-reads region-config.js`)
- `registration-data.js` ← imported by `bot/shared/routes/attendance-setup-endpoint.js:14:10deb1ba` · `bot/shared/routes/registration-endpoint.js:86:02c1a012`
- `registration-roles.js` ← imported by `bot/shared/handlers/flow-response.handler.js:58:6919ccc6` · `bot/shared/routes/registration-endpoint.js:94:5d0047c1` · `bot/shared/utils/registration-status.js:40:d00934ba` · `bot/shared/config/registration-data.js:144:2d855243`
- `religious-reverence-rules.js` ← imported by `bot/shared/calls/call-prompt.service.js:22:6d5d746a` · `bot/shared/services/openai.service.js:205:6d5d746a`
- `role-features.js` ← imported by `bot/shared/services/coaching/short-recording-guidance.js:42:0e5b41be` · `bot/shared/services/menu-match.service.js:15:0ef2af36` · `bot/shared/services/menu.service.js:13:ff996fa3` · `bot/shared/services/nudges/lp-coaching-ask.service.js:50:0e5b41be` (+6: `python3 kg/kg.py who-reads role-features.js`)
- `score-bands.js` ← imported by `dashboard/services/progress.service.js:43:2de943fa` · `dashboard/services/school-analytics.service.js:35:2de943fa`
- `settings-config.js` ← imported by `bot/shared/routes/settings-endpoint.js:27:bcd9de0c`
- `supabase-replica.js` ← imported by `bot/shared/calls/call-context.repo.js:16:5057528e` · `bot/shared/calls/call-tools.repo.js:25:5057528e`
- `supabase.js` ← imported by `bot/scripts/apply-lp612-figure-notes.js:28:bdc9e340` · `bot/scripts/assessment/backfill-paper-versions.js:101:eb082fc4` · `bot/scripts/assessment/repair-backfilled-v1-created-at.js:51:c58952a1` · `bot/scripts/backfill-lp-asset-sources.js:131:e2361752` (+437: `python3 kg/kg.py who-reads supabase.js`)
- `uptake-loop-flags.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:23:1a9040b0` · `bot/shared/services/coaching/report-generator.service.js:34:1a9040b0` · `bot/shared/services/observe/assignment/leader-source.js:26:6f3a3fb1` · `bot/shared/services/observe/observe-debrief.service.js:27:1a9040b0` (+1: `python3 kg/kg.py who-reads uptake-loop-flags.js`)
- `ux-strings.js` ← imported by `bot/scripts/import-lp612-segments.js:31:244271c0` · `bot/shared/handlers/account-state-reply.js:34:90174631` · `bot/shared/handlers/audio-document-router.js:135:90174631` · `bot/shared/handlers/flow-response.handler.js:57:de5cfe2f` (+212: `python3 kg/kg.py who-reads ux-strings.js`)
- `voice-language-rules.js` ← imported by `bot/shared/services/coaching/reflective-acknowledgement.js:14:1399dbb3` · `bot/shared/services/gpt5-mini.service.js:7:59d3beef` · `bot/shared/services/openai.service.js:6:59d3beef` · `bot/shared/services/reading/voice-feedback.service.js:29:8e032f5a` (+1: `python3 kg/kg.py who-reads voice-language-rules.js`)
- `web-quiz-brand.js` ← imported by `bot/shared/services/quiz/web-quiz-art.js:39:9cb0cda7` · `bot/shared/services/quiz/web-quiz-edge-learn.js:41:9cb0cda7` · `bot/shared/services/quiz/web-quiz-hub.js:487:9cb0cda7` · `bot/shared/services/quiz/web-quiz-page-warm.js:128:fa8107a7` (+3: `python3 kg/kg.py who-reads web-quiz-brand.js`)
- env `APP_SETTINGS_FLAG_TTL_MS` read at `bot/shared/config/app-settings-ttl.js:12:7b1a7c4a`
- env `BOT_NAME` read at `bot/shared/config/branding.js:22:bf7380d6` · `bot/shared/config/web-quiz-brand.js:122:1e5514cf`
- env `DEFAULT_COACH_ROLE_LABEL` read at `bot/shared/config/region-config.js:77:1b90f1cd`
- env `DEFAULT_LANGUAGE` read at `bot/shared/config/branding.js:26:d2c3924a`
- env `DEFAULT_OBSERVATION_FRAMEWORK` read at `bot/shared/config/region-config.js:34:6711fff0`
- env `LLM_SETTINGS_FRESH_WAIT_MS` read at `bot/shared/config/model-settings.js:240:e04f2c5d`
- env `LP612_AUTHOR_ROUNDS` read at `bot/shared/config/lp612-flags.js:304:40985bcb`
- env `LP612_AUTHOR_TIER` read at `bot/shared/config/lp612-flags.js:291:933dd8f4`
- env `LP612_AUTHOR_TIMEOUT_MS` read at `bot/shared/config/lp612-flags.js:308:0e10b2b0`
- env `LP612_CHECKPOINT_OFF` read at `bot/shared/config/lp612-flags.js:410:6c625f77`
- env `LP612_DRAIN_TIMEOUT_MS` read at `bot/shared/config/lp612-flags.js:396:815338d6`
- env `LP612_FOLLOWUP_MS` read at `bot/shared/config/lp612-flags.js:351:df997f35`
- env `LP612_OVERLAY_PASS_OFF` read at `bot/shared/config/lp612-flags.js:343:cd8b7491`
- env `LP612_OVERLAY_TIMEOUT_MS` read at `bot/shared/config/lp612-flags.js:347:02302a97`
- env `LP612_PROMPT_CACHE` read at `bot/shared/config/lp612-flags.js:208:f4961c46`
- env `LP612_QUEUE_ABANDON_MS` read at `bot/shared/config/lp612-flags.js:440:7a8e3791`
- env `LP612_TARGETED_REVISION` read at `bot/shared/config/lp612-flags.js:187:685aa881`
- env `LP612_WIDE_SEGMENTS` read at `bot/shared/config/lp612-flags.js:243:991c0a63`
- env `LP_612_EDIT_ENABLED` read at `bot/shared/config/lp612-flags.js:171:aa789d73`
- env `LP_612_ENABLED` read at `bot/shared/config/lp612-flags.js:136:c2b06102`
- env `LP_612_LANG_MENU` read at `bot/shared/config/lp612-flags.js:152:fac49b98`
- env `LP_612_RELIGIOUS_ENABLED` read at `bot/shared/config/lp612-flags.js:158:510bd08a`
- env `LP_612_ROUTE_ALL` read at `bot/shared/config/lp612-flags.js:465:f122416a`
- env `LP_612_ROUTE_K5` read at `bot/shared/config/lp612-flags.js:481:491d39cd`
- env `LP_612_TEMPLATE_FALLBACK` read at `bot/shared/config/lp612-flags.js:99:59f53a2f`
- env `LP_612_TEMPLATE_VERSION` read at `bot/shared/config/lp612-flags.js:247:fd938bce`
- env `NIETE_SUPABASE_REPLICA_URL` read at `bot/shared/config/supabase-replica.js:43:b7ed4147`
- env `ORG_NAME` read at `bot/shared/config/branding.js:23:2abd7e9f` · `bot/shared/config/web-quiz-brand.js:122:1e5514cf`
- env `REGION_COACH_ROLE_LABEL_MAP` read at `bot/shared/config/region-config.js:81:c55c5666`
- env `REGION_FRAMEWORK_MAP` read at `bot/shared/config/region-config.js:40:d5d66a10`
- env `SECURITY_CONTACT` read at `bot/shared/config/branding.js:25:6c57bf5e`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `bot/shared/config/model-settings.js:37:319f3b8a` · `bot/shared/config/supabase-replica.js:44:156061ae` · `bot/shared/config/supabase.js:23:08b79576`
- env `SUPABASE_URL` read at `bot/shared/config/model-settings.js:37:319f3b8a` · `bot/shared/config/supabase.js:22:58448145`
- env `SUPPORT_CONTACT` read at `bot/shared/config/branding.js:24:76976524`
- env `UPTAKE_LOOP_ENABLED` read at `bot/shared/config/uptake-loop-flags.js:11:689cc49f`

## Tests (all, generated)
- `app-settings-ttl.js` ← `tests/e2e-mock/app-settings-ttl.test.js`
- `branding.js` ← `tests/config/branding-defaults.test.js` · `tests/meta-bill-cut/fx3-silent-turn-typing.test.js` · `tests/setup/no-hardcoded-bot-name.test.js`
- `capabilities.config.js` ← `bot/tests/i18n/slash-command-bidi.test.js` · `tests/menu-match/chat-no-presentations.test.js`
- `classroom-audio.config.js` ← `tests/coaching/assistant-recording-minimum.test.js` · `tests/coaching/bd-fgj73x.7-portal-short-recording.test.js` · `tests/coaching/short-recording-tiers.test.js` · `tests/handlers/short-recording-guidance.test.js`
- `coaching-card.config.js` ← `tests/coaching/bd-azzhu-survey-after-voice.test.js` · `tests/coaching/bd-fmr3s-session-complete-merged.test.js` · `tests/coaching/card-buttons-routed.test.js` · `tests/coaching/uptake-loop-acceptance.test.js` · `tests/language/urdu-gender-neutral-copy.test.js` · `tests/region/coach-role-label.test.js`
- `coaching-debrief.config.js` ← `tests/coaching/bd-60106-reflection-count-single-source.test.js` · `tests/coaching/coaching-debrief-config.test.js` · `tests/coaching/continue-coaching-tap.test.js` · `tests/coaching/feat106-change1-one-reflective-question.test.js`
- `coaching-messages.js` ← `bot/tests/observe/coach-language-bound-observation.test.js` · `tests/coaching/bd-0c80s-guard-ignores-observe.test.js` · `tests/coaching/bd-2c1gj-lp-select-confirm.test.js` · `tests/coaching/bd-59840-honest-wait-no-ack.test.js` · `tests/coaching/bd-7beiz-audio-hash-dedupe.test.js` · `tests/coaching/bd-7beiz-dedupe-call-site.test.js` (+27: `python3 kg/kg.py who-reads bot/shared/config/coaching-messages.js`)
- `coaching-voice.js` ← `bot/tests/calls/call-prompt.test.js` · `bot/tests/calls/coaching-voice.test.js`
- `conversational-components.js` ← `bot/tests/welcome/bd-oak77.13-ice-breakers.test.js` · `tests/app-redirect/app-link-leader-lessons-doors.test.js` · `tests/app-redirect/app-redirect-routing.test.js`
- `copy.v2.json` ← `bot/tests/quiz/web-quiz/class-round-paused-card.test.js` · `bot/tests/quiz/web-quiz/class-round-paused-continue.test.js` · `bot/tests/quiz/web-quiz/class-round-retired-still.test.js` · `bot/tests/quiz/web-quiz/class-round-urdu-digits.test.js` · `bot/tests/quiz/web-quiz/class-round.test.js` · `dashboard/tests/web-quiz-child-screen-lint.service.test.js`
- `feature-availability.js` ← `tests/reading/reading-availability-gate.test.js` · `tests/setup/spoken-replies-availability.test.js` · `tests/unit/sprint-1/feature-availability.test.js`
- `feature-flags.js` ← `tests/assessment/assessment-chat-ack.test.js` · `tests/assessment/assessment-versions-flag.test.js` · `tests/assessment/fde-reader-gate.test.js` · `tests/assessment/fde-stem-check-gate.test.js` · `tests/assessment/topics/topic-cta-flag.test.js` · `tests/quiz/quiz-author-gates-load.test.js`
- `gender-neutral-address.js` ← `bot/tests/calls/call-gender-neutral.test.js` · `bot/tests/observe/second-person-address.test.js` · `bot/tests/observe/third-person-teacher.test.js` · `bot/tests/quiz/video-quiz-report-insight.test.js` · `tests/quiz/report-guidance-address.test.js`
- `language-config.js` ← `tests/coaching/coaching-debrief-config.test.js`
- `language-prompts.js` ← `bot/tests/lp-v8/voice-reply-quality.test.js`
- `languages.js` ← `bot/tests/services/remark-delivery-deps.test.js` · `tests/attendance/voice-note-wiring.test.js` · `tests/classes/class-labels.test.js` · `tests/coaching/analysis-output-language.test.js` · `tests/coaching/bd-jbjrx-step-language.test.js` · `tests/coaching/coaching-confirm-language.test.js` (+21: `python3 kg/kg.py who-reads bot/shared/config/languages.js`)
- `lp612-flags.js` ← `bot/tests/lp-v8/bd-oak77-route-all.test.js` · `tests/lesson-plan-lifecycle/lp612-leader.test.js` · `tests/lesson-plan-lifecycle/lp612-path.test.js` · `tests/lp-v8/bd-oak77-9-route-all.test.js` · `tests/lp612/flags.test.js` · `tests/lp612/phone-page.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/config/lp612-flags.js`)
- `lp612-subject-order.js` ← `tests/lp612/urdu-plan-english-residue.test.js`
- `menu-gates.js` ← `tests/menu/menu-role-layouts.test.js`
- `model-registry.js` ← `bot/tests/llm-cost-attributed.test.js` · `bot/tests/llm-fallback-armed.test.js` · `bot/tests/llm-fallback-per-job.test.js` · `bot/tests/llm-vendor-fallback.test.js` · `bot/tests/model-assessment-registry.test.js` · `bot/tests/model-registry-noop.test.js` (+17: `python3 kg/kg.py who-reads bot/shared/config/model-registry.js`)
- `model-settings.js` ← `bot/tests/model-pilot-vision.test.js` · `bot/tests/model-settings-backoff.test.js` · `bot/tests/model-settings-no-db.test.js` · `bot/tests/model-settings.test.js` · `tests/app-redirect/app-link-leader-lessons-voice-topic.test.js` · `tests/assessment/fde-prompt-cache.test.js` (+24: `python3 kg/kg.py who-reads bot/shared/config/model-settings.js`)
- `reading-benchmarks.js` ← `tests/reading/benchmark-service.test.js`
- `region-config.js` ← `tests/coaching/fico-framework-ict.test.js` · `tests/config/branding-defaults.test.js` · `tests/region/coach-role-label.test.js` · `tests/settings/settings-flow.test.js`
- `registration-data.js` ← `tests/registration/bd-x7aprz2-registration-v5.test.js`
- `registration-roles.js` ← `tests/registration/bd-x7aprz2-registration-v5.test.js`
- `religious-reverence-rules.js` ← `bot/tests/calls/call-prompt.test.js` · `bot/tests/lp-v8/religious-reverence.test.js` · `tests/quiz/student-persona-prompt.test.js`
- `role-features.js` ← `tests/handlers/menu-list-only.test.js` · `tests/handlers/menu-rows.test.js` · `tests/menu/menu-language-and-honesty.test.js` · `tests/menu/menu-role-layouts.test.js` · `tests/menu/role-features.test.js`
- `score-bands.js` ← `portal/src/portal/lib/scoreBands.test.ts` · `tests/portal/score-bands.test.js`
- `settings-config.js` ← `tests/settings/settings-flow.test.js`
- `supabase.js` ← `bot/scripts/e2e/lp-feedback-e2e.js` · `bot/tests/first-touch/door-cache.test.js` · `bot/tests/first-touch/door-keys.test.js` · `bot/tests/first-touch/door-known.golden.test.js` · `bot/tests/first-touch/door-off.golden.test.js` · `bot/tests/first-touch/door-on.test.js` (+586: `python3 kg/kg.py who-reads bot/shared/config/supabase.js`)
- `uptake-loop-flags.js` ← `tests/coaching/uptake-loop-flag.test.js`
- `ux-strings.js` ← `bot/tests/calls/call-overflow-strings.test.js` · `bot/tests/coaching/bd-n9832-terminal-guard-owners.test.js` · `bot/tests/coaching/bd-rw4so-confirm-refusal-language.test.js` · `bot/tests/first-touch/first-reply-english.text-turn.test.js` · `bot/tests/first-touch/maker-empty.golden.test.js` · `bot/tests/first-touch/maker.cards.assessment-door.test.js` (+181: `python3 kg/kg.py who-reads bot/shared/config/ux-strings.js`)
- `voice-language-rules.js` ← `bot/tests/lp-v8/sara-voice-delta.test.js` · `tests/coaching/bd2651-voice-language-rules.test.js`
- `web-quiz-brand.js` ← `bot/tests/quiz/web-quiz/web-quiz-brand.test.js` · `bot/tests/quiz/web-quiz/web-quiz-edge-learn.test.js` · `bot/tests/quiz/web-quiz/web-quiz-fast-reads.test.js` · `bot/tests/quiz/web-quiz/web-quiz.service.test.js` · `dashboard/tests/web-quiz-contrast.service.test.js` · `dashboard/tests/web-quiz-page-card.service.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/config/web-quiz-brand.js`)

## Related (all, generated)
- skills: `digital-coach`? · `registration`? · `setup`?
- docs: `.github/CONTRIBUTING.md`? · `AGENTS.md`? · `CLAUDE.md`? · `bot/shared/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `docs/agent-customization.md`? · `docs/architecture.md`? · `docs/classes-model.md`? · `docs/customization.md`? · `docs/e2e-profiling.md`? · `docs/features/role-based-menu.md`? · `docs/model-switching.md`? · `docs/onboarding/api-keys.md`? · `docs/pulling-updates.md`?
