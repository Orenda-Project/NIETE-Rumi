@whatsapp @ict @profile:niete @feature:observe @persona:coach
Feature: NIETE (ICT) WhatsApp bot — Classroom Observation (/observe, coach/officer)
  # Non-determinism: see .claude/qa/shared/non-determinism-contract.md (assert contracts/shape; @content-driven answers resolved live).
  # ═══════════════════════════════════════════════════════════════════════════
  # STATUS: PARTIALLY PROMOTED (2026-08-04). The entry + scheduling path was driven
  # LIVE on niete-prod (923206281951) from a coach account (role flipped to 'coach'
  # via the registration "Your Role" picker — the product-native way, no DB write):
  # DENY(teacher) · onboarding · visit entry · scheduling menu · school→teacher→brief
  # · schedule-a-visit · long-audio-no-state — all now carry a "Verified live on PROD
  # (2026-08-04)" note and have dropped @wip @draft. The CAPTURE → FICO form → debrief
  # → send-report scenarios remain @wip @draft (NOT driven — they fabricate a real
  # observation record against a real teacher + message a real teacher; need a
  # throwaway test teacher, never a real ICT roster teacher). Exact copy for the
  # promoted set is in answer-keys.yaml (observe.*). @config-gated is retained on all
  # (the feature needs OBSERVE_MEWAKA_FLOW_ID — CONFIRMED SET on niete-prod).
  # OBSERVE FINDING (2026-08-04): the WhatsApp Flow has NO cancel/delete affordance
  # for a scheduled visit — see the @known-issue EDGE scenario below.
  # ═══════════════════════════════════════════════════════════════════════════
  #
  # WHAT THIS IS. /observe is the COACH / OFFICER product — a school-leader,
  # coach, AEO, principal or supervisor records ANOTHER teacher's lesson, scores
  # it on the FICO rubric (37 indicators, scale 1–4), is coached on their own
  # debrief, then sends a report to the teacher. This is a different persona from
  # the teacher self-serve suite; the existing 55 scenarios do NOT touch it.
  #
  # GATING (verified in code, observe-gate.js:56-70):
  #   1. process.env.OBSERVE_MEWAKA_FLOW_ID must be set  → else the gate returns
  #      {match:false} and the message falls through (a teacher is unaffected).
  #      So the WHOLE feature is @config-gated on that env var at runtime.
  #   2. user.role ∈ LEADER_ROLES = school_leader | supervisor | coach | principal
  #      | aeo (observe-gate.js:25). A teacher role → deny_role.
  #   There is NO region check in the gate — on NIETE, OBSERVE_FRAMEWORK=fico
  #   makes a leader observation FICO-shaped (observe-gate.js:74-91). The
  #   endpoint/env keep the legacy "mewaka" name (Tanzania FEAT-053 origin).
  #
  # TEST ACCOUNT: needs a throwaway LEADER account (users.role='coach' + school
  # allocations in leader_schools/leader_teachers) — a teacher account CANNOT
  # reach any positive path here. Several scenarios mutate real observation state
  # (@destructive). Never on a personal number.
  #
  # DRIVING: two native Flows — the VISIT PICKER (OBSERVE_VISIT_FLOW_ID,
  # observe-visit-flow.json, 10 screens) and the EDITABLE FICO FORM
  # (OBSERVE_MEWAKA_FLOW_ID, observe-fico-flow.json, 4 domain screens + SUCCESS).
  # Both need a real MCP click on the CTA; picker chrome is Latin-only (bd-2331:
  # Meta list/dropdown secondary text drops Urdu). Inject #main{display:none} for
  # lean Flow snapshots. Audio is uploaded as a Document (Attach → Document; the
  # "Audio" item silently fails under Chrome-MCP).
  #
  # Scenarios grouped POSITIVE · EDGE · NEGATIVE. Tags: @flow (native Flow) ·
  # @audio · @debrief · @harm-gate · @scheduling (OBSERVE_SCHEDULING_UI v2) ·
  # @config-gated · @destructive (mutates observation/debrief state) · @known-fail
  # · @wip @draft (all — pending a live drive).

  # ═══════════════════════════ POSITIVE (happy path) ═══════════════════════════

  @e2e @config-gated @P1
  Scenario: A leader's /observe opens the capture/visit entry point
    Given the NIETE bot chat is open on a LEADER account
    When I send "/observe"
    Then the bot responds with the visit entry "Let's plan your visit. Pick a school, then a teacher — I'll brief you before you walk in." and a "Plan my visit" CTA
    And it does NOT reply with a teacher menu
    # Verified live on PROD (2026-08-04): coach account → visit entry + "Plan my visit".
    # observe-gate.js:70 action 'capture'; observe-command.handler.js:121-177.

  @e2e @first-use @config-gated @P2
  Scenario: First-ever /observe shows the one-time onboarding
    Given the NIETE bot chat is open on a LEADER account that has never used /observe
    When I send "/observe"
    Then the bot sends the 3-step how-it-works onboarding "Welcome to /observe! Here is how it works: 1️⃣ Go to the classroom and record the lesson (audio) 2️⃣ I will send you a pre-filled FICO form — review and edit it 3️⃣ Later: a guided debrief with the teacher, and a summary for them"
    And a follow-up moves me into the visit picker
    # Verified live on PROD (2026-08-04): 'functional' arm (3-step how-it-works),
    # immediately followed by the "Let's plan your visit" entry.
    # observe-command.handler.js action 'onboard'; arm from
    # preferences.observe_onboarding_arm; markOnboarded runs FIRST (idempotent).

  @e2e @content-driven @flow @config-gated @P1
  Scenario: The visit picker walks school → teacher → brief
    Given the NIETE bot chat is open on a LEADER account with school allocations
    When I open the observation visit Flow via "Plan my visit"
    And I pick a school from the school list (assert the list is POPULATED, ≥1 row — do not name a specific school)
    And I pick a teacher for that school (assert the teacher list is POPULATED, ≥1 row — do not name a specific teacher)
    Then a "Support brief" card for that teacher is shown with per-teacher guidance PRESENT (wording resolved live, not asserted) and the FIXED scaffold line "This is guidance to support your visit — not a grade or a ranking."
    And the brief offers "Pick date & time" (schedule) or "Start observation"
    # Verified live on PROD (2026-08-04): school list populated with real ICT schools
    # + rosters (e.g. IMSG(I-V)TUMIAR, 4 teachers); teacher rows "Not yet visited";
    # brief header = teacher + school, "ℹ️ No coaching data for this teacher yet —
    # use this visit to spot it." + 4 "During your visit:" moves. (v2 scheduling UI:
    # the brief leads to Pick-date&time, not straight to audio.)
    # observe-visit-flow.handler.js: INIT → SELECT_SCHOOL → SELECT_TEACHER (18/page,
    # bd-2431) → BRIEF. Data from observe/assignment/leader-source.js.

  @e2e @flow @scheduling @config-gated @P2
  Scenario: The scheduling menu shows live pending-debrief and upcoming counts
    Given the NIETE bot chat is open on a LEADER account
    And OBSERVE_SCHEDULING_UI is enabled
    When I open the observation visit Flow via "Plan my visit"
    Then the MENU shows "Complete debriefs" with a pending count, "My schedule" with an upcoming count, and "Schedule new observation — Pick a school and teacher"
    # Verified live on PROD (2026-08-04): rows "Complete debriefs / No pending debriefs",
    # "My schedule / N upcoming" (went 0→1 after scheduling), "Schedule new observation
    # / Pick a school and teacher". observe-visit-flow.handler.js (v2) MENU live counts.

  @e2e @flow @scheduling @destructive @config-gated @P2
  Scenario: A leader schedules a future observation visit
    Given the NIETE bot chat is open on a LEADER account with OBSERVE_SCHEDULING_UI enabled
    When I open the visit Flow and choose "Schedule new observation"
    And I pick a school, a teacher, a weekday and a time slot
    And I tap "Save schedule"
    Then the Flow shows "Scheduled — <teacher> - <Day DD Mon> at <HH:MM> - <school>"
    And the bot posts "✅ Observation scheduled for <teacher> on <DD Mon> at <HH:MM>. Tap /observe anytime to see your schedule."
    # Verified live on PROD (2026-08-04): TUMIAR → RUBINA BIBI → brief → "Pick date &
    # time" → CalendarPicker (weekends disabled) + Time dropdown (07:30–13:30, 30-min)
    # → Save schedule → "Scheduled" + chat ack. "My schedule" then shows 1 upcoming.
    # @destructive: writes an observation_schedules 'upcoming' row (bd cleanup: no
    # user-facing cancel — see @known-issue below). observe-schedule.service.js saveSchedule.

  @e2e @wip @audio @destructive @config-gated @P1
  Scenario: A leader's recording is captured without a Yes/No confirmation
    Given the NIETE bot chat is open on a LEADER account with a teacher bound (awaiting_audio)
    When I upload a classroom recording (Document, ≥ 15 min)
    Then the bot replies that the audio was received and is being analysed
    And it does NOT ask a Yes/No "analyse this?" confirmation
    And it sends the coach NO teacher-coaching progress lines — no "Step 1/5: Transcribing…" and no "Step 2/5: Analyzing your teaching…"
    # UPDATED 2026-10-01 (Meta bill cut, NO1 / N2-O01, N2-O02): the transcription and analysis jobs
    # are shared with a teacher's own coaching, and both opened with the TEACHER's progress line,
    # in the observed teacher's language, sent to the coach right after "Got the recording … 2–5
    # minutes" (449 + 440 a week). Skipped when observation_type = 'leader_observation'; the
    # teacher's own coaching session still gets both.
    # observe-capture.service.js:56 startFromAudio — inserts a row status
    # 'confirmed' directly (no Yes/No, bd-16), observation_type='leader_observation',
    # debrief_status='pending', queues transcription, arms 'analyzing', sends
    # audio_received. Contrast with teacher coaching, which DOES confirm.

  @e2e @wip @draft @audio @destructive @config-gated @P1
  Scenario: A classroom recording the coach already had analysed is not analysed again
    Given the NIETE bot chat is open on a LEADER account
    And a recording I sent earlier has already been analysed as an observation
    When I send that exact same recording file again
    Then the bot replies "This classroom recording has already been analyzed. Please submit a new recording."
    And no new FICO form or analysis arrives for it
    # bd-erpvf (HITL row 185) — transcription-processor, leader branch: the SHA-256
    # of the downloaded bytes is matched against this coach's own leader
    # observations (observer_user_id — a bound row's user_id is the teacher). A hit
    # closes the new row (cancelled, duplicate_of_session_id = prior) before the R2
    # upload and transcription. No time window. Unlike DC, no prior report is resent.

  @e2e @wip @draft @audio @i18n @destructive @config-gated @P2
  Scenario: The already-analysed reply is in the coach's own language, not the teacher's
    Given the NIETE bot chat is open on a LEADER account whose language is Urdu
    And a teacher whose language is English is bound to the observation
    And a recording I sent earlier has already been analysed as an observation
    When I send that exact same recording file again
    Then the bot replies "اس کلاس روم ریکارڈنگ کا تجزیہ پہلے ہی کیا جا چکا ہے۔ براہ کرم نئی ریکارڈنگ بھیجیں۔"
    # audio-hash-cache.js refuseDuplicateObservation — language is read for
    # observer_user_id, never the row's user_id.

  @e2e @wip @draft @audio @negative @destructive @config-gated @P2
  Scenario: A recording whose earlier observation was cancelled is analysed normally
    Given the NIETE bot chat is open on a LEADER account
    And I cancelled the observation for a recording I sent earlier
    When I send that exact same recording file again
    Then the bot replies that the audio was received and is being analysed
    And it does NOT say the recording has already been analysed
    # findPriorLeaderObservation excludes cancelled / abandoned / failed priors —
    # a recording that never produced an analysis must not be refused.

  @e2e @wip @content-driven @flow @destructive @config-gated @P1
  Scenario: When analysis is ready the editable FICO form opens pre-filled
    Given a leader observation has finished analysis
    When the bot delivers the observer review
    Then it opens the FICO form PRE-FILLED (the model's draft ratings and evidence are populated — assert the form is pre-filled, not the specific scores/values)
    # observe-draft.service.js:115 onAnalysisReady — freezes v1
    # (autofill_analysis_data) ONCE, status awaiting_observer_review, arms
    # awaiting_form, sends the FICO Flow (OBSERVE_MEWAKA_FLOW_ID, flowToken
    # observerId:sessionId). buildScreenPrefill:87 binds s_/e_/i_ per domain screen.

  @e2e @wip @content-driven @flow @destructive @config-gated @P1
  Scenario: Every Section B move on the form says why the grader rated it that way
    Given a leader observation has finished analysis with a measured Section B
    When the observer opens the FICO form's Section B screen
    Then each move's read-only line carries the grader's one-sentence reason under the prescribed move, whether the move was executed, partial or not done
    And the editable evidence box below it still holds the timestamped quote (or the reason alone when nothing was heard)
    And leaving the evidence box untouched and submitting does not count as an edit
    # observe-draft.service.js composeEditableFidelity — the reason (rationale) rides on the
    # mv_k TextBody line above the fid_e_k box; rescoreFidelityFromEdits compares the box
    # against the same prefill it served, so an untouched box is never an "edit".

  @e2e @wip @flow @destructive @config-gated @P1
  Scenario: The observer edits ratings then submits the FICO form
    Given the FICO form is open with the draft pre-filled
    When I adjust a rating and an evidence note on a domain screen
    And I advance through every domain screen and submit
    Then the bot acknowledges the submission and offers "Debrief now" / "Debrief later" in ONE buttons message — the "saved" line first, then the debrief question
    # UPDATED 2026-10-01 (Meta bill cut, NO1 / N2-O03): these were a text and then the buttons
    # (422 a week each). observe-debrief.service.js acknowledgeFormSubmitted joins them when the body
    # fits 1,024 code points; if the buttons are refused, the "saved" line is still sent alone.
    # observe-mewaka-endpoint.js: data_exchange buffers r_/ev_/imp_ edits in Redis
    # (observe:edits:<sessionId>, 2h); LAST screen → applyObserverEdits
    # (observe-draft.service.js:164, merge → v2, computeScores, observer_edit_summary
    # v1→v2 diff, status observer_review_complete) → SUCCESS observe_action:'submitted'.
    # Ack: whatsapp-bot.js:1303-1326 → buildDebriefChoiceButtons (Now/Later).

  @e2e @wip @debrief @destructive @config-gated @P1
  Scenario: "Debrief now" delivers the 6-step debrief guide
    Given a submitted FICO observation offering the debrief choice
    When I tap "Debrief now"
    Then the bot sends a 6-step debrief guide and an instruction to record the debrief, as ONE message — the instruction is its last paragraph
    # UPDATED 2026-10-01 (Meta bill cut, NO1 / N2-O04): two texts before (455 a week each). The
    # guide is budgeted to 2,200 code points, so the pair fits 4,096; over it they stay two messages.
    And the guide contains NO numeric scores
    # observe-debrief.service.js:282 startDebrief → observe-debrief-guide.js 6 steps
    # (intent → evidence-praise → question+silence → ONE improvement → if-then
    # commitment → agree return), hard _redactScores, validateGuide, per-lang
    # buildFallbackGuide → static scaffold. Arms awaiting_debrief_audio.

  @e2e @wip @content-driven @debrief @harm-gate @audio @destructive @config-gated @P1
  Scenario: A respectful debrief recording yields two wins and one improvement
    Given a debrief is armed (awaiting_debrief_audio) for an observation
    When I upload a respectful debrief recording (Document)
    Then the coach-the-coach feedback follows the "two wins + one try" STRUCTURE (exactly two wins, each with evidence, and one "try" — wording/quotes resolved live, not asserted verbatim)
    And the praise line arrives as the caption of the coach card, above the card's closing line — not as a separate message before it
    # UPDATED 2026-10-01 (Meta bill cut, NO1 / N2-O05): praise text + card image were two messages
    # (412 a week). A harmful debrief has no card and keeps its two texts; a card the render or
    # WhatsApp refuses falls back to the praise text + text card.
    And no numeric score is put on the officer
    # observe-debrief.service.js:402 startDebriefFromAudio (clears stale transcript
    # bd-56, queues observe_debrief, NOT queueTranscription) → :498
    # processDebriefRecording (worker) → observe-coach-feedback.js: respectful →
    # 2 wins (verbatim quote each) + 1 'try' targeting a rubric key judged FALSE
    # (no-resuggest, bd-2408). Card via observe-coach-card.js (Playwright PNG, niete brand).

  @e2e @wip @destructive @config-gated @P1
  Scenario: The observer sends the finished report to the teacher
    Given an observation with completed observer review and debrief
    When I tap "Send report" and pick the teacher from the roster
    Then a preview is shown and, on confirm, the NIETE-branded FICO report is delivered to the teacher
    And the preview and the teacher's copy are each ONE image whose caption carries the report caption and then the notes from the conversation
    And the "Send now" tap gets a 📨 reaction instead of a "Sending the report to the teacher now…" text, and the next message is the outcome
    And the 📨 still appears when several messages have just reached me (a reaction that is the only answer is never skipped for pacing)
    # ADDED 2026-10-02 (FX4, bd-w2daa.26): sendReaction(…, { soleAck: true }) waits for its pacing slot; only
    # a Meta refusal sends the "Sending the report…" text instead.
    # UPDATED 2026-10-01 (Meta bill cut, NO1 / N2-O06, N2-O07): report image + companion text were two
    # messages (preview and delivery alike); _sendPackage now captions the image with both (over 1,024
    # code points the companion stays its own text; nothing stored changes). The "sending now" text
    # (440 a week) preceded an outcome message that always follows; without the tap's message id, or
    # if the reaction is refused, the text is still sent.
    # observe-send.service.js: send_report → roster present → teacher-pick list
    # (observe_pickt_*) → preview job → awaiting_send_confirm → send_now →
    # processTeacherReport:544 generateHeroReport (brand heroBrandFor(fico)='niete',
    # teacher's market language) → R2 → deliver. FO sees exactly what the teacher gets (D33).

  @e2e @wip @destructive @config-gated @P1
  Scenario: The send confirm names the teacher the report is going to
    Given an observation with completed observer review and debrief
    When I tap "Send report" and the report preview arrives
    Then the confirm message right above the buttons names the recipient teacher and her number
    And "Send now" sends it, "Someone else" takes me back to the teacher pick, and "Cancel" sends nothing
    # bd-zpyf0 (HITL row 190): fillConfirmBody in observe-send.service.js fills
    # send_confirm_body {name} ({phone}) from teacher_delivery; a nameless row shows
    # the number alone. Button ids observe_send_confirm_/other_/cancel_ unchanged.
    # Proven in bot/tests/observe/bd-zpyf0-confirm-names-recipient.test.js.

  @e2e @wip @content-driven @P2 @config-gated
  Scenario: The FICO report to the teacher carries no score and no accusatory verdicts
    Given a completed observation is delivered to a teacher
    When the teacher opens the report
    Then it contains supportive notes (wording resolved live) and an optional commitment, with no numeric score (assert the no-score / supportive SHAPE, not the note text)
    # observe-teacher-report.js — teacher-facing companion notes: no score, no
    # accusatory verdicts, commitment null if not spoken. Teacher language via
    # resolveTeacherLang (teacher pref → coach → market fallback, clamped ur/en —
    # NEVER Swahili on NIETE, bd-2405).

  # ═══════════════════════════════ EDGE cases ══════════════════════════════════

  @e2e @wip @flow @edge @config-gated @P2
  Scenario: BACK on a FICO domain screen re-serves it without losing edits
    Given the FICO form is open past the first domain screen
    When I tap BACK
    Then the previous domain screen is re-served with my buffered edits intact
    # observe-mewaka-endpoint.js BACK re-serves; edits buffered in Redis
    # (observe:edits, 2h). Graceful loss → falls back to v1 values.

  @e2e @wip @debrief @edge @config-gated @P2
  Scenario: A pending debrief is offered the next time the leader opens /observe
    Given a leader has a submitted observation whose debrief is still pending
    When I send "/observe"
    Then the bot first offers the pending debrief(s) before starting a new capture
    # observe-command.handler.js capture branch intercepts on listPendingDebriefs
    # (debrief_status pending, status observer_review_complete) before the picker.
    # Pending-list rows observe_debrief_<id> + an observe_new sentinel
    # (whatsapp-bot.js:1651-1677). Row times in Asia/Karachi (bd-2216).

  @e2e @wip @debrief @edge @config-gated @P3
  Scenario: Tapping "Debrief now" twice re-sends the same guide, no new analysis
    Given a debrief guide has already been sent for an observation
    When I tap "Debrief now" again
    Then the bot re-sends the stored guide without re-running the LLM
    And the guide and the recording instruction arrive as ONE message, as on the first tap
    # observe-debrief.service.js:282 startDebrief double-tap idempotency
    # (re-send stored guide, no new LLM call).

  @e2e @wip @edge @config-gated @P3
  Scenario: A leader with no saved roster is asked for the teacher's name and number
    Given a leader is sending a report and has an empty teacher roster
    When the bot asks for the teacher's details
    And I reply with a name and a Pakistani phone number as free text
    Then the bot accepts it, previews the report, and asks me to confirm the send
    # observe-send.service.js ask-details path; parseTeacherDetails accepts TZ AND
    # PK numbers; roster stored in users.preferences.observe_teachers
    # (observe-roster.js, backfill-once, move-to-front, cap 25).

  @e2e @wip @edge @config-gated @P3
  Scenario: The teacher picker paginates when a school has many teachers
    Given a leader is on the SELECT_TEACHER screen for a large school
    Then teachers are shown 18 per page with a way to page through them
    # observe-visit-flow.handler.js SELECT_TEACHER pagination 18/page (bd-2431);
    # ordering via assignment/prioritise.js.

  @e2e @wip @edge @destructive @config-gated @P2
  Scenario: A report send outside the 24h window goes via an approved template
    Given a completed observation whose teacher is outside the 24h WhatsApp window
    When the report is delivered
    Then it is sent as an approved UTILITY template, not a free-form message
    # observe-send.service.js processTeacherReport deliver: window-open → direct;
    # window-closed → UTILITY template (observe_report_* payload);
    # OBSERVE_REVIEW_MODE=operator reroutes to a review number first.

  @e2e @flow @scheduling @edge @known-issue @config-gated @P3
  Scenario: A scheduled visit cannot be cancelled from the WhatsApp Flow
    Given a LEADER account with one upcoming scheduled visit
    When I open the visit Flow and drill into "My schedule" → the scheduled visit → "See the brief"
    Then the only forward action is "Start observation" — there is NO cancel/reschedule/delete affordance
    # Verified live on PROD (2026-08-04): "My schedule" → Scheduled-visit dropdown →
    # See-the-brief → only "Start observation". The Flow "⋮ more options" offers no
    # cancel. So an upcoming schedule can only be retired by starting the observation
    # (markDone) — there is no user-facing way to cancel it from WhatsApp. UX gap.

  # ═════════════════════════════════ NEGATIVE ══════════════════════════════════

  @e2e @wip @negative @config-gated @P1
  Scenario: /observe from a teacher account is denied (and the teacher is unaffected)
    Given the NIETE bot chat is open on a TEACHER account
    When I send "/observe"
    Then the bot does not open the observation product for me
    # observe-gate.js:64 !isSchoolLeader → action 'deny_role' → role_denied copy
    # (observe-command.handler.js). LEADER_ROLES excludes 'teacher'.

  @e2e @wip @negative @config-gated @P2
  Scenario: /observe is inert when the observation Flow is not configured
    Given OBSERVE_MEWAKA_FLOW_ID is unset on the runtime
    When any user sends "/observe"
    Then the trigger falls through and the bot handles the text as normal
    # observe-gate.js:62 — !OBSERVE_MEWAKA_FLOW_ID → {match:false}; dark-safe, a
    # PK teacher's normal behaviour is unchanged. This is the capability gate.

  @e2e @wip @negative @config-gated @P2
  Scenario: /observe before an account exists reports no account
    Given a WhatsApp number with no NIETE account
    When it sends "/observe" while OBSERVE_MEWAKA_FLOW_ID is set
    Then the bot replies that it could not find the account
    # observe-gate.js:63 !user → action 'deny_no_user' → no_account copy.

  @e2e @wip @negative @harm-gate @destructive @config-gated @P1
  Scenario: A harmful debrief is gated — a concern, never praise, no card
    Given a debrief recording where the officer disparaged the teacher or gave the moves themselves
    When the coach-the-coach feedback is produced
    Then it returns a concern with no wins, no praise line, and no praise card
    # observe-coach-feedback.js isHarmfulDebrief: disparaged_teacher===true OR
    # moves_not_teacher===false → programmatic gate: wins MUST be empty, no
    # praise_line, concern required (never praise cruelty). Card → null → text.

  @e2e @wip @negative @flow @config-gated @P2
  Scenario: The FICO form refuses a session that is not the observer's own
    Given a FICO form token pointing at another leader's observation
    When it is submitted
    Then the endpoint refuses it
    # observe-mewaka-endpoint.js token load guards: invalid token / not found /
    # not leader_observation / not-owner all refuse (owner-scoped).

  @e2e @negative @audio @config-gated @P1
  Scenario: A leader's long audio with no active state never starts teacher coaching
    Given a LEADER account with no observe state armed
    When I upload a long classroom recording
    Then the bot replies "🎧 I received a long recording — but there's no observation waiting for you right now. If this was a lesson or debrief recording, type /observe first (and pick the right observation), then send it again." and does NOT open a teacher coaching session
    # Verified live on PROD (2026-08-04): 25 MB m4a uploaded as a coach with no armed
    # observation → the long_audio_no_state nudge (NOT a coaching-analysis confirm).
    # observe-audio-router.js routeLeaderAudio — INVARIANT (bd-2409 class): a leader's
    # long audio NEVER starts teacher coaching. routeLeaderAudio runs FIRST.

  @e2e @wip @negative @destructive @config-gated @P2
  Scenario: A capture whose DB write fails reports a capture failure, not "no account"
    Given a leader uploads a recording but the session row insert fails
    Then the bot reports that the capture failed
    # observe-capture.service.js startFromAudio DB failure → capture_failed
    # (bd-2136: must NOT surface as no_account).

  @e2e @wip @negative @debrief @audio @config-gated @P3
  Scenario: A too-short debrief recording is refused and stays pending
    Given a debrief is armed for an observation
    When I upload a debrief recording shorter than the minimum
    Then the bot asks me to record a bit more and the debrief stays pending
    # observe-debrief.service.js processDebriefRecording — transcript < MIN →
    # re-arm awaiting_debrief_audio + debrief_too_short (stays pending).

  @e2e @wip @draft @debrief @audio @destructive @config-gated @P1
  Scenario: A debrief recording the coach was already coached on is not analysed again
    Given a debrief recording I sent for one observation has already been analysed
    And a debrief is armed for a different observation
    When I send that exact same debrief recording file
    Then the bot replies "This debrief recording has already been analyzed."
    And no new debrief feedback arrives
    And the debrief for this observation stays pending, ready for the right recording
    # bd-zq0ea (HITL row 185) — processDebriefRecording hashes the downloaded bytes
    # before transcription and matches this coach's analysed debriefs
    # (observer_debrief.audio_hash + feedback present), any observation, no time
    # window. The row keeps debrief_status 'pending', audio_id is cleared so the
    # retry sweep never re-queues it, and awaiting_debrief_audio is re-armed.

  @e2e @wip @draft @debrief @audio @i18n @destructive @config-gated @P2
  Scenario: The debrief already-analysed reply is in the coach's own language
    Given the NIETE bot chat is open on a LEADER account whose language is Urdu
    And a debrief recording I sent for one observation has already been analysed
    And a debrief is armed for a different observation
    When I send that exact same debrief recording file
    Then the bot replies "اس ڈی بریف ریکارڈنگ کا تجزیہ پہلے ہی کیا جا چکا ہے۔"

  @e2e @wip @draft @debrief @audio @negative @destructive @config-gated @P2
  Scenario: A debrief recording that was never coached is analysed normally when re-sent
    Given a debrief recording I sent earlier was too short to be coached
    And a debrief is armed for an observation
    When I send that exact same debrief recording file
    Then it does NOT say the recording has already been analysed
    # A prior only counts once observer_debrief.feedback exists — a too-short or
    # failed debrief never produced an analysis and must not block the coach.

  @e2e @wip @negative @destructive @config-gated @P1
  Scenario: A failed report send is surfaced to the coach with a retry
    Given a completed observation whose delivery to the teacher fails
    Then the bot tells the coach the send failed and offers a one-tap retry
    # observe-send.service.js _handleDeliverFailure (bd-2411): status send_failed,
    # tell the coach, one-tap retry via /observe. No silent drop.

  @e2e @wip @draft @negative @config-gated @P1
  Scenario: A cancelled observation stays cancelled whichever old button is tapped
    Given I cancelled an observation after its recording was accepted
    And the photo "Yes", "Continue", "Get Report Now" and lesson-plan buttons from before the cancel are still in my chat
    When I tap any of them
    Then the bot tells me the session was cancelled and the recording is saved
    And the observation is not advanced, not re-opened and no report is queued
    # session-terminal.js (bd-87p7s → bd-n9832): the incident was photo_yes_ reviving a
    # cancelled observation that its sibling "No" had refused. Six paths now share one
    # guard; a status read precedes every write and the write itself excludes
    # cancelled/abandoned. Copy: ux-strings coachingSessionCancelled.

  @e2e @wip @draft @negative @config-gated @P1
  Scenario: Reopening a cancelled observation's form names the real reason, once
    Given I cancelled an observation whose FICO form had already been sent to me
    When I open that form from the old message
    Then the Flow does not save anything
    And my chat receives "This observation was cancelled, so the form can no longer be submitted." in my language
    And opening it again within a few minutes does not repeat the sentence
    # observe-mewaka-endpoint.js (bd-rw4so): the refusal is now logged
    # ("observe-form: endpoint refused — the observation is over") and the catalogue sentence
    # observeStrings(lang).flow_terminal_refused is sent to the chat, send-once via a 300 s
    # Redis key. The Flow itself still shows Meta's generic "Something went wrong" until the
    # Flow JSON gains a terminal REFUSED screen and is re-published (scheduled on bd-rw4so).

  @e2e @wip @known-fail @config-gated @P2
  Scenario: The FICO report total reflects the real 148-point maximum
    Given a completed FICO observation (37 indicators, scale 1–4, max 148)
    When the report is rendered
    Then the reported maximum is 148, not the stale 104
    # ⚠ LIVE BUG: framework scores out of 148 but
    # report-transformers/fico-report-transformer.js:30,107 hardcodes 104 (stale
    # V2; header comment still says "26 indicators/104"). Expected to FAIL until fixed.

  # ══════ MENU ENTRY + the principal who also teaches (row 122, 2026-09-15) ══════
  # /observe gained a second door: the "Observe a Teacher" row on /menu, shown to
  # the roles that may observe. The row DELEGATES to handleObserveCommand(user,
  # from, '/observe') and changes nothing about the flow — onboarding, pending
  # debriefs, the visit picker and add/remove-school behave for a principal
  # exactly as they do for a coach.
  #
  # The other half is the bug the row exposed. observe-audio-router decided what
  # a leader's audio meant from role + duration + observe state ALONE, so a
  # principal who asked for HER OWN lesson to be coached had that request taken
  # from DC and turned into "Whose observation is this?" — her recording parked,
  # never analysed (row 122, Asifa Ayub, 14 Sep 2026; 544 users on the role
  # family; zero leader self-DC sessions in production since 2026-08-24).

  @e2e @observe @menu @config-gated @P1
  Scenario: The Observe a Teacher menu row opens the same /observe entry
    Given the NIETE bot chat is open
    And my role is "coach"
    When I send "/menu"
    And I open the "View Features" list
    And I tap the "Observe a Teacher" row
    Then I get the same entry I would get from sending "/observe"
    # Delegation, not a second implementation — menu.service.js case 'menu_observe'.

  @e2e @observe @coaching @config-gated @P1
  Scenario: A principal's OWN lesson recording reaches Digital Coach, not the binding list
    Given the NIETE bot chat is open
    And my role is "principal"
    And I have not started an observation
    When I tap "Classroom Coaching" on /menu
    And the bot asks me to send my classroom recording
    And I send a classroom recording longer than 15 minutes
    Then the bot does NOT ask "Whose observation is this?"
    And the recording is analysed as MY OWN lesson
    # Row 122. observe-audio-router now honours the declared DC intent
    # (conversation_state flow='coaching', step='AWAITING_CLASSROOM_AUDIO'),
    # in a branch placed after the armed-state checks and before park().

  @e2e @observe @config-gated @P1
  Scenario: A principal who HAS started an observation still captures it as an observation
    Given the NIETE bot chat is open
    And my role is "principal"
    And I have started an observation via "/observe" and picked a teacher
    When I send a classroom recording longer than 15 minutes
    Then it is captured as an OBSERVATION of that teacher, not as my own lesson
    # An armed observation is the more specific declaration and wins over a
    # stale DC intent — the two armed-state branches return above the new one.

  @e2e @observe @config-gated @P2
  Scenario: A leader recording with nothing declared is still asked whose it is
    Given the NIETE bot chat is open
    And my role is "coach"
    And I have not started an observation
    When I send a classroom recording longer than 15 minutes
    Then the bot asks "Whose observation is this?"
    # bd-tju8f's invariant, unchanged: an UNDECLARED school-leader classroom
    # recording never starts teacher coaching. This is the scenario that must
    # keep passing — it is what row 122's fix was carefully placed NOT to break.

  @e2e @observe @edge @config-gated @P3
  Scenario: A coach never reaches her own Digital Coach, even after tapping an old DC row
    Given the NIETE bot chat is open
    And my role is "coach"
    And I tapped a "Classroom Coaching" row from older scrollback and was refused
    When I send a classroom recording longer than 15 minutes
    Then the bot asks "Whose observation is this?"
    # canSelfCoach is false for a coach, so a DC intent can never be declared by
    # one — the refusal above does not write the state, and the router would
    # ignore it if it somehow existed.

  @e2e @observe @coaching @wip @draft @config-gated @P2
  Scenario: A principal's second recording after their own lesson was coached is asked whose it is
    Given the NIETE bot chat is open
    And my role is "principal"
    And I tapped "Classroom Coaching" on /menu and my first classroom recording started my own coaching
    When I send a second classroom recording longer than 15 minutes the same morning
    Then the bot asks "Whose observation is this?"
    And "My own lesson" is one of the choices
    # The recording now ends the Classroom Coaching wait (coaching-session initiateSession clears the
    # teacher's coaching state), so a later recording is no longer read as the same declared intent.
    # Before, the six-hour wait outlived the first recording and routed every later one to self-coaching.

  @e2e @observe @coaching @wip @draft @config-gated @P3
  Scenario: With COACHING_RECORDING_ENDS_WAIT off a principal's second recording goes straight to their own coaching again
    Given COACHING_RECORDING_ENDS_WAIT is "off" on the bot service
    And my role is "principal"
    And I tapped "Classroom Coaching" on /menu and my first classroom recording started my own coaching
    When I send a second classroom recording longer than 15 minutes the same morning
    Then the bot does NOT ask "Whose observation is this?"
    And the recording is analysed as MY OWN lesson
    # The behaviour before the recording ended the wait: the six-hour Classroom Coaching intent
    # still stands, so observe-audio-router routes the second recording to self-coaching.
  @e2e @observe @i18n @wip @draft @P2
  Scenario: In Urdu, the observe messages never guess the coach's or the teacher's gender
    Given the NIETE bot chat is open as a coach whose language is Urdu
    When I register as a school leader, start an observation of a named teacher, and reach the debrief and send steps
    Then no message addresses me with a masculine or a feminine verb form (never «رجسٹر ہو گئے», «مشاہدہ کر رہے ہیں», «بات کریں گے», «خود دیکھیں گے»)
    And no message describes the teacher with one (never «استاد … دیکھیں گے» or «استاد … بھروسہ کرتے ہیں»)
    And the debrief guide and the coaching card I receive describe the teacher without «استاد چاہتے ہیں» or «استاد چاہتی ہیں»
    # observe-strings (ur): leader_registered_welcome, the visit-capture prompt, debrief_choice_body,
    # debrief_record_instruction, send_choice_body, onboard_why — rewritten to a noun agreement, a passive or a
    # subjunctive. The debrief-guide and coach-feedback prompts carried "refer to the teacher with the respectful
    # plural (استاد چاہتے ہیں)"; they now carry URDU_THIRD_PERSON_RULE (config/gender-neutral-address.js), and the
    # HOTS analysis prompt the same rule in Urdu. The model output is content-driven: assert no gendered form, never
    # a fixed sentence. Proven in tests/language/urdu-gender-neutral-copy.test.js and
    # bot/tests/observe/third-person-teacher.test.js. @wip.

  @e2e @observe @wip @draft @P1
  Scenario: Picking the teacher's lesson plan from the list asks me to confirm before it is used
    Given the NIETE bot chat is open as a coach
    And an observation I started is waiting at the lesson-plan step with the teacher's recent lesson plans listed
    When I tap one of the recent lesson plans in the list
    Then the bot replies "You have selected <the plan I tapped>. Do you want to proceed?"
    And the reply shows that plan's grade, chapter and pages line under its name
    And it offers exactly two buttons, "Yes" and "Change lesson plan"
    And no "Lesson plan linked" message has arrived yet
    When I tap "Yes"
    Then the bot says the lesson plan is linked
    And the analysis continues with that plan
    # ICT feedback sheet, HITL row 189 (bd-2c1gj): one slip in the list used to link the wrong plan and queue
    # the analysis at once. lp-list-selection.handler.js: on a leader_observation lp_select_ sends
    # lessonPlan_confirm_prompt with lpconfirm_yes_{asset}_{session} / lpconfirm_no_{session}; the Yes tap
    # re-enters the unchanged link path. Unit: tests/coaching/bd-2c1gj-lp-select-confirm.test.js. @wip.

  @e2e @observe @wip @draft @P1
  Scenario: Changing the lesson plan links nothing and returns to the lesson-plan list
    Given the NIETE bot chat is open as a coach
    And I tapped a recent lesson plan on an observation and was asked to confirm it
    When I tap "Change lesson plan"
    Then the bot sends the recent lesson-plan list again
    And no lesson plan has been linked to the observation
    And tapping a different plan asks me to confirm that one by name
    # resendLpList (lp-step.service.js) re-sends the menu and writes nothing, so a late "Change lesson plan"
    # cannot walk an already-analysed observation back to awaiting_lesson_plan.

  @e2e @observe @wip @draft @negative @P2 @obsolete
  Scenario: A teacher picking her own lesson plan is not asked to confirm
    Given the NIETE bot chat is open as a teacher
    And my own Classroom Coaching session is waiting at the lesson-plan step with my recent lesson plans listed
    When I tap one of my recent lesson plans in the list
    Then the bot says the lesson plan is linked straight away
    And no "Do you want to proceed?" confirmation is sent
    # The confirmation is for a coach choosing on someone else's behalf; self-serve keeps the one-tap pick.
    # OBSOLETE 2026-09-30 (bd-2c1gj): the operator widened the confirmation to the teacher's own Digital Coach
    # flow — the same list, the same slip. Replaced by coaching.feature "Picking my lesson plan from the list
    # asks me to confirm before it is used".

  # ═══════════════════ /observe2 — the FICO ICT field-form pilot ═══════════════════
  # /observe2 lets a coach fill a live form DURING the lesson (Part 1, Part 2, then the seal),
  # send the recording afterwards, and check the moments found in it before a brief comes back.
  # GATING (observe2/gate.js, FEATURE_GATES.observe2): OBSERVE2_FIELD_FORM_FLOW_ID,
  # OBSERVE2_CHECK_FLOW_ID and OBSERVE_VISIT_FLOW_ID must all be set, and the user must be in the
  # leader family; otherwise "/observe2" falls through like any text. Sandbox only for the pilot.
  # Copy: bot/shared/services/observe/observe2/strings.js. All @wip @draft until driven on sandbox.

  @e2e @flow @config-gated @wip @draft @P1
  Scenario: A coach's /observe2 opens the visit planner
    Given the NIETE bot chat is open on a LEADER account on sandbox
    When I send "/observe2"
    Then the bot responds with "Let's plan the /observe2 visit. Pick a school, then a teacher." and a "Plan my visit" CTA
    # observe2/start.js handleObserve2Command: the /observe visit Flow, token <userId>:observe2-visit.

  @e2e @flow @config-gated @wip @draft @P1
  Scenario: After Start, the coach chooses the period length
    Given I opened the visit planner from /observe2 and picked a school and a teacher
    When I tap "Start observation" in the brief
    Then the bot asks "How long is this period?" naming the teacher
    And it offers exactly three buttons: "30 minutes", "35 minutes", "40 minutes"
    And no "record it and send me the audio" message is sent
    # flow-response.handler handleObserveVisitFlow: the observe2 marker → Observe2Start.afterStart
    # (record created in observation_field_forms; the teacher is bound exactly as for /observe).

  @e2e @flow @config-gated @wip @draft @P1
  Scenario: The period button sends the live form with the steps before the lesson
    Given I was asked how long the period is
    When I tap "40 minutes"
    Then the bot sends a message starting "Before the lesson starts:" with an "Open the form" CTA
    And it tells me to start my phone's voice recorder app, not WhatsApp
    And it says to save Part 1 at minute 20 and carry on with Part 2 until minute 40

  @e2e @flow @config-gated @wip @draft @negative @P1
  Scenario: Part 1 refuses a number that cannot be right
    Given the live form is open on Part 1
    When I type 32 children present and 40 children who spoke, and tap "Part 1 done"
    Then the form stays on Part 1 with "Can't be more than the 32 children present." under "Children who spoke"
    And nothing is saved

  @e2e @flow @config-gated @wip @draft @P1
  Scenario: A form reopened after Part 1 continues with Part 2
    Given I saved Part 1 of the live form and closed it
    When I tap "Open the form" again
    Then the form opens on Part 2
    # WhatsApp restores a form reopened shortly after from the phone (no request reaches the bot; seen on
    # the sandbox E2E, 30 Sep). A form WhatsApp starts afresh opens on "Part 1 is saved" with "Carry on
    # with Part 2, from minute 20 to 40." and "Continue" opens Part 2.

  @e2e @flow @config-gated @wip @draft @P1
  Scenario: After Part 2 the coach picks the lesson plan from the teacher's own plans
    Given I saved Part 2 of the live form
    Then the form shows "The lesson plan" with "Was there a lesson plan?"
    When I choose "Followed a lesson plan"
    Then a "Which plan?" list shows the teacher's most recent plans from the bot, newest first, named as in the /observe plan list, and "Upload new" last
    When I tap "Next" without picking a plan
    Then the form stays with 'Pick the plan, or "Upload new".' at the bottom
    When I pick a plan and tap "Next"
    Then "Before you seal" names the plan I picked and says "To change it, go back."
    # Decided on the 2 Oct go-live call: the plan is picked inside the form, before the seal, and can be
    # changed until then. observe2-form-endpoint.js LESSON_PLAN; recent-fidelity-lps.service.js; the row
    # names come from lp-selection-format.js, as in /observe's list.

  @e2e @flow @config-gated @wip @draft @P1
  Scenario Outline: A plan the bot didn't give the teacher is added in the form as photos, a file, or typed text
    Given I saved Part 2 of the live form
    When I choose "Followed a lesson plan", pick "Upload new" and choose "<how>" for "How will you add it?"
    And I tap "Next"
    Then the form shows "<screen heading>"
    When I add <what> and tap "Next"
    Then "Before you seal" says "<seal line>" and "To change it, go back."
    Examples:
      | how                      | screen heading            | what                         | seal line                   |
      | Photos of the paper plan | Photos of the lesson plan | two photos, one per page     | 2 photos of the plan        |
      | A PDF or Word file       | The lesson plan file      | a PDF of the plan            | the file you added          |
      | Type it                  | Type the lesson plan      | the plan's steps, typed      | the plan you typed          |
    # Asked by the operator on 2 Oct: the same ways in as /observe (photo, PDF or Word, typed). Photos and
    # files are stored after the reply; typed text under 40 characters is refused (the extractor's floor).

  @e2e @flow @config-gated @destructive @wip @draft @P1
  Scenario: An added plan is read and its steps checked after the recording, as /observe does
    Given I added the lesson plan as photos before sealing, and sent the recording
    When the "Check the moments" form opens and I tap "Next" on the last moments screen
    Then the form shows "Did the lesson follow the plan?" with the steps read from the photos, each already rated
    # observe2/added-plan.js reads the files with the extraction worker /observe uses (text layer, Word,
    # vision read), applies the same "is this a lesson plan?" check, then the orchestrator's uploaded-plan
    # path grades it. The pages of several photos are read in order as one plan.

  @e2e @flow @config-gated @wip @draft @P2
  Scenario: An added plan that can't be read, or isn't a lesson plan, is named in the brief
    Given the photos I added could not be read
    When I submit the check
    Then there is no "Did the lesson follow the plan?" screen
    And the brief says the photos or file couldn't be read, so the plan's steps weren't checked

  @e2e @flow @config-gated @wip @draft @P2
  Scenario: No lesson plan goes straight on to the seal
    Given I saved Part 2 of the live form
    When I choose "No plan for this lesson" and tap "Next"
    Then "Before you seal" says there was no lesson plan for this lesson

  @e2e @flow @config-gated @destructive @wip @draft @P1
  Scenario: Sealing locks the record and the chat says what to do with the recording
    Given I filled Part 1 and Part 2 of the live form
    When I pick what to work on first, tick the seal box and tap "Seal and send"
    Then the form shows "Sealed at" and the time
    And the bot says the record is sealed and to stop the recorder, then share the recording to this chat
    And tapping "Seal and send" again changes nothing
    # observe2-form-endpoint.js: seal is a compare-and-set; the database trigger refuses any later
    # change to what was sealed. Up to ten photos are kept (observe2/<record>/photo-N.jpg); the photo
    # line says which ones help (2 Oct: no cap of three for coaches).

  @e2e @audio @config-gated @destructive @wip @draft @P1
  Scenario: The recording joins the sealed record and its moments come back to check
    Given my /observe2 record is sealed
    When I send the lesson recording from the recorder app as a file
    Then the bot says "Recording received" and that the moments come here to check
    And no photo or lesson-plan question is asked
    And a few minutes later a message with a "Check the moments" CTA arrives
    # capture-link.js links the recording to the open form; moments.js reads the timed transcript
    # (one model call) and opens the check because the record is sealed.

  @e2e @flow @config-gated @destructive @wip @draft @P1
  Scenario: With a picked plan, the check shows each step of the plan pre-rated from the recording
    Given I picked a lesson plan before sealing, and the "Check the moments" form is open
    When I answer the moments and tap "Next" on the last moments screen
    Then the form shows "Did the lesson follow the plan?" with how many steps the plan has, how many count toward the result, and how many were done, partly done and not done
    And each step shows its phase, the whole step, what the recording showed, and a pre-selected answer from "Done as planned", "Done another way, as good", "Done another way, better", "Partly done", "Not done", "Couldn't tell"
    And a step that does not count, such as homework, says "(not counted)"
    When I change a step I saw differently and tap "Add it all up"
    Then the result is re-scored from my answers and the levels follow
    # As /observe's Section B: the same move lists, grader and scorer (fidelity-orchestrator.js,
    # observe-draft.rescoreFidelityFromEdits). Without a graded plan, the levels come straight after the moments.

  @e2e @flow @config-gated @destructive @wip @draft @P1
  Scenario: The check pre-fills every level and Submit sends the brief
    Given the "Check the moments" form is open
    When I answer each moment "Yes, this happened" or "No, or not like this" and tap through
    Then every level is pre-filled with what my sealed answers and the confirmed moments add up to, with the reason
    And no level found by the recording alone is shown
    When I keep or change the levels, keep my sealed pick and tap "Submit"
    Then the form shows "Saved at" and the time
    And the bot sends a brief naming the teacher, questions to open with, what went well, how much of the lesson plan was done, the thing to work on first and one moment to bring up

  @e2e @config-gated @wip @draft @negative @P2
  Scenario: A teacher's /observe2 is refused
    Given the NIETE bot chat is open on a TEACHER account on sandbox
    When I send "/observe2"
    Then the bot responds with "/observe2 is for coaches and school leaders."
    And no Flow is sent

  @e2e @wip @draft @negative @P3
  Scenario: /observe2 is plain text where its Flows are not configured
    Given the NIETE bot runs without OBSERVE2_FIELD_FORM_FLOW_ID or OBSERVE2_CHECK_FLOW_ID
    When a coach sends "/observe2"
    Then the message is handled like any other text and no /observe2 Flow is sent

  # ── The teacher hears about her own visit ──────────────────────────────────
  # observe-teacher-notice.service sends an approved UTILITY template, gated by
  # OBSERVE_TEACHER_NOTIFY_ENABLED; the portal routes reach it through
  # POST /api/internal/observe/notify-teacher.

  @e2e @config-gated @P1
  Scenario: The teacher gets the date and time on WhatsApp when a coach books her visit
    Given OBSERVE_TEACHER_NOTIFY_ENABLED is on and the visit-notice templates are approved
    And a coach has a teacher with a WhatsApp number in her patch
    When the coach books a visit for that teacher on a date and time slot, in WhatsApp or on the portal
    Then the teacher receives a message naming the coach, her school, the date and the time
    And the message is in the teacher's own language, not the coach's

  @e2e @config-gated @P1
  Scenario: Moving or cancelling a visit tells the teacher
    Given a teacher has been told about an upcoming visit
    When the coach moves the visit to a different date or time
    Then the teacher receives a message with the new date and time
    When the coach cancels the visit
    Then the teacher receives a message that the visit is cancelled

  @e2e @config-gated @negative @P2
  Scenario: Re-saving a visit unchanged, or a teacher with no number, sends nothing
    Given a coach has an upcoming visit booked for a teacher
    When the coach saves the same visit again on the same date and time slot
    Then the teacher receives no new message
    And the coach's booking of a hand-added teacher with no WhatsApp number is saved without any message

  # ── An observation the coach runs from the PORTAL (bd-5rz1v.6) ─────────────
  # Dark behind app_settings.portal_coach_observation. The coach picks the
  # teacher, records or uploads the lesson, attaches HER lesson plan, then checks
  # the draft, records the talk and sends the report — all in the portal, through
  # the same functions WhatsApp uses (portal-observe.service.js). The row is the
  # WhatsApp capture's row; a portal row is recognised by its R2 key.

  @e2e @config-gated @P1
  Scenario: A lesson sent from the portal becomes a bound /observe observation
    Given a coach is in the portal_coach_observation pilot and the teacher is in her patch
    When the coach sends a recording of the teacher's lesson from the portal
    Then a leader observation is created, owned by the teacher, with the coach as observer
    And transcription and analysis run as for a WhatsApp /observe recording
    And the coach receives nothing on WhatsApp — no capture message, no "who did you observe?", no photo or lesson-plan prompt

  @e2e @config-gated @P1
  Scenario: The draft of a portal observation is checked in the portal, not in a WhatsApp form
    Given a portal observation whose analysis has finished
    When the coach opens the observation in the portal
    Then the draft report shows the same sections, ratings and notes the review form would show
    And no review form is sent to the coach's WhatsApp
    When the coach changes a rating and saves
    Then the observation is saved exactly as the review form's submit saves it

  @e2e @config-gated @P1
  Scenario: The talk with the teacher and the coach's own feedback happen in the portal
    Given the coach has saved the draft of a portal observation
    When the coach opens the talk, records her conversation with the teacher in the portal and sends it
    Then the guide she sees is the one WhatsApp would have sent
    And her feedback on the talk appears in the portal, and no feedback card or send buttons reach her WhatsApp
    And the report to the teacher can be prepared only after that feedback

  @e2e @config-gated @P1
  Scenario: The teacher's report is previewed and sent from the portal and reaches her WhatsApp
    Given the coach has her feedback on a portal observation
    When the coach previews the report in the portal and presses Send
    Then the teacher receives the report on WhatsApp — directly, or through the invite template when her window is closed
    And the coach receives no WhatsApp message about the send

  @e2e @config-gated @negative @P1
  Scenario: A WhatsApp /observe observation is unchanged
    Given a coach records an observation on WhatsApp with /observe
    When the analysis finishes
    Then the review form is sent to her WhatsApp as before
    And the debrief, her feedback card and the send-report steps all happen on WhatsApp as before

  @e2e @config-gated @negative @P2
  Scenario: A failed portal observation is shown in the portal, not announced on WhatsApp
    Given a portal observation whose transcription or analysis fails
    When the failure is recorded
    Then the observation shows as stopped in the portal
    And the coach receives no failure message on WhatsApp
