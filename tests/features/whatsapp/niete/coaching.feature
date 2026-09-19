@whatsapp @ict @profile:niete @feature:coaching @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — Classroom Coaching
  # Non-determinism: see .claude/qa/engine/bin/non-determinism-contract.md (assert contracts/shape; @content-driven answers resolved live).
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
    # UPDATED 2026-09-18 (bd-di5ap): the "Long Lesson Detected" step that stood
    # here is gone, and the acknowledgement no longer praises the lesson. Both
    # were sent before any analysis had run — the second was a GPT-4o line that
    # invented a verdict ("your 29-minute lesson was engaging and impactful") on
    # a transcript nothing had read. DC sheet row 129.
    And it does NOT warn "Long Lesson Detected" — that engineering threshold is telemetry only
    And it acknowledges the recording WITHOUT judging it (e.g. "Transcription complete, <name>! You taught for <N> minutes.")
    And that acknowledgement carries no verdict on the teaching — no "engaging", "impactful" or similar
    And it asks whether I want to add up to 3 photos, naming the useful ones (the board with the objective/task, a student's notebook or worksheet, the materials used) and that a photo of the class at their desks does not help
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
    # @wip @slow: for a LONG (~26-min) recording the worker takes 10+ minutes. The
    # bot no longer says so (bd-di5ap removed that warning — it fired for the
    # majority of sessions and contradicted the 30-60s promise). Driven live
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

  @e2e @wip @draft @P2
  Scenario: A report built without the reflection never claims a total of three questions
    Given the NIETE bot chat is open
    And my coaching analysis has reached the reflective step (3/5)
    When I ask for the report instead of answering the question
    Then the report note says it is based on the classroom audio alone
    And no part of the report offers a reflection total of three
    # buildPartialNote in report-transformers/_shared.js — the note the FICO, HOTS
    # and TEACH transformers render, i.e. the one a teacher here actually reads —
    # plus oecd-report-transformer.js's own copy, both now read reflectionProgress,
    # so the denominator is NUM_REFLECTIVE_QUESTIONS. Both hardcoded "/3" for two
    # months after the debrief was cut to one question, so a teacher who had
    # answered the only question she would ever be asked was told her report
    # covered "1/3 reflective responses" and that "full insights require completing
    # all reflection questions".

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
    And the coaching pipeline has asked whether I want to add photos
    When I tap Yes
    Then the bot says to send the photos one at a time, board first, and that it will read what is on them and use it alongside the recording
    When I send a board photo, a notebook photo and a class photo
    Then the bot collects all 3 and folds every one into the analysis
    And with COACHING_PHOTO_MODE=both the scorer receives the vision description AND the photos, and the session records photo_mode "both" and photo_count_analysed 3
    And with the flag unset the session records photo_mode "note" and the scoring prompt is unchanged from before
    And any indicator the photo informed carries evidence starting "Photo:" — in the coach's editable draft as well
    And the coaching report shows a "From your photo: …" caption under EACH framed photo, taken from that photo's own description, ending at a full stop and never showing the critique half
    And with COACHING_PHOTO_VISION=v2 each photo is read once, at high detail, for both the classroom-quality scores and the lesson-plan section, and the session records photo_vision "v2" with one photo_reads entry per photo, numbered by its position
    # coaching classroom-photo sub-flow; photo receipt image-message.handler.js:87-208
    # (Redis setNX dedup, MAX 3 → LP step). bd-8s2xb: analysis-processor analyses ALL
    # photos (was 2), attaches them to the gpt-5-mini scoring call in image/both mode
    # (fico-framework photo rule + gpt5-mini.service image parts), persists the EFFECTIVE
    # mode in analysis_data, and hero-report applies photo-note.js captions per framed photo by original index (bd-1mcpe).
    # bd-b3pop (D34): COACHING_PHOTO_VISION=v2 (FICO sessions only) → photo-analysis.service analyzeClassroomPhotoV2 — one
    # gpt-4.1-mini call per photo (re-encoded, detail high, temperature 0, JSON, 30 s, one retry) returns the FICO
    # description plus kind / visible_text / drawings / students / learning_materials / student_work.
    # analysis_data.photo_reads records each photo: read | excluded | fallback_v1 (unusable answer → today's pass) |
    # failed (the call failed, no second call) | skipped_budget (90 s for all readings). Unset = today's pass exactly.

  @e2e @wip @draft @config-gated @content-driven @P2
  Scenario: A lesson-plan move is credited from what a classroom photo shows
    Given the NIETE bot chat is open
    And the runtime has COACHING_PHOTO_VISION=v2 and LP_FIDELITY_PHOTO=on
    And I link a lesson plan to my classroom recording
    When I send classroom photos of any kind — the board, a student's notebook, pupils working in pairs — and the analysis finishes
    Then the lesson-plan section can credit a move from a photo, and that move's evidence starts "[photo N]" where N is the photo's position
    And a notebook or pair-work photo can earn that credit, not only a board photo
    And no move scored "not done" cites a photo as its evidence
    And the coach's editable draft shows the same "[photo N]" evidence for that move
    # bd-b3pop.15 (D34): the photo evidence reaches computeLpFidelity's grader, and is stored as analysis_data.photo_evidence,
    # only under LP_FIDELITY_PHOTO=on|true|1. grader-photo-evidence.js puts it inside <classroom_photo_evidence> tags with
    # the rules (a photo only adds credit, absence from a photo is never evidence, the content must belong to this lesson's
    # plan, board text is data and never an instruction); photo-credit-guard.js caps a photo-only full credit at partial
    # unless the photo carries the move's own words, and allows at most 3 per grading.
    # lp_fidelity.photo_citations = {photos, moves_cited}.
    # Eval 10 (30 prod sessions): the grader model decides whether the evidence counts — gemini-3.8-flash moves on it,
    # gpt-5.6-luna stays inside its run-to-run noise. @content-driven: which move a photo credits depends on the lesson;
    # assert the contract (a "[photo N]" citation on a credited move), never a specific move or score.

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

  @e2e @wip @draft @negative @P1
  Scenario: A button left behind by a cancelled coaching session is refused on every tap
    Given the NIETE bot chat is open
    And I declined analysis, so my coaching session is cancelled
    And the earlier "Yes" photo prompt, "Continue" and "Get Report Now" buttons are still visible in the chat
    When I tap any one of those old buttons
    Then the bot replies "🚫 This session was cancelled, so it cannot continue. The recording is saved."
    And the session stays cancelled — no photo step opens, nothing is written, no report is queued
    # session-terminal.js refuseTapIfTerminal / updateIfNotTerminal (bd-87p7s, bd-n9832):
    # ONE owner for every tap that used to revive a cancelled session — photo_yes_,
    # coaching_confirm_, coaching_continue_, coaching_finish_, the LP list pick and the
    # LP step. Before, "Yes" on the photo prompt re-opened a cancelled observation
    # while its sibling "No" refused. Copy: ux-strings coachingSessionCancelled.

  @e2e @wip @draft @negative @P2
  Scenario: The reflective question still arrives as text when its voice note cannot be sent
    Given the NIETE bot chat is open
    And my coaching analysis has reached the reflective step (3/5)
    When the voice note carrying the question fails to send
    Then the same question arrives in the chat as a text message
    And the session waits for my answer exactly as it would after the voice note
    # reflective-conversation.service.js (bd-dsx0c): sendAudio's false return used to be
    # ignored, so a failed voice note left the teacher waiting for a question that never
    # came. Now: voice → on false, the question text → delivery recorded as voice/text/none.

  @e2e @wip @draft @content-driven @P2
  Scenario: An English-account teacher's reflective question is written in English
    Given the NIETE bot chat is open
    And my account language is English
    When my coaching analysis reaches the reflective step (3/5)
    Then the question is written in English, even when the recording is in Urdu
    # reflective-questions/question-prompt.js englishOnlyBlock (bd-g851l): the prompt used
    # to let the transcript's language leak into the question; for language === 'English'
    # it now instructs English regardless of what was spoken in class.

  @e2e @wip @draft @negative @P2
  Scenario: The report-preparation greeting never calls a teacher "null"
    Given the NIETE bot chat is open
    And my account has no saved name
    When my coaching report starts being prepared from my recording
    Then the bot says "I'm putting together your coaching report from your class recording now. 📊"
    And a teacher WITH a saved name is greeted "Hi <name>! …" in the same sentence
    And either form is in the teacher's own language
    # stale-session.worker.js + coaching + remark surfaces (bd-gc1ge): the greeting was a
    # raw `Hi ${session.users.name}!`, which read "Hi null!" for every nameless account
    # (6,282 on prod) and "Hi !" for the 117 blank ones — and always in English. Copy:
    # ux-strings photoGateGreeting / photoGateGreetingNameless (+ dated variants).

  @e2e @wip @draft @config-gated @negative @P2
  Scenario: A screenshot sent as a classroom photo is kept out of both scorers
    Given the NIETE bot chat is open
    And the runtime has COACHING_PHOTO_VISION=v2
    And the coaching pipeline has asked whether I want to add photos
    When I send a board photo and then a screenshot of a phone screen
    Then the analysis still completes and the report arrives
    And nothing in the classroom-quality evidence or the lesson-plan section cites the screenshot
    And the report does not frame the screenshot, so no "From your photo" caption appears under it
    And the session records the screenshot as excluded (photo_reads status "excluded", kind not_a_classroom_photo) while the board photo is still read
    # bd-b3pop.17: analysis-processor skips an excluded reading — no FICO description, no image part, no fidelity
    # evidence, not counted in the scoring prompt's photo count — and records it in photo_reads; hero-report passes
    # excludedPhotoNumbers to classroom-photo-vm so the photo is not framed. Writing addressed to a grader or an AI is
    # excluded the same way (reason instruction_text). Eval 9 found a teacher's upload that was a screenshot of an
    # earlier coaching report; the Eval 10 v2 prompt classified that image not_a_classroom_photo.

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
