# services — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests/services -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `reading/` | → (no door; 1 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `audio.service.test.js` | Tests AudioService language-aware ASR routing: Soniox languages vs MMS-ASR for regional languages |
| `bd-2kxxa3-whisper-extension-convert.test.js` | Pins that the Whisper last-resort path transcodes .aac/.amr containers to mp3 via ffmpeg before upload (bd-2kxxa.3 T4b) |
| `bd-gc1ge-remark-roster-nameless.test.js` | Pins that the /remark roster never prints the literal 'null' or an empty gap for a nameless teacher (bd-gc1ge) |
| `capability.test.js` | Pins the capability registry and hasCapability resolving from data (e.g. remark.author), not a hardcoded list (bd-2531) |
| `coach-voice-note-retention.test.js` | Pins 30-day coach voice-note retention sweep: R2 delete then null key, retry on failure, bounded batches (bd-v0toag.67) |
| `curriculum-lp-ast.findByTopic.test.js` | Tests CurriculumLpAstService.findByTopic natural-language matcher incl. 'lesson plan for grade 1 math number buddies' |
| `lesson-plan-template.grounded.test.js` | Tests buildGroundedLessonPlanPrompt: 5-step GRR layout, verbatim teacher scripts and metadata embedded |
| `lp-feedback.service.test.js` | Integration tests: LpFeedbackService: delayed prompt, Urdu prompt, button handling with mocked Redis, Supabase, WhatsApp |
| `lp612-figures-missing-queryable.test.js` | Pins a missing lp612 book crop is emitted as the queryable lp612.figures.missing event with ids and reason (bd-7wr3f) |
| `lp612-renderid-join.test.js` | Pins that deliverRender forwards renderId into the scheduled feedback prompt so a thumbs-down is traceable (bd-jsong) |
| `name-extractor.test.js` | Tests NameExtractorService prompt building with and without a student list for contextual biasing |
| `oxbridge-lp.service.test.js` | Unit tests of OxbridgeLpService: grade 6-12 eligibility and findMatches topic resolution (FEAT-080, bd-2016) |
| `pregen-lookup.service.test.js` | Pins PreGenLookupService.findPreGenLP filtering by curriculum, grade, subject and chapter, null on error |
| `remark-command-handler.test.js` | Tests the /remark command handler: fall-through of non-matches, three distinct refusals, entry-point wiring (bd-2531) |
| `remark-default-send.test.js` | Pins that the default sendMessage dep of /remark can really send (static method not detached) (bd-2711) |
| `remark-delivery-deps.test.js` | Pins makeDeliveryDeps.loadScores returning rows with numeric ordinal so computeS no longer throws on delivery |
| `remark-delivery.test.js` | Pins /remark submit and narrative delivery: persist first, then LLM, teacher's language, retry on LLM failure (bd-2531) |
| `remark-flow.test.js` | Pins the /remark rubric walk: parseTeacherPick and state derived from score rows with no session table (bd-2531) |
| `remark-gate.test.js` | Pins the /remark trigger gate: matches the command, not prefix collisions or bare mentions (bd-2529) |
| `remark-init-roster.test.js` | Pins that the /remark init roster lists every teacher with the score already given, not only un-evaluated ones |
| `remark-narrative.test.js` | Pins that the Supervisor Remark narrative prompt carries anchors never digits and teacher never sees a score (bd-2531) |
| `remark-progress-comment.test.js` | Regression: deriveProgress must report comment state (hasComment, skipped, not asked) found by staging E2E (bd-2531) |
| `remark-rubric.test.js` | Pins the STEPS 'S' rubric contract: 5 indicators, export column keys, 4-to-1 scale (bd-2531) |
| `remark-score-repository.test.js` | Pins that remark score reads target the s_pct Postgres view for teacher, cycle and principal scopes (bd-2531) |
| `remark-screens.test.js` | Pins the /remark indicator screens: full anchors, indicator and teacher names, progress shown (bd-2531) |
| `remark-wiring.test.js` | Source guard that text-message.handler.js has the /remark branch, calls the handler and returns when handled (bd-2531) |
| `remark-write.test.js` | Pins /remark write path: ensureRemark lazily creates header, saveScore upserts so flow is session-free (bd-2531) |
| `settings-group.test.js` | Tests settings-group: one app_settings read for a host switch plus riders, with absence and failure handling |
| `silence-detector.test.js` | TDD tests for the silence detector service: detectSilences gaps between tokens and board-writing inference |
| `student-list.test.js` | Tests StudentListService parseStudentText and related parsing of pasted student lists |
| `topic-matching.service.test.js` | Tests TopicMatchingService.findChapterByTopic: grade/subject scoping, ILIKE direction fix, topic_keywords contains hit |
| `transcript-enhancer.test.js` | TDD tests for the transcript enhancer: enhanceTranscript LLM post-processing of segments |
| `transcription-processor.test.js` | TDD tests that transcribeWithDiarization returns real Soniox tokens and _buildDiarizationFromTokens builds diarization |
| `vision.service.test.js` | Tests VisionService analyzeImage, analyzeWithRetry and token estimation for GPT-4.1-mini image analysis |

## Who reads this (all, generated)
- env `LP612_PAGE_TRUTH_DIR` read at `bot/tests/services/lp612-figures-missing-queryable.test.js:50:f8eefa63`
- env `OPENAI_API_KEY` read at `bot/tests/services/transcript-enhancer.test.js:280:f1ad06eb`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/authz/CLAUDE.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/remark/CLAUDE.index.md`? · `bot/shared/services/remark/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/services/CLAUDE.index.md`? · `bot/tests/services/CLAUDE.md`?
