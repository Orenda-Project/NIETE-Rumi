@whatsapp @ict @profile:niete @feature:training @persona:teacher
Feature: NIETE (ICT) Teacher Training
  # What a TEACHER actually does in Teacher Training on WhatsApp. ICT region only, driven
  # from a linked WhatsApp Web session via Chrome MCP against the NIETE bot.
  #
  # STRUCTURE (2026-08-05): the happy path is ONE complete end-to-end flow scenario
  # (open → programme → level → module → quiz → pass → next unlocks) with every screen
  # asserted inline as a step — NOT split into a separate scenario per assertion. Only
  # genuinely-separate branches (different inputs, negative outcomes, other content types /
  # vendors / states) are their own scenarios. Internal-robustness checks that aren't a user
  # flow (concurrency/races, crafted-payload security, data-shape lints, fault injection,
  # format guards) live in unit/integration tests, not here.
  #
  # Teacher Training runs inside a native WhatsApp Flow. The click/snapshot mechanics live
  # in ../../../.claude/qa/shared/whatsapp-interaction-map.md — steps stay in plain language.
  #
  # Tags: @flow (native Flow) · @quiz · @copy (exact wording) · @content-driven (answers
  # resolved LIVE) · @edge · @negative · @destructive (changes real progress) · @config-gated
  # · @wip @draft (code-grounded, not yet driven live). @P1/@P2/@P3 = priority.
  #
  # ─────────────────────── Handling non-determinism (READ FIRST) ───────────────────────
  # The quiz output is NON-DETERMINISTIC by design, so steps assert CONTRACTS, never fixed
  # content. Confirmed live 2026-08-05: retakes/other modules serve DIFFERENT questions and
  # the correct answer moves letters. What varies: which questions, how many, order, the
  # correct option's letter, the grand-quiz served set, progress counts, the "▶ Next up"
  # module, the certificate code.
  #  1. NEVER assert a fixed question/option-letter/exact-count/module-or-cert name. Assert
  #     the SHAPE/TEMPLATE ("<done>/<total> modules · <pct>%", "<n> questions … 100%").
  #  2. @content-driven "answer correctly" is resolved LIVE: read each question + options and
  #     pick the option whose TEXT matches the answer key (answer-keys.yaml training_quiz,
  #     substring) — never by position. A forced-wrong picks any option NOT matching the key.
  #  3. Identify levels/modules by ROLE/STATE ("in-progress level", "▶ Next-up module"), not
  #     by name; compare transitions against the OBSERVED pre-state.
  #  4. @copy pins exact wording of FIXED strings only (headings, buttons, templated lines).

  # ═════════════════════════════ POSITIVE — the complete flow ═════════════════════════════

  @e2e @flow @quiz @content-driven @P1 @T01
  Scenario: A teacher works through Teacher Training end to end — open, take a module check, pass, unlock the next
    Given the NIETE bot chat is open
    When I send "/training"
    Then the bot replies with the "Teacher Training" heading, the body "View your training progress and start your next level.", and an "Open" button
    When I tap "Open" (real MCP click — the native Flow won't open on a synthetic click)
    Then the Flow opens on "Choose a program" headed with my number and school, listing my enrolled programme in the shape "<name> · <levels> levels · <pct>% · <done>/<total> courses", with an "Open program" button
    When I open the "NIETE" programme
    Then the in-progress level is shown as "<done>/<total> courses · <pct>% done" and the later levels are 🔒 locked in order, each reading "Unlocks after Level <n> exam"
    When I open the in-progress level
    Then the level detail shows my module progress in the shape "<done>/<total> modules done · <pct>%"
    And the "Pick a module to watch" picker lists modules tagged "✓ Passed" / "▶ Next up" / "🔒 Locked", with exactly one "▶ Next up"
    And the grand quiz reads "🔒 Grand Quiz — Unlocks when all courses are complete." with a "🔒 Locked" button, and its exam caption states the real served size in the shape "<n> questions · <p>% required · 24h cooldown on fail" (not the whole bank)
    When I pick the "▶ Next up" module
    Then the Flow closes and the bot posts ONE module video card: "Watch the video, then tap 📝 Take quiz — passing it unlocks the next module.", the video link, then "Finished watching \"<module>\"?" — with "📝 Take quiz" and "⏸ Pause" buttons on that same message
    When I tap "📝 Take quiz"
    Then the bot serves Q1 as ONE message headed "Module check · Q1/<n>", opening with "Module check — \"<module>\"" and "<n> questions. You need 100% to unlock the next module — if you miss it you can retry straight away.", with an "Answer" button and the caption "100% required · tap an option"
    When I answer every served question with its correct option, resolved live (match the option TEXT to the answer key, never a fixed letter)
    Then each answer gets a ✅ reaction, and every question after Q1 is headed with the verdict on the one before it, in the shape "✅ Correct · Q<k>/<n>" (a wrong answer: "✗ Not correct · Q<k>/<n>") — no separate verdict message
    And the next module's card arrives as ONE message opening with "✅ *Correct*", then "Module check — passed" with a perfect score in the shape "<n>/<n> correct", then the next module's card and its "📝 Take quiz" / "⏸ Pause" buttons — and no "Loading the next module…" message
    And the module that was "▶ Next up" becomes "✓ Passed" and the following module becomes the new "▶ Next up"
    # UPDATED 2026-10-01 (bd-w2daa.8, fewer billed bubbles): module card + buttons, intro + Q1, verdict + next
    # question, and "passed" + next module card are each ONE message now; "Loading the next module…" is gone.
    # Same words, same order. Over a WhatsApp cap, each falls back to the old separate messages.
    # NIETE needs 100%. Verified live on PROD (2026-08-05) end-to-end (Auditory aids & Differentiated
    # reading materials driven 3/3 → next-up advanced); re-verified entry+Flow+ladder+level-detail on the
    # shared staging number 923222482222. Exam caption observed "20 questions" (prod) / "62 questions"
    # (staging 923222482222) for the same account — see the config-discrepancy note in _suite.md.

  @e2e @flow @copy @P1 @T02
  Scenario Outline: Teacher Training opens from any of its entry points
    Given the NIETE bot chat is open
    When I open training via "<entry>"
    Then the bot replies with the "Teacher Training" heading and an "Open" button
    Examples:
      | entry                            |
      | /training                        |
      | the /menu "Teacher Training" row |
      | /trainings                       |
      | show me training                |
      | open training                   |
      | training                         |
    # @copy. All six converge on the same card (menu row = same entry as the command). "training"
    # (no slash) DOES open it — unlike "menu". Verified live on PROD (2026-08-05).

  @e2e @certificates @copy @P2 @T03
  Scenario: A teacher with no certificates yet is pointed back to training
    Given the NIETE bot chat is open
    When I send "/certificates"
    Then the bot replies "You don't have any NIETE certifications yet." and tells me to complete a level and pass the grand quiz, and to type "/training"
    # @copy. Verified live on PROD & staging (2026-08-05).

  # ── other positive branches (separate because they need a different content type / state / vendor) ──

  @e2e @wip @draft @flow @P3 @T04
  Scenario: A PDF module arrives as a document
    Given the NIETE bot chat is open and I have opened a module whose content is a PDF, not a video
    Then the bot sends the module as a PDF document whose caption is the module card ("<course> — <i> of <N>", the module title, "Read the PDF, then tap …"), followed by its buttons — no separate caption message
    # content-delivery.service.js isPdfModule. @wip.

  @e2e @wip @draft @flow @quiz @destructive @P1 @T05
  Scenario: Finishing every module unlocks the level exam, and passing it certifies the level
    Given the NIETE bot chat is open on a teacher who has passed every module in a level
    When I open that level, start the now-unlocked grand quiz, and answer at least 80% correctly
    Then the bot sends the certificate PDF captioned with the congratulation and my certificate code — one message (plain text only when there is no PDF, or the PDF does not arrive)
    # loadGrandQuizState (unlocks once all modules done) + quiz-delivery grand-pass branch.
    # @destructive: certifies the level + unlocks the next. @wip — needs a fully-completed level.

  @e2e @wip @draft @certificates @P2 @T06
  Scenario: Asking for a certificate by its code sends the PDF
    Given the NIETE bot chat is open on a teacher who holds a certificate
    When I send "/certificate <my certificate code>"
    Then the bot sends me that certificate as a PDF document
    # certificate-pdf.service.js (only my own certificates). @wip.

  @e2e @wip @draft @flow @quiz @P3 @T07
  Scenario: For a Beacon House programme the level exam is written answers, not multiple choice
    Given the NIETE bot chat is open on a teacher in a Beacon House programme who has finished every module in a level
    When I start the level exam
    Then it asks open-ended questions I answer in my own words, marked out of 5
    And each answer's mark and feedback arrive in the same message as the next question (and, on the last answer, the result)
    # capstone-delivery.service.js (open-ended, model-scored, 70% to pass, no cooldown). @wip.

  @e2e @flow @P3 @T08
  Scenario: For an Oxbridge programme a level is certified from module scores, with no exam
    Given a teacher in an Oxbridge programme who has finished every module with each best score at least 70%
    Then the level detail states "🎓 No level exam — finish all sessions to complete this level." with no grand-quiz row
    And on finishing the last module the bot sends the certificate PDF captioned with "Module check — passed", the congratulation "with 70%+ on each quiz" and a certificate code — no exam is ever shown
    # maybeIssueQuizScoreCertificate (QUIZ_CERT_PASS_PCT=0.7, vendor unlock_logic=all_modules, no capstone).
    # Verified live on PROD (2026-08-06): Oxbridge L17 (1 course · 7 modules SESSION#1-7 · no grand_quizzes).
    # Module bar is 70% ("10 questions. You need 70%…") vs NIETE 100%. Cert NIETE-20260805-YA5IU7 + PDF issued
    # off the final module pass — no exam step. See F-OXB-examcopy (post-completion still nudges "take the level exam").

  @e2e @wip @draft @quiz @destructive @P1 @T26
  Scenario: For an I-SAPS programme passing the ninth module exam certifies the level
    Given the NIETE bot chat is open on a teacher in the I-SAPS programme who has passed eight of the nine module exams
    And every session of the remaining module is passed
    When I take that module exam and pass it
    Then the bot sends the certificate PDF captioned "You have completed every module of Level 1: Novice." with my certificate code
    # UPDATED 2026-10-01 (bd-vej4h): was "...whatever units are left". The certificate still waits on the
    # module exams ONLY, but a module exam now opens only after that module's sessions are passed, so
    # "units left" can no longer reach the exam. @wip — needs an I-SAPS level seeded 8/9 on the throwaway.

  @e2e @wip @draft @flow @P1 @T85
  Scenario: In I-SAPS, any module can be opened, but its sessions open one at a time
    Given the NIETE bot chat is open on a teacher in the I-SAPS programme with nothing completed
    When I open Module 5
    Then its first session is open and its second session is locked
    And Module 1's first session is open as well
    # bd-vej4h: module_unlock_logic = chain_per_course — one next-up session per module.

  @e2e @wip @draft @quiz @P1 @T86
  Scenario: An I-SAPS session's quick check needs 70% before the next session opens
    Given the NIETE bot chat is open on a teacher in the I-SAPS programme partway through a module
    When I answer a 3-question quick check with 2 correct
    Then the bot says I did not clear the 70% bar and offers a retry
    And the next session stays locked until I pass
    # bd-vej4h: module_passing_pct = 70. On a 1-3 question check this means every answer correct.

  @e2e @wip @draft @quiz @P1 @T87
  Scenario: An I-SAPS module exam opens only once that module's sessions are passed
    Given the NIETE bot chat is open on a teacher in the I-SAPS programme with 4 of 6 sessions of Module 1 passed
    When I open Module 1
    Then the module exam row says to finish 2 more sessions first, and cannot be started
    # bd-vej4h: buildModuleExamSlot closes the exam while unitsDone < unitsTotal.

  @e2e @wip @draft @quiz @destructive @P1 @T88
  Scenario: An I-SAPS module exam is 4 multiple-choice questions and 1 written answer, with two separate pass bars
    Given the NIETE bot chat is open on a teacher in the I-SAPS programme with every session of Module 1 passed
    When I take the Module 1 exam and get 3 of the 4 multiple-choice questions right
    Then the bot says the multiple choice is cleared and my written answer is being graded
    And no written-answer mark or feedback is shown, and no certificate is issued
    # bd-vej4h: pass = MCQ >= 75% of those served AND CRQ >= 60%. Module 6 serves its 2 MCQs and needs both.
    # UPDATED 2026-10-01 (bd-hxm7a): while I-SAPS written-answer results are HELD, an exam with the MCQs
    # cleared is PENDING REVIEW (neither passed nor failed); fewer than 3 of 4 fails now and can be retaken.

  @e2e @wip @draft @quiz @P0 @T90
  Scenario: An I-SAPS written answer is graded but its mark is not shown while results are held
    Given the NIETE bot chat is open on a teacher in the I-SAPS programme sitting a module exam
    When I type my written answer
    Then the bot says my written answer is being graded and will take some time
    And it shows no score and no feedback for it
    And the module exam cannot be started again while it is being graded
    # bd-hxm7a: graded against the I-SAPS rubric and stored; app_settings isaps_crq_results_released is the switch.

  @e2e @wip @draft @quiz @P2 @T89
  Scenario: A failed I-SAPS module exam can be retaken straight away
    Given a teacher in the I-SAPS programme has just failed the Module 1 exam
    When I open Module 1
    Then the module exam can be started again immediately, with a new random draw of questions
    # bd-vej4h: I-SAPS cooldown_hours = 0, and the exam cooldown now reads the vendor row (was a hardcoded 24h).

  @e2e @wip @draft @certificates @P2 @T27
  Scenario: An I-SAPS certificate on production carries no "not a real certificate" watermark
    Given a teacher in the I-SAPS programme has just been certified on production
    When the certificate PDF arrives
    Then it has no "NOT A REAL CERTIFICATE" watermark
    And a certificate issued on sandbox or staging still carries it
    # Updated at go-live (bd-vej4h, 2026-10-01): PILOT_WATERMARK_VENDORS is empty.

  # ═══════════════════════════════════ NEGATIVE ═══════════════════════════════════

  @e2e @flow @negative @known-issue @P2 @T09
  Scenario: A locked level is selectable but the server refuses to open it
    Given the NIETE bot chat is open and I have opened the "NIETE" programme
    When I select a locked level (e.g. Level 1) and tap "Open level"
    Then the "Open level" button turns on client-side (the Flow can't disable the row) but the bot replies "Pass Level 0's grand quiz first to unlock this level."
    # @known-issue: the real gate is server-side. Verified live on PROD (2026-08-05). Names the previous level.

  @e2e @flow @negative @known-issue @P2 @T10
  Scenario: A module further down the list can't be opened before the earlier ones
    Given the NIETE bot chat is open and I have opened a level with earlier modules unfinished
    When I pick a locked module lower down and try to open it
    Then the bot replies "Finish \"<the Next-up module>\" first — modules open one at a time."
    # @known-issue: locked rows stay tappable; the server enforces order. Verified live on PROD (2026-08-05).

  @e2e @flow @negative @P2 @T11
  Scenario: Tapping the locked exam link explains what to finish first
    Given the NIETE bot chat is open and the level still has modules to finish
    When I tap the "🔒 Locked" exam link in the level detail
    Then the bot replies "Finish every module in this level first — the exam unlocks once all 9 courses are complete."
    # Verified live on PROD (2026-08-05). Distinct wording from the locked-card caption in the main flow.

  @e2e @quiz @negative @content-driven @P2 @T12
  Scenario: Getting one question wrong fails the module check (NIETE needs 100%) and offers a retry
    Given the NIETE bot chat is open and I am taking a NIETE module check
    When I answer exactly one question with a deliberately-wrong option (not matching the key) and the rest correctly
    Then the bot replies in ONE message, opening with the verdict on my last answer: "Module check — not quite" with my score in the shape "<got>/<total> (<pct>%)", that I need 100% to move on, and "Ready to try the module check again?" — with "🔄 Try again" and "⏸ Pause" buttons on that same message
    # @content-driven. Verified live on PROD (2026-08-05): "Module check — not quite. You got 2/3 (67%).
    # You need 100% to move on…" All questions are asked FIRST, then graded. module_passing_pct=100 for
    # NIETE (TALEEMABAD); other partners 70%. Assert the shape, not "2/3".

  @e2e @certificates @negative @copy @P3 @T13
  Scenario: Asking for a certificate that isn't mine says it can't be found
    Given the NIETE bot chat is open
    When I send "/certificate NIETE-L0-20260101-ZZZZ"
    Then the bot replies "I could not find a certificate with the code" and points me to "/certificates"
    # Verified live on PROD (2026-08-05). Owner-scoped: not-yours and not-exist both → not found. Code must
    # be well-formed (CERT_CODE_RE), else it falls through to the list (see edge below).

  @e2e @certificates @negative @P3 @T14
  Scenario: A /certificate with a junk code just shows my certificates list
    Given the NIETE bot chat is open
    When I send "/certificate not-a-code"
    Then the bot shows my certificates list, or the no-certificates nudge
    # Verified live on PROD (2026-08-05): a junk argument is ignored → list/nudge mode.

  @e2e @edge @negative @P3 @T15
  Scenario: "/teacher training" (two words) is not a training command
    Given the NIETE bot chat is open
    When I send "/teacher training"
    Then the bot treats it as a normal question, not the Teacher Training Flow
    # Verified live on PROD (2026-08-05): AI reply, no card — the two-word phrase isn't a trigger.

  @e2e @quiz @negative @destructive @P3 @T16
  Scenario: Failing the level exam starts a wait before I can retry
    Given the NIETE bot chat is open and I have just failed a level's grand quiz
    When I try to start the grand quiz again
    Then the bot tells me to try again in a few hours

  @e2e @flow @edge @P3 @T18
  Scenario: /training works even in the middle of something else
    Given the NIETE bot chat is open and I am part-way through another feature
    When I send "/training"
    Then the Teacher Training card is sent without my having to cancel first
    # Single, stateless entry point. Verified live on PROD (2026-08-05): opened from a pending register Welcome card.

  @e2e @quiz @edge @copy @P3 @T19
  Scenario: Pausing a module check saves my place
    Given the NIETE bot chat is open and a module check is offering "🔄 Try again" and "⏸ Pause"
    When I tap "⏸ Pause"
    Then the bot replies "⏸ Paused. Send /training when you want to pick up where you left off."
    # @copy. Verified live on PROD (2026-08-05).

  @e2e @quiz @edge @content-driven @P3 @T20
  Scenario: A module retake serves a fresh set of questions
    Given the NIETE bot chat is open and I have just missed a module check
    When I tap "🔄 Try again"
    Then the check restarts from Q1 and may serve different questions, in a different order, with the correct answer on a different letter
    # Verified live on PROD (2026-08-05): retry served different Q1-Q3, reshuffled. Assert the CONTRACT (restarts at Q1/<n>, still 100% to pass).

  @e2e @wip @draft @flow @quiz @P3 @T21
  Scenario: A half-finished module quiz picks up where I left off
    Given the NIETE bot chat is open and I started a module check and answered some questions
    When I re-open the module and tap "Take quiz" again
    Then the quiz continues at the next unanswered question, not from the beginning
    # quiz-delivery startTrainingQuiz resumes the same attempt. @wip.

  @e2e @flow @copy @P3 @T22
  Scenario: A module's button is named after what tapping it does
    Given the NIETE bot chat is open and I have opened a module
    Then a module with a quiz shows "Take quiz", a video module shows "Next video", and a PDF module shows "Next module"
    # @copy. The button label follows the content type. @wip.

  @e2e @quiz @edge @wip @draft @P3 @T23
  Scenario: A very long answer option is shown in full, not cut off
    Given the NIETE bot chat is open and a module question has an option longer than about 70 characters
    Then that option is written out as a lettered line and can still be chosen
    # sendQuestion long-option handling (OPTION_DESC_MAX=72). @wip.

  # ── the quiz written from a lesson PLAN (lp_v8) — PLAN_R8 §3.4/§3.5 ──────────────────────
  # A quiz made from the lesson plan a teacher was served (the 15:00 offer) has no coaching
  # recording behind it. It must still live in the ONE /quiz list, and its class report must
  # still carry the objectives to reteach. Needs an lp_v8 quiz on the driver number first
  # (answer "Make the quiz" on the afternoon offer, or seed one on sandbox). @wip until lane E
  # drives it.

  @e2e @quiz @wip @draft @P2 @T24
  Scenario: A quiz made from my lesson plan is listed in /quiz among my coaching lessons
    Given the NIETE bot chat is open and a quiz was made from a lesson plan I was served on an earlier day
    And I also have a recorded coaching lesson
    When I send "/quiz"
    Then the list shows the lesson-plan quiz as a row "<date> · <subject>" with "From lesson plan · <topic> · <status>" beneath it
    And the rows are ordered newest lesson first, the lesson-plan quiz dated by the day it was planned for
    And the recorded coaching lesson is still in the list
    When I tap the lesson-plan quiz's row
    Then I am offered "Resend the link", the report, and a way back — and nothing offers to make the quiz again
    # transcript-quiz-list.service lessonItems + handleLpPick (row id tq_pick_lp_<quizId>); the /quiz Flow
    # lists it too (key lp_<quizId>) with Generate report / Resend link on its LESSON screen. @wip.

  @e2e @quiz @wip @draft @P1 @T63
  Scenario Outline: However I type "quiz", it opens my quiz menu
    Given the NIETE bot chat is open and I have a recorded coaching lesson or a lesson plan from the last 30 days
    When I send "<text>"
    Then my /quiz menu opens — the list of my lessons — and no chat answer about quizzes comes instead
    Examples:
      | text         |
      | quiz         |
      | Quiz?        |
      | quiz/        |
      | / quiz       |
      | quize        |
      | my quizzes   |
      | send me quiz |
      | mera quiz    |
      | کوئز         |
      | کویز         |
    # quiz-menu-request isQuizMenuRequest → the text handler's /quiz door → quiz-menu-entry openQuizMenu.
    # Production, 14 days to 24 Sep 2026: 54 of 351 such texts reached general AI chat instead. @wip.

  @e2e @quiz @wip @draft @P1 @T64
  Scenario: /quiz lists the lesson plans I took, says where each lesson came from, and makes nothing until I tap
    Given the NIETE bot chat is open and I took a Grade 1-5 lesson plan today and have a recorded coaching lesson
    And no quiz has been made from either
    When I send "quiz"
    Then my lessons are listed newest first, the lesson plan and the recording together
    And the lesson plan's row says "From lesson plan" and the recording's row says "From transcript"
    And no quiz is made by opening the list
    When I tap the lesson plan's row
    Then the bot asks which language the quiz should be in, or — for an Urdu or Islamiyat lesson — says it is making the quiz now
    And the quiz arrives with the PDF and the message to forward to the class
    When I send "/quiz" again
    Then that lesson plan is listed once, as its quiz with its status — never a second time as a lesson to make
    # lp-v8-lesson-provider list/start; row id tq_pick_lsn_lp_v8_<delivery id>, Flow key lsn_lp_v8_<delivery id>.
    # Only lessons whose served version has a slide script are listed (niete_lp_asset_sources). In Urdu the
    # labels read «سبق کے منصوبے سے» and «کلاس کی ریکارڈنگ سے». @wip.

  @e2e @quiz @wip @draft @P1 @T65
  Scenario: Tapping the same lesson plan twice makes one quiz
    Given the NIETE bot chat is open and /quiz lists a lesson plan with no quiz yet
    When I tap that lesson plan's row twice in quick succession
    Then exactly one quiz is made and one "making it now" arrives
    And the afternoon quiz offer never makes a second quiz for that lesson
    # lp-lesson-claim: a Redis SET NX per (teacher, lesson) around read → insert → re-read; the re-read keeps
    # the oldest row when Redis fails open. The 15:00 offer goes through the same claim. @wip.

  @e2e @quiz @wip @draft @P1 @T66
  Scenario: A lesson plan another teacher already made into a quiz comes back quickly, with my own name and link
    Given another teacher on the same version of a lesson plan has already been sent its quiz
    And the NIETE bot chat is open and /quiz lists that lesson plan with no quiz yet
    When I tap that lesson plan's row
    Then the quiz arrives with the PDF and the message to forward to the class
    And the PDF and the forward message carry my name and my lesson date, and the link is a new one of my own
    And the questions are the same questions the other teacher's class was sent
    # lp-quiz-cache: key = (source, lesson id, version stamp, content hash, language); donor = the newest SENT quiz
    # of that key with every check passed, not itself a copy. quiz_funnel.generated carries cached:true and
    # donor_quiz_id; meta.cache_donor on the row. Pictures re-hosted under this quiz. QUIZ_LP_CACHE=off = author. @wip.

  @e2e @quiz @negative @wip @draft @P2 @T67
  Scenario: Past today's quiz limit I am told plainly and can make it tomorrow
    Given I have already had the day's limit of quizzes made today
    When I ask for one more quiz from /quiz
    Then the bot says today's limit for new quizzes is reached and that it can be made tomorrow from /quiz
    And no quiz is sent
    # quiz-daily-cap: QUIZ_DAILY_CAP (default 10) per teacher per PKT day, both streams, counted in the generate
    # step before any model call; failed / daily_cap; copy tqDailyCap. Needs Redis; off/0 = no cap. @wip.

  @e2e @quiz @wip @draft @P2 @T68
  Scenario: A child in the middle of a quiz who types "quiz" stays in the quiz
    Given a child on this phone is taking a class quiz and a question is waiting for an answer
    When the child sends "quiz"
    Then the bot replies, in the quiz's language, that a quiz is in progress: tap an answer above or type its letter, and STOP ends it
    And no lesson list or menu is sent over the question, and the waiting question can still be answered
    # quiz-menu-entry: the video-quiz state (currentQuestionId) is checked before the role. vqStillInQuiz. @wip.

  @e2e @quiz @wip @draft @P3 @T69
  Scenario: A coach who types "quiz" gets the coach menu
    Given the NIETE bot chat is open on a coach's number
    When I send "quiz"
    Then the coach menu opens, and nothing tells me to record a lesson for coaching first
    # A role that cannot self-coach has no quiz row in its menu (role-features LAYOUTS). @wip.

  @e2e @quiz @wip @draft @P2 @T35
  Scenario: A lesson-plan quiz still waiting for its language is asked again from /quiz, never "still being made"
    Given the NIETE bot chat is open and I said yes to the afternoon quiz offer on a maths, science or English lesson plan but never tapped a language
    When I send "/quiz"
    Then that lesson's row says "No quiz yet"
    When I tap that row
    Then the bot asks again which language the quiz should be in, with an Urdu and an English button, and does not say the quiz is still being made
    When I tap "English"
    Then the bot says it is making the quiz now, and the quiz arrives with the message to forward to the class
    And in the /quiz Flow, the same kind of lesson opens a lesson screen offering to make it in Urdu or in English — not a "still being made" screen
    # The row waits offered + meta.awaiting_language until a language is tapped; nothing is queued before.
    # handleLpPick re-sends the ask (sendLanguageAsk, tq_lang_ buttons); the Flow's actionsFor gives make_<lang>
    # for that state and stepAction hands it to startGenerating (atomic offered → generating, then the
    # lesson-plan quiz job) — the same path as answering the ask in chat. @wip.

  @e2e @quiz @wip @draft @P2 @T36
  Scenario: A lesson-plan quiz that could not be made opens in /quiz, says why, and can be made again
    Given the NIETE bot chat is open and a quiz for one of my planned lessons could not be made because something went wrong while writing it
    When I open "/quiz" and tap that lesson
    Then the lesson screen opens — never "Something went wrong" — and says the problem was on the bot's side, not my lesson plan
    And it offers "Make it again" and "Done"
    When I choose "Make it again" and continue
    Then the Flow closes and the bot says it is making the quiz now
    But when the lesson plan itself had too little lesson in it, the screen says so and offers only "Done"
    # transcript-quiz-flow-endpoint: actionsFor never serves the LESSON screen an empty action list (its
    # RadioButtonsGroup is required over ${data.actions}); a failed lp_v8 row gets lpFailedActions — remake
    # where quiz-sources.lpRemakeable (model-side reason, lessons kept, < 2 remakes) — plus Done, and the
    # results name the reason (failureReasonOf). "Make it again" runs transcript-quiz-offer.remakeLpQuiz:
    # atomic failed → generating, then queueLpQuiz. Seen on staging: a failed lesson-plan quiz showed the Flow's
    # generic error. @wip — forcing a failure needs a seeded failed row.

  @e2e @quiz @wip @draft @P2 @T70
  Scenario: In the /quiz list message, a lesson-plan quiz that could not be made is made again on a tap
    Given the NIETE bot chat is open and a quiz for one of my planned lessons could not be made because something went wrong while writing it
    When I open the /quiz list from the menu's Quiz item
    Then that lesson's row says "Failed — tap to retry", the way a failed quiz from a recording does
    When I tap that row
    Then the bot says it is making the quiz now, and the quiz arrives with the message to forward to the class
    But when the lesson plan itself had too little lesson in it, the row says "Didn't work" and a tap only says why
    # transcript-quiz-list statusLine + handleLpPick: a failed lp_v8 row reads tqRowFailed where
    # quiz-sources.lpRemakeable holds, and the tap runs transcript-quiz-offer.remakeLpQuiz (source 'list') —
    # the same remake as the Flow's "Make it again". Otherwise tqRowFailedLp and the persisted failure copy.
    # @wip — forcing a failure needs a seeded failed row.

  @e2e @quiz @wip @draft @P2 @T71
  Scenario: A Grades 6-12 lesson plan I received is in /quiz, and becomes a quiz only when I tap it
    Given the NIETE bot chat is open and the 6-12 quiz source is switched on
    And earlier today I took a Grade 8 maths lesson plan from the 6-12 menu
    When I send "/quiz"
    Then that lesson is listed "From lesson plan", with its date, subject and the lesson's own name, and no quiz has been made for it yet
    When I tap it
    Then the bot asks which language the quiz should be in, and after I choose, says it is making the quiz now
    And the quiz arrives as a PDF that says "What you planned" and "Made from your lesson plan", followed by the message to forward to the class
    And after children take it, /quiz offers Resend link and Generate report for it, and the class report and the children's cards arrive as for any quiz
    # quiz/providers/lp612.provider.js (list: niete_lp612_deliveries → newest delivery per lesson, not held, not an
    # assessment day, no quiz yet; start: the lp612 quiz row with meta.lessons[0] = the render's version triple);
    # quiz/lp612-quiz-source.js reads the exact stored lp_doc (R2 lp612/{tv}/{lang}/{segment}.lp.json) and adapts it
    # to the slide-script shape the LP digest reads. Needs V1.5.5 applied and the provider in the /quiz registry. @wip.

  @e2e @quiz @config-gated @wip @draft @P2 @T72
  Scenario: With the 6-12 quiz source switched off, no 6-12 lesson is offered and a quiz already made still works
    Given the NIETE bot chat is open, I have a sent quiz made from a 6-12 lesson plan, and QUIZ_LP612_SOURCE is off
    When I send "/quiz"
    Then no 6-12 lesson without a quiz is listed
    But my sent 6-12 quiz is still listed, and Resend link and Generate report still work for it
    # quiz-sources.lp612SourceOn (read at call time): the provider lists nothing and a tap is unavailable; the
    # generate step fails a queued lp612 quiz as source_off ("couldn't start it… try again from /quiz a little
    # later") and never stops one already made.
    # @config-gated: needs the env var flipped on a test environment. @wip.

  @e2e @quiz @config-gated @wip @draft @P2 @T73
  Scenario: A 6-12 lesson tapped in /quiz that could not be started says so honestly, and can be made again once it can be
    Given the NIETE bot chat is open, and the 6-12 quiz source is on where /quiz runs but off where quizzes are written
    When I tap a 6-12 lesson in /quiz and choose the quiz language
    Then the bot says it could not start that quiz, that the problem was on its side and not my lesson plan, and to try again from /quiz a little later
    And it never says "the next lessons you plan will get a new offer" — I asked for this quiz from the menu, not from an offer
    When the source is switched on where quizzes are written and I open that lesson in /quiz
    Then the lesson screen says the quiz could not be started on the bot's side and my lesson plan was not the problem, and offers "Make it again" and "Done"
    When I choose "Make it again" and continue
    Then the Flow closes and the bot says it is making the quiz now, and the quiz arrives with the message to forward
    # Staging E2E 25 Sep (quiz failed source_off: QUIZ_LP612_SOURCE was off on the service running the quiz queue).
    # quiz-sources failureCopyKey → startFailureCopyKey: the chat line is chosen by what can happen next —
    # lpQuizCouldNotStartRetry when lpRemakeable, lpQuizCouldNotStartLater while the source is off here,
    # otherwise lpQuizCouldNotStart (the 15:00 offer) or lpQuizCouldNotStartMenu (a /quiz tap). lpRemakeable:
    # source_off once lp612SourceOn() here; source_missing only when lp-source-check reads the plan again.
    # The Flow's LP_FLOW_FAILURE_RESULT.source_off = tqFlowResultsFailedLpStart (+ tqFlowResultsLater while off).
    # @config-gated: the switch has to be flipped on one service and not another. @wip.

  @e2e @quiz @copy @wip @draft @P2 @T74
  Scenario: The line after a quiz is sent says when the class report really comes
    Given the NIETE bot chat is open and I made a quiz for one of my lessons from /quiz
    When the quiz PDF and the message to forward to my class arrive
    Then the PDF's caption ends by saying the class report comes about 12 hours after the first student starts, or at 7 in the morning if that falls at night
    And it says that to get the report sooner I can send /quiz, pick the lesson and ask for its report
    And it never promises the report "sooner if everyone finishes"
    And the message to forward is the last thing I am sent — no line arrives after it
    # tqReportPromise (transcript-quiz-handoff, first send) closes the PDF caption — it was a third message
    # after the link until the Meta bill cut (bd-w2daa.7); only past the 1,024-code-point caption cap does it
    # still go on its own, after the link. When no PDF can be made, the text that stands in for it carries
    # it, ahead of "Forward THIS message". The schedule is video-quiz-report reportTargetUtc:
    # 12 h after the first join, 22:00-07:00 PKT moved to 07:00; the early "everyone finished" send was removed
    # (generate suppresses every follow_up), so nothing sends it sooner except the teacher's own request.
    # vqShareReportPromise, the video lesson's class link, says the same schedule. Proven against the real
    # scheduler in tests/quiz/report-promise-truth.test.js. @wip.

  @e2e @quiz @i18n @wip @draft @P2 @T75
  Scenario: An Urdu class quiz never guesses whether the child is a boy or a girl — "can", "are doing", "forgot" included
    Given the NIETE bot chat is open and I made an Urdu quiz for one of my lessons
    When a child takes it from the class link and reads every question, option, explanation and feedback line
    Then nothing speaks to the child with a masculine or a feminine verb — no «آپ … کر سکتے ہیں», «آپ … سمجھ رہی ہیں» or «آپ … بھول گئے»
    And the words say the same thing without a gender: «… کیا جا سکتا ہے», «شاید آپ نے … سمجھا», «… گننا رہ گیا»
    But a story character or a thing keeps its own verb — «فاطمہ جلد ٹھیک ہوں گی»، «آئس کریم پگھل گئی»
    # transcript-quiz-address (PEDAGOGY_GENDERED_CHILD): آپ + a gendered present/modal/progressive/future/perfect,
    # and now a perfective with no auxiliary closing its clause («آپ … بھول گئے»), not where the field names the
    # Prophet ﷺ or a companion, not after another subject. The validator's complaint names the neutral rewrite for
    # each form it found (modal, progressive, wish, perfect, habitual). Staging 25 Sep: «آپ … بڑھا سکتے ہیں» was
    # flagged, left by the last rewrite, and shipped as a recorded soft fault. Proven in
    # tests/quiz/transcript-quiz-child-address-forms.test.js. @wip — the author's wording cannot be forced live.

  @e2e @quiz @i18n @wip @draft @P2 @T76
  Scenario: An Urdu quiz on a lesson plan with an English title keeps the title in reading order
    Given the NIETE bot chat is open and I made an Urdu quiz on a maths or science lesson plan whose English title has a dash in it, like "Divisibility — apply the rules"
    When the quiz PDF arrives, and later the class report
    Then the English title reads left to right in one piece on both documents — "Divisibility — apply the rules", never "apply the rules — Divisibility"
    # latin-runs.js: "—", "–" and "→" between two Latin words join them into one left-to-right isolate, as
    # "&" and "·" already did. The lesson-plan quiz is named by the catalog title verbatim, and 330 of the
    # catalog's 1,390 English titles carry a dash or an arrow. The coaching hero report and card use the
    # same runs. @wip.

  @e2e @quiz @wip @draft @P2 @T37
  Scenario: /quiz never promises a report when no student has finished
    Given the NIETE bot chat is open and I have sent a class quiz that only my own test run has taken
    When I open "/quiz" and tap that lesson
    Then the lesson screen offers "Resend link" and "Done", and no "Generate report"
    When a student finishes the quiz and I open the lesson again
    Then "Generate report" is offered first, and choosing it brings the report to my chat
    # transcript-quiz-flow-endpoint baseActions: report only when a non-self-test session is completed (the
    # report service's own rule — it declines nothing_completed_yet otherwise). A stale Generate report tap
    # answers tqFlowResultsNothingToReport on the lesson screen, never the DONE "on its way"; a decline after
    # the screen was answered is told in chat (tqNoReportYet). @wip.

  @e2e @quiz @wip @draft @P1 @T38
  Scenario: A letter typed during a class quiz answers the question, and an unfinished quiz never takes over the chat
    Given a child has opened a class quiz from its link and a question with lettered answers is waiting
    When the child types "B" instead of tapping
    Then the answer the child saw as B is recorded and the feedback and the next question arrive, exactly as for a tap
    But when the child types a letter the question does not offer, it is not taken as an answer
    And a teacher who started their own quiz link and never finished it can still send "/menu" or tap "Lesson plan" and get the menu or a lesson plan, never "Tap one of the answer buttons above"
    # video-quiz.service answerTypedLetter (the letter mapped through the question's stored display order);
    # quiz-session._recoverFromDB now recovers only its own roster sessions, never past expires_at — before,
    # it adopted share_link / video_solo sessions (production, 14 days: 2,893 adoptions, 97% of them), and
    # the teacher's menu taps and commands were answered with the adaptive quiz's nudge. @wip.

  @e2e @quiz @wip @draft @P2 @T39
  Scenario: A child can type STOP to end a class quiz, and the teacher sees it stopped
    Given a child has opened a class quiz from its link and a question is waiting
    When the child types "stop"
    Then the child is told the quiz has stopped and can be started again later, in the quiz's language
    And a tap on the old question afterwards records nothing
    And in "/quiz" the teacher sees the child under "Stopped before the end", not as finished and not as still going
    And the class report lists the child as not finished
    But on an Urdu quiz "روکیں" stops it too, and the child is told in Urdu
    # video-quiz.service stopTyped: the words the adaptive quiz takes ("stop", "روکیں"), any case, a full stop
    # allowed, under the answer lock (a tap being graded finishes first and cannot bring the state back). The
    # session ends through endUnfinished: status incomplete, the answers so far counted, no score, no
    # scorecard, the state cleared, vqStopped sent. The /quiz Flow results list incomplete/expired/cancelled
    # sessions under tqFlowStopped, apart from tqFlowStillGoing. @wip.

  @e2e @quiz @wip @draft @P2 @T40
  Scenario: /quiz counts each child once, however many times they opened the quiz
    Given a child stopped a class quiz part-way, opened the link again and finished it
    And another child finished it, then took it again and did better
    When I open "/quiz" and tap that lesson
    Then each child is counted once in "started" and once in "finished", and each has one line
    And the average uses each child's latest finished attempt
    And the child who finished on the second go is not listed as still going or stopped
    And the lessons list, the lesson screen, the class report and the "only N have started" nudge give the same numbers
    # one-attempt-per-child.js oneAttemptPerChild (the class report's rule: the latest completed attempt, else
    # the latest row, grouped by student_id), now read by transcript-quiz-list countsFor (per quiz),
    # transcript-quiz-flow-endpoint loadStudents and the nudge's startedFor. @wip.

  @e2e @quiz @wip @draft @P2 @T41
  Scenario: A lesson-plan quiz that could not be started says so, and can be made again
    Given the NIETE bot chat is open and a quiz for one of my planned lessons could not be started (the job never reached the queue)
    When I open "/quiz" and tap that lesson
    Then the lesson screen says the quiz could not be started on the bot's side and the lesson plan was not the problem
    And it offers "Make it again" and "Done", and "Make it again" makes the quiz
    # transcript-quiz-offer queueLpQuiz merges the failure into the row's meta (the lessons, class and lesson
    # date are kept); quiz-sources: queue_failed -> lpQuizCouldNotStart copy and a remakeable reason; the Flow
    # results read tqFlowResultsFailedLpStart. @wip — a queue refusal cannot be forced live.

  @e2e @quiz @wip @draft @P2 @T42
  Scenario: A question that cannot be sent is skipped, and the child is scored on the questions actually asked
    Given a class quiz one of whose questions cannot be sent to a child's phone
    When a child opens the quiz from its link and answers the questions before it
    Then the bot says it could not send that question and has skipped it, and the next question arrives
    When the child answers every question that arrives
    Then the child's score card counts only the questions that were asked, never full marks on a part of the quiz
    And the teacher's class report shows that child with the same score
    But when the questions stop getting through, or the child could be asked fewer than half of the quiz, the child is told the quiz has stopped and to try again later, no score card is sent, and the teacher's report lists the child as started but not finished
    # video-quiz.service sendNextQuestion: 3 tries per question, then skipQuestion (vqQuestionSkipped, the
    # "Question n of N" numbering left as it was); 5 failed pickers in a row across questions ends the session
    # `incomplete` (endUnfinished, vqTrouble), never finish() on the answered subset; finish() itself refuses
    # to score a child asked fewer than half the quiz (minAskedToScore). Same engine for video, transcript and
    # lesson-plan quizzes. Forceable on an environment whose bot cannot fetch the question cards; otherwise
    # proven in bot/tests/quiz/video-quiz-undeliverable-question.test.js. @wip.

  @e2e @quiz @wip @draft @P2 @T25
  Scenario: The class report of a quiz made from my lesson plan carries the objectives to reteach
    Given the NIETE bot chat is open and children have finished a quiz that was made from my lesson plan
    When I ask for the report from that quiz's row in /quiz
    Then the class report arrives as a PDF
    And it names the lesson's learning objectives next to the questions the class found hard
    And afterwards that quiz's row in /quiz says the report was sent
    # video-quiz-report: isLessonQuiz gates the digest; markReportSent flips lp_v8 rows to report_sent. @wip.

  @e2e @quiz @wip @draft @P1 @T77
  Scenario: The class report arrives once, even when it is asked for while it is being made
    Given the NIETE bot chat is open and children have finished a class quiz I shared, and its scheduled class report is being made right now
    When I ask for the report from that quiz's row in /quiz
    Then exactly one class report arrives
    And the bot does not tell me that no child has finished yet
    # video-quiz-report generate(): a Redis SET NX claim (vq:report:sending:<share code>) makes the send
    # single-flight; a caller that loses it stands down (report_suppressed why send_in_progress), and the
    # teacher's own ask (force) waits for the send in flight and answers true, so /quiz sends no tqNoReportYet.
    # Kill switch VIDEO_REPORT_SEND_CLAIM. Timing cannot be forced live; proven in
    # bot/tests/quiz/video-report-send-once.test.js. @wip.

  @e2e @quiz @wip @draft @P1 @T78
  Scenario: After the class report, children who join late do not trigger a second automatic report
    Given the NIETE bot chat is open and I already received the class report of a quiz I shared
    When more children join and finish that quiz more than a day after the first child
    Then no second class report arrives on its own
    But when I ask for the report from that quiz's row in /quiz, a fresh class report arrives with every child in it
    # video-quiz-report generate(): a scheduled run on a share code whose report_sent_at is set suppresses
    # (report_suppressed why already_reported) — one automatic report per quiz (operator, 15 Sep). force (the
    # /quiz ask) still sends. VIDEO_REPORT_SCHEDULED_FOLLOWUP=on restores the old follow-up send. @wip.

  @e2e @quiz @wip @draft @P2 @T43
  Scenario: The class report names the class once, the same way, however the children typed it
    Given the NIETE bot chat is open and children of one class have finished a class quiz, typing their class in different ways such as "4", "Class 4", "grade 4" and "۴"
    When I ask for the report from that quiz's row in /quiz
    Then the report's header names one class — "Class 4" in an English report, "جماعت 4" in an Urdu one — never "4، ۴" as if there were two
    And the list of children does not repeat the class after every name
    But when the children are in more than one class, each child's line names their class, written the same way on every line
    And the quiz's lesson screen in /quiz follows the same rule: the class named once under the counts, and "(Class 5)" or "(جماعت 5)" beside a child only when the children are in more than one class
    # text-format parseClass/normaliseClasses/classLabel: Urdu and Arabic-Indic digits become ASCII, the grade
    # number is read out of the free text, children are grouped by it; the report template prints a roster
    # class only when the report spans more than one class. The text fallback and the /quiz Flow lesson
    # screen (transcript-quiz-flow-endpoint resultsText/studentLine) follow the same rule. @wip.

  @e2e @quiz @wip @draft @P3 @T44
  Scenario: The class report never calls me "your teacher"
    Given the NIETE bot chat is open and my account has no name on record, and children have finished a class quiz I shared
    When I ask for the report from that quiz's row in /quiz
    Then the report's header under the topic shows the class alone, such as "جماعت 4" or "Class 4"
    And nowhere does the report call me "آپ کے استاد" or "Your teacher"
    But the children who open my link are still greeted with "آپ کے استاد" / "Your teacher" in place of my name
    # video-quiz-report generate(): the header takes the teacher's own users.name; quiz_share_codes.teacher_name
    # holds the children's fallback (tqYourTeacher) and keeps serving the join greeting. @wip.

  @e2e @quiz @wip @draft @P2 @T45
  Scenario: The class report and the quiz PDF do not leave pages nearly empty
    Given the NIETE bot chat is open and children have finished an Urdu class quiz with several questions worth reteaching
    When I ask for the report from that quiz's row in /quiz
    Then the report's first page carries the first question worth reteaching under its header, not the header alone
    And no page before the last ends with most of it blank
    And the last page carries more than the NIETE footer
    And the teacher's quiz PDF that came with the link also never ends on a page holding only its footer
    # video-quiz-report.template: a card and the guidance box break between their parts, the footer is kept with
    # the last guidance part; transcript-quiz-teacher.template: the last card and the footer are one unbreakable
    # tail. Assert on the received PDFs' pages, never on a fixed page count (content length varies). @wip.

  @e2e @quiz @wip @draft @P2 @T46
  Scenario: A quiz the model could not write from my lesson plan says the problem was on our side
    Given the NIETE bot chat is open and I have said yes to a quiz for a lesson I planned
    When the model gives no usable reply while that quiz is being written
    Then the bot apologises that something went wrong on its side and says the problem was not my lesson plan
    And it never says my lesson plan could not be read
    And tapping that quiz's row in /quiz later repeats the same sentence
    But when the lesson plan itself carries no lesson to write from, the bot says the lesson plan has too little in it instead
    # transcript-quiz-generate: a digest throw is source_unusable only when lp-quiz-digest finds no lesson
    # in the slide script (err.code SOURCE_UNUSABLE); any other digest throw, or no usable author reply on
    # any attempt, is model_failed (tqFailedLpModel). The reason is persisted as quizzes.meta.error and /quiz
    # (handleLpPick) repeats it. A model failure cannot be forced live on demand; the behaviour is proven
    # in tests/quiz/lp-quiz-failure-reasons.test.js. @wip.

  @e2e @quiz @wip @draft @P2 @T47
  Scenario: A quiz the model could not write from my coaching recording says the problem was on our side
    Given the NIETE bot chat is open and I have said yes to a quiz for a lesson I recorded for coaching
    When the model gives no usable reply while that quiz is being written
    Then the bot apologises that something went wrong on its side and says the problem was not my recording
    And it never says the transcript didn't carry enough of what was taught
    And it tells me I can send /quiz and pick this lesson to try again
    And the /quiz lesson screen for that lesson says the same, and still offers to make the quiz
    # transcript-quiz-generate: a recording's digest or author that gives nothing usable (empty, cut off or
    # not JSON after the retry, or a refused call) is model_failed → tqCouldNotMakeModel, persisted as
    # quizzes.meta.error; the Flow lesson screen reads it (tqFlowResultsFailedModel) above the Make choices.
    # tqCouldNotMake ("the transcript didn't carry enough") is sent ONLY for a transcript under
    # MIN_TRANSCRIPT_CHARS (source_unusable, checked before any model call — /quiz and the offer never list
    # one). The offer-time digest failure is skipped as model_failed and the teacher is told nothing. A model
    # failure cannot be forced live; proven in tests/quiz/transcript-quiz-failure-reasons.test.js. @wip.

  @e2e @quiz @wip @draft @P2 @T79
  Scenario: A quiz whose questions never passed our checks says the problem was on our side, and can be made again
    Given the NIETE bot chat is open and I have said yes to a quiz for a lesson I recorded for coaching
    When the questions written for that lesson never pass the quiz checks, after every attempt and repair
    Then the bot apologises that it could not write good enough questions from this lesson this time
    And it says the problem was on its side, not my recording
    And it never says the transcript didn't carry enough of what was taught
    And it tells me to send /quiz and pick this lesson to make it again, never to wait for my next lesson
    And the /quiz lesson screen for that lesson says the same, and still offers to make the quiz
    And a quiz held back because some of its answers were wrong or unclear also tells me I can pick this lesson to make it again
    # quiz-sources TRANSCRIPT_FAILURE_COPY: validator_failed (the author replied, nothing validated) and
    # key_conflict → tqCouldNotMakeAuthor; key_disagreement → tqFailedKeyDisagreement (tail: pick this lesson
    # to make it again); a reason with no sentence of its own → tqCouldNotMakeModel. The Flow lesson screen
    # (TRANSCRIPT_FLOW_FAILURE_RESULT): validator_failed / key_conflict / a row with no stored reason →
    # tqFlowResultsFailedAuthor; key_disagreement → tqFlowResultsFailedKeys. Production 1–24 Sep: 14 teachers
    # were told "the transcript didn't carry enough" for validator_failed. @wip — a validation failure cannot
    # be forced live on demand; proven in tests/quiz/transcript-quiz-failure-reasons.test.js and
    # bot/tests/quiz/transcript-quiz-flow-endpoint.test.js.

  @e2e @quiz @wip @draft @P1 @T28
  Scenario: A maths question with fractions reaches the child as a typeset card
    Given the NIETE bot chat is open and a class quiz was made from a maths lesson on comparing fractions
    When a child opens the quiz from its link and reaches a question about fractions
    Then the question arrives as a picture card with the fractions drawn stacked, the way a textbook prints them
    And the buttons under the card are the letters on the card, and tapping one answers the question
    And after answering, the verdict writes each fraction as plain text like "2/3", never with "$" or a backslash
    And the teacher's quiz PDF shows the same fractions drawn stacked
    # bd-mg9c7.159.19 part A. The author writes maths as inline TeX ($\frac{2}{9}$); needsQuestionCard
    # fires on it, so the question is a card (transcript-quiz-card, KaTeX via the 6-12 LP renderer's
    # rich()) and the child answers with the lettered buttons. Every WhatsApp TEXT — the stem when
    # sent as text, button and list titles, the verdict, the class report — passes through
    # quiz-math.mathForChat (tex-to-unicode), and inside Urdu each expression is a left-to-right
    # isolate. Same engine for transcript and lp_v8 quizzes. Content-driven: assert the SHAPE
    # (a card, stacked fractions, no TeX source in any text), never a fixed question. @wip.

  @e2e @quiz @i18n @wip @draft @P2 @T48
  Scenario: An Urdu class quiz speaks to the child in grammatical Urdu, and a picture question looks like the rest of the quiz
    Given the NIETE bot chat is open and an Urdu class quiz with a picture question was made from a maths lesson
    When a child opens the quiz from its link and gives a name and the class "3"
    Then the greeting joins the name and the class with the Urdu comma "،", never with ","
    When the child reaches the picture question
    Then the picture carries "سوال <n> از <total>" and the NIETE mark, as the question cards do
    And the text under the picture does not print the question number a second time
    When the child finishes the quiz with one star
    Then the caption says "آپ کو 1 ستارہ ملا!" and the scorecard names the subject "ریاضی", never "maths"
    When the teacher's report goes out and the child shares a place with another child
    Then the class card says "مشترکہ <place> نمبر پر" with the place in its oblique form, for example "پہلے" or "پانچویں"
    And one hidden classmate reads "کلاس کا 1 اور بچہ", several read "کلاس کے <n> اور بچے"
    And an English topic on the Urdu card is cut at its own end with "…", never at its beginning
    # Figure frame: transcript-quiz-figure figureHtml (counter + mark in the 1080x565 header;
    # media.question_image_paints_counter drops the body counter; an older unframed figure keeps
    # it). Copy: ux-strings vqWhoNameClass / vqStarsEarned(One) / vqClassOthers(One); ordinals built
    # in video-quiz-leaderboard.template urduOrdinal (direct + oblique); subject via
    # transcript-quiz-language subjectLabel. Content-driven: which question has the picture, the
    # score and the place vary — assert the SHAPE of each line. Class cards need CLASS_CARD_ENABLED.
    # Proven in tests/quiz/child-copy-urdu-grammar.test.js, child-card-subject-and-topic.test.js and
    # transcript-quiz-figure-frame.test.js. @wip until driven live.

  @e2e @quiz @wip @draft @P2 @T49
  Scenario: A place-value question shows the bundles the class built, and never the number
    Given the NIETE bot chat is open and a class quiz was made from a grade 1-3 maths lesson on tens and ones
    When a child opens the quiz from its link and reaches a question asking what number the picture shows
    Then the picture above the question has one headed column per place, bundles of ten sticks under the tens and loose sticks under the ones
    And no digit and no count is written anywhere in the picture
    And a place that holds nothing is an empty column under its heading
    And in an Urdu quiz the column headings are in Urdu
    # The base_ten figure type (vendor/lp-v9/diagrams/types/base_ten.js; SYNC.md §3.18); the headings
    # come from the string catalog (tqPlaceHundreds / tqPlaceTens / tqPlaceOnes). The counters and
    # tiles a counting lesson uses are drawn the same way, as the pictograms "counter" and "tile".
    # Content-driven: assert the SHAPE (headed columns, bundles, no digits), never a fixed number. @wip.

  @e2e @quiz @wip @draft @P2 @T50
  Scenario: A four-digit place-value question shows the thousands the class built
    Given the NIETE bot chat is open and a class quiz was made from a grade 3 maths lesson plan on four-digit numbers
    When a child opens the quiz from its link and reaches a question asking what number the picture shows
    Then the picture has a thousands column to the left of the hundreds, with a cube (or a block of ten big bundles) for each thousand
    And a number with thousands and no hundreds, such as 2014, still shows an empty hundreds column under its heading
    And no digit and no count is written anywhere in the picture, and in an Urdu quiz the thousands heading reads "ہزار"
    # base_ten `thousands` (0-9), SYNC.md §3.20; heading tqPlaceThousands. The lesson-plan digest quotes a
    # four-digit worked example whole (lp-quiz-digest lessonDrewBlock). Content-driven: assert the SHAPE
    # (four headed columns, cubes or bundle blocks, no digits), never a fixed number. @wip.

  @e2e @quiz @wip @draft @P3 @T51
  Scenario: A counting question draws the lesson's own objects — sweets, dates, cookies, lilies, samosas, bangles
    Given the NIETE bot chat is open and a class quiz was made from a grade 1-3 maths lesson plan that counted sweets or samosas
    When a child opens the quiz from its link and reaches a counting question with a picture
    Then the picture draws the objects the lesson counted, not plain round counters
    # Pictograms sweet, cookie and lily (OpenMoji candy, cookie, lotus) and date, samosa and bangle (drawn in
    # lib/pictogram.js), plus the lesson's words biscuit, candy, toffee, laddu and pebble; SYNC.md §3.20.
    # Proven in tests/quiz/pictograms-lesson-objects.test.js. Content-driven: which object appears depends on
    # the lesson. @wip.

  @e2e @quiz @wip @draft @P1 @T52
  Scenario: An Urdu quiz for a maths lesson full of English terms is made, with the terms in English letters
    Given the NIETE bot chat is open and I planned a maths lesson whose key terms are English, such as comparing unlike fractions
    When I say yes to a quiz for that lesson and choose اردو when asked for the quiz language
    Then the quiz arrives — the teacher PDF and the class link — instead of "I couldn't make a good quiz"
    And its questions and feedback are Urdu sentences that keep the lesson's terms in English letters, such as "numerator" and "common denominator"
    And on the teacher PDF and the class report an English phrase reads in its own order, left to right — a title such as "Comparing & ordering unlike fractions" and the heading's "quiz · forward" — never "ordering unlike & Comparing"
    # templates/latin-runs.js: an English phrase inside Urdu is ONE left-to-right isolate; "&", "·" and spaces
    # between two English words join it (both the teacher PDF and the class report use it).
    # transcript-quiz-validator urduShareByPart: the quiz-level Urdu check counts WORDS, not letters, and takes
    # the questions and the explanations + feedback separately (bar URDU_WORD_SHARE_MIN). Long English terms
    # used to pull a correct Urdu quiz under a letter bar of 0.6 on every attempt. A quiz written in English or
    # Roman Urdu, or with its questions in one language and its feedback in the other, is still refused and
    # re-authored — that cannot be forced live; it is proven in tests/quiz/transcript-quiz-urdu-script-share.test.js.
    # Content-driven: assert that a quiz arrives and its sentences are Urdu, never a fixed question. @wip.

  @e2e @quiz @wip @draft @P2 @T53
  Scenario: In an Urdu quiz, two English terms are never written side by side
    Given the NIETE bot chat is open and I planned a maths lesson whose terms are English, such as proper and improper fractions
    When I say yes to a quiz for that lesson and choose اردو when asked for the quiz language
    Then the quiz arrives, and no question, option or feedback puts two separate English terms next to each other — an Urdu word stands between them, as in «جب numerator کی قیمت denominator سے کم ہو»
    And a two-word English term such as "improper fraction" or "cross multiplication" still reads as one phrase, left to right
    # transcript-quiz-adjacent-terms + validator URDU_ADJACENT_TERMS: two separate English terms side by side are
    # one left-to-right run in a right-to-left line, so a reader meets the second first and the meaning turns
    # around («جب numerator denominator سے چھوٹا ہو»). The author and the targeted rewrite are told never to write
    # it; the validator names it per question as a SOFT fault, repaired in place by one targeted rewrite and shipped
    # whatever that leaves (never a re-roll, a dropped question or a failed quiz). The model's wording cannot be
    # forced live; the behaviour is proven in tests/quiz/transcript-quiz-adjacent-terms.test.js. Content-driven:
    # read every Urdu line of the quiz for two English words side by side that are two different things. @wip.

  @e2e @quiz @wip @draft @P1 @T54
  Scenario: A grade 1-5 maths quiz draws what the lesson drew, on at least three questions
    Given the NIETE bot chat is open and a class quiz was made from a grade 1-3 maths lesson plan that counted with counters
    When a child opens the quiz from its link and answers every question
    Then at least three of its questions arrive with a picture, and never more than half of them
    And the pictures draw the lesson's own objects, such as counters for a lesson that counted counters
    And a question that states its numbers may carry a picture of them, such as two fraction bars beside "which is larger", but no picture ever shows the answer
    And on a grade 4-5 fractions lesson taught as a method, such as cross multiplication, the pictures are questions read off fraction bars — what fraction of the bar is shaded, which bar shows a fraction — never a picture beside a step of the working
    And every fraction on the question cards and on my PDF is printed stacked, number over number, while the WhatsApp text of the question reads it as 2/3
    And a picture that names its parts calls them P, Q, R or 1, 2, 3 — never A, B or C, the letters of the answer buttons — in the picture, the options and the feedback alike, and those names are big enough to read on the phone
    And counters are drawn only where the child can count the answer from them, never beside a product or a common multiple they do not show
    And in an Urdu quiz a child's name from the lesson is written in Urdu script, in the question and in the picture
    And when a question still writes that name in English letters, it comes to me as the same question with the name in Urdu script — in the question, the answers, the explanation, the feedback and my notes — and the bar in its picture says the same name
    And each person from the lesson is written the same way in Urdu script on my page — my notes and the lesson summary included — whichever step of making the quiz wrote them
    And a matching picture names its rows P, Q, R, so its pairings read "P-2", never "A-2" beside the answer letter A
    And a bar named with a child's name keeps that name even when the question writes the name in English letters
    And an improper fraction or a mixed number is drawn as whole bars and a part bar, such as 17/4 as four whole bars and a quarter
    And a question about a part of a set, such as the coloured pencils, shows that part in its own colour or picture
    And an equation in a question, such as 7 × 4 = 28, reads in the order it was written — on the card, on my PDF and in the WhatsApp text — even inside an Urdu sentence, and never with a letter x as the times sign
    # Part names: transcript-quiz-figure relabelLetterParts, run by the validator (P/Q/R/S on bars, number
    # lines, shapes and circuits; 1/2/3/4 otherwise); fraction_bar and circuit font ceilings 2.4 / 2.0.
    # Counters: FIGURE_MISMATCH now covers count_objects. Names: NAMES ARE NOT TERMS in the Urdu style rule;
    # a name in English letters is URDU_NAME_LATIN, a soft in-place fault: one targeted rewrite returns the
    # name's Urdu spelling ("names") and a name-only question is kept as authored with the name swapped in,
    # picture labels included (spellNames); a spelling the quiz has learned is written by every later rewrite
    # (key check, blind solve) too; what still ships is recorded (transcript_quiz.latin_name).
    # A capitalised word the lesson or quiz also writes in lowercase ("Compare") is not a name.
    # People: the digest records each person in the lesson's material once, people [{latin, ur}] (never the
    # teacher, never a pupil called on); the author and every Urdu rewrite get the spellings up front, and the
    # validator writes them into every Urdu field and picture label (transcript-quiz-people). Name events log counts.
    # Match: the vendored engine takes `handleLetters` (SYNC.md 3.21); the quiz lane sets P/Q/R/S and renames
    # A-D in the stem, options and feedback. The label gate reads one name in two scripts as one word.
    # Improper fractions: one over-full bar is redrawn as whole bars + a part bar (expandImproperBar); an
    # over-full bar among several is refused with how to draw it; an unnamed bar in a named set is refused.
    # Equations: quiz-math spanEquations makes an equation written in prose ("7 x 4 = 28") one maths
    # expression — typeset in a left-to-right isolate on the card and PDF, one LRI…PDI in a WhatsApp text.
    # Author prompt: "at least three, never more than half", PLAN THE PICTURES FIRST, the read-off recipes
    # and "PICTURES, AGAIN" at the end, and figure_role "model" (grade 1-5 maths only). A step of a
    # procedure is a text question; a model picture beside one is still refused (FIGURE_MISMATCH).
    # lp-quiz-digest lessonDrewBlock: the slide script's token rows (never the exit options). Too few
    # pictures is a soft complaint (FIGURE_FEW): the add-pictures repair (transcript-quiz-rewrite
    # addPictures) may ADD a picture or REPLACE a question with a read-off one on the same objective; it
    # asks for one spare, runs a second round only when pictures were refused, is validated in full and
    # runs before the blind solve; the quiz ships either way, and transcript_quiz.figure_density logs
    # before/after/asked/rounds/added/replaced/reverted. Two options of the same amount under a bar
    # (2/8 and 1/4) are refused, and so is a bar of more than 24 parts. Stacked fractions: quiz-math
    # stackFractions ($2/3 -> \frac). Content-driven: count the pictures and look at them; never a fixed
    # question. @wip.

  @e2e @quiz @wip @draft @P1 @T29
  Scenario: A quiz never ships an answer key a blind solver disagrees with
    Given the NIETE bot chat is open and I have said yes to a quiz for a lesson I taught or planned
    When the quiz arrives
    Then every question on my PDF has exactly one answer marked correct, and that answer is right
    And no question offers two options that are both right, such as the same letters in a different order
    And the class report built on that quiz teaches the right answer back to me
    But when too few questions survive that check, I am told the quiz was held back because some answers were wrong or unclear, and nothing is sent to the class
    # transcript-quiz-generate runKeyVerify + transcript-quiz-key-verify.service: every lesson quiz (from a
    # coaching recording or a lesson plan, after the lp_v8 key check) is answered once by a solver that is not
    # shown the keys. A disagreement, a second right answer or no right answer is rewritten once, else dropped
    # (floor 6), else the quiz fails as key_disagreement (tqFailedKeyDisagreement / tqFailedLpKeyDisagreement).
    # A solver that itself fails ships the quiz as authored (fail-open). @wip — a wrong key cannot be forced
    # live on demand; the behaviour is proven in tests/quiz/transcript-quiz-key-verify.test.js.

  @e2e @quiz @wip @draft @P1 @T80
  Scenario: A quiz never keys a mistake made in class as the right answer
    Given the NIETE bot chat is open and I taught a lesson in which something was said that is not true by the subject, such as calling 4/8 not a proper fraction
    When I say yes to the quiz for that lesson and it arrives
    Then no question marks that mistake as the right answer, and every answer marked correct is right by the subject
    And no explanation gives "the teacher said so" as the reason, or says a fact holds "but in class" it was not accepted
    And a question that tested the mistake is asked about the correct fact instead, or left out
    # transcript-quiz-key-authority (validator KEY_BY_AUTHORITY: an explanation that concedes the fact and
    # sides with the class, repaired by the targeted rewrite with KEY_BY_AUTHORITY_RULE, else dropped);
    # transcript-quiz-contract (THE ANSWER IS TRUE BY THE SUBJECT, for the author and the rewrite); runKeyVerify
    # solves every item a second time without the lesson (key_verify_bare: no summary, no objectives), where no
    # right answer or two count at once and another answer only after a second look in another option order.
    # @wip — a class's mistake cannot be recorded on demand; proven in tests/quiz/transcript-quiz-key-truth.test.js.

  @e2e @quiz @wip @draft @config-gated @P1 @T81
  Scenario: The quiz sheet never presents a mistake made in class as what was taught
    Given the NIETE bot chat is open and I taught a lesson in which something was said that is not true by the subject, such as calling 4/8 not a proper fraction
    When I say yes to the quiz for that lesson and its PDF arrives
    Then the "What you taught" line, the "What this quiz checks" line and every question's objective describe the lesson without repeating that mistake as a fact
    And the sheet never says that I or the class got something wrong, and carries no correction note
    And with QUIZ_SUMMARY_TRUTH_FILTER=off the sheet is written exactly as before this change
    # Option B (operator, 24 Sep). transcript-quiz-summary-truth: after the blind solve, one call on the verify
    # model with nothing about the lesson checks every line the sheet prints (the one-liner, each summary sentence,
    # the checks line, each objective in both languages), with the blind solve's notes on the keys it disagreed
    # with as hints; a false line is replaced by a rewrite that code accepts (same script, similar length, no blame
    # word, no gendered teacher form) or dropped; a summary is never left empty (one-liner, then a topic-only line).
    # The digest, author and summary-rewrite prompts carry the same rule. Fail-open; recorded on meta.summary_truth
    # (counts only in the event). Kill switch QUIZ_SUMMARY_TRUTH_FILTER (read per job; off = every prompt and the sheet
    # as before). @wip — a class's mistake cannot be recorded on demand; proven in
    # tests/quiz/transcript-quiz-summary-truth.test.js.

  @e2e @quiz @wip @draft @P1 @T82
  Scenario: A quiz made from my recording never names or asks about a child in my class
    Given the NIETE bot chat is open and I recorded a lesson in which I called on children by name and used their names in example sentences
    When I say yes to the quiz for that lesson and it arrives
    Then no question, option, explanation or feedback names a child from my class
    And no question asks what a child said, answered or did in class
    And no option says anything about a named child's behaviour
    And a question that did any of these is written again about the lesson's idea, or left out — it is never sent to the class
    And a story or word-problem character the lesson itself uses, and a person from history, can still be named
    # transcript-quiz-pupils: the transcript digest keeps the lesson's characters in `people` and records the
    # children the recording names as one-way hashes only (`pupil_tokens`), scrubbing the names from the digest
    # and from the transcript excerpts the author reads; the author, the targeted rewrite and the picture repair
    # get PUPILS_RULE. The validator's PEDAGOGY_PUPIL_AS_SUBJECT (hard fault): a recorded child in a child-facing
    # field; a named person's meaning / answer / sentence / example, a named person's words with a class marker,
    # or the teacher asking a named person; a negative claim about a named person. A title or an honorific marks
    # a public figure. One targeted rewrite (PUPIL_REPAIR), else the salvage drops the question. The complaint and
    # the logs never carry a name. @wip — a named child cannot be recorded on demand; proven in
    # tests/quiz/transcript-quiz-pupils.test.js.

  @e2e @quiz @wip @draft @P2 @T83
  Scenario: A lesson quiz never asks the class the same question twice
    Given the NIETE bot chat is open and I have said yes to a quiz for a lesson I taught or planned
    When the quiz arrives
    Then no two questions on my PDF ask the same thing and have the same answer, even with the options in another order
    And a question shown over a picture and the same question shown as text count as the same question
    And a fill-in-the-blank and a question on the same fact count as the same question, even when one answer ends in «سے» and the other does not
    And two questions that ask the same fact in other words, with the same answer, are caught by the solver that checks the answers and one of them is replaced
    And two questions that only look alike — the same question about another number, another word or another picture, or with another answer — both stay in the quiz
    And the quiz still arrives with all its questions when a repeated one could not be replaced
    # The model that writes the quiz, the targeted rewrite and the add-pictures repair are each told the
    # rule (transcript-quiz-contract DISTINCT_QUESTIONS_RULE): no two questions with the same answer on the
    # same fact; a question shape comes back only with different numbers or a different item.
    # transcript-quiz-duplicates, run once over the whole quiz by the validator: a LATER question with the
    # same answer, not two different pictures, the same numbers and quoted items, and a near-identical stem
    # is named DUPLICATE_QUESTION. transcript-quiz-generate replaces it with one targeted rewrite
    # (IN_PLACE_FAULT); a rewrite that does not take ships the quiz with the repeat recorded in
    # meta.soft_faults (SOFT_FAULT) — never a refusal, never a dropped question.
    # An Urdu answer is compared with and without a trailing postposition (never when the question is about
    # the postposition); a sentence with a blank (underscores, or the word «ڈیش») is compared with a question
    # by filling the blank with its answer and comparing content words. The blind solve
    # (transcript-quiz-key-verify) is also asked, in its one full call, which questions test the same fact
    # with the same answer ("same_fact"); a pair that also passes the contract in code (confirmsSameFact:
    # the same answer, the same numbers and quoted items) has its later question rewritten by the rewrite
    # the blind solve already makes, else ships recorded; any other pair is only logged. Counted on
    # transcript_quiz.duplicate_question: stage "author" for each author attempt that wrote one, stage
    # "solver" for the pairs the blind solve named (confirmed / unconfirmed), stage "shipped" when the
    # stored quiz still carries a word-for-word one, whichever step wrote it. Content-driven: read every
    # question on the PDF and compare them; never a fixed quiz. @wip — a repeat cannot be forced live on
    # demand; the behaviour is proven in tests/quiz/transcript-quiz-duplicate-questions.test.js and
    # tests/quiz/transcript-quiz-distinct-questions-rule.test.js and
    # tests/quiz/transcript-quiz-duplicates-blank-and-postposition.test.js and
    # tests/quiz/transcript-quiz-same-fact.test.js.

  @e2e @quiz @wip @draft @P2 @T84
  Scenario: A quiz with many questions to fix gets the worst ones fixed first, not none
    Given the NIETE bot chat is open and the quiz for my lesson came back with more than five questions that need a fix, such as verbs that speak to the child as a boy or a girl
    When the quiz arrives
    Then no question speaks to the child as a boy or a girl, and no English terms sit side by side
    And a question whose answer was defended by the class against the fact is fixed before any of those
    And a picture question added after the quiz was written reads the same way — no English terms side by side, no gendered verb
    And a lesson that can be drawn gets its pictures even when the first draft's words also needed fixing
    # transcript-quiz-generate runFinalSoftRepair: a question written after the author's loop (the picture step, a
    # key rewrite) gets one in-place repair call before the rows are stored, text only (picture, key, options' order
    # kept), and the set is kept as it was when that does not work. Order: the first attempt's picture retry
    # (FIGURE_REQUIRED) runs before any in-place repair of its words, then the picture step, then the last repair.
    # transcript-quiz-rewrite rewriteTargets `partial`: more than five faulted questions → the worst five by harm
    # (KEY_* > PEDAGOGY_GENDERED_CHILD > URDU_ADJACENT_TERMS > URDU_NAME_LATIN > the rest), the merged set
    # validated again, ONE second batch for what is left (REPAIR_BATCHES = 2), the questions the first left out
    # first. More than five questions that need re-asking is still a re-roll on an early attempt. @wip — the
    # author's faults cannot be forced on demand; proven in tests/quiz/transcript-quiz-rewrite-overflow.test.js.

  @e2e @quiz @wip @draft @P2 @T55
  Scenario: A column subtraction reaches the child set out the way the textbook prints it
    Given the NIETE bot chat is open and a class quiz was made from a grade 3 maths lesson on column subtraction
    When a child opens the quiz from its link and reaches a column subtraction
    Then the question arrives as a picture card with the numbers written one under the other, places lined up, the minus sign on the left and a line under them
    And after answering, every text about that question writes it on one line like "452 − 137 = ?", never with "$", "array" or a backslash
    And the teacher's quiz PDF shows the same column subtraction set out the same way
    # quiz-math: the author writes the sum as ONE KaTeX array (transcript-quiz-contract COLUMN_SUM_RULE);
    # the card and the PDF typeset it (.qm-col, its own centred line); mathToText / mathForChat flatten it
    # (columnSumText) for every WhatsApp text; MATH_TEX accepts the environment and names an array whose
    # rows ran together. Content-driven: assert the SHAPE, never a fixed sum. @wip.

  # ── a child reads the quiz's language from the link to the invite ──────────────────────
  # A child who opens a class quiz link meets the join screen (name + class) and, after the
  # quiz, can pass it to a friend. An Urdu quiz used to meet the child in English at both
  # ends. Needs an Urdu class quiz link and a phone that has never joined a class quiz (a
  # fresh driver number). @wip until driven.

  @e2e @quiz @flow @copy @wip @draft @P2 @T56
  Scenario: A child opening an Urdu quiz link is asked for name and class in Urdu
    Given an Urdu class quiz link from a teacher, and a phone that has never joined a class quiz
    When the child sends the link's "QUIZ-<code>" text
    Then the greeting names the teacher and the topic in Urdu, and its button reads "شروع کریں"
    When the child taps "شروع کریں"
    Then the screen's title, heading, both field labels, both hints and its button are in Urdu, with no English word on it but "quiz"
    When the child fills in a name and a class and taps the button
    Then the quiz begins, in Urdu
    # video-quiz-share beginFromCode: STUDENT_JOIN_LOCALIZED_FLOW_ID opens docs/flows/student-join-flow-v2.json,
    # every word supplied as screen data from the vqJoin* catalog strings; flow_cta = vqJoinFlowButton. With only
    # the legacy STUDENT_JOIN_FLOW_ID set, only an English child gets that (English) screen and an Urdu child is
    # asked in Urdu chat — proven in bot/tests/quiz/student-join-language.test.js. @wip.

  @e2e @quiz @copy @wip @draft @P2 @T57
  Scenario: After an Urdu quiz, the message a child forwards to a friend is in Urdu
    Given a child has just finished an Urdu class quiz opened from its link
    When the child taps "دوست کو بھیجیں"
    Then the next message tells them in Urdu to forward the one after it
    And the message after it invites the friend in Urdu, names the child by first name only, names the topic, and carries a "QUIZ-<code>" link
    And the offer to watch more videos follows it
    # video-quiz-invite handleInviteButton: vqInviteForwardThis + vqInviteMessage in the quiz language
    # (the invite's own language, else its share code's). @wip.

  @e2e @quiz @copy @wip @draft @P2 @T58
  Scenario: A child who passed an Urdu quiz to a friend hears how the friend did, in Urdu
    Given a child sent an Urdu class quiz to a friend and has finished it themselves
    When the friend finishes the same quiz
    Then the first child is told in Urdu that the friend finished, with the friend's first name only
    And both scores are shown as "<out of> میں سے <score>", and the closing line never frames it as a loss
    # video-quiz.service finish() -> video-quiz-invite notifyInviter(session, state.language) ->
    # buildComparison: vqCompareMessage + vqCompareBehind/Ahead/Tie in the quiz language (quiz_sessions
    # carries no language; the session state does). English copy is byte-identical. @wip.

  @e2e @quiz @copy @wip @draft @P2 @T59
  Scenario: A video quiz sent to the class from an Urdu run forwards an Urdu message
    Given I have just taken a video quiz in Urdu on my own
    When I tap "کلاس کو بھیجیں" on the offer to send it to my class
    Then I am told in Urdu to forward the next message to the class group
    And the message to forward is in Urdu, names the teacher and the topic, and carries a "QUIZ-<code>" link
    And a last message in Urdu says when the class report will arrive
    # video-quiz-share offerShare / handleShareButton / deliverClassLink: vqShareOffer, vqShareYes/No,
    # vqShareForwardThis, vqClassMessage, vqShareReportPromise, vqShareDeclined, vqShareLinkFailed in
    # the run's language. English copy is byte-identical. @wip.

  @e2e @quiz @copy @wip @draft @P2 @T60
  Scenario: A video quiz offered in Urdu answers every tap in Urdu, even after the offer or the quiz has ended
    Given I picked a video from the library and was offered its quiz in Urdu
    When I tap "ابھی نہیں" on the offer
    Then I am told in Urdu to enjoy the video
    When I tap the offer again after it has lapsed
    Then I am told in Urdu that the offer has ended and to pick the video again
    And when I tap an answer on a quiz that has already finished, I am told in Urdu to pick another video
    # video-quiz.service handleOfferButton / startSession / handleAnswer: vqOfferDeclined, vqOfferExpired,
    # vqStartFailed, vqQuizFinished in the run's language. The two taps after the run's state is gone read the
    # phone's last run language (videoquiz:<phone>:lang, a week), written by sendOffer and startSession — a child
    # from a class link never saw an offer, so startSession writes it too. English copy is byte-identical. @wip.

  @e2e @quiz @copy @wip @draft @P2 @T61
  Scenario: The reminder about a quiet quiz reads naturally and keeps each quiz title whole
    Given my language is English and I sent two class quizzes today whose titles are in Urdu
    And almost no child has started either of them
    When the quiet-quiz reminder arrives
    Then it names both quizzes, each title in bold and whole, separated by an English comma
    And a reminder about a single quiz says "No one has started", "One student has started" or "<n> students have started" — never "student(s)"
    # transcript-quiz-nudge process(): tqNudgeNone / tqNudgeOne / tqNudge by count; each title bold and
    # first-strong isolated (titled()), joined with the teacher language's list comma (vqLetterSep).
    # Proven in tests/quiz/transcript-quiz-nudge-copy.test.js. @wip.

  @e2e @quiz @copy @wip @draft @P3 @T62
  Scenario: The quiz caption names the lesson once, with a bracket only when the bracket says something new
    Given my language is English and I asked for an Urdu quiz on a lesson named "Comparing & ordering unlike fractions"
    When the quiz PDF arrives
    Then its caption names the lesson once, with no bracketed copy of the same name
    And the same holds when the two names differ only by a plural, such as "Proper Fraction" and "Proper Fractions"
    But for an Urdu lesson name, the caption still carries its English meaning in brackets
    # transcript-quiz-language lessonLabel(): the gloss shows only when it adds information — a translation or a
    # genuinely different name; sameTopic() treats "&"/"and"/"اور", punctuation, spacing, case and an English
    # word's plural (-s/-es/-ies + common irregulars) as the same.
    # Proven in tests/quiz/transcript-quiz-language.test.js + transcript-quiz-teacher-language.test.js. @wip.

  # ══════════════════ ASSESSMENT GENERATOR — the paper she asks for ══════════════════
  # The generator is mapped to this feature (feature-map.yaml: training) because it sits
  # with the exam/quiz surfaces, but it had no scenarios until bd-60175. It is its own
  # native Flow. The teacher's words are Seen (from the book) and Unseen (outside the book):
  #   Seen   → QUESTIONS → SEEN_COUNT → CONFIRM
  #   Unseen → QUESTIONS → TYPES → COUNTS → CONFIRM
  #   Both   → QUESTIONS → SEEN_COUNT → TYPES → COUNTS → CONFIRM

  @e2e @flow @P1 @T30
  Scenario: For Unseen questions she sets how many of EACH type, not one total we split for her
    Given the NIETE bot chat is open and I have opened the assessment generator
    And I have chosen a class, a subject and the pages to cover
    When I choose "Unseen (outside the book)" and continue
    Then the next screen's heading says it is about Unseen questions
    When I tick "MCQs" and "Brief Answers" and continue
    Then I get one box per type I ticked, each labelled with that type's name
    When I ask for 10 MCQs and 2 Brief Answers
    Then the recap says "10 MCQs, 2 Brief Answers" and 12 in total, not 6 and 6
    # bd-60175. It used to ask for ONE total on the previous screen and spread it evenly over
    # the kinds ticked, so 10-and-2 came back 6-and-6. The count boxes are a fixed bank of 8
    # slots labelled and hidden by the server (a Flow cannot grow a component at runtime), so
    # assert one box PER TICKED KIND — never a fixed number of boxes.

  @e2e @flow @negative @P2 @T31
  Scenario Outline: A count she cannot have is refused on the screen, naming the type
    Given the NIETE bot chat is open and I have reached the Unseen "how many of each" screen with "MCQs" ticked
    When I put <value> against MCQs and continue
    Then I stay on that screen and the reason appears in red under the MCQs box, naming MCQs
    And the same reason is shown just above Continue
    # Refused, never clamped — quietly turning 60 into 50 hands her a paper she did not ask
    # for and never says so. The ceiling is checked on the SUM too: several kinds that are
    # each allowed can still add up to a paper the generator pads its way through.
    Examples:
      | value     |
      | nothing   |
      | "0"       |
      | "abc"     |
      | "60"      |

  @e2e @flow @P2 @T32
  Scenario: Seen questions ask one thing — how many Seen
    Given the NIETE bot chat is open and I have opened the assessment generator
    And I have chosen a class, a subject and the pages to cover
    When I choose "Seen (from the book)" and continue
    Then I am asked one thing, on a screen headed Seen — how many — with no type-picking
    When I ask for 12
    Then the recap says Seen and 12 questions
    # The book's own exercises carry their own kinds, so a choice of kinds there is a question
    # whose answer cannot be used — planCounts() discards types on the seen path. This is the
    # one path where a single total is still the right thing to ask for, and it is asked on
    # the same "how many" screen as the per-kind counts: when the total box first came off
    # QUESTIONS, the seen path was left demanding a number it had no box for.

  @e2e @flow @P1 @T33
  Scenario: Both asks the Seen number first, on its own screen, then the Unseen types and counts
    Given the NIETE bot chat is open and I have opened the assessment generator
    And I have chosen a class, a subject and the pages to cover
    When I choose "Both Seen and Unseen" and continue
    Then I am asked how many Seen questions, on a screen of its own
    When I ask for 5 Seen
    Then I am asked which Unseen types I want
    When I tick "MCQs" and "Brief Answers" and ask for 10 and 2
    Then the recap says Seen 5, Unseen "10 MCQs, 2 Brief Answers", and 17 in total
    # "Both" used to take per-type counts and then HALVE the total for Seen and re-spread the
    # types over the rest, so 10-and-2 came back as 3-and-3. The Seen number now travels on
    # its own, and her Unseen counts reach the model untouched. Kept on two screens on purpose
    # (operator: "I would rather it be clear"). The 50 ceiling counts Seen AND Unseen together.

  @e2e @flow @negative @P1 @T34
  Scenario: Going over 50 in total tells her why, where she can see it
    Given the NIETE bot chat is open and I have chosen "Both Seen and Unseen" and asked for 30 Seen
    And I have ticked "MCQs" and "Brief Answers"
    When I ask for 15 MCQs and 10 Brief Answers and continue
    Then I stay on the Unseen screen and just above Continue it says the paper would be 55 questions (30 Seen + 25 Unseen) and the most is 50
    # Operator, 23 Sep: "when you hit the limit, no error is displayed to the user so they can't
    # even tell what is happening" — the logs showed Continue tapped twice a second apart. The
    # reason used to sit at the TOP of the screen; it now sits under the offending box (a single
    # bad box) or above Continue (a total over 50, which belongs to no one box).

  # ─────────── app redirect (bd-onxyu) — Teacher Training moved to the NIETE app ───────────
  # One switch per feature (app_redirect_<feature>), off by default, so none of this is visible
  # until an operator turns Teacher Training's switch on. The quiet hour is per teacher and shared
  # by every switch. Unit: tests/app-redirect/ (service + every door, red-first).

  @e2e @config-gated @P1 @T92
  Scenario: With Teacher Training moved to the app, /training sends me to the Play Store instead
    Given the NIETE bot chat is open
    And Teacher Training has been switched to the NIETE app
    When I send "/training"
    Then I get one message telling me to use the NIETE app, with the NIETE Play Store link
    And no training Flow opens

  @e2e @config-gated @P1 @T93
  Scenario: Asking again within the hour gets no reply at all
    Given the NIETE bot chat is open
    And Teacher Training has been switched to the NIETE app
    And the bot sent me to the Play Store less than an hour ago
    When I send "/training"
    Then the bot does not reply
    # After the hour the next request gets the Play Store message again.

  # ─────────── fewer bubbles, same words (bd-w2daa.7 — the Meta bill cut, 1 Oct 2026) ───────────
  # Meta bills every message from 1 Oct 2026; a reaction is free. Each scenario below sends fewer
  # bubbles and loses no word, and keeps its order. Unit: tests/quiz/child-quiz-fewer-bubbles.test.js,
  # child-refusals-once-a-day.test.js, teacher-quiz-handoff-fewer-bubbles.test.js (red-first).

  @e2e @quiz @wip @draft @P1 @T94
  Scenario: A child's answer gets a ✅ or ❌ on the tap, and the verdict rides on the next question when that one starts with words
    Given a child has opened a class quiz from its link and a question with text answers is waiting
    When the child taps the right answer
    Then a ✅ appears on the child's own tap at once
    And the next message starts "✅ Correct! The answer is …", then "Question 2 of 8", then the question and its buttons — one message
    When the child taps a wrong answer
    Then a ❌ appears on the tap, and the next message starts with "❌ Not quite — the answer is …" and "Keep going, mistakes help you learn!" above the question
    But when the next question is a picture card, the verdict still comes as its own message first, then the card
    And the verdict on the last question still comes on its own, before the score card
    # video-quiz.service handleAnswer -> sendNextQuestion({ lead }) -> video-quiz-lead foldLead: only a
    # text-only verdict (no explanation picture or clip), only into a first bubble with nothing drawn above its
    # body (buttons with no image header, a list, the listen line), only within Meta's 1,024 cap. A verdict
    # under the next question's PICTURE is operator decision D1, not built. @wip.

  @e2e @quiz @wip @draft @P2 @T95
  Scenario: A double tap does not bring the same question twice
    Given a child has answered a question and the next one has arrived
    When the child taps the old answer again a few seconds later
    Then nothing new arrives, and the question on screen is still the one to answer
    But when the child taps it again long after (more than two minutes), the waiting question is sent again
    # video-quiz.service reconcileFromAnswers: a 23505 duplicate whose next question is the one already sent
    # (currentQuestionId, set only after its picker went out) within RESEND_WINDOW_MS sends nothing. @wip.

  @e2e @quiz @wip @draft @P1 @T96
  Scenario: A class quiz opens in one message when its first question starts with words
    Given a child the bot already knows taps a class quiz link
    When the quiz starts
    Then one message carries the greeting naming the teacher and the topic, "Good to see you again", "Here we go — 8 questions. Take your time!", "Question 1 of 8" and the first question with its buttons
    But when the first question is a picture card, the greeting and "Here we go" are one message, then the card
    And when the lesson video goes first, the greeting and "First, here is the lesson" are one message before the video, and "Here we go" rides on question 1
    And a child picking a video from the video library gets "First, here is the lesson" before it, and no "Sending your video" line
    # video-quiz-share passes the greeting / "let's begin" to startSession as its lead; sendLessonFirst sends
    # it with the lesson note; the opener rides on question 1 through the same foldLead. student-videos-endpoint
    # sendPreDeliveryAck skips a child's video that has a quiz (the Flow's SUCCESS screen says it is on its way). @wip.

  @e2e @quiz @wip @draft @P1 @T97
  Scenario: The score card is the picture on the "invite a friend" message
    Given a child is answering the last question of a class quiz
    When the child answers it
    Then the verdict arrives, then ONE message: the score card picture, "All done! You got … right", and "Want to send this quiz to a friend?" with "Invite a friend" and "No thanks"
    But when the teacher's class report is already out, the score card, the class card and the invite come as before, in that order
    # video-quiz.service finish -> scorecardForInvite -> video-quiz-invite offerInvite({ scorecard }) ->
    # WhatsAppService.sendImageBufferWithButtons; any failure sends the score card and the invite separately,
    # and the score card is never lost. Watch-more after the invite is unchanged (operator decision D2). @wip.

  @e2e @quiz @wip @draft @P2 @T98
  Scenario: A child who keeps sending voice notes hears the "please type" line once a day
    Given a child the bot knows as a student
    When the child sends a voice note
    Then the bot says it can only read typed messages
    When the child sends another voice note the same day
    Then a ✍️ appears on that voice note and no message is sent
    And a sticker gets no reply at all
    # student-ingress refuse(): each refusal line once per handset per 24 h (Redis set-if-absent); a repeat gets
    # a free reaction, and the line is said again whenever the reaction cannot be sent. @wip.

  @e2e @quiz @wip @draft @P2 @T99
  Scenario: "Not now" on the quiz offer is answered with a 👌
    Given the NIETE bot chat is open and I have been offered a quiz after a coaching session
    When I tap "Not now"
    Then a 👌 appears on my tap and no message is sent
    And the 👌 still appears when several messages have just reached me (it is never skipped for pacing)
    And the chat header does not show "typing…" before the 👌
    # ADDED 2026-10-02 (FX4, bd-w2daa.26): a reaction that is the only answer is sent as a sole ack.
    # FX1 (bd-w2daa.22): 👌, not 👍 — the webhook's automatic 👍 on every message would answer nothing.
    # transcript-quiz-offer handleOfferButton: the offer already ends "You can make one for any lesson
    # anytime by sending /quiz"; tqDeclined is sent only when the reaction cannot be. @wip.
    # UPDATED 2026-10-02 (FX7, bd-w2daa.31): handleOfferButton settles the turn as soon as it has found a live
    # offer, before the decline write (an expired offer still says so, in text). Unit: fx7-reaction-only-taps.test.js.

  # ─────────────────────── The web child quiz: the bot API (ADDED 2026-10-05) ───────────────────────
  # Children play the class quiz on a web page; the portal forwards to the bot's /api/internal/wq/*
  # (x-api-key). These scenarios are the API contract the page relies on; @no-mock-driver until the
  # page is live on sandbox. Unit: bot/tests/quiz/web-quiz/*.test.js (fake Supabase, real scoring,
  # real one-attempt and self-test rules, real report scheduler).

  @api @quiz @web @wip @draft @P1 @T100 @no-mock-driver
  Scenario: A returning child plays the class quiz on the web and the teacher's report is scheduled
    Given a teacher's class code whose children have played before
    When the page asks for the quiz by its code
    Then it gets the questions with their options, the right option, the "why", and picture links
    And it gets one name button per child of that teacher (first name and an animal), never a phone or a full name
    When the child taps their name and the page starts a session
    Then a share-link session is stored with no phone and a per-browser device reference
    And the code's use count goes up by one
    And the teacher's 12-hour class report is scheduled exactly as when a child joins in WhatsApp, once per code
    And no WhatsApp message is sent to anyone
    # web-quiz.service startSession -> increment_share_code_uses + video-quiz-report scheduleForShareCode. @wip.

  @api @quiz @web @wip @draft @P1 @T101 @no-mock-driver
  Scenario: A new child types their name, answers offline, and finishes with a score card
    Given a class code
    When a new child types a first name that matches a child already in the class
    Then the page is asked "is this you?" with that child's name button
    When the child says they are a different child
    Then a new student is stored with no phone, filed under the teacher
    When the page sends the answers in one batch, and then sends the same batch again
    Then each answer is stored once and the second batch is reported as already recorded
    When the page finishes the quiz
    Then the score is "N out of M" from the stored answers, with one star per right answer
    And the review lists each question, the child's pick, the right option and why
    And the child gets a challenge code to send a friend, the same code every time they finish
    But a child who answered fewer than half the questions is told the quiz is not finished
    # web-quiz.service recordAnswers (unique session+question) and finishSession (today's floors). @wip.

  @api @quiz @web @wip @draft @P1 @T106 @no-mock-driver
  Scenario: A child remembered on a phone plays the same teacher's next quiz in one tap
    Given a child finished one of the teacher's quiz links on this phone
    And the teacher sends a new quiz with a new code
    When the child taps "Play as" their name on the new quiz's page
    Then a session starts for the same child, with no phone and no name typed
    And the page is given the child's name button for the new code
    But a name button from a child the teacher never had is still unknown
    # web-quiz.service classChips accepts the chip minted on any of the child's earlier codes of this teacher. @wip.

  @api @quiz @web @wip @draft @P1 @T102 @no-mock-driver
  Scenario: The first finished attempt counts; a replay on another phone is practice
    Given a child who has finished the class quiz once
    When the same child starts it again on another phone
    Then the page is told the run will not count because it was finished elsewhere
    And on the same phone the page is told it was already finished
    And the class league table and the teacher's report keep the first finished score for a web quiz
    # one-attempt-per-child rule 'first_completed', chosen by quizzes.meta.web_arm = 'web'. @wip.

  @api @quiz @web @wip @draft @P1 @T103 @no-mock-driver
  Scenario: The class league table
    Given several children have finished, two with the same score, and the teacher has tried their own link
    When the page asks for the league table with the child's session
    Then children are ranked by score, tied children share a place, first names only
    And only the top 7 are listed, then how many more finished
    And the class average is shown, and the child's own place and score
    And the teacher's own run and friends who came through a challenge code are not in the table
    # web-quiz.service board -> video-quiz-report loadClassRows (self-tests and invited friends out). @wip.

  @api @quiz @web @wip @draft @P2 @T104 @no-mock-driver
  Scenario: The teacher's preview never counts as a child
    Given the teacher's signed preview link
    When the teacher plays it
    Then the run is stored as the teacher's own test run and is never in the roster, the average or the league table
    And a preview link signed for another teacher is refused
    # p token -> quiz_sessions.user_id = teacher (the self-test marker). @wip.

  @api @quiz @web @wip @draft @P2 @T105 @no-mock-driver
  Scenario: The web quiz API is closed without its key or secret, and an old code is friendly
    Given the bot has no internal key
    Then every web quiz call is refused
    And a call without the right key is refused
    And an expired or switched-off code answers "expired" with the quiz language, so the page can say "ask your teacher"
    # requireInternalKey; web-quiz-token fails closed with no secret (503 web_quiz_off). @wip.

  @api @quiz @web @wip @draft @P1 @T107 @no-mock-driver
  Scenario: The quiz page names the teacher and the class the way the teacher's own texts do
    Given a teacher whose stored name carries a title, and children who finished the quiz typed their class
    When the quiz is fetched for the page
    Then the teacher is named exactly as the forwarded class message names them ("Teacher <name>", in the quiz language)
    And the class is the heading the teacher's report uses for this code
    But before anyone has finished the class is empty, never a guess
    # ADDED 2026-10-05: web-quiz.service getQuiz -> quiz-teacher-label teacherLabel + report loadClassRows().className. @wip.

  @api @quiz @web @wip @draft @P1 @T108 @no-mock-driver
  Scenario: A web quiz's report counts each child's first finish
    Given a quiz whose children play on the web page
    When the first child starts a web session
    Then the quiz is marked as a web quiz, and nothing else about it changes
    And the teacher's report then counts each child's first finished score, as the class league table does
    But the teacher's own preview does not mark the quiz
    # ADDED 2026-10-05: web-quiz.service startSession -> markWebArm (quizzes.meta.web_arm = 'web'); attemptRuleFor reads it. @wip.

  @api @quiz @web @wip @draft @P1 @T109 @no-mock-driver
  Scenario: The quiz page lists the options in the one order every other surface uses
    Given a quiz question whose options carry a stored display order
    When the quiz is fetched for the page
    Then the options come in that display order, the order the WhatsApp quiz and the teacher's answer key use
    And each option keeps its own letter, so the right answer, the feedback and the pictures stay with it
    # ADDED 2026-10-05: web-quiz.service questionPayload -> inDisplayOrder (video-quiz-render displayOrder). @wip.

  @api @quiz @web @wip @draft @P1 @T145 @no-mock-driver
  Scenario: The quiz page shows the lesson video when the video bank's rows name another bucket of ours
    Given a video-bank quiz whose lesson video row names a different bucket on our own R2 endpoint
    And the same video key exists in this deployment's bucket
    When the quiz is fetched for the page
    Then the page gets a signed link to this deployment's copy of the video, so the lesson video shows before question 1
    But when that key is missing from this deployment's bucket, or the row names a host that is not ours, there is no video and the quiz starts at question 1
    # ADDED 2026-10-05: web-quiz-media presignVideo -> videoKey (path after the bucket segment, HEAD in our bucket). @wip.

  @api @quiz @web @wip @draft @P1 @T195 @no-mock-driver
  Scenario: The things a child counts or matches on my web quiz are colour pictures
    Given my quiz asks "How many apples are in the picture?" with a drawing of 12 apples
    When a child plays it on the web page
    Then the apples are drawn as colour pictures a child can count on a small phone
    And the same question sent on WhatsApp keeps the picture it has today
    And a row the question coloured on purpose ("the red row and the blue row") keeps its colour
    # web-quiz-figure draw() withColour -> vendor pictogram withPainter + pictures/color_glyphs.json (Fluent Emoji Flat, MIT). Unit: bot/tests/quiz/web-quiz/web-quiz-pictures.test.js. @wip.

  @api @quiz @web @wip @draft @P1 @T196 @no-mock-driver
  Scenario: A picture question whose options are emoji shows big picture tiles on my web quiz
    Given my quiz asks "Look at the pictures. Which one is a LEAF?" with the options 🌸 🍃 🌰 🥕
    When a child plays it on the web page, in English or in Urdu
    Then each option is a large colour picture tile, with no word under it that gives the answer away
    And options that are signs such as "=", "<" and ">" stay as they are
    # web-quiz.service questionPayload (pictures.emojiNoun -> pic {kind:pictogram, unnamed}). Unit: bot/tests/quiz/web-quiz/web-quiz-pictures.test.js. @wip.

  @api @quiz @web @wip @draft @P1 @T197 @no-mock-driver
  Scenario: A question with picture options does not show the options twice on my web quiz
    Given my video quiz has a question whose two options are pictures
    And on WhatsApp the child also gets one collage of both pictures with their words written in
    When a child plays it on the web page
    Then the child sees the two picture options once, as the answer tiles, and no collage above them
    And a question that has its own picture to compare with ("Which picture goes with this one?") still shows that picture
    # web-quiz.service questionImageOf (grid never the question picture when option_images exist). Unit: bot/tests/quiz/web-quiz/web-quiz-pictures.test.js. @wip.

  @api @quiz @web @wip @draft @P2 @T198 @no-mock-driver
  Scenario: Pictures on my web quiz are big enough on a small phone
    Given my quiz has a one-bar fraction picture and a picture question with three options
    When a child plays it on a phone 360 pixels wide
    Then the fraction bar is drawn tall enough to count its parts
    And the third picture option sits in the middle of its row, with no empty space beside it
    And the button that makes a picture bigger is a small icon at the side of the picture, never covering it
    # web-quiz-figure forPage (fraction_bar barHeight); wq.js figureHtml zoom icon, wq.css .wq-pgrid odd tile. Unit: web-quiz-pictures.test.js, dashboard/tests/web-quiz-page-pictures.service.test.js. @wip.

  @api @quiz @web @wip @draft @P1 @T200 @no-mock-driver
  Scenario: A child on the web quiz never sees a question picture that contradicts or ignores the answer
    Given a quiz question whose picture was reviewed against its question and answer and judged to contradict it or to show nothing the question asks about
    When a child plays the quiz on the web page
    Then the question is shown without that picture, on its text alone
    And a question that tells the child to look at the picture is left out of the web quiz instead
    And a picture that was reviewed and found fine, or never reviewed, is shown as before
    And the WhatsApp quiz is unchanged
    # web-quiz-figure pictureHidden (media.picture_check.verdict contradicts|ignores); web-quiz.service questionImageOf + figureFor + playable + media(). Unit: bot/tests/quiz/web-quiz/web-quiz-picture-check.test.js. @wip.

  @api @quiz @web @wip @draft @P1 @T170 @no-mock-driver
  Scenario: The recorded "why" of a web quiz question is its reason, never praise
    Given a quiz question whose correct-answer feedback is only "Well done!" and whose explanation gives the reason
    When the read-aloud clips are published
    Then the "why" clip says the explanation, and no clip says "Well done!" or «شاباش!»
    And praise in front of a reason is cut off and the reason is kept
    And a web item's own why is voiced, not its praise line
    # ADDED 2026-10-05: web-quiz-publish.service whyText/withoutPraise; the page plays the why clip after a wrong answer too. @wip.

  @e2e @quiz @wip @draft @config-gated @P1 @T100
  Scenario: With the web quiz switched on for me, the message I forward opens the quiz page instead of a WhatsApp chat
    Given the web quiz is switched on and I am one of the teachers it is on for
    When I make a class quiz for one of my lessons and receive the message to forward to my class
    Then the message is word for word the one I would get today, except that its link opens the quiz page (…/q/<code>)
    And the PDF's caption, which only I see, carries a link to try the quiz page myself before I forward it
    And a child who taps "Invite a friend" forwards the same kind of link
    But when the web quiz is off, or I am not on its list, every link is the WhatsApp one as before, and the caption has no preview line
    # ADDED 2026-10-05: web-quiz-link quizLink(code, {teacherUserId, whatsapp}) at the three link builders
    # (video-quiz-share deliverClassLink, transcript-quiz-handoff sendHandoff, video-quiz-invite
    # handleInviteButton). app_settings web_quiz_enabled + web_quiz_teachers ("all" or user ids), fail closed;
    # base = WEB_QUIZ_BASE_URL else PORTAL_URL. previewLink() adds tqWebPreview to the caption only when the
    # token module signs one. The code is the same in both channels, so QUIZ-<code> still works in WhatsApp.
    # Unit: tests/quiz/web-quiz-link.test.js. @wip.

  @api @quiz @web @wip @draft @P1 @T107 @no-mock-driver
  Scenario: A web-arm quiz carries web items written from its own source, and WhatsApp is unchanged
    Given the web quiz is switched on for me and app_settings "web_quiz_items_v2" is true
    When my class quiz is made from my lesson
    Then each question may carry a web item beside it (quiz_questions.media.web)
    And every web item names the moment of my lesson it tests, and that quote is found in my transcript or lesson plan
    And a web item whose quote is missing, off the question's topic, or fails the maths or Urdu address checks is not kept
    And the question's own WhatsApp fields are exactly what they would have been without the web item
    # web-quiz-items.js maybeAttach (one call after the quiz is final; never fails a quiz), wired in
    # transcript-quiz-generate process() before the insert. Flag absent = no call, no media.web.
    # Unit: bot/tests/quiz/web-quiz/web-quiz-items.test.js, tests/quiz/web-quiz-items-generate.test.js. @wip.

  @api @quiz @web @wip @draft @P1 @T108 @no-mock-driver
  Scenario: A child plays picture, listen, order and match questions on the web
    Given a web quiz whose questions carry web items
    When the page loads the quiz
    Then each question shows its type, its own options (pictures with spoken names where it has them) and what the voice reads
    And the source of a question is named by its time or lesson section, never by the classroom words
    When the child puts the steps of an order question in the right order
    Then the answer is right only in that order, and the review shows the order
    # web-quiz.service questionPayload (WebItems.webPayload), recordAnswers (WebItems.isCorrect), finishSession (keyFor). @wip.

  @api @quiz @web @wip @draft @P2 @T160 @no-mock-driver
  Scenario: In Urdu, each child's animal sits inside its circle on "Whose turn is it?"
    Given a web quiz in Urdu, and names remembered on this phone and in the class
    When the child opens "Whose turn is it?"
    Then every name chip shows its animal inside its round badge, as it does in English
    And the animal sits in line with the name on the "Is this you?" card, the scorecard and the class league table
    # wq.js ani() wraps every animal in .wq-ani; wq.css .wq-ani keeps the system font and line-height 1.
    # Unit: dashboard/tests/web-quiz-page-badge.service.test.js. @wip.

  @api @quiz @web @wip @draft @P2 @T178 @no-mock-driver
  Scenario: Jugnu moves on every screen, differently each time, and stays still when it should
    Given a web quiz open on a child's phone
    When a screen with Jugnu appears (hello, whose turn, a question's answer, the results, see you tomorrow)
    Then Jugnu's still pose shows at once and a short looping animation of that pose takes over a moment later, one of several picked at random
    And the first question never waits for an animation to load
    When the phone asks for reduced motion, saves data or is on 2G
    Then Jugnu stays as the still pose and no animation is downloaded
    When the page is hidden or the in-app browser is closed
    Then the animation stops with the sounds, and it starts again when the child comes back
    # wq.js mascot block (jugImg, jugWake, jugStop); assets dashboard/public/wq/jugnu/<pose>_<k>.webm|.webp.
    # Unit: dashboard/tests/web-quiz-mascot.service.test.js. @wip.

  @api @quiz @web @wip @draft @P2 @T161 @no-mock-driver
  Scenario: A tap anywhere on the lesson video starts it, and a video with no poster is not a dark box
    Given a web quiz with a lesson video
    When the child sees the video screen
    Then the video box shows Jugnu and a big play button when the video has no poster, or the poster when it has one
    When the child taps anywhere on the box
    Then the video starts, the cover goes away and the video's own controls take over
    # wq.js video() .wq-vcover. Unit: dashboard/tests/web-quiz-page-video.service.test.js. @wip.

  @api @quiz @web @wip @draft @P2 @T162 @no-mock-driver
  Scenario: A class with no label never leaves a dangling dot on the card or the league table
    Given a brand-new code whose class has no label yet
    When the child finishes and sees the scorecard and the league table
    Then the card's header reads "NIETE" with nothing after it, and no line starts or ends with a dot
    # wq.js dotJoin(). Unit: dashboard/tests/web-quiz-page-card.service.test.js. @wip.

  @api @quiz @web @wip @draft @P2 @T163 @no-mock-driver
  Scenario: The page records whether it was opened in WhatsApp's in-app browser
    Given a child opens the web quiz in WhatsApp's own browser, or in the phone's browser
    When the page reports that it opened
    Then the log keeps iab as 1 for WhatsApp's browser and 0 for the phone's browser
    # web-quiz.service cleanEvent. Unit: bot/tests/quiz/web-quiz/web-quiz.service.test.js (E8 iab). @wip.

  @api @quiz @web @wip @draft @config-gated @P1 @T164 @no-mock-driver
  Scenario: The message I forward for the web quiz says the child is asked only their name
    Given the web quiz is on for me
    When I get my class quiz and its message to forward
    Then the message carries the web link and says the child will be asked their name first, in the quiz's language
    And when the web quiz is off for me, the message carries the WhatsApp link and still says name and class, exactly as before
    # transcript-quiz-handoff: the link and the text are chosen together (tqStudentMessageWeb vs tqStudentMessage).
    # Unit: tests/quiz/web-quiz-forward-message.test.js, tests/quiz/web-quiz-link.test.js. @wip.

  @api @quiz @web @wip @draft @P1 @T190 @no-mock-driver
  Scenario: The phone's Back button inside WhatsApp's browser never throws a child out of the quiz by accident
    Given a child is playing the web quiz in WhatsApp's in-app browser
    When the child presses Back on a side screen (who is playing, the share screen, the league table, history, today)
    Then the page goes back to the screen the child came from
    When the child presses Back on a question
    Then the page stays, says the answers are saved, and a second Back leaves
    And on the landing, the results and the scorecard Back leaves the page as before
    # wq.js navArm/navBack (one history entry, added on a tap). Unit: dashboard/tests/web-quiz-page-inapp.service.test.js. @wip.

  @api @quiz @web @wip @draft @P1 @T191 @no-mock-driver
  Scenario: Sharing the scorecard to the class group keeps classmates in the teacher's report
    Given a child has finished the web quiz and sees the scorecard in a browser with no share menu
    When the child taps "Share to class group"
    Then WhatsApp opens with the score line and the CLASS link, in the same view
    When the child taps "Challenge a friend"
    Then WhatsApp opens with the child's own challenge link, and "Copy the message" is there if WhatsApp does not open
    # wq.js card() classUrl vs chalUrl. Unit: dashboard/tests/web-quiz-page-inapp.service.test.js. @wip.

  @api @quiz @web @wip @draft @P2 @T192 @no-mock-driver
  Scenario: A reload in the middle of the lesson video carries on where it was
    Given a child is watching the lesson video on the web quiz
    When the page reloads (or the child comes back to the link)
    Then "Continue" takes the child back to the video at the point it reached, with no name to pick again
    And a video the child skipped or finished does not come back; the questions do
    # wq.js video() S.vt/S.vdone + resume(). Unit: dashboard/tests/web-quiz-page-inapp.service.test.js. @wip.

  @api @quiz @wip @draft @config-gated @P1 @T130 @no-mock-driver
  Scenario: With the author gates on, every quiz question carries the moment of my lesson that holds its answer
    Given app_settings "quiz_author_gates_v2" is true
    When my class quiz is made from my lesson (a recording, a K-5 lesson plan or a 6-12 lesson plan)
    Then every question is written with a quote of the moment in my lesson that carries its answer
    And a question is re-written on my lesson's own example when its quote is missing, is not in my lesson, is itself a question, shares no word or number with the answer, or quotes numbers that are neither the answer's nor the question's
    And a question the re-write still cannot ground is left out of the quiz, never sent as it was
    And how many questions were refused, re-written, left out or kept is recorded on the quiz
    And with the setting off, the quiz is made exactly as before
    # transcript-quiz-source-fidelity.js (the gates) + transcript-quiz-generate runSourceFidelity (one targeted
    # rewrite, then the salvage); counts in quizzes.meta.source_fidelity. Applies to the WhatsApp rows, so to both arms.
    # Unit: tests/quiz/quiz-source-fidelity.test.js, tests/quiz/quiz-source-fidelity-generate.test.js. @wip.

  @api @quiz @wip @draft @config-gated @P1 @T131 @no-mock-driver
  Scenario: With the author gates on, a grade 1-2 question is short enough for a beginning reader
    Given app_settings "quiz_author_gates_v2" is true
    And my lesson is for grade 1 or 2
    When my class quiz is made
    Then no question is longer than 8 words, and a longer one is re-written shorter
    # STEM_TOO_LONG_G12 in transcript-quiz-source-fidelity.js; the web page voices the stem (read.stem). @wip.

  @api @quiz @wip @draft @config-gated @P2 @T132 @no-mock-driver
  Scenario: With the author gates on, a slip in my lesson is not taught to the children
    Given app_settings "quiz_author_gates_v2" is true
    And something said in my lesson about a fact was wrong
    When my class quiz is made
    Then the question tests the correct fact and quotes the moment the correct fact was said
    And the slip is recorded on the quiz for my report to use later, and nothing in my report changes yet
    # teaching_error per question -> quizzes.meta.source_fidelity.teaching_errors [{question, said, correct, quote}]. @wip.

  @api @quiz @web @wip @draft @P1 @T110 @no-mock-driver
  Scenario: A question that sends the child to a picture it does not have is left out of my web quiz
    Given my web quiz has four questions
    And one says "Look at the pictures. Which one is a leaf?" but has no picture, no figure and no picture options
    When a child opens the quiz from my link
    Then the child plays three questions, and the score and the "answered at least half" rule count three
    And a question that says "Look at the picture" and has its own picture is played with the picture
    # web-quiz.service loadQuestions (playable: quiz-picture-words pointsAtPicture + hasPicture). Unit: tests/quiz/web-quiz/web-quiz.service.test.js, tests/quiz/quiz-picture-words.test.js. @wip.

  @api @quiz @web @wip @draft @P1 @T111 @no-mock-driver
  Scenario: The recorded voice on my web quiz says plain words, never maths code
    Given a question "What is $\frac{3}{4}$ of 8?" whose web item reads it as "What is three quarters of eight?"
    When the read-aloud clips for my quiz are recorded
    Then the question clip says "What is three quarters of eight?" and each option clip says that option's spoken words
    And a question with no web item is read from its own text with the maths written as words
    And when a question's words change, the next recording says the new words
    # web-quiz-publish.service partsFor (read.stem / read.opts, mathToText fallback), audioKey (hash of the words). Unit: tests/quiz/web-quiz-publish.test.js. @wip.

  @api @quiz @web @wip @draft @P1 @T165 @no-mock-driver
  Scenario: With my class list, my quiz children are the children on my list
    Given app_settings "web_quiz_roster_id" is true and I keep a class list with roll numbers
    When a child of my class opens my quiz link, types their roll number and confirms their first name
    Then the child plays as the child on my class list, not as a new name
    And my report shows the name and class from my class list, counting each child's first finished score
    And the quiz page never receives my class list: one roll number answers with at most three first names and their animals
    But with the switch off, or without a class list, children pick or type their names as before
    # ADDED 2026-10-05: web-quiz-roster.js (rosterOn, loadRoster, byRoll, byName, nearName); web-quiz.service getQuiz cls.roster + startSession body.roll / roster chips. Unit: tests/quiz/web-quiz/web-quiz-roster.test.js. @wip.
