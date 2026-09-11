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
