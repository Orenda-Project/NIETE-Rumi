# quiz — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/quiz -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__fixtures__/` | → (no door; 1 files: 0 test + 1 support) |
| `fixtures/` | → (no door; 1 files: 0 test + 1 support) |
| `helpers/` | Shared stubs and fixtures for quiz suites: Supabase fakes, lesson fixtures → `helpers/CLAUDE.md` |
| `__snapshots__/` | → (not mapped: excluded; 1 files) |
| `base-ten-thousands.test.js` | base_ten gets a thousands place: place-value mat columns thousands to ones (also in Urdu), a thousand drawn as a cube |
| `child-card-subject-and-topic.test.js` | Child scorecard and class card name the subject in the card's language, never the key; English topic cut at its end |
| `child-copy-urdu-grammar.test.js` | Four Urdu grammar faults on child surfaces: rank ordinals on the class card, scorecard caption, post-join greeting |
| `child-quiz-fewer-bubbles.test.js` | Children's quiz sends fewer bubbles (NQ1 etc.): the verdict rides on the next question; same words, same order |
| `child-refusals-once-a-day.test.js` | NQ6: a child hears each refusal line once a day; repeats get a free reaction, stickers nothing (student-ingress) |
| `e2e-cassette-faults.test.js` | Tests E2E_CASSETTE_FAULTS: scripted vendor replies or throws for matching requests, N times, instead of cassette or live |
| `feature-intro-count.test.js` | Tests FeatureIntro.introShownCount and markVideoShown's incrementIntroCount path against a mocked supabase chain |
| `handoff-class-binding.test.js` | Tests the lesson/coaching quiz hand-out (sendHandoff) asks one class question: known binds, ambiguous asks after sending |
| `language-ask-examples.test.js` | Quiz language ask names English terms taken from the lesson itself, not hardcoded fraction/numerator examples |
| `lesson-label-gloss-subphrase.test.js` | bd-1r3k2h: lessonLabel drops a bracketed gloss that only repeats part of the lesson name; keeps real translations |
| `lp-app-opens-served-and-listed.test.js` | App-opened lesson plan: the version resolved equals the one the app served (A/B group, ch3-8 scope), plus listing rules |
| `lp-quiz-app-open-counts.test.js` | bd-qvevax.3: a lesson plan opened in the teacher app counts as taken for the 15:00 cohort and every LP quiz door |
| `lp-quiz-author.test.js` | R8 lane D: author pass for an lp_v8 quiz with no transcript reads the planned lesson, never invents classroom talk |
| `lp-quiz-cache.test.js` | LP quiz cache: same lesson version reuses a donor quiz's questions with no digest/author/checks; no teacher data leaks |
| `lp-quiz-cohort-source-gate.test.js` | 15:00 offer cohort skips lessons whose served version has no slide script (no_quiz_source), same check as /quiz |
| `lp-quiz-cohort.test.js` | R8 lane B 5.1: who is offered an LP-born quiz at 15:00 and for which lessons: cohort rule date, skips, classes |
| `lp-quiz-digest-manipulatives.test.js` | lp_v8 digest parses slide-script manipulatives (counter/bundle/tile token rows) so the quiz can ask about what was drawn |
| `lp-quiz-digest.test.js` | R8 lane D 3.2b: digest of a planned lesson from its slide script; never carries the lesson's own exit MCQ |
| `lp-quiz-downstream-parity.test.js` | An lp_v8 quiz gets everything a transcript quiz gets after authoring: hand-off PDF and link, share code, report, nudges |
| `lp-quiz-failure-reasons.test.js` | Why an lp_v8 quiz failed, said truthfully: model_failed vs source_unusable and others, to the teacher and in the row |
| `lp-quiz-g1-urdu-repair-order.test.js` | Grade 1 numbers 0-4 Urdu quiz that failed validator_failed on sandbox: pins the generate/repair loop and repair order |
| `lp-quiz-generate-store.test.js` | R8 lane D 3.2: generate() against the real slide-script store; only supabase mocked; served version reaches the digest |
| `lp-quiz-generate-v9-source.test.js` | Quiz source is the served version: v8 slide script or v9 lesson HTML; a missing source fails with a stated reason |
| `lp-quiz-generate.test.js` | R8 lane D 3.2: process() for an lp_v8 quiz with no coaching session digests the served script; teacher from teacher_id |
| `lp-quiz-handoff.test.js` | R8 lane D 3.3: resend-link on an lp_v8 quiz with no coaching session still states the lesson date via lessonSessionFor |
| `lp-quiz-key-check.test.js` | An LP-born quiz never keys the lesson's own planted misconception as correct: key-check rewrites or drops such items |
| `lp-quiz-language-ask.test.js` | LP-born quiz asks which language to write in, same ask and buttons as the recording quiz; queues only after the answer |
| `lp-quiz-offer-answer.test.js` | R8 lane B 5.3: a tap on the 15:00 offer makes exactly one lp_v8 quiz however many taps or replicas; conditional claim |
| `lp-quiz-offer-film-numerals.test.js` | 15:00 LP quiz offer: per-language intro film as video header when configured, and numerals; unchanged when none set |
| `lp-quiz-offer-lesson-name.test.js` | The 15:00 offer names the lesson as its own PDF does (clean catalog topic, not the run-on topic_short) |
| `lp-quiz-offer-quiet-hours.test.js` | The 15:00 quiz offer never goes out at night: an offer claimed in the quiet window is skipped; at 15:00 it goes |
| `lp-quiz-offer-send.test.js` | R8 lane B 5.2: what the teacher gets at 15:00 and the re-checks that stop it; PLANNED wording; nudge-id button ids |
| `lp-quiz-offer-two-classes-one-message.test.js` | 15:00 offer for two classes while the intro film shows is ONE three-button message; falls back to the list if it fails |
| `lp-quiz-offer-window-template.test.js` | Afternoon offer for a closed 24-hour window via UTILITY template teacher_quiz_reminder_v1 (en, ur); drafts and sender |
| `lp-quiz-pdf.test.js` | R8 lane D 3.6: teacher PDF of an lp_v8 quiz names the lesson PLAN, not 'What you taught' or a lesson recording |
| `lp-quiz-planned-not-taught.test.js` | An LP-born quiz says PLANNED never TAUGHT in the PDF caption and other strings (PLAN_R8 §2.3); transcript quiz unchanged |
| `lp-quiz-religious-hold.test.js` | Islamiyat is held out of machine-written LP quizzes until religious review clears; every door driven through its chain |
| `lp-quiz-router.test.js` | Executes lpquiz_ button and list ids through the real webhook so each reaches its handler (route contract, PLAN_R8 §2.3) |
| `lp-quiz-slo-codes-generate.test.js` | bd-v0toag.9: generate stamps quizzes.meta.slo_codes from the slide script only when quiz_slo_retest_enabled is on |
| `lp-quiz-start-failure.test.js` | A lesson-plan quiz that could not be started: what the teacher is told by case and whether /quiz can make it again |
| `lp-quiz-strings.test.js` | R8 lane D 3.6: failure copy of an LP-born quiz says three different things, not one shared recording-based fallback |
| `lp-quiz-topic-label.test.js` | An LP-born quiz's topic label is the lesson's catalog name, not a clipped sentence or the model's wording |
| `lp-shelf.test.js` | Tests lp-shelf.service: FIFO cap, sliding TTL, delivery-type discriminator (segment vs chapter) and flush, Redis mocked |
| `lp-v9-html-source.test.js` | lp-v9-html-source turns a v9 lesson's HTML into slide-script shape; no answers or exit ticket reach the author |
| `lp612-provider.test.js` | /quiz provider for Grades 6-12 lesson plans a teacher received: listed as From lesson plan, made only on tap (lp612) |
| `lp612-quiz-generate.test.js` | Generate a quiz for a served Grades 6-12 lesson (lp612) by its version triple; gates-v2 board diagram specs |
| `lp612-quiz-menu.test.js` | /quiz menu through the real list service and provider registry: lists 6-12 lessons, makes nothing until one is tapped |
| `lp612-quiz-source.test.js` | toSlideScript: reads a stored Grades 6-12 lesson document (R2 lp612/.../*.lp.json) as the slide script the LP quiz reads |
| `multi-question-card.test.js` | renderQuestionCardHtml answerMode multi: select-all-that-apply card with checkbox group; default output byte-identical |
| `multi-teacher-docs.test.js` | Multi-answer questions (correct_option 'A,C', answer_mode multi): teacher PDF and consumers mark every correct option |
| `nudge-quiet-hours-env.test.js` | Teacher-send quiet window is env-configurable; unset keeps 21:00-07:00 PKT; one nudgeTargetUtc rule defers to morning |
| `pictogram-school-bag.test.js` | The school-bag pictogram must read as a school bag: line-art backpack variant keeps the glyph contract and 72-unit grid |
| `pictograms-lesson-objects.test.js` | Pictogram set covers objects the Grade 1-5 maths lessons count (six new objects), each a name the author is shown |
| `quiz-adaptive.test.js` | Tests the pure adaptive-difficulty engine computeNextDifficulty over a 3-answer window (quiz-adaptive) |
| `quiz-attempts-kept.test.js` | bd-v0toag.10: every quiz attempt is kept; scans bot source to prove no code deletes or upserts a quiz_sessions row |
| `quiz-author-gates-answer-leak.test.js` | Answer leaks between questions behind quiz_author_gates_v2: the detector names the later question over earlier text |
| `quiz-author-gates-blind-figure.test.js` | Gates: the blind solve sees what the child sees; a word_blank picture with no pictogram is flagged ambiguous (S_Y case) |
| `quiz-author-gates-child-reasons.test.js` | Gates v2: explanations and wrong-option feedback must be child-followable: sentence and word caps banded by grade |
| `quiz-author-gates-cross-item-leaks.test.js` | Gates v2: cross-item answer leaks the first leak check missed (wrong-option and earlier-question leaks), detector tests |
| `quiz-author-gates-equal-options.test.js` | Gates v2: two options of the same value (4/8 beside 1/2) are two right answers; named as a duplicate-option complaint |
| `quiz-author-gates-fail-soft.test.js` | Gates v2 fail soft: a long grade 1-2 stem is never cut and a soft fault never leaves a teacher with no quiz |
| `quiz-author-gates-figures.test.js` | Gates v2 figure rules: indistinguishable pictures refused, picture options named by drawn label, flag from app_settings |
| `quiz-author-gates-leak-moments.test.js` | Gates v2: a leak rewrite is shown unused lesson lines to quote, so it can rewrite the answer-leaking question |
| `quiz-author-gates-load.test.js` | Pins that quiz-author-gates loads with no database config so offline callers (KaTeX suite, evals) can use the validator |
| `quiz-author-gates-meta-stem.test.js` | Gates v2: stems asking about the lesson itself, not its content (meta stems), are named for in-place rewrite |
| `quiz-author-gates-named-pronouns.test.js` | Gates v2: a named character keeps their pronoun in the lesson text the author reads, while teacher prose stays neutral |
| `quiz-author-gates-picture-phrasings.test.js` | Gates v2: a stem pointing at a diagram it does not carry is PICTURE_MISSING across all phrasings |
| `quiz-author-gates-top-up.test.js` | Gates v2 top-up: a quiz that would ship under seven questions gets one refill call quoting an unused lesson line |
| `quiz-author-gates-translit-soft.test.js` | Gates v2: a transliterated term names its question and is never a reason to send no quiz (soft complaint) |
| `quiz-author-gates-v2.test.js` | Quiz author gates v2 through the real validator: faults a pedagogy review found become q-named complaints for rewrite |
| `quiz-bare-text-routing.test.js` | A teacher typing 'quiz' in any spelling lands on the /quiz menu, not general AI chat; decision logged with ids only |
| `quiz-daily-cap.test.js` | Runaway guard: at most QUIZ_DAILY_CAP quizzes per teacher per PKT day, counted before any model call, in Redis |
| `quiz-flow-endpoint.test.js` | Smoke test that quiz-flow-endpoint actually loads with infra mocked and is wired into flow-configs as /api/flows/quiz |
| `quiz-funnel-children.test.js` | Quiz funnel, children's side: child_joined to report_sent events carry the quiz stream; report_sent_at stamping finding |
| `quiz-funnel-generate.test.js` | Quiz funnel generate to hand-off: generation_started, generated, generation_failed, sent, send_failed plus row trace |
| `quiz-funnel-offers.test.js` | Quiz funnel teacher side: offer_made, offer_answered, accepted for every channel (coaching, 15:00, /quiz, make again) |
| `quiz-funnel-watch.test.js` | Quiz funnel watcher: one stream to the operator, no spam; per-stream funnel from quiz_funnel rows, 2-hourly summary |
| `quiz-funnel-worker-wiring.test.js` | Pins that the worker runs the quiz funnel watcher on its timer, never throws, and the hourly digest is gone |
| `quiz-funnel.test.js` | Tests the one quiz_funnel.<stage> event shape written through one helper for both quiz streams |
| `quiz-generation.test.js` | Tests quiz-generation.service: question validation, option shuffling, generate-then-store path (openai, supabase mocked) |
| `quiz-helped-by-finish.test.js` | bd-v0toag.10 (c): finish() asks who helped after the scorecard with the quiz stream; teacher's own test run not asked |
| `quiz-helped-by.test.js` | bd-v0toag.10 (c): who-helped one tap (no one/classmate/teacher/family, en/ur) stored on quiz_sessions.helped_by |
| `quiz-intent-detector.test.js` | Tests the quiz-intent detector's deterministic regex priors: head-noun and header-style matches, negatives |
| `quiz-job-handler.test.js` | Tests SQS-side quiz job handlers: cancel flag, idempotency, cascade re-queue dedup and firing (deps mocked) |
| `quiz-lesson-providers.test.js` | /quiz lists K-5 lesson plans a teacher took and makes a quiz only on tap, once per lesson whichever door asked |
| `quiz-math-equation-runs.test.js` | An equation written outside maths dollars reads as one expression in order on every surface, incl. an Urdu isolate |
| `quiz-math-stacked-fractions.test.js` | A flat fraction $2/3$ is typeset stacked on the child's card and teacher PDF via stackFractions |
| `quiz-menu-flow-lessons.test.js` | The /quiz Flow lists lesson plans with no quiz yet, labelled in metadata; quiz made only on Make it in ... |
| `quiz-multi-flow-json.test.js` | Structural test of quiz-multi-select-flow.json: static Flow, one terminal PICK screen, per-send navigate data |
| `quiz-queue-uses-driver.test.js` | Pins that every quiz job goes through the queue driver (QUEUE_DRIVER=bullmq or sqs), never the SQS singleton by name |
| `quiz-report-template.test.js` | Tests the quiz-report HTML template: full doc, embedded Lexend and Nastaliq fonts, escaping, no leaks |
| `quiz-retest-schedule.test.js` | bd-v0toag.10 (b): day-3 retest sweep runs on main-queue replicas only: boot run at 2 min then hourly; throws swallowed |
| `quiz-retest-sweep.test.js` | bd-v0toag.10 (b): day-3 retest sweep makes a new quiz on the same SLOs via quiz_generate, behind quiz_slo_retest_enabled |
| `quiz-row-no-quiz-wording.test.js` | One phrase in /quiz for no quiz made yet: the Flow and list message say the same words for plans and recordings |
| `quiz-scheduler.test.js` | Tests quiz-scheduler.service school-hours window (8am-4pm PKT weekdays) and next-school-hour selection |
| `quiz-session.test.js` | Tests quiz-session.service: Redis state read, DB recovery on a miss, session-end transitions, post-quiz chat lifecycle |
| `quiz-slo-code.test.js` | bd-v0toag.9: curriculum SLO code from the slide script shown on a question in place of S1/S2; never invented |
| `quiz-slo-stamp.test.js` | bd-v0toag.9: stamping a quiz's meta with slo_codes; off by default, a missing code is logged and the old label stays |
| `quiz-source-fidelity-generate.test.js` | Source fidelity at generation (quiz_author_gates_v2): source_quote per question; unsupported ones re-authored or dropped |
| `quiz-source-fidelity-reason.test.js` | Source fidelity: an invented reason (answer to a why question the lesson never gives) is refused (chameleon item) |
| `quiz-source-fidelity.test.js` | Pure source-fidelity gates (transcript-quiz-source-fidelity): quote must carry the key; unused-number problems refused |
| `quiz-v21-flag.test.js` | bd-v0toag.10: quiz_slo_retest_enabled gates every v21 quiz change; default off, a failed read fails closed and logs |
| `religious-marks.test.js` | bd-mg9c7.9: Islamiyat marks rule: Prophet mentions carry the honorific, no sacred names in Latin, no invented quotes |
| `reminder-stop-handler.test.js` | STOP via the real text handler for the reminder template: quiz STOP keeps priority; switch off routes as before |
| `reminder-stop.test.js` | Tests reminder-stop: STOP or روکیں to the window-closed quiz reminder template records opt-out and one confirmation |
| `report-class-labels.test.js` | Class labels a child types (4, Class 4, grade 4, Urdu or Arabic-Indic digits) are one class on the report |
| `report-class-line.test.js` | PLAN_R5 §0 item 6: the report names the class the children entered, never the digest's grade band (classesTaught) |
| `report-fallback-direction.test.js` | Class report text fallback states each line's direction so Urdu reports with Latin terms paint correctly |
| `report-guidance-address.test.js` | The Urdu class report's for-tomorrow box addresses the teacher without gender: prompt rule and gendered-verb field check |
| `report-guidance-depth.test.js` | PLAN_R5 item 12: the for-tomorrow box asks for a detailed 2-3 sentence reteach/stretch move; off-language field checks |
| `report-guidance-grade.test.js` | The for-tomorrow guidance prompt names the class's own grade (Grade 4 / Urdu form), never Grade primary |
| `report-labels-and-guidance-box.test.js` | Class report's own words: header names the class the children entered (classHeading); guidance box (PLAN_R5 §0) |
| `report-promise-truth.test.js` | The line telling a teacher when the class report comes must match what the report service does (12 h or 07:00 PKT) |
| `report-slo-code-chip.test.js` | bd-v0toag.9: the PDF report's hardest-question chip shows the SLO code before the goal when handed one; escaped |
| `report-teacher-name.test.js` | The class report is written to the teacher: with no stored name the header is the class alone, never 'your teacher' |
| `roster-gate-after-attendance-teardown.test.js` | bd-2530: the video-quiz roster gate fails closed now that attendance Flow endpoints are torn out |
| `sqs-queue-quiz.test.js` | Tests sqs-queue.service queueJob: quiz_* jobs go to the quiz queue with DelaySeconds capped at 900; others to main |
| `student-join-flow-json.test.js` | Structural test of student-join-flow-v2.json: localised one-screen WHO Flow binding titles, labels, footers to data |
| `student-mode-decide.test.js` | PLAN_R5 D8: student-mode decide(): fails towards teacher; registered teachers are always teachers, ambiguous cases too |
| `student-mode-gate.test.js` | PLAN_R5 D8: the one student-mode gate executed inside the real text handler; persona reaches the model only on free chat |
| `student-persona-prompt.test.js` | TQ-R5 lane G (bd-mg9c7.64): student tutor persona in the prompt builder; never teacher wording; teacher prompt unchanged |
| `teacher-artefact-type-floor.test.js` | PLAN_R5 D6/PLAN_R6 D4: shared TYPE_FLOOR for every teacher-facing rendered artefact and its size on a phone |
| `teacher-quiz-handoff-fewer-bubbles.test.js` | NO2: teacher quiz hand-off sends fewer bubbles: the report promise rides in the PDF caption; forwardable link alone |
| `teacher-report-v21.test.js` | bd-v0toag.10 (2a, 2d): pure attempt counts and completion from quiz_sessions rows; childKey prefers student_id |
| `transcript-quiz-add-pictures-replace.test.js` | The add-pictures repair may REPLACE a question it cannot draw: mergeAddedPictures keeps index and objective |
| `transcript-quiz-add-pictures.test.js` | Add-pictures: the one targeted rewrite allowed to add a figure; pictureCandidates chooses questions a picture helps most |
| `transcript-quiz-adjacent-terms.test.js` | Two English terms side by side in an Urdu sentence read backwards: validator names them; repair inserts an Urdu word |
| `transcript-quiz-author-avoid.test.js` | bd-v0toag.10: day-3 retest author prompt gains a do-not-reuse block only when an avoid list is given |
| `transcript-quiz-author-density.test.js` | Author prompt aims for at least three picture questions of eight for grade 1-5 maths, pictures that model the stem |
| `transcript-quiz-author-figure.test.js` | The author prompt's FIGURE contract: allowlist and minimal specs generated from the diagram engine manifest |
| `transcript-quiz-author-language-restated.test.js` | PROD 2026-09-07: the author prompt restates the quiz language on the first attempt, after the question contract |
| `transcript-quiz-author-pedagogy.test.js` | PLAN_R5 D3: author contract rebalanced so SLOs drive questions and the transcript supplies level, examples, words |
| `transcript-quiz-author-pictures-first.test.js` | A grade 1-5 maths author is told to draw on attempt 1 and to write fractions stacked (maths notation rule) |
| `transcript-quiz-author-selected-because.test.js` | PLAN_R4 D4: author emits lesson_summary and per-question selected_because; validator enforces when opted in |
| `transcript-quiz-author-short-summary.test.js` | bd-2yyry.7: pre-send sheet is one sentence taught and one on what the quiz checks, authored in the quiz language |
| `transcript-quiz-authoring-budget.test.js` | Authoring budget after the first production morning: three attempts, picture demanded on attempt 1 only |
| `transcript-quiz-card-counter-source.test.js` | The question card carries its own counter (Question N of M); one source for the number, not a second chat bubble |
| `transcript-quiz-card-letters.test.js` | Pins that the letters a question card draws equal render.optionLetter() for positions 0-3 |
| `transcript-quiz-card-number.test.js` | The counter on a question card equals the chat-chrome counter even when SLO order differs from position order |
| `transcript-quiz-card.test.js` | The question card: needsQuestionCard when notation or length defeats WhatsApp text; one image of stem, figure, options |
| `transcript-quiz-child-address-forms.test.js` | Urdu address check forms: which gendered child-address forms are flagged, which are left alone, what repair writes |
| `transcript-quiz-child-address.test.js` | An Urdu quiz never guesses the child's gender: validator names every question with a gendered verb; repair and feedback |
| `transcript-quiz-column-sum.test.js` | Column sums typeset as one expression the way a textbook prints them, readable as one line in every WhatsApp text |
| `transcript-quiz-completion.test.js` | The /quiz Flow completion is recognised by flow-type-detector and routed, not dropped to generic thanks or attendance |
| `transcript-quiz-digest-normalise.test.js` | Digest SLO statements and as-taught topic: transliterated English terms are written in English letters in PDF and report |
| `transcript-quiz-display-order.test.js` | Round-5 D1: option display order is decided at generation and stored once on the row (media.display_order) |
| `transcript-quiz-distinct-questions-rule.test.js` | The eight questions test eight different things: the three question-writing prompts carry the rule once |
| `transcript-quiz-duplicate-and-lift.test.js` | Two defects from one prod run: duplicate options kept recurring; the lift line on an all-recall lesson explains itself |
| `transcript-quiz-duplicate-questions.test.js` | A class quiz never asks the same question twice: validator names the later copy (DUPLICATE_QUESTION), rewrite fixes it |
| `transcript-quiz-duplicates-blank-and-postposition.test.js` | A fill-in-the-blank and a question on the same fact count as duplicates despite a postposition difference in the key |
| `transcript-quiz-early-years-gating.test.js` | A grade 1-5 lesson is drawable in every subject (round 5): author prompt and FIGURE_REQUIRED gate no longer maths-only |
| `transcript-quiz-failure-reasons.test.js` | Why a quiz from a coaching recording failed, said truthfully: model_failed and other distinct reasons |
| `transcript-quiz-figure-adaptive-scale.test.js` | The phone font scale is a ceiling per spec: a dense figure scales down, a sparse one keeps the ceiling, never discarded |
| `transcript-quiz-figure-bar-labels.test.js` | A fraction bar is labelled once, in the digits the stem uses (Latin), not twice in two digit sets |
| `transcript-quiz-figure-bar-parts.test.js` | A fraction bar of more than 24 parts is refused by the validator because the engine would draw only 24 |
| `transcript-quiz-figure-circle.test.js` | fraction_bar model circle: a roti/pizza drawn as n equal sectors, k shaded, via the quiz lane's vendored diagram engine |
| `transcript-quiz-figure-count-mismatch.test.js` | FIGURE_MISMATCH now covers count_objects: counters that cannot produce the answer are refused |
| `transcript-quiz-figure-counts-zero-one.test.js` | The figure engine draws a count of one and zero (empty tray) for Grade 1 numbers 0-4 lessons (vendor SYNC.md §3.23) |
| `transcript-quiz-figure-density-generate.test.js` | Picture density through generate: a grade 1-5 maths quiz with one picture gets one add-a-picture repair and ships |
| `transcript-quiz-figure-density-replace.test.js` | Fractions lesson with only method questions still ends with three pictures: add-pictures REPLACES unanswerable questions |
| `transcript-quiz-figure-density.test.js` | Grade 1-5 maths picture density: figure_role model lets a picture restate the stem's numbers without FIGURE_REDUNDANT |
| `transcript-quiz-figure-dropped-text.test.js` | The engine silently drops unrecognised text (flow steps written as label not title): FIGURE_EMPTY names the key to fix |
| `transcript-quiz-figure-early-years.test.js` | Round-5 early-years figure types (counting, phonics): on the allowlist, manifest entries render, prompt names them all |
| `transcript-quiz-figure-equal-value.test.js` | A picture of 2 shaded parts in 8 offered as 2/8 and 1/4 is refused: both read the picture right (equal-value options) |
| `transcript-quiz-figure-eval6.test.js` | Round-6 author eval findings on early-years lessons: pictogram set covers phonics words; unknown names fail loudly |
| `transcript-quiz-figure-frame.test.js` | A figure question carries the same quiz chrome (counter, NIETE mark, RTL band) on its 1080x565 canvas |
| `transcript-quiz-figure-gate-wiring.test.js` | Wires the three LP lint gates into the quiz validator: FIGURE_LABEL_SMALL under the phone floor (PLAN_R4 D7c) |
| `transcript-quiz-figure-gates.test.js` | The three LP lint gates ported to the quiz canvas: label-floor gate derives scale from min(boxW/vbW, boxH/vbH) |
| `transcript-quiz-figure-generate.test.js` | Picture questions through generate: render, upload, row; no row points at a never-uploaded image; no double render |
| `transcript-quiz-figure-improper-bars.test.js` | An improper fraction is drawn as whole bars plus a part bar, never one bar with more shaded than parts |
| `transcript-quiz-figure-labels.test.js` | A figure label may only be a value or a word from the question; stripStrayLabels removes stray shape names |
| `transcript-quiz-figure-language-labels.test.js` | The diagram engine's own words follow the quiz language: Urdu figure gets an Urdu caption, symbols stay Latin |
| `transcript-quiz-figure-manipulatives.test.js` | Manipulatives for grade 1-5 maths (counter, tile, bundles, flats): pictogram set gains counter and tile; shown to author |
| `transcript-quiz-figure-match-and-names.test.js` | Part-names residue: a match picture never draws option letters; handles move to P/Q across stem, options, feedback |
| `transcript-quiz-figure-part-labels.test.js` | A figure never names parts with option letters; bars A,B,C become P,Q,R everywhere; labels big enough on a phone |
| `transcript-quiz-figure-phone-scale.test.js` | bd-mg9c7.52 (PLAN_R4 D7): withFontScale scales figure label sizes for phone rendering and restores SIZE even on throw |
| `transcript-quiz-figure-science-wiring.test.js` | Wires the science gate into the quiz validator (PLAN_R4 D7e/f): an unbalanced equation is rejected as FIGURE_CHEM |
| `transcript-quiz-figure-science.test.js` | Science accuracy checks for quiz figures: chemBalanceDefect, off-table elements, cell labels, against the live renderer |
| `transcript-quiz-figure-smoke.test.js` | Smoke test: every allowlisted figure type of the vendored diagram engine renders clean, in English and Urdu |
| `transcript-quiz-figure-validator.test.js` | The validator's FIGURE checks: five distinct error strings (type, render, overlap, leak...) quoted back to the model |
| `transcript-quiz-figure-visible-subset.test.js` | A counters picture can show a part of a set only if that part looks different (identical pencils refused for 2 of 5) |
| `transcript-quiz-figure.test.js` | The figure module: type allowlist (24 phone-safe types), render and overlap gate, answer-leak rule, alias resolution |
| `transcript-quiz-flow-attempt-rule.test.js` | The /quiz Flow lesson screen counts each child's attempt by the same rule as the class report: web keeps first finish |
| `transcript-quiz-flow-dispatch.test.js` | R6 lane M: /quiz opens the Flow when TRANSCRIPT_QUIZ_FLOW_ID is set, else the list message; run through the real handler |
| `transcript-quiz-flow-json.test.js` | Structural test of docs/flows/transcript-quiz-flow.json: LESSONS, LESSON, DONE screens, NavigationList limits, paging |
| `transcript-quiz-gendered-generate.test.js` | A gendered lesson summary is repaired, not shipped: PEDAGOGY_GENDERED_TEACHER end to end through generate (PLAN_R6 D5) |
| `transcript-quiz-gendered-teacher.test.js` | PEDAGOGY_GENDERED_TEACHER: the teacher has no gender anywhere in a quiz; prompts and validator across all fields |
| `transcript-quiz-generate.test.js` | bd-mg9c7.11: the generate step: author, validate, store, PDF, link, paced teacher messages; idempotent per step |
| `transcript-quiz-handoff.test.js` | bd-mg9c7.63 (lane F): sendHandoff is the same inline or via /quiz resend; the share code is minted at most once |
| `transcript-quiz-intro-video.test.js` | The quiz offer intro film rides the first N offers chosen by teacher language, gated by a showing count (D7) |
| `transcript-quiz-key-truth.test.js` | A key is right by the subject, not by class talk: KEY_BY_AUTHORITY fault (Proper Fraction 4/8) named per question |
| `transcript-quiz-key-verify-model.test.js` | The blind solve runs on its own model (quiz.keyVerify, TRANSCRIPT_QUIZ_VERIFY_MODEL) billed and failed over separately |
| `transcript-quiz-key-verify.test.js` | A quiz never ships a key a blind solver disagrees with: disagreeing items are re-authored from the solver's answer |
| `transcript-quiz-language-ask.test.js` | The teacher chooses the quiz language: yes or a /quiz pick asks first and generation waits for the answer |
| `transcript-quiz-language.test.js` | bd-mg9c7: quiz language decided by subject in code (quizLanguageFor), canonicalSubject and teacherLanguageFor copy |
| `transcript-quiz-late-soft-repair.test.js` | A question written after the last repair pass gets its own repair (staging quiz bd00a132: picture step replaced q5, q7) |
| `transcript-quiz-latin-name-repair.test.js` | URDU_NAME_LATIN: a person's name in English letters inside an Urdu quiz is repaired in place by one targeted rewrite |
| `transcript-quiz-latin-names.test.js` | A person's name in an Urdu quiz is in Urdu script; latinNames light check records it when it is not |
| `transcript-quiz-lesson-people.test.js` | Lesson people and their Urdu-script names recorded once in the digest, so the Latin-name repair always has a spelling |
| `transcript-quiz-list-actions.test.js` | bd-mg9c7.63 (TQ-R5 lane F): tapping a SENT lesson offers Resend, Regenerate report, back; body names lesson and date |
| `transcript-quiz-list-self-test.test.js` | PLAN_R5 §1 D8: /quiz started/finished counts exclude the teacher's own test run (user_id != teacher NULL trap) |
| `transcript-quiz-list.test.js` | bd-mg9c7.17: /quiz lists recent lessons with quiz state; a tap makes a quiz, resends the link or fetches the report |
| `transcript-quiz-llm-anthropic-direct.test.js` | The quiz's Claude calls (blind solve, summary truth check) go to the prepaid Anthropic key with OpenRouter fallback |
| `transcript-quiz-llm-retry.test.js` | bd-mg9c7.159.17: completeJson retries one malformed or empty model reply once so a teacher's quiz does not fail |
| `transcript-quiz-llm-tex-escapes.test.js` | bd-mg9c7.159.19: a quiz reply carrying single-escaped TeX (\frac, \times) keeps its backslashes, not a form feed |
| `transcript-quiz-log-names.test.js` | Data standard D4: no person's name in logs; complaint strings and figure_label_stripped log reason and key only |
| `transcript-quiz-muhammad-is-a-name.test.js` | Muhammad in a person's name (Quaid-e-Azam) is not a Prophet mention; PROPHET_TOKENS no longer demands the honorific |
| `transcript-quiz-multi.test.js` | PLAN_R5 D4: a question with more than one right answer: set answers, validator, card, generate, Flow pick |
| `transcript-quiz-nudge-cadence.test.js` | Quiz nudge cadence: once after six hours, quiet hours defer to morning, never dropped (operator, 2026-09-07) |
| `transcript-quiz-nudge-copy.test.js` | What the quiz nudge says: titles stay whole, joined with the language's own comma, isolated and bold; the count |
| `transcript-quiz-nudge-inflight-quiet.test.js` | Quiet-hours rule applies to in-flight nudges queued under the old schedule: late-night arrivals wait for morning |
| `transcript-quiz-nudge-one-a-day.test.js` | The 'only N children have started' nudge reaches a teacher at most once a day, counted on the nudge day |
| `transcript-quiz-nudge-self-test.test.js` | PLAN_R5 §1 D8: the nudge started count excludes the teacher's own test run so NUDGE_BELOW still fires |
| `transcript-quiz-nudge-story-send.test.js` | A storybook send (quiz_source story) is not a quiet lesson: the morning nudge never names or stamps it |
| `transcript-quiz-offer-users-columns.test.js` | The offer's session read joins only users columns the schema still has, so a dropped column cannot fail finished lessons |
| `transcript-quiz-offer.test.js` | bd-mg9c7.7: the offer: one quizzes row per coaching session, one ask at a time, flag-gated; yes/no flip state once |
| `transcript-quiz-part-names-prompt.test.js` | Prompts stop naming parts A, B, C (the card's option letters) and ask for people's names in the quiz language |
| `transcript-quiz-pedagogy-wiring.test.js` | Pedagogy rules run on the real path: validate() rejects, the retry gets the complaint, last pedagogy-only failure drops |
| `transcript-quiz-pedagogy.test.js` | PEDAGOGY rules (PLAN_R5 D3): COUNT_RECALL, teacher-as-subject stems, questions only the present child could answer |
| `transcript-quiz-pupils.test.js` | The children in the room are never the quiz's subject: PEDAGOGY_PUPIL_AS_SUBJECT is a hard fault, quotes no name |
| `transcript-quiz-r4-live-fixes-2.test.js` | Second round-4 live run: Urdu quiz keeps selected_because and misconceptions in Urdu; an English one is rejected |
| `transcript-quiz-r4-live-fixes.test.js` | Round-4 live fixes: SLO statements carry both scripts (statement_en, statement_ur) and the document picks its own |
| `transcript-quiz-religious-recoverable.test.js` | bd-mg9c7.95: an Islamiyat lesson could yield no quiz; patronymic companion names keep honorifics and are recoverable |
| `transcript-quiz-report-refetch.test.js` | bd-mg9c7.63: Regenerate report refetches the class so a child who finished after report_sent_at is included |
| `transcript-quiz-resolve-grade.test.js` | A grade hint is a hint: resolveGrade lets the digest's grade band beat a lesson-plan download hint outside the band |
| `transcript-quiz-rewrite-overflow.test.js` | More faulted questions than one targeted rewrite takes (five): overflow repaired in further rounds, quiz still ships |
| `transcript-quiz-rewrite.test.js` | A quiz never ships short: targeted rewrite of faulted questions before the salvage drops any (rewriteTargets) |
| `transcript-quiz-router.test.js` | Executes the tq_lang_ router branch through the real webhook: language button reaches handleLanguageButton |
| `transcript-quiz-rows.test.js` | bd-mg9c7.63 (TQ-R5 lane F): /quiz row layout: topic in the description, cut on a word boundary (transcript-quiz-rows) |
| `transcript-quiz-same-fact.test.js` | The blind solver names questions that ask the same fact in other words; same-fact duplicates are repaired |
| `transcript-quiz-sender.test.js` | bd-mg9c7.15: every child-facing quiz send is throttled per recipient; picker chrome follows quiz language |
| `transcript-quiz-share-code-precedence.test.js` | bd-mg9c7.97: a QUIZ-<code> text reaches the share-code join even when a stale quiz state is set on the handset |
| `transcript-quiz-ship-what-we-can.test.js` | A quiz is never lost for a fault in ONE question when the rest is good: the floor decides, offending questions dropped |
| `transcript-quiz-stem-length-repair.test.js` | PROD 2026-09-07: an over-long stem is one question to repair like an over-long option, not a lost quiz |
| `transcript-quiz-strings.test.js` | bd-mg9c7.12: every transcript-quiz string exists in both languages, fits its WhatsApp field in code points, not gendered |
| `transcript-quiz-summary-truth.test.js` | The teacher's sheet never presents a mistake made in class as what was taught: summary-truth check through generate |
| `transcript-quiz-tall-figure-card.test.js` | Tall square-ish figures (atom, cell, circuit...) go through the question card so labels stay legible on a 360 dp phone |
| `transcript-quiz-teacher-figure-fonts.test.js` | The teacher quiz PDF can draw Urdu inside a figure: font stack for the diagram engine's foreignObject text boxes |
| `transcript-quiz-teacher-language.test.js` | One language decides everything the teacher reads: the stored language, never the transcript's (teacherLanguageFor) |
| `transcript-quiz-teacher-multi-marks.test.js` | bd-mg9c7.77: the pre-send teacher PDF marks every correct option on select-all questions; misses skip all of them |
| `transcript-quiz-teacher-nograde.test.js` | Operator round-5 item 6: the pre-send teacher PDF drops the grade band from the hero meta line (name and date only) |
| `transcript-quiz-teacher-template.test.js` | The teacher's pre-send PDF: embedded Nastaliq, RTL for Urdu, isolated Latin runs, one card per question (bd-mg9c7.10) |
| `transcript-quiz-topic-follows-language.test.js` | The topic label follows the language the teacher chose: choosing English or Urdu rewrites the row topic accordingly |
| `transcript-quiz-typeset-maths.test.js` | Maths in a class quiz is typeset on cards via KaTeX and never reaches a phone as TeX source (bd-mg9c7.159.19 part A) |
| `transcript-quiz-unanswerable-group.test.js` | Which group has more? is early-years maths, not unanswerable: groups of objects pass, groups of children do not |
| `transcript-quiz-urdu-fields-technical-terms.test.js` | Prod 2026-09-07 quiz 1920ae53: Urdu fields dense in English technical terms are still Urdu; URDU_TEACHER_FIELDS accepts |
| `transcript-quiz-urdu-script-share.test.js` | The quiz-level Urdu check counts words not letters, so a correct Urdu maths quiz dense in English terms is accepted |
| `transcript-quiz-validator.test.js` | bd-mg9c7.9: the deterministic validator that runs before rows are stored: structure, counts, options, language (pure) |
| `transcript-quiz-wiring.test.js` | bd-mg9c7: edits to existing files run on their live branch: report-generator offers a quiz; offer failure never fails it |
| `transcript-quiz-word-blank.test.js` | A word_blank never costs the child the question: the blank is inferred from the stem when the spec names none |
| `video-quiz-join-lock-env.test.js` | VIDEO_QUIZ_JOIN_LOCK_SECS shortens the one-join-per-minute class-link lock for test lanes; unset stays 60 s |
| `video-quiz-report-dual-language.test.js` | bd-mg9c7.27: class report reads in the teacher's language and quotes questions in the quiz's language (dual language) |
| `video-quiz-typed-letter.test.js` | A typed letter answers the quiz the child is taking, and no other quiz takes over the handset; free verdict reactions |
| `web-quiz-config-bot-boot.test.js` | Pins that the bot logs web_quiz.config once at startServer, with resolved names, before the port is bound |
| `web-quiz-forward-message.test.js` | The forwarded message says what the child is asked first: web link asks only the name; wa.me link keeps the old text |
| `web-quiz-items-generate.test.js` | SCHEMA_v2 web items at generation: media.web stored only on the web arm with web_quiz_items_v2 on; else unchanged |
| `web-quiz-link.test.js` | quizLink helper: web page link only when web_quiz_enabled and the teacher is allowed; records the choice via the worker |
| `web-quiz-render-matrix.test.js` | Web quiz render matrix (no-browser half): every item shape rendered through the shipped page in a vm; TeX stray check |
| `web-quiz-soniox-live.test.js` | Soniox temporary-key mint: default 90 s single-use body unchanged; live moves pass a longer sessionSeconds |
| `webhook-ack.test.js` | Every Meta webhook must be answered: the join-Flow reply and picture-Flow answer get an HTTP ack, never left hanging |
| `webhook-drain-inflight.test.js` | The real /webhook route registers its work with the deploy drain and keeps it until the handler finishes, not at the ack |
| `webhook-quiz-tap-message-id.test.js` | Pins that every video-quiz answer door and transcript-quiz offer button passes the tap's wamid to the handler |
| `whatsapp-media-cache.test.js` | WhatsApp media-id cache on sendImageWithButtons: download and upload once, send by media id, remember the id for 25 days |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/services/monitoring/CLAUDE.md`? · `bot/shared/services/nudges/CLAUDE.md`? · `bot/shared/services/queue/CLAUDE.md`? · `bot/shared/services/quiz/providers/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `bot/vendor/lp-v9/diagrams/CLAUDE.md`? · `bot/vendor/lp-v9/diagrams/lib/CLAUDE.md`? · `bot/vendor/lp-v9/diagrams/types/CLAUDE.md`? · `bot/workers/CLAUDE.md`? · `docs/student-mode.md`? · `infrastructure/templates/drafts/README.md`? · `scripts/qa/render-matrix/CLAUDE.md`? · `tests/CLAUDE.md`?
