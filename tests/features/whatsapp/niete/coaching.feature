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
    Then the bot reply contains "Record your lesson with the WhatsApp mic"
    And the bot reply asks for 20 to 45 minutes of the lesson
    And the bot reply does not say "at least 15 minutes"
    # UPDATED 2026-09-22: the menu door now sends the catalog
    # string lpAskYesReply (menu.service _handleClassroomCoachingChoice) — the same
    # instruction the lesson-plan coaching ask's "Record my lesson" sends. The old
    # "at least 15 minutes" was the routing threshold, not an ask.

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
    # UPDATED 2026-09-20 (DC row 130): the account language is now stated. Every
    # quoted step below is the ENGLISH string, and steps 1 and 2 used to be
    # English for everyone regardless of preference — so this scenario passed for
    # an Urdu teacher too, by way of the bug. It is an English-account scenario
    # now that all five steps follow the preference; the Urdu path is its own
    # scenario below.
    And my account language is English
    And I have uploaded a classroom recording and it was detected
    When I tap "Yes, Analyze"
    Then the bot posts "Step 1/5: Transcribing your classroom audio"
    # UPDATED 2026-09-18 (bd-di5ap): the "Long Lesson Detected" step that stood
    # here is gone, and the acknowledgement no longer praises the lesson. Both
    # were sent before any analysis had run — the second was a GPT-4o line that
    # invented a verdict ("your 29-minute lesson was engaging and impactful") on
    # a transcript nothing had read. DC sheet row 129.
    #
    # UPDATED 2026-09-20 (bd-59840): the acknowledgement is gone too. Row 129
    # asked for NO extra messages between Step 1/5 and the photo prompt, and an
    # acknowledgement is still an extra message. The same change made Step 1/5
    # state the real wait: nothing shorter than 15 minutes reaches this pipeline
    # (CLASSROOM_AUDIO_THRESHOLD = 900) and transcription was measured in the
    # 880-990s band, so "30-60 seconds" was wrong by more than an order of
    # magnitude — and the warning that used to qualify it had just been removed.
    And that step states the wait in minutes and does NOT promise "30-60 seconds"
    And it does NOT warn "Long Lesson Detected" — that engineering threshold is telemetry only
    And it sends NO acknowledgement of the recording at all before the photo prompt
    And in particular no message carries a verdict on the teaching — no "engaging", "impactful" or similar
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
    And Step 5/5 is followed by the voice note ITSELF — exactly one message stands
    And that one message is the Step 5/5 announcement, in my own language, not a second line restating it
    # UPDATED 2026-09-20 (bd-sk206, DC row 132): a caption used to sit between
    # Step 5/5 and the audio — "🎤 Here's your personalized voice summary:". In
    # Urdu it restated the announcement almost word for word (both "a summary …
    # in audio"), differing only by verb aspect at the END of the sentence, so
    # the reporter read Step 5 as one message sent twice. English hid it: there
    # the step label and "Creating…" vs "Here's…" separate them up front. The
    # caption is gone; the ANNOUNCEMENT stays, because it covers a real wait —
    # median 39.7s between the two across 586 sessions on 18 Sep 2026 (niete-logs;
    # min 15s, p95 55s, max 242s). Assert the COUNT and which one survived, not
    # the wording of the removed line.
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
    Then the stated audio length differs (20 to 45 minutes vs up to 20 minutes)
    # F4: the menu door now asks for 20 to 45 minutes (lpAskYesReply, 2026-09-22)
    # while feature-keyword-detector.service.js still says "up to 20 minutes" —
    # one copy source should own the number. Documented, not asserted.

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

  @e2e @wip @draft @P1
  Scenario: The same recording sent twice returns the report already made, not a second score
    Given the NIETE bot chat is open
    And I have already received a coaching report for a classroom recording
    When I upload that exact same recording file again
    Then the bot tells me it has heard this recording before
    And the bot sends back the report it already made for that recording
    And it comes back as an IMAGE, the same way the first report arrived — openable, not a .pdf that will not render
    And no new 5-step analysis is started
    # bd-7beiz — audio-hash-cache.js: SHA-256 of the downloaded audio, matched against
    # this teacher's own completed DC sessions inside a 7-day window.
    # transcription-processor short-circuits BEFORE the R2 upload and before
    # transcription, so a duplicate costs neither ASR nor LLM. Why it matters: the
    # rubric pass runs at temperature 1 with no seed, so re-scoring identical audio
    # moved the overall by a mean of 5.9 points across 1,515 measured duplicate
    # groups — one lesson must not yield a teacher two different numbers.
    # bd-5tgzv — delivery must MATCH the original. `report_pdf_url` holds a hero
    # PNG on this deployment (12,749 of 12,754 completed DC sessions; zero PDFs),
    # so resending it as 'classroom-observation.pdf' shipped PNG bytes labelled as
    # a PDF and no reader would open it — FEAT-098 again.

  @e2e @wip @draft @P2
  Scenario: A recording the bot has not scored before is still analysed normally
    Given the NIETE bot chat is open
    And I have already received a coaching report for a classroom recording
    When I upload a different classroom recording
    Then the 5-step analysis starts as usual
    And the bot does NOT say it has heard this recording before
    # bd-7beiz — the match is on the exact bytes, so only a bit-for-bit identical
    # resubmission is short-circuited; a re-recorded or new lesson hashes differently
    # and takes the normal path. Guards the failure mode where a lookup matches too
    # broadly and silently swallows new work.

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

  @e2e @wip @draft @P1
  Scenario: An Urdu teacher's five step messages are all in Urdu, counted in digits
    Given the NIETE bot chat is open
    And my account language is Urdu
    And I have uploaded a classroom recording and it was detected
    When I tap the confirm-analysis button
    Then every one of the five step messages is in Urdu — steps 1 and 2 included
    And no step message is in English
    And each counter reads "مرحلہ 1/5" through "مرحلہ 5/5" — standard digits, only the word translated
    And no counter uses Urdu numeral glyphs such as "۱ از ۵"
    And the digits render left-to-right inside the Urdu sentence, not reordered
    # ADDED 2026-09-20 (DC rows 130 + 131). Row 130: steps 1 and 2 were sent with
    # no language argument at all, so `languageCode = 'en'` addressed every
    # teacher in English while steps 3/4/5 resolved her preference — one session,
    # two languages. transcription-processor.service.js and
    # analysis-processor.service.js now pass the resolved language, and their
    # defaults are offerDefaultLanguage() (Urdu here), not 'en'.
    #
    # Row 131: the counter was Urdu numeral glyphs. It is digits now, wrapped in
    # LRI…PDI (U+2066…U+2069) — the last step matters because a bare "1/5" is a
    # neutral run with a neutral separator, which an RTL paragraph reorders. That
    # is why the reordering assertion is separate from the glyph one: the string
    # can be right in the source and wrong on the screen.
    #
    # A teacher who never picked a language belongs on THIS path, not the English
    # one: LANGUAGE_OFFER is ['ur','en'], so the floor is Urdu.

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

  @e2e @wip @draft @negative @P1
  Scenario: A grader answer that comes back empty is re-graded the same way, not on a more generous setting
    Given the NIETE bot chat is open
    And I link a lesson plan to my classroom recording
    When the grader's first answer comes back empty and the second one succeeds
    Then my lesson is graded on the same settings as everyone else's, not on a faster cheaper one
    And the session's lp_fidelity records that the grading came from a retry, so a degraded answer is never invisible
    # bd-29r3o: fidelity-analyzer used to add `reasoning: {effort:'low'}` to the retry after an empty first answer —
    # written for GLM/DeepSeek, which answer empty without a reasoning budget (Eval 8), and never revisited when the
    # model became Gemini 3.8 Flash, where `low` means thinking OFF: the arm Eval 12 §8 rejected (false credit on
    # reader-not_done 15–17% against 5–9%, κ 0.45 against 0.56). Found on the first prod morning of D37 — session
    # b9698b1d carried reasoning_effort "low" although the variable is unset on all three services; it had fired on 1 of
    # the first 5 Gemini gradings. The retry now keeps the configuration; the coaxing retry lives behind
    # LP_FIDELITY_EMPTY_RETRY_EFFORT (unset in prod) and the blob carries empty_retry.

  @e2e @wip @draft @negative @P1
  Scenario: A recording whose transcript carries no timestamps is "not scored", never 0%
    Given the NIETE bot chat is open
    And I link a lesson plan to my classroom recording
    When the transcription comes back without a single [MM:SS] timestamp and the analysis finishes
    Then the lesson-plan section of the report says the recording could not be matched to the plan move by move, and shows no percentage
    And Section B carries no fidelity score and the coach's editable draft shows the not-assessable explanation instead of per-move ratings
    And the session's lp_fidelity has status ok, fidelity_pct null, recording_unusable true, every move not_adjudicable, moderators.note "recording_unusable" and unusable_guard "no_timestamps"
    And no fidelity grader call was made for the session (lp_fidelity.model is null and runs is empty)
    # bd-b3pop.31 (Eval 12 §4/§8): fidelity-orchestrator decides this in code right after describeRecording — every
    # verdict above not_done must quote a stamped span, so a stamp-less transcript cannot be adjudicated move by move
    # (D19: "not scored", never 0%). Luna already returned recording_unusable on the D19 fixture; Gemini 3.8 Flash
    # returned 0% + lesson_mismatch in 9 of 12 runs, which would have shown a teacher 0/40 and a mismatch line for a bad
    # recording. On prod (2,685 graded sessions, 15–22 Sep) 2 transcripts had no stamps and both were already unscored.
    # The substitution rules added to grader-prompt.js in the same change (bd-b3pop.32, Eval 12 D37) are a calibration
    # of the grader's verdicts, not a new user-visible flow: Spec-Sync coaching=none-needed for that part.

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

  @e2e @wip @draft @P2
  Scenario: The "was this useful?" survey comes right after the voice debrief
    Given the NIETE bot chat is open
    And I have finished the reflective questions of a coaching session
    When the voice debrief of my report arrives
    Then the next message asks "Was this coaching report useful to you?" with a yes and a no button
    And it arrives before the message saying my coaching session is complete
    And it is asked only once for this session
    # DC feedback 2026-09-23. report-generator sends it inline right after
    # generateAndSendVoiceDebrief(); completeSession() no longer schedules the old
    # +90 s copy. A tap before the session completes creates the metrics row, and
    # recordQualityMetrics updates that row rather than inserting a second.

  @e2e @wip @draft @P2
  Scenario: The commitment question opens by saying the coaching session is over
    Given the NIETE bot chat is open
    And I have received a coaching report with a commitment card
    When the commitment question arrives
    Then that same message first tells me the coaching session is complete
    And then asks whether I will try it in my next class
    And no separate session-complete message follows it
    And the message arrives before any quiz offer
    And the message is in my selected language
    # bd-x3k1q / DC row 133 added the boundary; bd-fmr3s / DC row 137 merged it
    # INTO the commit prompt: body = cardCopy.sessionCompleteLead + "\n\n" +
    # cardCopy.commitPrompt (coaching-card.config.js, en/ur/ar/es). Urdu:
    # "آپ کا کوچنگ سیشن یہاں مکمل ہو گیا ہے۔" then "کیا آپ اگلی کلاس میں یہ آزمانے کا عہد کریں گے؟".
    # With no commitment card, the standalone getCoachingMessage('sessionComplete')
    # line is still sent before scheduleTranscriptQuiz() / suggestNext().

  @e2e @wip @draft @negative @known-fail @P3
  Scenario: The commitment-card buttons on the report are handled
    Given the NIETE bot chat is open
    And I have received a coaching report with a commitment card
    When I tap "Yes" on the commitment card
    Then the bot records my commitment
    # ⚠ ORPHAN BUG: card_yes_/later_/no_ have NO handler (card-response.service.js is
    # never called) → prioritized_action.teacher_response never becomes 'yes' and the
    # agency reminder can't fire. Expected to FAIL until wired.

  @e2e @wip @draft @P1
  Scenario: A lesson plan typed into the chat is attached to the waiting observation
    Given the NIETE bot chat is open
    And the coaching flow has asked me for a lesson plan
    When I paste my lesson plan into the chat as an ordinary message
    Then the bot moves straight on to "Step 2/5" of the analysis
    And no separate "lesson plan received" message arrives before it
    And the bot does not ask me again to send it as a document
    And the observation records that it has a lesson plan
    # Every other way in needs a WhatsApp media id (document webhook, LP-as-photo),
    # so a typed plan used to reach generic AI chat and the observation stayed
    # without one. lp-text-paste.service.js pre-filters the text, resolves the
    # session through media-session-resolver (kind 'lp'), and hands it to
    # LessonPlanProcessorService.handlePastedLessonPlan, which stores it as
    # lesson_plan_text with lesson_plan_link_method='pasted'. It sends NO ack of
    # its own (DC feedback 2026-09-23): the old "thanks for typing it out" line
    # arrived just before Step 2/5 and read as the same message twice.

  @e2e @wip @draft @negative @P2 @obsolete
  Scenario: A short reply at the lesson-plan step is not mistaken for a plan
    Given the NIETE bot chat is open
    And the coaching flow has asked me for a lesson plan
    When I send a short reply such as "no" or the teacher's name
    Then the bot does not treat it as a lesson plan
    And the observation still has no lesson plan attached
    # The pre-filter is deliberately strict — a paste must clear a length floor
    # AND name several parts of a plan. A false positive would eat the message,
    # so short answers keep the existing behaviour (the LP prompt is re-sent).
    # OBSOLETE 2026-09-22 (bd-cq1go): the operator set the rule that whatever a
    # teacher sends at the lesson-plan step is considered, so the length floor it rests on is gone.
    # What counts as a plan is settled downstream by the extraction worker,
    # never by measuring her text before agreeing to read it.

  @e2e @wip @draft @negative @P3
  Scenario: Pasted text that is not a lesson plan gets the same rejection as a file
    Given the NIETE bot chat is open
    And the coaching flow has asked me for a lesson plan
    When I paste a long message that is not a lesson plan
    Then the bot tells me it is not a lesson plan rather than referencing it
    And the classroom recording is still analysed
    # The authoritative verdict is not the pre-filter: a paste runs the SAME
    # extraction job as an upload, so isLikelyLessonPlan decides, and the
    # not-a-lesson-plan reply now names the paste route among the retry options.

  @e2e @wip @draft @P1
  Scenario: A brief typed lesson plan counts — length is not the test
    Given the NIETE bot chat is open
    And the coaching flow has asked me for a lesson plan
    When I type a three-line plan naming the topic, an activity and how I will check learning
    Then the bot moves straight on to "Step 2/5" of the analysis
    And the observation records that it has a lesson plan
    # The first live attempt failed here: a real 222-code-point Roman-Urdu plan
    # was refused by a 280-point floor fitted to long formatted pastes, while
    # the session sat waiting for one. What makes a paste a plan is the
    # evidence in it, not its size; the floor only keeps one-liners out.

  @e2e @wip @draft @negative @P2 @obsolete
  Scenario: Saying I have no lesson plan is not the same as sending one
    Given the NIETE bot chat is open
    And the coaching flow has asked me for a lesson plan
    When I reply that I do not have a lesson plan for this class
    Then the bot does not record that reply as my lesson plan
    # A teacher explaining she has no plan NAMES one, so she clears the marker
    # bar; the old length floor excluded her only by accident. Checked in
    # English, Roman Urdu and Urdu.
    # OBSOLETE 2026-09-22 (bd-cq1go): the operator set the rule that whatever a
    # teacher sends at the lesson-plan step is considered, so she now reaches the same judge a PDF does and gets the No-button outcome.
    # What counts as a plan is settled downstream by the extraction worker,
    # never by measuring her text before agreeing to read it.

  @e2e @wip @draft @negative @P2 @obsolete
  Scenario: Talking about a lesson plan is not the same as sending one
    Given the NIETE bot chat is open
    And the coaching flow has asked me for a lesson plan
    When I describe in one sentence the lesson I just taught, or ask how to write a plan
    Then the bot does not record what I typed as my lesson plan
    # Naming the parts of a plan is not enough on its own at this length — a
    # teacher narrating her lesson names the topic, an activity and how she
    # checked learning, all in one flowing sentence. A plan that short is
    # LAID OUT: a label, a line per step, a numbered list.
    # OBSOLETE 2026-09-22 (bd-cq1go): the operator set the rule that whatever a
    # teacher sends at the lesson-plan step is considered, so the layout rule it rests on is gone.
    # What counts as a plan is settled downstream by the extraction worker,
    # never by measuring her text before agreeing to read it.

  # ═══════════ ADDED 2026-09-22 · the coaching ask on the first lesson plan of the day (@wip) ═══════════
  # lp-coaching-ask.service: a lesson plan delivered before 14:00 PKT books ONE ask
  # LP_COACHING_ASK_DELAY_MINUTES later (07:30 next school day after 14:00), one per
  # teacher per PKT day by the teacher_nudges UNIQUE. Needs TEACHER_NUDGES_ENABLED and
  # LP_COACHING_ASK_ENABLED on the sandbox bot + sqs-worker; the driver's role is
  # 'teacher' (coaches are never asked). Driven and promoted by the E2E lane.

  @e2e @wip @draft @lp-ask @P1
  Scenario: The first lesson plan of the day brings one coaching ask
    Given the NIETE bot chat is open
    And no coaching ask has been sent to me today
    And my last message to the bot was under 24 hours ago
    When I take a lesson plan before 14:00 PKT
    And I wait for the coaching-ask delay plus one sweep
    Then the bot sends a message that begins "You planned a lesson with me today"
    And it has the buttons "Record my lesson" and "Not today"

  @e2e @wip @draft @lp-ask @negative @P1
  Scenario: A second lesson plan the same day brings no second ask
    Given the NIETE bot chat is open
    And I took a lesson plan earlier today and the coaching ask was booked
    When I take another lesson plan the same day
    And I wait for the coaching-ask delay plus one sweep
    Then no second coaching ask arrives today

  @e2e @wip @draft @lp-ask @P2
  Scenario: Not today is remembered
    Given the coaching ask is on screen
    When I tap "Not today"
    Then the bot replies that Classroom Coaching is in the menu whenever I want it
    And nothing else about coaching is sent to me today
    And my answer is stored as "no" on today's ask

  @e2e @wip @draft @lp-ask @P1
  Scenario: Yes asks for a 20–45 minute mic recording, with the how-to clip the first two times
    Given the coaching ask is on screen
    And the how-to clip is configured for my language
    When I tap "Record my lesson"
    Then the bot reply contains "Record your lesson with the WhatsApp mic"
    And the bot reply asks for 20 to 45 minutes of the lesson
    And my conversation is waiting for a classroom recording
    # The clip (LP_COACHING_HOWTO_VIDEO_EN/_UR) is sent before the ask on the first
    # and second asks only (feature intro 'lp_coaching_howto', count < 2).

  @e2e @wip @draft @lp-ask @negative @P1
  Scenario: An 11-minute recording after yes is answered as too short
    Given I tapped "Record my lesson" within the last 8 hours
    When I send an 11-minute voice note
    Then the bot replies that the recording is about 11 minutes and too short to coach
    And the bot says it has not analysed this recording
    And the recording is not answered as a chat question
    # Keyed on the PROBED length (ffprobe runs on files >= 500 KB). Under 5 minutes
    # is an ordinary voice message; 15 minutes and over starts coaching as always.

  @e2e @wip @draft @lp-ask @P2
  Scenario: A classroom-length voice note gets no "send it as a document" warning
    Given the NIETE bot chat is open
    And I have chosen Classroom Coaching (awaiting audio)
    When I send a 20-minute recording with the WhatsApp mic button
    Then the bot detects a classroom recording and starts the coaching flow
    And no message tells me to send the recording as a document

  @e2e @coaching @quiz @wip @draft @config-gated @negative @P2
  Scenario: Saying yes to the coaching ask means no quiz offer arrives that afternoon
    Given the NIETE bot chat is open on a teacher who took a lesson plan this morning
    And the coaching ask that followed it arrived
    When I tap "Record my lesson"
    Then the bot asks for the recording
    And when the afternoon quiz offer is built I am left out of it, with the reason recorded as coaching_yes_today
    And I am not asked twice in one day
    # R8 D5, the operator's message-budget rule: a teacher who has agreed to record gets the
    # coaching-born quiz offer after her report, so offering an LP-born one the same afternoon would
    # be the second ask of the day for the same thing. teacher_nudges carries the skip and its reason,
    # so a teacher who was deliberately left alone is countable, not invisible.
    # @wip — authored with the change, driven and promoted by the sandbox E2E run.
