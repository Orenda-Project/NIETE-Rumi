@whatsapp @ict @profile:niete @feature:coaching @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — Classroom Coaching
  # Non-determinism: see .claude/qa/shared/non-determinism-contract.md (assert contracts/shape; @content-driven answers resolved live).
  # ICT-region only. The NIETE bot (E2E_TARGET_NUMBER) driven from a linked
  # WhatsApp Web session via Chrome MCP. "Classroom Coaching" is the 3rd ICT menu
  # row. Entry: the /menu "Classroom Coaching" row (menu.service.js:110-112 →
  # _handleClassroomCoachingChoice) or a natural-language coaching request. The
  # teacher uploads a classroom recording and the async coaching pipeline returns
  # pedagogical feedback against the FICO / ICT rubric.

  @e2e @menu @P1
  Scenario: The Classroom Coaching menu row asks for a classroom recording
    Given the NIETE bot chat is open
    When I send "/menu"
    And I open the "View Features" list
    And I tap the "Classroom Coaching" row
    Then the bot reply contains "upload your classroom recording"
    And the bot reply says the audio should be at least 15 minutes long
    # Verified: menu.service.js:265 — "Great! Please upload your classroom recording
    # audio to get started with pedagogical analysis. The audio should be at least
    # 15 minutes long."

  @e2e @first-use @P2
  Scenario: Declining the intro on a coaching request asks for the class audio
    Given the NIETE bot chat is open
    And I have never used the Classroom Coaching feature on this account
    When I send "Can you give me feedback on my teaching?"
    And I tap "Just tell me"
    Then the bot reply contains "send me an audio recording of your class"
    # feature-keyword-detector.service.js coaching branch — "No problem! Just send
    # me an audio recording of your class (up to 20 minutes)…". NOTE: the intro
    # offer + "Just tell me" button only fire on FIRST use of the feature
    # (FeatureIntroService); on an account that already used coaching it won't
    # appear — needs a fresh account or a feature-usage reset.

  @e2e @content-driven @P2
  Scenario: Uploading a classroom recording is detected and confirmed for analysis
    Given the NIETE bot chat is open
    And I have chosen Classroom Coaching (awaiting audio)
    When I upload a >=15-minute classroom audio recording
    Then the bot replies "I detected a <N>-minute audio recording. Is this classroom audio you'd like me to analyze using research-based pedagogical frameworks?"
    And a "Yes, Analyze" / "No" choice is offered
    # Verified live on PROD (2026-08-04) with fixture hameeda_classroom.m4a (25 MB,
    # ~26 min): the bot read the duration correctly ("I detected a 26-minute audio
    # recording") and offered Yes,Analyze / No. Upload via Attach → **Document** (the
    # "Audio" item silently fails under Chrome-MCP — see interaction-map). Duration
    # gate: voice-message.handler.js:724 / whatsapp-bot.js:1773 (>=15 min = classroom).

  @e2e @content-driven @P2
  Scenario: Confirming analysis walks a 5-step pipeline with optional-context prompts
    Given the NIETE bot chat is open
    And I have uploaded a classroom recording and it was detected
    When I tap "Yes, Analyze"
    Then the bot posts "Step 1/5: Transcribing your classroom audio"
    And for a long recording it warns "Long Lesson Detected" and that analysis will take longer
    And it acknowledges the lesson (e.g. "Great job, Teacher! …engaging <N>-minute lesson")
    And it asks whether I want to share a classroom photo to improve the analysis
    And when I decline it asks whether I have a lesson plan for this class
    And when I decline it replies "No problem! I'll analyze your classroom audio without the lesson plan."
    And it continues "Step 2/5: Analyzing your teaching using research-based pedagogical frameworks"
    And then "Step 3/5: Let's reflect on your teaching together"
    # Verified live on PROD (2026-08-04), fixture hameeda_classroom.m4a (26 min):
    # after "Yes, Analyze" the pipeline emits numbered progress steps AND two optional-
    # context prompts BETWEEN transcription and analysis — a classroom-photo offer and
    # a lesson-plan offer, both rendered in URDU with ہاں/نہیں (Yes/No) buttons even
    # though the account's other copy was English (possible i18n leak — see F-COACH1).
    # Declining both proceeds "without the lesson plan". Steps advance ~1 min apart.

  @e2e @slow @content-driven @P2
  Scenario: The pipeline delivers coaching feedback on the FICO/ICT rubric
    Given the NIETE bot chat is open
    And I have confirmed analysis and answered the optional-context prompts
    When the async worker finishes steps 4/5 and 5/5
    Then it returns coaching feedback referencing the FICO / ICT rubric
    # @wip @slow: for a LONG (~26-min) recording the worker takes 10+ minutes —
    # "Long Lesson Detected" is the bot warning you of exactly this. Driven live
    # 2026-08-04: reached Step 3/5 ("Let's reflect on your teaching together") ~6 min
    # in; the final graded report had not landed within the run window. Rubric:
    # bot/shared/services/observe/observe-framework.js.

  @known-issue
  Scenario: The two coaching entry points quote different minimum audio lengths
    Given the NIETE bot chat is open
    When I reach coaching from the menu versus from a keyword request
    Then the stated audio length differs (15 minutes vs up to 20 minutes)
    # F4: menu.service.js:265 says "at least 15 minutes" while
    # feature-keyword-detector.service.js says "up to 20 minutes" — one copy source
    # should own the number. Documented, not asserted in the default run.

  # ═══════════ ADDED 2026-08-04 · draft coverage from the feature-map (code-grounded, @wip) ═══════════
  # The verified scenarios cover intake → confirm → the 5-step pipeline. These add
  # the uncovered legs: the reflective step, the hero-report delivery shape, the
  # in-flight guard, session cancel, document rejection, and two orphan bugs.
  # All @wip @draft, excluded from safe runs until verified.

  # ── POSITIVE ──
  @e2e @wip @draft @P2
  Scenario: The reflective step asks exactly one question and closes after the answer
    Given the NIETE bot chat is open
    And my coaching analysis has reached the reflective step (3/5)
    When the bot asks its reflection question and I answer it
    Then the bot acknowledges my answer and moves to generate the report — it asks only ONE question
    # reflective-conversation.service.js — NUM_REFLECTIVE_QUESTIONS=1 (S.T.I.C.K.S.,
    # was 3). The question is delivered as a voice note (ElevenLabs); after one answer
    # → contextual acknowledgement → queue report.

  @e2e @content-driven @P2
  Scenario: Coaching feedback is delivered as a branded hero-report image
    Given the NIETE bot chat is open
    And a coaching analysis has finished
    Then the feedback arrives as a NIETE-branded hero-report PNG with a caption (not a plain PDF)
    # report-generator.service.js → report-v2/hero-report.service.js (Playwright
    # htmlToImage, brand:'niete') → sendImage + caption. A PDF is only the fallback
    # if the hero render throws. (The @wip rubric scenario above asserts CONTENT; this asserts FORM.)

  @e2e @wip @draft @P3
  Scenario: Accepting the classroom-photo prompt folds photos into the analysis
    Given the NIETE bot chat is open
    And the coaching pipeline has asked whether I want to share a classroom photo
    When I tap Yes and send a photo
    Then the bot collects it (up to 3) and folds it into the analysis
    # coaching classroom-photo sub-flow; photo receipt image-message.handler.js:87-208
    # (Redis setNX dedup, MAX 3 → auto-analyze). (The verified pipeline DECLINES this;
    # this covers the ACCEPT branch.)

  # ── EDGE ──
  @e2e @wip @draft @edge @P2
  Scenario: A second recording sent mid-analysis is deferred, not started fresh
    Given the NIETE bot chat is open
    And a coaching analysis is already in flight
    When I upload another classroom recording within 30 minutes
    Then the bot acknowledges it is still analysing the first and does NOT start a new session
    # coaching-inflight-guard.js shouldDeferNewClassroomAudio (bd-2376) →
    # coaching_stillAnalysing ack. Stuck >30min or terminal → a new session is allowed.

  @e2e @wip @draft @edge @P2
  Scenario: A slash command during the reflective step ends the session
    Given the NIETE bot chat is open
    And I am at the coaching reflective step
    When I send any slash command (e.g. "/menu")
    Then the reflective conversation ends and the command runs
    # bd-2508 — text-message.handler.js:1276: any slash command ends the reflective
    # conversation (status → abandoned) and falls through to the command.

  # ── NEGATIVE ──
  @e2e @wip @draft @negative @P2
  Scenario: A teacher's under-15-minute recording does not start a coaching analysis
    Given the NIETE bot chat is open
    And I have chosen Classroom Coaching (awaiting audio)
    When I upload a classroom audio recording shorter than 15 minutes
    Then the bot does NOT start the coaching pipeline — no "I detected a <N>-minute audio recording", no "Yes, Analyze" choice, and no "Step 1/5: Transcribing…"
    And the short clip is handled gracefully as an ordinary voice message, not analysed as a classroom recording
    # Duration gate: CLASSROOM_AUDIO_THRESHOLD = 900s (voice-message.handler.js:725 &
    # whatsapp-bot.js:1774) — only audioDurationRounded >= 900 is classified as classroom
    # coaching; a shorter clip falls through to normal voice handling. There is currently
    # NO explicit "too short — please send 15+ minutes" rejection in the awaiting-audio
    # state → possible UX gap: a teacher who sends, say, a 10-minute clip expecting
    # coaching gets a normal conversational reply, not a "minimum length" nudge. Consider
    # adding an explicit too-short message that restates the 15-minute minimum.
    # ⚠ SAFETY-NET GOTCHA (voice-message.handler.js:735-761): if WhatsApp UNDER-reports the
    # duration AND file_size >= 500KB, the handler re-probes the real bytes with ffprobe and
    # may PROMOTE a "short" clip to classroom. So the fixture must be GENUINELY short AND
    # small (< 500KB) or it gets promoted and the test is invalid.
    # PRECONDITIONS (why @wip @draft, not yet driven live): (1) a TEACHER-role driver — on
    # a leader/observe-role account the upload routes to /observe ("no observation waiting"),
    # never reaching the coaching duration gate (confirmed live 2026-08-05); (2) a real
    # <15-min, <500KB audio fixture (the current hameeda_classroom.m4a is ~26 min / 25 MB).
    # Assert the CONTRACT (no coaching pipeline; handled as a normal voice note), not exact copy.

  @e2e @negative @P2
  Scenario: Declining analysis cancels the coaching session
    Given the NIETE bot chat is open
    And I have uploaded a recording and been asked to confirm analysis
    When I tap "No"
    Then the bot cancels the session and tells me nothing will be analysed
    # coaching-session.service.js handleConfirmation:110 — cancel → status cancelled,
    # localized exitedNoAudio. (Counterpart to the "Yes, Analyze" pipeline scenario.)

  @e2e @wip @draft @negative @P2
  Scenario: A non-lesson-plan document is rejected, not silently analysed
    Given the NIETE bot chat is open
    And the coaching flow asked for a lesson plan and I upload a non-LP document (e.g. a leave letter)
    Then the bot tells me it is not a lesson plan rather than analysing it
    # bd-2372 — lesson-plan-extraction.worker.js isLikelyLessonPlan guard →
    # not_lesson_plan notification.

  @e2e @wip @draft @negative @P3
  Scenario: An audio document over the size cap is rejected before download
    Given the NIETE bot chat is open
    When I upload an audio document larger than the size cap
    Then the bot replies that the file is too large before processing it
    # audio-document-router.js classifyAudioDocument → reject_too_large
    # (buildTooLargeMessage). NB the reject copy still says "25MB"/"Whisper" though
    # the real cap is 100MB Soniox — assert the reject, flag the stale number.

  @e2e @wip @draft @negative @known-fail @P3
  Scenario: The commitment-card buttons on the report are handled
    Given the NIETE bot chat is open
    And I have received a coaching report with a commitment card
    When I tap "Yes" on the commitment card
    Then the bot records my commitment
    # ⚠ ORPHAN BUG: card_yes_/later_/no_ have NO handler (card-response.service.js is
    # never called) → prioritized_action.teacher_response never becomes 'yes' and the
    # agency reminder can't fire. Expected to FAIL until wired.
