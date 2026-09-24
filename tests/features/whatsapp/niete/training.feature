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

  @e2e @flow @quiz @content-driven @P1
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
    Then the Flow closes and the bot posts the module video card with "Watch the video, then tap 📝 Take quiz — passing it unlocks the next module." followed by "Finished watching \"<module>\"?" offering "📝 Take quiz" and "⏸ Pause"
    When I tap "📝 Take quiz"
    Then the bot announces "Module check — \"<module>\"" and "<n> questions. You need 100% to unlock the next module — if you miss it you can retry straight away.", then serves "Q1/<n>" with an "Answer" button and the caption "100% required · tap an option"
    When I answer every served question with its correct option, resolved live (match the option TEXT to the answer key, never a fixed letter)
    Then the bot replies "Module check — passed" and confirms a perfect score in the shape "<n>/<n> correct"
    And the module that was "▶ Next up" becomes "✓ Passed" and the following module becomes the new "▶ Next up"
    # NIETE needs 100%. Verified live on PROD (2026-08-05) end-to-end (Auditory aids & Differentiated
    # reading materials driven 3/3 → next-up advanced); re-verified entry+Flow+ladder+level-detail on the
    # shared staging number 923222482222. Exam caption observed "20 questions" (prod) / "62 questions"
    # (staging 923222482222) for the same account — see the config-discrepancy note in _suite.md.

  @e2e @flow @copy @P1
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

  @e2e @certificates @copy @P2
  Scenario: A teacher with no certificates yet is pointed back to training
    Given the NIETE bot chat is open
    When I send "/certificates"
    Then the bot replies "You don't have any NIETE certifications yet." and tells me to complete a level and pass the grand quiz, and to type "/training"
    # @copy. Verified live on PROD & staging (2026-08-05).

  # ── other positive branches (separate because they need a different content type / state / vendor) ──

  @e2e @wip @draft @flow @P3
  Scenario: A PDF module arrives as a document
    Given the NIETE bot chat is open and I have opened a module whose content is a PDF, not a video
    Then the bot sends the module as a PDF document with a button to the next one
    # content-delivery.service.js isPdfModule. @wip.

  @e2e @wip @draft @flow @quiz @destructive @P1
  Scenario: Finishing every module unlocks the level exam, and passing it certifies the level
    Given the NIETE bot chat is open on a teacher who has passed every module in a level
    When I open that level, start the now-unlocked grand quiz, and answer at least 80% correctly
    Then the bot congratulates me, gives me a certificate code, and sends the certificate PDF
    # loadGrandQuizState (unlocks once all modules done) + quiz-delivery grand-pass branch.
    # @destructive: certifies the level + unlocks the next. @wip — needs a fully-completed level.

  @e2e @wip @draft @certificates @P2
  Scenario: Asking for a certificate by its code sends the PDF
    Given the NIETE bot chat is open on a teacher who holds a certificate
    When I send "/certificate <my certificate code>"
    Then the bot sends me that certificate as a PDF document
    # certificate-pdf.service.js (only my own certificates). @wip.

  @e2e @wip @draft @flow @quiz @P3
  Scenario: For a Beacon House programme the level exam is written answers, not multiple choice
    Given the NIETE bot chat is open on a teacher in a Beacon House programme who has finished every module in a level
    When I start the level exam
    Then it asks open-ended questions I answer in my own words, marked out of 5
    # capstone-delivery.service.js (open-ended, model-scored, 70% to pass, no cooldown). @wip.

  @e2e @flow @P3
  Scenario: For an Oxbridge programme a level is certified from module scores, with no exam
    Given a teacher in an Oxbridge programme who has finished every module with each best score at least 70%
    Then the level detail states "🎓 No level exam — finish all sessions to complete this level." with no grand-quiz row
    And on finishing the last module the bot congratulates me "with 70%+ on each quiz", gives a certificate code, and sends the certificate PDF — no exam is ever shown
    # maybeIssueQuizScoreCertificate (QUIZ_CERT_PASS_PCT=0.7, vendor unlock_logic=all_modules, no capstone).
    # Verified live on PROD (2026-08-06): Oxbridge L17 (1 course · 7 modules SESSION#1-7 · no grand_quizzes).
    # Module bar is 70% ("10 questions. You need 70%…") vs NIETE 100%. Cert NIETE-20260805-YA5IU7 + PDF issued
    # off the final module pass — no exam step. See F-OXB-examcopy (post-completion still nudges "take the level exam").

  @e2e @wip @draft @quiz @destructive @P1
  Scenario: For an I-SAPS programme passing the last module exam certifies the level, whatever units are left
    Given the NIETE bot chat is open on a teacher in the I-SAPS programme who has passed eight of the nine module exams and has NOT finished every unit
    When I take the remaining module exam and pass it
    Then the bot says "You have completed every module of Level 1: Novice.", gives me a certificate code, and sends the certificate PDF
    And no unit, unit quiz score or module order is asked about first
    # Operator 2026-09-23: no chaining; the certificate waits on the module exams ONLY (PASSED — a failed
    # submission does not count). certificate.service maybeIssueQuizScoreCertificate: per-module-exam level ->
    # allModuleExamsPassed is the whole rule. @wip — needs an I-SAPS level seeded 8/9 on the throwaway.

  @e2e @wip @draft @certificates @P2
  Scenario: An I-SAPS certificate is watermarked as not real, in every environment, while it is a pilot
    Given a teacher in the I-SAPS programme has just been certified
    When the certificate PDF arrives
    Then it carries the diagonal "NOT A REAL CERTIFICATE" watermark, even on production
    And a certificate from any other programme on production does not
    # certificate-env.rules PILOT_WATERMARK_VENDORS = ['ISAPS'].
    # TODO(NIETE-ISAPS-GO-LIVE): at go-live for all teachers this flips — production I-SAPS certificates are clean.

  # ═══════════════════════════════════ NEGATIVE ═══════════════════════════════════

  @e2e @flow @negative @known-issue @P2
  Scenario: A locked level is selectable but the server refuses to open it
    Given the NIETE bot chat is open and I have opened the "NIETE" programme
    When I select a locked level (e.g. Level 1) and tap "Open level"
    Then the "Open level" button turns on client-side (the Flow can't disable the row) but the bot replies "Pass Level 0's grand quiz first to unlock this level."
    # @known-issue: the real gate is server-side. Verified live on PROD (2026-08-05). Names the previous level.

  @e2e @flow @negative @known-issue @P2
  Scenario: A module further down the list can't be opened before the earlier ones
    Given the NIETE bot chat is open and I have opened a level with earlier modules unfinished
    When I pick a locked module lower down and try to open it
    Then the bot replies "Finish \"<the Next-up module>\" first — modules open one at a time."
    # @known-issue: locked rows stay tappable; the server enforces order. Verified live on PROD (2026-08-05).

  @e2e @flow @negative @P2
  Scenario: Tapping the locked exam link explains what to finish first
    Given the NIETE bot chat is open and the level still has modules to finish
    When I tap the "🔒 Locked" exam link in the level detail
    Then the bot replies "Finish every module in this level first — the exam unlocks once all 9 courses are complete."
    # Verified live on PROD (2026-08-05). Distinct wording from the locked-card caption in the main flow.

  @e2e @quiz @negative @content-driven @P2
  Scenario: Getting one question wrong fails the module check (NIETE needs 100%) and offers a retry
    Given the NIETE bot chat is open and I am taking a NIETE module check
    When I answer exactly one question with a deliberately-wrong option (not matching the key) and the rest correctly
    Then the bot replies "Module check — not quite" with my score in the shape "<got>/<total> (<pct>%)", says I need 100% to move on, and a follow-up offers "🔄 Try again" and "⏸ Pause"
    # @content-driven. Verified live on PROD (2026-08-05): "Module check — not quite. You got 2/3 (67%).
    # You need 100% to move on…" All questions are asked FIRST, then graded. module_passing_pct=100 for
    # NIETE (TALEEMABAD); other partners 70%. Assert the shape, not "2/3".

  @e2e @certificates @negative @copy @P3
  Scenario: Asking for a certificate that isn't mine says it can't be found
    Given the NIETE bot chat is open
    When I send "/certificate NIETE-L0-20260101-ZZZZ"
    Then the bot replies "I could not find a certificate with the code" and points me to "/certificates"
    # Verified live on PROD (2026-08-05). Owner-scoped: not-yours and not-exist both → not found. Code must
    # be well-formed (CERT_CODE_RE), else it falls through to the list (see edge below).

  @e2e @certificates @negative @P3
  Scenario: A /certificate with a junk code just shows my certificates list
    Given the NIETE bot chat is open
    When I send "/certificate not-a-code"
    Then the bot shows my certificates list, or the no-certificates nudge
    # Verified live on PROD (2026-08-05): a junk argument is ignored → list/nudge mode.

  @e2e @edge @negative @P3
  Scenario: "/teacher training" (two words) is not a training command
    Given the NIETE bot chat is open
    When I send "/teacher training"
    Then the bot treats it as a normal question, not the Teacher Training Flow
    # Verified live on PROD (2026-08-05): AI reply, no card — the two-word phrase isn't a trigger.

  @e2e @quiz @negative @destructive @P3
  Scenario: Failing the level exam starts a wait before I can retry
    Given the NIETE bot chat is open and I have just failed a level's grand quiz
    When I try to start the grand quiz again
    Then the bot tells me to try again in a few hours
    # @destructive: a real failure locks the exam for hours — throwaway teacher only. @wip.

  @e2e @i18n @quiz @wip @draft @P2
  Scenario: An Urdu teacher gets the Urdu question text and Urdu options
    Given my preferred_language is "ur" and a question has question_urdu + options[].urdu set
    When the question is delivered
    Then the Urdu question and Urdu options are shown (not English)
    # Real flow for an Urdu-speaking teacher; delivery may currently fall back to English — drive to confirm (Rule 20). @wip.

  # ═══════════════════════════════════ EDGE cases ═════════════════════════════════

  @e2e @flow @edge @P3
  Scenario: /training works even in the middle of something else
    Given the NIETE bot chat is open and I am part-way through another feature
    When I send "/training"
    Then the Teacher Training card is sent without my having to cancel first
    # Single, stateless entry point. Verified live on PROD (2026-08-05): opened from a pending register Welcome card.

  @e2e @quiz @edge @copy @P3
  Scenario: Pausing a module check saves my place
    Given the NIETE bot chat is open and a module check is offering "🔄 Try again" and "⏸ Pause"
    When I tap "⏸ Pause"
    Then the bot replies "⏸ Paused. Send /training when you want to pick up where you left off."
    # @copy. Verified live on PROD (2026-08-05).

  @e2e @quiz @edge @content-driven @P3
  Scenario: A module retake serves a fresh set of questions
    Given the NIETE bot chat is open and I have just missed a module check
    When I tap "🔄 Try again"
    Then the check restarts from Q1 and may serve different questions, in a different order, with the correct answer on a different letter
    # Verified live on PROD (2026-08-05): retry served different Q1-Q3, reshuffled. Assert the CONTRACT (restarts at Q1/<n>, still 100% to pass).

  @e2e @wip @draft @flow @quiz @P3
  Scenario: A half-finished module quiz picks up where I left off
    Given the NIETE bot chat is open and I started a module check and answered some questions
    When I re-open the module and tap "Take quiz" again
    Then the quiz continues at the next unanswered question, not from the beginning
    # quiz-delivery startTrainingQuiz resumes the same attempt. @wip.

  @e2e @flow @copy @P3
  Scenario: A module's button is named after what tapping it does
    Given the NIETE bot chat is open and I have opened a module
    Then a module with a quiz shows "Take quiz", a video module shows "Next video", and a PDF module shows "Next module"
    # @copy. The button label follows the content type. @wip.

  @e2e @quiz @edge @wip @draft @P3
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

  @e2e @quiz @wip @draft @P2
  Scenario: A quiz made from my lesson plan is listed in /quiz among my coaching lessons
    Given the NIETE bot chat is open and a quiz was made from a lesson plan I was served on an earlier day
    And I also have a recorded coaching lesson
    When I send "/quiz"
    Then the list shows the lesson-plan quiz as a row "<date> · <subject>" with "<topic> · <status>" beneath it
    And the rows are ordered newest lesson first, the lesson-plan quiz dated by the day it was planned for
    And the recorded coaching lesson is still in the list
    When I tap the lesson-plan quiz's row
    Then I am offered "Resend the link", the report, and a way back — and nothing offers to make the quiz again
    # transcript-quiz-list.service lessonItems + handleLpPick (row id tq_pick_lp_<quizId>); the /quiz Flow
    # lists it too (key lp_<quizId>) with Generate report / Resend link on its LESSON screen. @wip.

  @e2e @quiz @wip @draft @P2
  Scenario: A lesson-plan quiz still waiting for its language is asked again from /quiz, never "still being made"
    Given the NIETE bot chat is open and I said yes to the afternoon quiz offer on a maths, science or English lesson plan but never tapped a language
    When I send "/quiz"
    Then that lesson's row says "Offered — tap to make"
    When I tap that row
    Then the bot asks again which language the quiz should be in, with an Urdu and an English button, and does not say the quiz is still being made
    When I tap "English"
    Then the bot says it is making the quiz now, and the quiz arrives with the message to forward to the class
    And in the /quiz Flow, the same kind of lesson opens a lesson screen offering to make it in Urdu or in English — not a "still being made" screen
    # The row waits offered + meta.awaiting_language until a language is tapped; nothing is queued before.
    # handleLpPick re-sends the ask (sendLanguageAsk, tq_lang_ buttons); the Flow's actionsFor gives make_<lang>
    # for that state and stepAction hands it to startGenerating (atomic offered → generating, then the
    # lesson-plan quiz job) — the same path as answering the ask in chat. @wip.

  @e2e @quiz @wip @draft @P2
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

  @e2e @quiz @wip @draft @P2
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

  @e2e @quiz @wip @draft @P1
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

  @e2e @quiz @wip @draft @P2
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

  @e2e @quiz @wip @draft @P2
  Scenario: A lesson-plan quiz that could not be started says so, and can be made again
    Given the NIETE bot chat is open and a quiz for one of my planned lessons could not be started (the job never reached the queue)
    When I open "/quiz" and tap that lesson
    Then the lesson screen says the quiz could not be started on the bot's side and the lesson plan was not the problem
    And it offers "Make it again" and "Done", and "Make it again" makes the quiz
    # transcript-quiz-offer queueLpQuiz merges the failure into the row's meta (the lessons, class and lesson
    # date are kept); quiz-sources: queue_failed -> lpQuizCouldNotStart copy and a remakeable reason; the Flow
    # results read tqFlowResultsFailedLpStart. @wip — a queue refusal cannot be forced live.

  @e2e @quiz @wip @draft @P2
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

  @e2e @quiz @wip @draft @P2
  Scenario: The class report of a quiz made from my lesson plan carries the objectives to reteach
    Given the NIETE bot chat is open and children have finished a quiz that was made from my lesson plan
    When I ask for the report from that quiz's row in /quiz
    Then the class report arrives as a PDF
    And it names the lesson's learning objectives next to the questions the class found hard
    And afterwards that quiz's row in /quiz says the report was sent
    # video-quiz-report: isLessonQuiz gates the digest; markReportSent flips lp_v8 rows to report_sent. @wip.

  @e2e @quiz @wip @draft @P2
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

  @e2e @quiz @wip @draft @P3
  Scenario: The class report never calls me "your teacher"
    Given the NIETE bot chat is open and my account has no name on record, and children have finished a class quiz I shared
    When I ask for the report from that quiz's row in /quiz
    Then the report's header under the topic shows the class alone, such as "جماعت 4" or "Class 4"
    And nowhere does the report call me "آپ کے استاد" or "Your teacher"
    But the children who open my link are still greeted with "آپ کے استاد" / "Your teacher" in place of my name
    # video-quiz-report generate(): the header takes the teacher's own users.name; quiz_share_codes.teacher_name
    # holds the children's fallback (tqYourTeacher) and keeps serving the join greeting. @wip.

  @e2e @quiz @wip @draft @P2
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

  @e2e @quiz @wip @draft @P2
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

  @e2e @quiz @wip @draft @P2
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
    # tqCouldNotMake ("the transcript didn't carry enough") stays for questions that never validated and for
    # a transcript under MIN_TRANSCRIPT_CHARS (source_unusable, checked before any model call — /quiz and the
    # offer never list one). The offer-time digest failure is skipped as model_failed and the teacher is told
    # nothing. A model failure cannot be forced live; proven in tests/quiz/transcript-quiz-failure-reasons.test.js. @wip.

  @e2e @quiz @wip @draft @P1
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

  @e2e @quiz @i18n @wip @draft @P2
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

  @e2e @quiz @wip @draft @P2
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

  @e2e @quiz @wip @draft @P2
  Scenario: A four-digit place-value question shows the thousands the class built
    Given the NIETE bot chat is open and a class quiz was made from a grade 3 maths lesson plan on four-digit numbers
    When a child opens the quiz from its link and reaches a question asking what number the picture shows
    Then the picture has a thousands column to the left of the hundreds, with a cube (or a block of ten big bundles) for each thousand
    And a number with thousands and no hundreds, such as 2014, still shows an empty hundreds column under its heading
    And no digit and no count is written anywhere in the picture, and in an Urdu quiz the thousands heading reads "ہزار"
    # base_ten `thousands` (0-9), SYNC.md §3.20; heading tqPlaceThousands. The lesson-plan digest quotes a
    # four-digit worked example whole (lp-quiz-digest lessonDrewBlock). Content-driven: assert the SHAPE
    # (four headed columns, cubes or bundle blocks, no digits), never a fixed number. @wip.

  @e2e @quiz @wip @draft @P3
  Scenario: A counting question draws the lesson's own objects — sweets, dates, cookies, lilies, samosas, bangles
    Given the NIETE bot chat is open and a class quiz was made from a grade 1-3 maths lesson plan that counted sweets or samosas
    When a child opens the quiz from its link and reaches a counting question with a picture
    Then the picture draws the objects the lesson counted, not plain round counters
    # Pictograms sweet, cookie and lily (OpenMoji candy, cookie, lotus) and date, samosa and bangle (drawn in
    # lib/pictogram.js), plus the lesson's words biscuit, candy, toffee, laddu and pebble; SYNC.md §3.20.
    # Proven in tests/quiz/pictograms-lesson-objects.test.js. Content-driven: which object appears depends on
    # the lesson. @wip.

  @e2e @quiz @wip @draft @P1
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

  @e2e @quiz @wip @draft @P1
  Scenario: A grade 1-5 maths quiz draws what the lesson drew, on at least three questions
    Given the NIETE bot chat is open and a class quiz was made from a grade 1-3 maths lesson plan that counted with counters
    When a child opens the quiz from its link and answers every question
    Then at least three of its questions arrive with a picture, and never more than half of them
    And the pictures draw the lesson's own objects, such as counters for a lesson that counted counters
    And a question that states its numbers may carry a picture of them, such as two fraction bars beside "which is larger", but no picture ever shows the answer
    And on a grade 4-5 fractions lesson taught as a method, such as cross multiplication, the pictures are questions read off fraction bars — what fraction of the bar is shaded, which bar shows a fraction — never a picture beside a step of the working
    And every fraction on the question cards and on my PDF is printed stacked, number over number, while the WhatsApp text of the question reads it as 2/3
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

  @e2e @quiz @wip @draft @P1
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

  @e2e @quiz @wip @draft @P2
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

  @e2e @quiz @flow @copy @wip @draft @P2
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

  @e2e @quiz @copy @wip @draft @P2
  Scenario: After an Urdu quiz, the message a child forwards to a friend is in Urdu
    Given a child has just finished an Urdu class quiz opened from its link
    When the child taps "دوست کو بھیجیں"
    Then the next message tells them in Urdu to forward the one after it
    And the message after it invites the friend in Urdu, names the child by first name only, names the topic, and carries a "QUIZ-<code>" link
    And the offer to watch more videos follows it
    # video-quiz-invite handleInviteButton: vqInviteForwardThis + vqInviteMessage in the quiz language
    # (the invite's own language, else its share code's). @wip.

  @e2e @quiz @copy @wip @draft @P2
  Scenario: A child who passed an Urdu quiz to a friend hears how the friend did, in Urdu
    Given a child sent an Urdu class quiz to a friend and has finished it themselves
    When the friend finishes the same quiz
    Then the first child is told in Urdu that the friend finished, with the friend's first name only
    And both scores are shown as "<out of> میں سے <score>", and the closing line never frames it as a loss
    # video-quiz.service finish() -> video-quiz-invite notifyInviter(session, state.language) ->
    # buildComparison: vqCompareMessage + vqCompareBehind/Ahead/Tie in the quiz language (quiz_sessions
    # carries no language; the session state does). English copy is byte-identical. @wip.

  @e2e @quiz @copy @wip @draft @P2
  Scenario: A video quiz sent to the class from an Urdu run forwards an Urdu message
    Given I have just taken a video quiz in Urdu on my own
    When I tap "کلاس کو بھیجیں" on the offer to send it to my class
    Then I am told in Urdu to forward the next message to the class group
    And the message to forward is in Urdu, names the teacher and the topic, and carries a "QUIZ-<code>" link
    And a last message in Urdu says when the class report will arrive
    # video-quiz-share offerShare / handleShareButton / deliverClassLink: vqShareOffer, vqShareYes/No,
    # vqShareForwardThis, vqClassMessage, vqShareReportPromise, vqShareDeclined, vqShareLinkFailed in
    # the run's language. English copy is byte-identical. @wip.

  @e2e @quiz @copy @wip @draft @P2
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

  @e2e @quiz @copy @wip @draft @P2
  Scenario: The reminder about a quiet quiz reads naturally and keeps each quiz title whole
    Given my language is English and I sent two class quizzes today whose titles are in Urdu
    And almost no child has started either of them
    When the quiet-quiz reminder arrives
    Then it names both quizzes, each title in bold and whole, separated by an English comma
    And a reminder about a single quiz says "No one has started", "One student has started" or "<n> students have started" — never "student(s)"
    # transcript-quiz-nudge process(): tqNudgeNone / tqNudgeOne / tqNudge by count; each title bold and
    # first-strong isolated (titled()), joined with the teacher language's list comma (vqLetterSep).
    # Proven in tests/quiz/transcript-quiz-nudge-copy.test.js. @wip.

  @e2e @quiz @copy @wip @draft @P3
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

  @e2e @flow @P1
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

  @e2e @flow @negative @P2
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

  @e2e @flow @P2
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

  @e2e @flow @P1
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

  @e2e @flow @negative @P1
  Scenario: Going over 50 in total tells her why, where she can see it
    Given the NIETE bot chat is open and I have chosen "Both Seen and Unseen" and asked for 30 Seen
    And I have ticked "MCQs" and "Brief Answers"
    When I ask for 15 MCQs and 10 Brief Answers and continue
    Then I stay on the Unseen screen and just above Continue it says the paper would be 55 questions (30 Seen + 25 Unseen) and the most is 50
    # Operator, 23 Sep: "when you hit the limit, no error is displayed to the user so they can't
    # even tell what is happening" — the logs showed Continue tapped twice a second apart. The
    # reason used to sit at the TOP of the screen; it now sits under the offending box (a single
    # bad box) or above Continue (a total over 50, which belongs to no one box).
