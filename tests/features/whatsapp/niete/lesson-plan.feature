# NIETE (ICT) Lesson Plans — WhatsApp E2E, driven via a linked WhatsApp Web session (Chrome-MCP).
# Target: staging 923222482222 (.claude/qa/config/whatsapp-targets.yaml). Values that vary by DB state
# (grades, subjects, chapters, filenames) resolve live from answer-keys.yaml → lesson_plan; assert shape,
# not exact wording. Non-determinism contract: .claude/qa/shared/non-determinism-contract.md.
@whatsapp @ict @profile:niete @feature:lesson-plan @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — Lesson Plans
  # Entry points: the "Lesson Plans" menu row, a keyword (lp | lesson plan | lesson-plan | /lp | لیسن پلان,
  #   exact match), the Meta ice-breaker, a natural-language request, or a voice note.
  # Delivery engines:
  #   (A) the "Pick a class" native Flow (Grade → Subject → Chapter → Topic → PDF), gated on
  #       PAKISTAN_LP_FLOW_ID. Grades 1–5 serve a pre-generated Pakistan PDF; grades 6–10 an Oxbridge PDF.
  #   (B) natural language / voice — since bd-2540 these NO LONGER generate a freeform plan; they return
  #       the curriculum fallback ("this isn't in our collection yet — type menu").
  # Flow driving: dropdown pickers (open dropdown → pick option → Next); final submit is "Send Lesson Plan".
  # Flow screens and acks are English-only regardless of language (see the @known-issue scenario).

  # ─────────────────────────── Positive / happy path ───────────────────────────

  @e2e @flow @P1
  Scenario: Completing the "Pick a class" Flow delivers the lesson-plan PDF
    Given the NIETE bot chat is open
    When I open the LP Flow and complete it for Grade 1 → English → "Ch 1: Hello World" → "Full Chapter Lesson Plan"
    Then the interim ack matches "📘 Sending your lesson plan: <grade> <subject> — <chapter>…"
    And a lesson-plan PDF is delivered to the chat within a few seconds (e.g. "Hello World — English.pdf")
    # Grades 1–5 = pre-generated Pakistan corpus. No feedback survey fires on the Flow path (by design).

  @e2e @flow @P2
  Scenario Outline: A recognised keyword opens the Lesson Plans Flow
    Given the NIETE bot chat is open
    When I send "<keyword>"
    Then the bot sends a "📘 Lesson Plans" card with a launch button
    Examples:
      | keyword     |
      | lp          |
      | lesson plan |
      | lesson-plan |
      | /lp         |
      | لیسن پلان   |
    # The Meta ice-breaker "Plan Lesson - Create PDF lesson plans instantly" opens the same Flow.

  @e2e @flow @content-driven @P2
  Scenario: A secondary grade delivers an Oxbridge lesson plan, not a Pakistan one
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I complete it for a grade between 6 and 10
    Then the interim ack matches "📖 Sending your Oxbridge lesson plan: <grade> <subject> — <chapter>…"
    And an Oxbridge lesson-plan PDF is delivered (e.g. "Oxbridge — <chapter> — Lesson Plan.pdf")

  # ─────────────────────── Business rules / valid variations ───────────────────────

  @e2e @content-driven @P2
  Scenario: A natural-language request returns the curriculum fallback, not a generated plan
    Given the NIETE bot chat is open
    When I send a free-text request like "make me a lesson plan for grade 4 science on the water cycle"
    Then the bot does not generate a freeform lesson plan
    And it replies with the curriculum fallback inviting me to type "menu"
    # bd-2540 removed the teacher-triggerable freeform (Gamma) generation.

  @e2e @voice @P2
  Scenario: A voice lesson-plan request is transcribed and answered like the text path
    Given the NIETE bot chat is open
    When I send a voice note asking for a lesson plan
    Then the bot transcribes it and replies (by voice and/or text) without erroring
    And the outcome matches the text path — the curriculum fallback for an out-of-catalog request
    And the spoken reply does not promise a lesson plan it will not deliver

  # ─────────────────────────────── Negative ───────────────────────────────

  @e2e @flow @negative @P2
  Scenario: A grade with no lesson plans shows a friendly message
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I pick a grade that has no lesson plans yet
    Then the bot replies that no lesson plans are available for that grade yet

  @e2e @flow @negative @P3
  Scenario: A subject with no chapters for that grade is refused politely
    Given the NIETE bot chat is open
    And I have opened the LP Flow and picked a grade
    When I pick a subject that has no lesson plans for that grade
    Then the bot replies that no lesson plans exist for that subject and grade yet

  @e2e @edge @negative @P3
  Scenario: "/lesson plan" is not a recognised keyword and falls through to natural language
    Given the NIETE bot chat is open
    When I send "/lesson plan"
    Then the bot does not open the Lesson Plans card
    And it handles the message as a natural-language request
    # Only "/lp" carries the slash; "/lesson plan" (slash + space) misses the keyword match.

  @e2e @negative @known-fail @P2
  Scenario: A photo gets no reply when pic-to-LP is disabled
    Given the NIETE bot chat is open
    And pic-to-LP is not enabled on this deployment
    When I send a photo of a textbook page
    Then the bot should still reply with something (at minimum its "text or voice only" fallback)
    But it currently sends no response at all — a silent dead-end (F-LP-PIC)

  # ─────────────────────────────── Known issue ───────────────────────────────

  @e2e @flow @i18n @known-issue @P3
  Scenario: The "Pick a class" Flow renders in English for an Urdu-preference teacher
    Given the NIETE bot chat is open on a teacher whose language is Urdu
    When I open the LP Flow
    Then the Flow screens and the "Sending…" ack are shown in English
    # English is the deliberate floor for this asset-poor surface (F-LP-i18n).
