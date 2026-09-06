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
    # observe-capture.service.js:56 startFromAudio — inserts a row status
    # 'confirmed' directly (no Yes/No, bd-16), observation_type='leader_observation',
    # debrief_status='pending', queues transcription, arms 'analyzing', sends
    # audio_received. Contrast with teacher coaching, which DOES confirm.

  @e2e @wip @content-driven @flow @destructive @config-gated @P1
  Scenario: When analysis is ready the editable FICO form opens pre-filled
    Given a leader observation has finished analysis
    When the bot delivers the observer review
    Then it opens the FICO form PRE-FILLED (the model's draft ratings and evidence are populated — assert the form is pre-filled, not the specific scores/values)
    # observe-draft.service.js:115 onAnalysisReady — freezes v1
    # (autofill_analysis_data) ONCE, status awaiting_observer_review, arms
    # awaiting_form, sends the FICO Flow (OBSERVE_MEWAKA_FLOW_ID, flowToken
    # observerId:sessionId). buildScreenPrefill:87 binds s_/e_/i_ per domain screen.

  @e2e @wip @flow @destructive @config-gated @P1
  Scenario: The observer edits ratings then submits the FICO form
    Given the FICO form is open with the draft pre-filled
    When I adjust a rating and an evidence note on a domain screen
    And I advance through every domain screen and submit
    Then the bot acknowledges the submission and offers "Debrief now" / "Debrief later"
    # observe-mewaka-endpoint.js: data_exchange buffers r_/ev_/imp_ edits in Redis
    # (observe:edits:<sessionId>, 2h); LAST screen → applyObserverEdits
    # (observe-draft.service.js:164, merge → v2, computeScores, observer_edit_summary
    # v1→v2 diff, status observer_review_complete) → SUCCESS observe_action:'submitted'.
    # Ack: whatsapp-bot.js:1303-1326 → buildDebriefChoiceButtons (Now/Later).

  @e2e @wip @debrief @destructive @config-gated @P1
  Scenario: "Debrief now" delivers the 6-step debrief guide
    Given a submitted FICO observation offering the debrief choice
    When I tap "Debrief now"
    Then the bot sends a 6-step debrief guide and an instruction to record the debrief
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
    # observe-send.service.js: send_report → roster present → teacher-pick list
    # (observe_pickt_*) → preview job → awaiting_send_confirm → send_now →
    # processTeacherReport:544 generateHeroReport (brand heroBrandFor(fico)='niete',
    # teacher's market language) → R2 → deliver. FO sees exactly what the teacher gets (D33).

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

  @e2e @wip @negative @destructive @config-gated @P1
  Scenario: A failed report send is surfaced to the coach with a retry
    Given a completed observation whose delivery to the teacher fails
    Then the bot tells the coach the send failed and offers a one-tap retry
    # observe-send.service.js _handleDeliverFailure (bd-2411): status send_failed,
    # tell the coach, one-tap retry via /observe. No silent drop.

  @e2e @wip @known-fail @config-gated @P2
  Scenario: The FICO report total reflects the real 148-point maximum
    Given a completed FICO observation (37 indicators, scale 1–4, max 148)
    When the report is rendered
    Then the reported maximum is 148, not the stale 104
    # ⚠ LIVE BUG: framework scores out of 148 but
    # report-transformers/fico-report-transformer.js:30,107 hardcodes 104 (stale
    # V2; header comment still says "26 indicators/104"). Expected to FAIL until fixed.
