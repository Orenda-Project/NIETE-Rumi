# quiz — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/tests/quiz -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 3 files: 0 test + 3 support) |
| `goldens/` | → (no door; 2 files: 0 test + 2 support) |
| `helpers/` | Render-and-measure helpers that read PDFs and pages back as ink for layout tests → `helpers/CLAUDE.md` |
| `teacher-quiz-menu/` | Tests for the teacher /quiz home, report list and button routing → `teacher-quiz-menu/CLAUDE.md` |
| `web-quiz/` | Jest suite for the kid-facing web quiz, hub, Challenge, stories and share flows → `web-quiz/CLAUDE.md` |
| `backfill-bank-quiz-audio.test.js` | Pins the video-bank quiz audio backfill script: ranking, dry-run makes zero calls, real publishQuizAudio with fakes |
| `backfill-quiz-language.test.js` | Pins backfill-quiz-language: decideLanguage rule (ur if half of questions Arabic-script), dry-run default, filters |
| `bd-v0toag-126-quiz-offer-window.test.js` | bd-v0toag.126: quiz offer processOffer checks the 24h window first; closed means no claim, digest or send (131047) |
| `chat-quiz-report-send-checked.test.js` | Pins quiz_report_send_checked in quiz-job-handler handleQuizReport: flag set only if WhatsApp took it, 3 tries |
| `child-flow-token.test.js` | bd-2475: ChildFlowToken build/parse round-trip of the phone-keyed flow token for anonymous quiz children |
| `child-quiz-home.test.js` | Pins child /quiz opening a Home hub cta_url (flag web_quiz_child_quiz_home) via the real webhook; teacher never gets it |
| `class-report-layout.test.js` | Prints the class-results report through real Chromium and checks page count and packing, Urdu and English |
| `handout-class-binding.test.js` | Pins deliverClassLink: known class mints a bound share code, ambiguous sends unbound then asks, none unchanged |
| `handout-class-real-resolver.test.js` | Runs hand-out class binding through the real resolveQuizClass for one, two-section and out-of-grade class cases |
| `latin-runs-rtl.test.js` | Pins that an English phrase with "&" or middle dot in an Urdu teacher PDF is one LTR isolate (wrapLatin) |
| `lp-asset-source.store.test.js` | Pins lp-asset-source.store resolveSlideScript: exact content_hash version only, no latest fallback, null on miss |
| `lp-quiz-list.test.js` | Pins /quiz list buildRows union of lp_v8 quizzes and coaching sessions, sorted by date, 9 per page plus Older |
| `lp-quiz-offer-worker-wiring.test.js` | Boots the real startWorker and checks lp_quiz_offer is registered once on the sweeping main worker only |
| `lp-quiz-queue-failed.test.js` | Pins that a lesson-plan quiz whose generate job cannot be queued keeps lessons, class and date and offers Make it again |
| `lp-quiz-report.test.js` | R8 lane D 3.5: class report of an lp_v8 quiz carries digest objectives; markReportSent flips lp_v8 via isLessonQuiz |
| `meta-window-cache-status.test.js` | bd-v0toag.108: a 131047 status receipt flags that phone's 24h window closed in meta-window-cache.service |
| `old-link-redirect.test.js` | Pins the QUIZ-<code> old-link redirect to ONE web-quiz cta_url under web_quiz_old_link_redirect, with guards |
| `old-link-reoffer.test.js` | Pins re-offering the Start quiz button once to a child who types after the redirect, plus redirect wamid logging |
| `one-voice-missing-keys.test.js` | Pins read-only pre-flip check one-voice-missing-keys.js for web_quiz_one_voice: lists missing clips by id |
| `quiz-column-sum-katex.test.js` | Real-KaTeX check that a textbook column sum is valid TeX and typeset as an array on the card and teacher PDF |
| `quiz-equation-runs-katex.test.js` | Real-KaTeX check that an Urdu stem's Latin-x equation renders as one LTR expression on card and teacher PDF |
| `quiz-picture-words.test.js` | Pins pointsAtPicture (quiz-picture-words): which stem wordings, English and Urdu, mean the stem refers to a picture |
| `quiz-sources.test.js` | R8 lane D 3.1: pins quiz-sources constants and isLessonQuiz/isPlanQuiz predicates for transcript, lp_v8, lp612 quizzes |
| `quiz-stacked-fractions-katex.test.js` | Real-KaTeX check that flat $2/3$ fractions render stacked (mfrac) on the child card and teacher PDF |
| `quiz-start-via-home.test.js` | Pins that a quiz started from teacher home is credited home: Funnel.metaSourceOf, teacher_home channel, failure copy |
| `quiz-typeset-maths-katex.test.js` | bd-mg9c7.159.19 A: real-KaTeX check that fractions typeset as mfrac with KaTeX faces inlined, English and Urdu |
| `record-one-voice-shared-lines.test.js` | Pins scripts/quiz/record-one-voice-shared-lines: per-voice set naming, no calls without --apply, manifest and hash |
| `record-welcome-lines.test.js` | Pins scripts/quiz/record-welcome-lines: one clip per welcome line and language in the plan voice, under 4.5 s |
| `report-delivery-send.test.js` | Pins that an accepted class report keeps its wamid in Redis report_msg:<id> for 48h when quiz_report_send_checked is on |
| `report-delivery-webhook.golden.json` | Recorded OFF-path supabase/redis call log golden loaded by report-delivery-webhook.test.js |
| `report-delivery-webhook.test.js` | Drives the real webhook status handler: a failed report status un-stamps the report and counts toward 3 tries |
| `report-not-through.test.js` | Pins /quiz reply when WhatsApp refused a report: "didn't come through" with link, never "no one has finished" |
| `report-send-checked.test.js` | Pins video-quiz-report.buildAndSend stamping report_sent_at only if WhatsApp accepted the send; retries then gave_up |
| `rescore-kept-reads.test.js` | Pins scripts/quiz/rescore-kept-reads: tier guard, dry-run default with cost ceiling, writes only score meta fields |
| `restore-bank-recorded-voices.test.js` | Pins scripts/quiz/restore-bank-recorded-voices: dry-run default, --apply writes option_audio by slot, idempotent |
| `send-flow-screen-data.test.js` | bd-mg9c7.79: sendFlow must carry navigateData into flow_action_payload.data (student-join WHO, picture-quiz ASK) |
| `send-returning-id.test.js` | Pins WhatsAppService sendTextReturningId and sendAudioFromUrlReturningId that the quiz sender calls for quoted replies |
| `student-identity.test.js` | bd-2337: StudentIdentity handset normalisation and none/one/many resolution so a child types their name once |
| `student-ingress-after-remember.test.js` | Pins that student-ingress drops its cached unknown verdict once StudentIdentity.remember writes the child row |
| `student-ingress-portal.test.js` | Pins that a child's "portal"/"/portal" opens their home like "quiz"; PORTAL_KEYWORD_ROUTING=false restores old answers |
| `student-ingress.test.js` | bd-2yyry.1-.3: student-ingress classify three rules and route() for child versus teacher across message types |
| `student-join-flow.test.js` | bd-2338: a never-met child gets the name+class join Flow once; a returning child never does; no-Flow fallback |
| `student-join-language.test.js` | Pins the localized student-join Flow filled from the catalog so an Urdu quiz link never shows English on entry |
| `student-quiz-flow-endpoint.test.js` | bd-2yyry.13: child /quiz Flow endpoint INIT/actions, sq_action discriminator, child token versus teacher token |
| `student-quiz.test.js` | bd-2yyry.13: student-quiz.service quizzesForHandset listing and open() sending the child Flow with a childpick token |
| `student-teacher-link.test.js` | bd-2340: a new child is filed under the enrolling teacher once; the link is never rewritten by a later quiz |
| `teacher-pdf-footer.test.js` | Sweeps the last question's length through real renderPdf and Chromium so the footer never sits alone on a page |
| `teacher-pdf-summary-quoted-title.test.js` | Pins the "What you planned" first-sentence split on the teacher PDF so a quoted title with ! or ? stays whole |
| `teacher-self-test.test.js` | PLAN_R5 D8: isSelfTest marks a session whose user_id equals the share-code owner, nothing else |
| `transcript-quiz-flow-action-empty.test.js` | Pins /quiz Flow fix for empty tq_action submits and undeclared error_message: bare Continue acts or refuses loudly |
| `transcript-quiz-flow-class-labels.test.js` | Pins the /quiz lesson screen writing each child's class one way (named once or per line) in the teacher's language |
| `transcript-quiz-flow-endpoint.test.js` | R6 lane M: /quiz as one WhatsApp Flow; paging stays in-Flow, lesson tap shows results, actions end on DONE |
| `transcript-quiz-lp-hint-app-opens.test.js` | Pins transcript-quiz-digest lpHintFor counting niete_lp_opens app opens (LP_CONTEXT_COUNT_APP_OPENS) within -36h/+6h |
| `urdu-line-spacing.test.js` | Measures ink gaps between Nastaliq lines on teacher sheet, report and class card via line-ink; fixes overlap |
| `urdu-spacing-kill-switch.test.js` | Pins QUIZ_URDU_SPACING_V2 kill switch: off gives pre-spacing CSS; on is one appended block, removable byte-for-byte |
| `ux-strings-teacher-word.test.js` | Pins exact Urdu and English bytes of child-facing ux-strings that use the word ٹیچر (expired link, join help, button) |
| `video-quiz-answer-lock.test.js` | Pins per-phone answerlock (setNX) and index derived from answers so concurrent taps cannot resend question 6 |
| `video-quiz-answer-reconcile.test.js` | Pins that a duplicate (23505) answer tap rebuilds state from quiz_answers and continues or finishes the session |
| `video-quiz-answers-truth.test.js` | Pins that finish and reconcile count from the quiz_answers table, not a stale in-memory question list |
| `video-quiz-binge-neutral.test.js` | bd-2yyry.9: watch-more copy moved to ux-strings, gender-neutral Urdu, caps in code points, Flow text in quiz language |
| `video-quiz-binge.test.js` | Pins video-quiz-binge offerMore (no-op without ids, two-button offer) and handleMoreButton behaviour |
| `video-quiz-card-four-options.test.js` | Pins that a question card with four options sends a list so every drawn letter is tappable; three use buttons |
| `video-quiz-child-copy-language.test.js` | Pins that the inviter's friend-result and the class-link share message follow the quiz language, English unchanged |
| `video-quiz-class-card.test.js` | bd-2yyry.11: class card sent to each finished child (not the teacher) once per quiz behind CLASS_CARD_ENABLED |
| `video-quiz-counter-drift.test.js` | Pins that quiz_sessions counters come from the quiz_answers table so lost Redis updates never drop an answer |
| `video-quiz-figure-delivery.test.js` | Pins that a P3 figure question goes as ONE image-with-buttons message: picture header, stem body, options |
| `video-quiz-invite-language.test.js` | Pins that the invite-a-friend messages (own and forwardable) are in the quiz language, incl. in-flight invites |
| `video-quiz-invite.test.js` | bd-2339: only a friend's first name and score cross between two children; invitee recorded on the teacher's share code |
| `video-quiz-late-class-card.test.js` | bd-2yyry.18: sendLateClassCards gives a child finishing after the report their class card, nothing to the teacher |
| `video-quiz-latency.test.js` | Pins video_quiz.phase_sent and answer_latency telemetry (send, throttle, gap decomposition) in sender and service |
| `video-quiz-leaderboard.test.js` | bd-2yyry.10: rankRows ordering/ties and what the child's class card paints for the leaderboard |
| `video-quiz-lesson-first.test.js` | bd-2395/FEAT-121: a shared class link sends the lesson video before question 1 |
| `video-quiz-multi-select.test.js` | PLAN_R5 D4: sending select-all-that-apply questions (Flow versus picker) and grading the returned set |
| `video-quiz-offer-path-language.test.js` | Pins that the /video quiz offer path (decline, etc.) speaks the run's language even after run state is gone |
| `video-quiz-offer-share.test.js` | bd-2336: the quiz offer carries a Share-with-class choice that mints the class link before a solo run |
| `video-quiz-one-message-per-question.test.js` | Pins one WhatsApp send per question (card as header, counter in body) to stay inside the per-recipient throttle |
| `video-quiz-post-quiz-telemetry.test.js` | TQ-R5 lane H: uniform video_quiz.offer_shown / scorecard_sent funnel events for every post-quiz offer |
| `video-quiz-question-cascade.test.js` | bd-2477 #1: a 131056 rate-limit storm backs off instead of burning through every remaining question |
| `video-quiz-rate-limiter.test.js` | bd-2666: per-recipient sliding-window self-throttle in front of every video-quiz WhatsApp send |
| `video-quiz-render.test.js` | bd-2306: three-phase render contract (phase order and operator FEEDBACK_RULES) for video quiz messages |
| `video-quiz-report-attribution.test.js` | bd-2472: an invited friend's session never reaches the teacher's class report roster or counts |
| `video-quiz-report-dual-language.test.js` | bd-mg9c7.27: class report chrome follows the teacher's language while quoted questions follow the quiz's |
| `video-quiz-report-first-report-guard.test.js` | bd-2yyry.18: a completion never sends the first report before its scheduled time; follow_up suppressed |
| `video-quiz-report-followup.test.js` | Pins removal of the early report path (shouldSendEarly) so class reports wait for the 12-hour schedule |
| `video-quiz-report-guidance-clean.test.js` | bd-2611/2612: report guidance reaches the teacher with markup stripped and clean wording |
| `video-quiz-report-insight.test.js` | bd-2335: class report names the wrong option the class clustered on to say what to reteach |
| `video-quiz-report-one-attempt.test.js` | bd-2yyry.15: oneAttemptPerChild keeps each child's latest completed attempt in the class report |
| `video-quiz-report-self-test.test.js` | PLAN_R5 D8: a teacher's self-test run is excluded from the class report roster, average and hardest question |
| `video-quiz-report-template.test.js` | bd-2473: class report template redesign (navy hero, Fraunces headline, hero score, jewel cards) |
| `video-quiz-report-timing.test.js` | bd-2404/2405: class report timing survives a forwarded link; 12-hour scheduled fallback, no early fire |
| `video-quiz-report.test.js` | bd-2334: class report scheduling survives the queue (targetAt in payload) and never says "0 of 1 finished" |
| `video-quiz-scorecard-name.test.js` | bd-2481: scorecard carries the taker's name, resolved at startSession for a solo teacher run or a child |
| `video-quiz-scorecard-v4.test.js` | Scorecard v4: one ground for every score and an aligned card layout in the child's scorecard render |
| `video-quiz-scorecard-wiring.test.js` | bd-2474: finish() sends the scorecard IMAGE before the invite-a-friend button instead of plain text |
| `video-quiz-scorecard.test.js` | bd-2474: child scorecard template and service in isolation, e.g. starsAndBadge score-to-stars mapping |
| `video-quiz-self-test-join.test.js` | PLAN_R5 D8: a teacher opening their own class link joins as themself, not written to students; children unaffected |
| `video-quiz-sender.test.js` | bd-2358: the sender never shows the same option twice in a picker row (no description repeating its title) |
| `video-quiz-session-order.test.js` | Pins orderForSession so a transcript bank is asked by sort_order and "Question N of M" chrome matches the card |
| `video-quiz-share.test.js` | bd-2313..2316: share-code parsing of inbound text (no false positives) and minting in video-quiz-share.service |
| `video-quiz-shuffle.test.js` | bd-2359: option shuffle moves the correct answer off slot A so slots are about equally used across the bank |
| `video-quiz-throttle-coverage.test.js` | bd-2681: startSession and sendNextQuestion direct sends go through rateLimiter.throttle like sendPhase |
| `video-quiz-tracking.test.js` | bd-2396/2397/2398: funnel tracking, e.g. startSession stamps quiz_session_id onto video_quiz_deliveries |
| `video-quiz-undeliverable-question.test.js` | Pins that an undeliverable question is skipped and scored over questions asked, never turned into a finish |
| `video-quiz-verdict-marker.test.js` | Round-5 D2: every verdict opens with a tick or cross so the child can tell right from wrong at a glance |
| `video-quiz-window-budget.test.js` | Pins the re-costed per-recipient send window: a full 19-send session waits zero, cap still bites at the 25th |
| `video-report-schedule-once.test.js` | Pins scheduleForShareCode queueing one class-report chain per share code, not one per joining child |
| `video-report-send-once.test.js` | Pins that the class report is sent once per share code even when scheduled runs race to generate() |
| `web-quiz-publish.test.js` | Pins publishQuizAudio: one read-aloud clip per question, option and why line, recorded once to R2 under the quiz |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/quiz/CLAUDE.md`? · `bot/shared/services/tts/CLAUDE.md`? · `bot/shared/templates/CLAUDE.md`? · `bot/shared/utils/CLAUDE.md`? · `bot/tests/CLAUDE.md`?
