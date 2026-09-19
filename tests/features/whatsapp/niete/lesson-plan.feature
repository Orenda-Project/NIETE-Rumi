# NIETE (ICT) Lesson Plans — WhatsApp E2E, driven via a linked WhatsApp Web session (Chrome-MCP).
# Target: staging 923222482222 (.claude/qa/config/whatsapp-targets.yaml). Values that vary by DB state
# (grades, subjects, chapters, filenames) resolve live from answer-keys.yaml → lesson_plan; assert shape,
# not exact wording. Non-determinism contract: .claude/qa/engine/bin/non-determinism-contract.md.
@whatsapp @ict @profile:niete @feature:lesson-plan @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — Lesson Plans
  # Entry points: the "Lesson Plans" menu row, a keyword (lp | lesson plan | lesson-plan | /lp | لیسن پلان,
  #   exact match), the Meta ice-breaker, a natural-language request, or a voice note.
  # Delivery engines:
  #   (A) the "Pick Class" native Flow (Grade → Subject → Chapter → Topic → PDF), gated on
  #       PAKISTAN_LP_FLOW_ID. Grades 1–5 serve a pre-generated Pakistan PDF; grades 6–12 the Pakistan
  #       6-12 corpus (gated on LP_612_ENABLED, live per bd-mww73), with Oxbridge only as the fallback.
  #   (B) natural language / voice — since bd-2540 these NO LONGER generate a freeform plan; they return
  #       the curriculum fallback ("this isn't in our collection yet — type menu").
  # Flow driving: dropdown pickers (open dropdown → pick option → Next); final submit is "Send Lesson Plan".
  # Flow screens and acks are English-only regardless of language (see the @known-issue scenario).

  # ─────────────────────────── Positive / happy path ───────────────────────────

  @e2e @flow @P1
  Scenario: Completing the Pick Class Flow delivers the lesson-plan PDF
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
  Scenario: A secondary grade delivers a Pakistan lesson plan, not an Oxbridge one
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I complete it for a grade between 6 and 12
    Then the bot delivers a lesson plan from the Pakistan 6-12 corpus (PDF named "grade_<n>_<subject>_c<NN>_p<NN>_<lang>.pdf")
    And it does not fall back to an Oxbridge lesson plan
    # Grades 6-12 = the Pakistan 6-12 corpus, gated on LP_612_ENABLED (live per bd-mww73; sandbox DB seeded).
    # Oxbridge is only the fallback when the flag is off or a grade's books are not yet segmented — an
    # Oxbridge reply for a secondary grade is now the FAILURE the driver reports (oxbridge:true).

  @e2e @P1
  Scenario: Rating a 6-12 lesson plan useful asks whether I taught it
    Given the NIETE bot chat is open
    And a lesson plan from the Pakistan 6-12 corpus has just been delivered to the chat
    When the feedback survey arrives and I tap 👍
    Then the bot asks whether I got to use it in class
    And it offers exactly three replies — "Taught it today", "Planning to", "Not yet"
    And tapping one of them is acknowledged with a short thank-you that ends the survey
    # bd-b708h. Before this, 👍 ended the survey on a bare thank-you, so lp_feedback.used_in_class
    # was NULL on every 6-12 row — and it is the only signal this lane has that a PDF became a
    # lesson (a render row is a cache miss, not a delivery).

  # ─────────────────────── Business rules / valid variations ───────────────────────

  @e2e @i18n @P2
  Scenario: The use question is asked in my language, not the document's
    Given the NIETE bot chat is open on a teacher whose language is Urdu
    And an English 6-12 lesson plan has just been delivered to the chat
    When I tap 👍 on the feedback survey
    Then both the question and all three replies are in Urdu
    # The document's language and the bot's voice are separate territories: ordering an English
    # plan does not switch an Urdu-preference teacher into being spoken to in English.

  @e2e @content-driven @P1
  Scenario: An Urdu plan that uses ordinary religious vocabulary is delivered, not withheld
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I complete it for an Urdu 6-12 segment whose text uses the common word "انبیاء"
    Then a lesson-plan PDF is delivered to the chat
    And the request does not end in silence
    # bd-kpqu6. RELIGIOUS_MARKS is a never-deliver gate: when it fires the teacher gets NOTHING,
    # not a degraded plan. `PROPHET_RE` had no word boundary — Arabic has no working \b — so the
    # bare token "نبی" matched INSIDE the ordinary plural "انبیاء" ("prophets"). Three teachers
    # asked for a lesson on 2026-09-16 between 02:33 and 02:37 and received nothing. The second
    # half of the same fix stops the gate scoring fields no teacher reads (/human_review_reason,
    # /slo/text_verbatim, video titles) — same observable outcome, so it is not a separate
    # scenario: see grade_7_urdu.c11.p062-064.tafheem, which is delivered only because the model's
    # internal routing note is not teacher-facing.

  @e2e @content-driven @P1
  Scenario: A plan naming an ordinary person called محمد is delivered, because a reviewer cleared it
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I complete it for the Grade 10 Urdu segment whose body names the poet "سیّد ولی محمد"
    Then a lesson-plan PDF is delivered to the chat
    And the plan is not sent back for a revision round
    # bd-zipoe. `محمد` is one of the commonest given names in Pakistan, and RELIGIOUS_MARKS
    # demanded ﷺ after every one — so grade_10_urdu.p2c05.p135-135.tafheem failed five times on
    # Nazeer Akbarabadi's real name, four of them on teacher-facing paths, and auto-repair answered
    # by attaching the Prophet's salutation to a man who is not the Prophet. What clears it is NOT
    # a rule: gate G5c forbids an automated check clearing religious content. It is the G5c
    # native-speaker review itself — 298 phrases decided by Amena Ahmed on 2026-09-17 — carried
    # into the repo as data (bot/vendor/lp-v9/g5c_cleared_names.json). A name the review did not
    # decide is still withheld, which is the scenario below.

  @e2e @content-driven @P1
  Scenario: An "Urdu" plan that is really English is refused, and the English lesson is delivered instead
    Given the NIETE bot chat is open on a teacher whose language is Urdu
    And I have opened the LP Flow
    When I complete it for a 6-12 segment from an English-medium book, and the overlay pass answers in
      English with its Urdu only inside the brackets — "Chapter 10 (کیمیائی توازن)"
    Then a lesson-plan PDF is still delivered to the chat — the refusal is not silence
    And what she receives is the English lesson, flagged by the honest caption
    And she is never handed a plan that presents itself as Urdu and reads as English
    # bd-htw51 / bd-y478d / bd-9a2sf. Two fixes to this gate each answered half the question and each
    # re-opened the other half, because ONE number cannot answer both. Measured on real deltas: a
    # genuine Urdu line carrying a bare English term of record — «باب 10 · Chemical Equilibrium» —
    # scores 0.371 Urdu, while an English line with an Urdu gloss — «Chapter 10 (کیمیائی توازن)» —
    # scores 0.439. The impostor scores HIGHER, so no threshold could separate them. What separates
    # them is WHERE the Urdu sits, so the gate now asks two questions: a FLOOR on the merged overlay
    # with all-Latin brackets discounted, and a CATEGORICAL check on THIS call's delta with every
    # bracket stripped — if no Urdu survives outside the brackets, the model answered in English.
    # Refusing is the kind outcome: the worker falls back to the English document it kept intact,
    # the row records overlay_dropped, and lp612.overlay.pass carries outcome=failed. The silent
    # alternative was an English page delivered under an Urdu claim, which is what 8 of the 23
    # attempted 6-12 repair rows were on 2026-09-18.

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

  @e2e @negative @P2
  Scenario: A thumbs-down asks why, and never asks whether I taught it
    Given the NIETE bot chat is open
    And a lesson plan from the Pakistan 6-12 corpus has just been delivered to the chat
    When the feedback survey arrives and I tap 👎
    Then the bot asks me to say what was wrong, in my own words
    And it does not ask whether I got to use it in class
    # Asking a teacher who has just said the plan was no use whether she taught it reads as not
    # listening — the reason window is the only follow-up on this branch.

  @e2e @negative @content-driven @P1
  Scenario: A plan that names the Prophet without an honorific in teacher-facing text is still withheld
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I complete it for a segment whose teacher-facing body names the Prophet with no honorific
    Then no lesson-plan PDF is delivered
    # The boundary fix narrows WHERE the gate looks, never WHETHER it holds. Gate G5c stands:
    # automated checks do not clear religious content, and native-speaker review remains a hard
    # hold before any teacher delivery. A plan that reaches this state is a review item, not a
    # delivery — bd-qzitp is the regression this pins.
    # bd-zipoe does not move this line: the cleared-name list only ever CLEARS, and only the exact
    # phrases the reviewer saw. An unreviewed name — even one shaped exactly like a cleared one —
    # is not cleared. Fail-closed, always.

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
  Scenario: The Pick Class Flow renders in English for an Urdu-preference teacher
    Given the NIETE bot chat is open on a teacher whose language is Urdu
    When I open the LP Flow
    Then the Flow screens and the "Sending…" ack are shown in English
    # English is the deliberate floor for this asset-poor surface (F-LP-i18n).
