@whatsapp @ict @profile:niete @feature:attendance @persona:teacher @draft
Feature: NIETE (ICT) WhatsApp bot — Attendance (teacher student-marking + principal teacher-marking)
  # Non-determinism: see .claude/qa/shared/non-determinism-contract.md (assert contracts/shape; @content-driven answers resolved live).
  # ═══════════════════════════════════════════════════════════════════════════
  # STATUS: DRAFT (2026-08-04). Grounded in CODE (file:line from a full deep-map
  # of the attendance domain) but NOT driven live. Confirm exact bot copy via a
  # linked WhatsApp Web drive before dropping @wip @draft. Excluded from the
  # /niete-e2e safe subset by @wip until then.
  # ═══════════════════════════════════════════════════════════════════════════
  #
  # WHAT THIS IS. Two personas share the word "attendance", split by a ROLE FORK
  # (attendance-router.service.js, brand-new merge 118194a):
  #   • TEACHER  → marks STUDENT attendance (conversational / voice roll-call /
  #                tap-Flow) → a monthly Excel register (attendance-conversation +
  #                voice-attendance + attendance-flow + attendance-delivery).
  #   • PRINCIPAL→ marks TEACHER attendance (text roster, brand-new channel:
  #                teacher-attendance-conversation.service.js). The web Portal and
  #                WhatsApp both call the SAME saveAttendance() → identical Presence.
  # The @new tag marks the principal channel (shipped last week). None of this is
  # covered by the existing 55-scenario teacher suite.
  #
  # THE ROLE FORK (attendance-router.service.js, wired text-message.handler.js:2097):
  #   resolveAttendanceActor(user,{hasStudentClasses}) →
  #     PRINCIPAL_MARKS_TEACHERS  (principal, NO student classes)
  #     ASK                       (principal who ALSO owns student classes → ask)
  #     TEACHER_MARKS_STUDENTS    (teacher / any non-principal / unset role — safe default)
  #   SAFETY INVARIANT: a principal is NEVER silently routed into the student flow.
  #
  # GATING: role-based only (NOT feature-flagged). The tap-Flow and setup/edit
  # Flows are env-gated: ATTENDANCE_MARKING_FLOW_ID, ATTENDANCE_SETUP_FLOW_ID,
  # EDIT_CLASS_FLOW_ID (absent → text fallback). Two Redis session NAMESPACES that
  # must never collide: attendance:session:<uid> (student) vs
  # teacher-attendance:session:<uid> (principal).
  #
  # TEST ACCOUNTS: a throwaway TEACHER (with ≥1 student class) AND a throwaway
  # PRINCIPAL (users.role='principal' + users.school_id + teachers in the school).
  # @destructive scenarios write real attendance_sessions / teacher_attendance_records.
  #
  # DRIVING: tap-Flow = native Flow (real MCP click). Voice roll-call = a VOICE
  # note while AWAITING_VOICE_INPUT. Setup/edit rosters via Document/Flow.
  #
  # Scenarios grouped POSITIVE · EDGE · NEGATIVE. Tags: @flow · @voice · @new
  # (principal channel) · @role-fork · @excel · @config-gated · @destructive ·
  # @out-of-band (web convergence) · @wip @draft (all — pending a live drive).

  # ═══════════════════════════ POSITIVE — student marking (teacher) ═══════════════════════════

  @e2e @wip @role-fork @P1
  Scenario: A teacher saying "attendance" enters the student-marking flow
    Given the NIETE bot chat is open on a TEACHER account with a class
    When I send "attendance"
    Then the bot starts the student attendance flow (class / date / marking method)
    # attendance-detector.service.js:92 detectAttendanceIntent → role fork
    # (text-message.handler.js:2097) → TEACHER_MARKS_STUDENTS →
    # attendance-conversation.service.js:344 startAttendanceSession.

  @e2e @wip @flow @P2
  Scenario: A teacher with no classes is sent the class-setup Flow
    Given the NIETE bot chat is open on a TEACHER account with NO classes
    When I send "attendance"
    Then the bot sends the class-setup Flow ("Class Setup")
    # attendance-conversation.service.js — no classes → SEND_SETUP_FLOW (header
    # "Class Setup"), gated on ATTENDANCE_SETUP_FLOW_ID.

  @e2e @wip @P2
  Scenario: A teacher with exactly one class goes straight to the marking method
    Given the NIETE bot chat is open on a TEACHER account with one class
    When I send "attendance"
    Then the bot asks how I want to mark (voice / tap / everyone present)
    # attendance-conversation.service.js — one class → AWAITING_MARKING_METHOD.

  @e2e @wip @content-driven @P2
  Scenario: A teacher with several classes is asked which class
    Given the NIETE bot chat is open on a TEACHER account with multiple classes
    When I send "attendance"
    Then the bot lists the classes (roster contents resolved live) and I can pick one by number or by name
    # AWAITING_CLASS_SELECTION; handleClassSelection:620 (numeric OR fuzzy name).

  @e2e @wip @excel @destructive @content-driven @P1
  Scenario: "Everyone present" produces the monthly register
    Given a teacher is at the marking-method step for a class
    When I choose "everyone present"
    Then the bot marks all students present and a monthly attendance register document is delivered (not asserting exact cell values / counts / dates)
    # handleEveryonePresent:765 ("everyone present"/"سب حاضر"/3) → GENERATE_ATTENDANCE
    # → attendance-delivery.service.js:37 processAndDeliver (cumulative monthly
    # register → R2 → WhatsApp document).

  @e2e @wip @flow @excel @destructive @content-driven @P1
  Scenario: Tap-to-mark marks the absentees and delivers the register
    Given a teacher chose the tap marking method for a class
    When I mark the absent students in the Flow and submit
    Then the bot confirms and a monthly Excel register document is delivered (not asserting exact cell values / counts / dates)
    # flow-response.handler.js:579 handleAttendanceMarkingFlow →
    # attendance-flow.handler.js:278 handleMarkingFlowSubmission (absent set vs all)
    # → processAndDeliver markingMethod:'tap'. Flow gated on ATTENDANCE_MARKING_FLOW_ID.

  @e2e @wip @voice @destructive @content-driven @P1
  Scenario: A voice roll-call is transcribed into an attendance draft
    Given a teacher chose the voice marking method (AWAITING_VOICE_INPUT)
    When I send a voice note naming who is absent
    Then the bot produces an attendance draft to verify — a verification summary marking the named students absent (assert the draft's shape, not a fixed transcription)
    # voice-message.handler.js:132-192 → voice-attendance.service.js:54
    # processVoiceAttendance (Soniox transcription → GPT-4o-mini extraction →
    # generateAttendanceRecords; unmentioned students default present) →
    # AWAITING_VERIFICATION.

  @e2e @wip @destructive @content-driven @P2
  Scenario: Confirming the verification delivers the register
    Given a teacher is at the attendance verification step
    When I reply "yes"
    Then the bot generates and a monthly register document is delivered (not asserting exact cell values / counts / dates)
    # handleVerificationResponse:963 — yes/confirm/ہاں → GENERATE_ATTENDANCE.

  @e2e @wip @flow @P2
  Scenario: /add-class opens the class-setup Flow even when classes exist
    Given the NIETE bot chat is open on a TEACHER account with existing classes
    When I send "add class"
    Then the bot opens the "Add New Class" setup Flow
    # attendance-detector.service.js:171 detectAddClassIntent →
    # text-message.handler.js:2066 (header "Add New Class", always fires).

  @e2e @wip @flow @P2
  Scenario: /edit-class opens the roster editor
    Given the NIETE bot chat is open on a TEACHER account with a class
    When I send "edit class"
    Then the bot opens the roster editor for that class (or asks which class if several)
    # edit-class-trigger.js → text-message.handler.js:1740 (one class → Flow;
    # multiple → buttons edit_class_<id>, resolved whatsapp-bot.js:1018). Gated on
    # EDIT_CLASS_FLOW_ID. edit-class-endpoint.js ROSTER_VIEW → add/remove/edit.

  # ═══════════════════════ POSITIVE — teacher marking (PRINCIPAL, NEW) ═══════════════════════

  @e2e @wip @new @role-fork @content-driven @P1
  Scenario: A principal without student classes marks teacher attendance
    Given the NIETE bot chat is open on a PRINCIPAL account (no student classes) whose school has teachers
    When I send "attendance"
    Then the bot shows the school's numbered teacher roster to mark (roster contents resolved live; identify teachers by index/role, not by name)
    # attendance-router.service.js resolveAttendanceActor → PRINCIPAL_MARKS_TEACHERS
    # → teacher-attendance-conversation.service.js:126 startSession
    # (generateMarkingMessage, numbered roster, EN/UR). Redis namespace
    # teacher-attendance:session:<uid> (never collides with the student flow).

  @e2e @wip @new @P2
  Scenario: A principal marks everyone present
    Given a principal is at the teacher-marking step
    When I reply "all"
    Then all teachers are marked present and the bot asks me to verify
    # parseMarkingInput:103 — all/0/سب حاضر = everyone present → AWAITING_VERIFICATION.

  @e2e @wip @new @P1
  Scenario: A principal marks specific teachers absent
    Given a principal is at the teacher-marking step with a numbered roster
    When I reply "2,5"
    Then teachers 2 and 5 are marked absent and the bot asks me to verify
    # parseMarkingInput:103 — comma indices = absent → handleMarkingInput:169.

  @e2e @wip @new @P1
  Scenario: A principal marks a teacher on leave and picks the leave type
    Given a principal is at the teacher-marking step
    When I reply "3L"
    Then the bot asks the leave type for teacher 3 (casual / sick / official)
    And picking a type records it against that teacher
    # parseMarkingInput — "3L" queues a leave → AWAITING_LEAVE_TYPE per teacher;
    # handleLeaveTypeInput:215 (casual/sick/official via 1/2/3 or names);
    # teacher-attendance.service.js:67 parseLeaveType. Leave requires a type
    # (re-validated in the repo — never silently dropped).

  @e2e @wip @new @destructive @P1
  Scenario: Confirming persists teacher attendance (one upsert per teacher)
    Given a principal has marked the teacher roster and reached verification
    When I reply "yes"
    Then the bot persists the attendance and confirms
    # handleVerification:275 yes/confirm/ہاں → persist;
    # teacher-attendance.service.js:89 persistMarkedAttendance — ONE
    # repository.saveAttendance() upsert per teacher (UNIQUE teacher_id,date).

  @e2e @wip @new @out-of-band @P2
  Scenario: WhatsApp and the web Portal show the same teacher presence
    Given a principal has marked teacher attendance via WhatsApp
    When the same school's presence is read from the Portal attendance API
    Then the Presence numbers match exactly
    # Both channels call the SAME saveAttendance() + computePresence
    # (dashboard/services/attendance-repository.service.js); asserted by
    # teacher-attendance-convergence.test.js. @out-of-band: verify via the portal API / DB.

  # ═══════════════════════════════ EDGE cases ══════════════════════════════════

  @e2e @wip @role-fork @edge @P2
  Scenario: Roman-Urdu and Urdu attendance keywords all trigger
    Given the NIETE bot chat is open on a TEACHER account
    When I send "hazri" (and, separately, "حاضری" / "roll call" / "/attendance")
    Then each opens the attendance flow
    # attendance-detector.service.js:92 high-confidence: attendance, roll call,
    # /attendance, حاضری, hazri/haazri/haziri/hajri (substring, case-insensitive).

  @e2e @wip @new @role-fork @edge @P1
  Scenario: A principal who also owns classes is asked teachers-or-students
    Given the NIETE bot chat is open on a PRINCIPAL account that ALSO owns student classes
    When I send "attendance"
    Then the bot asks whether I mean teachers or students ("1. Teachers / 2. Students")
    # resolveAttendanceActor → ASK (ambiguous) → sets Redis attendance:actor-choice
    # + prompt (text-message.handler.js:2097). TTL 300s.

  @e2e @wip @new @role-fork @edge @P2
  Scenario: The teachers-or-students answer routes to the right channel
    Given a principal was asked teachers-or-students
    When I reply "1"
    Then the bot starts the teacher-marking channel
    # text-message.handler.js:1791 actor-choice intercept: 1/teacher/اساتذہ →
    # teacher channel; 2/student/بچ → student setup/flow; unrecognised → re-ask.

  @e2e @wip @new @role-fork @edge @P3
  Scenario: The role fork tolerates casing and whitespace
    Given a principal whose users.role is stored as " PRINCIPAL " (mixed case, padded)
    When I send "attendance"
    Then I am still forked to the teacher-marking channel (not the student flow)
    # attendance-router.service.js:34 isPrincipal — role.trim().toLowerCase()==='principal'.

  @e2e @wip @edge @P3
  Scenario: A teacher can resume a recent unfinished attendance session
    Given a teacher started but did not finish an attendance session under 30 minutes ago
    When I send "attendance" again
    Then the bot offers to resume the session or start fresh
    # attendance-conversation.service.js:203 handleSessionRecovery (<30min, not completed).

  @e2e @wip @voice @edge @content-driven @P3
  Scenario: Voice roll-call understands "everyone except" phrasing
    Given a teacher is at the voice marking step
    When my voice note says everyone is present except two named students
    Then only those two are marked absent (assert the relationship in the draft, not a fixed transcription)
    # voice-attendance.service.js extraction + generateAttendanceRecords:356
    # (unmentioned default present); parseAttendanceKeyword:308 checks absent
    # BEFORE present ("غیر حاضر" contains "حاضر").

  @e2e @wip @excel @edge @P2
  Scenario: Recording the same class/date/session twice is caught
    Given a teacher already recorded attendance for a class on a date+session
    When the same session is submitted again
    Then the bot says it is already recorded rather than duplicating it
    # attendance-delivery.service.js checkExistingSession (list+date+sessionType)
    # → friendly "already recorded".

  @e2e @wip @edge @P3
  Scenario: "Edit" at verification returns to marking
    Given a teacher (or principal) is at the verification step
    When I reply "edit"
    Then the bot returns me to the marking step with my current marks
    # student: handleVerificationResponse:963 'edit' → re-send marking Flow with
    # prefilledAbsent. principal: handleVerification:275 'edit' → back to marking.

  # ═════════════════════════════════ NEGATIVE ══════════════════════════════════

  @e2e @wip @voice @negative @P2
  Scenario: Text sent while awaiting a voice roll-call is redirected
    Given a teacher is at the voice marking step (AWAITING_VOICE_INPUT)
    When I send a text message instead of a voice note
    Then the bot asks me to send a voice note (or reply "2" to switch to tap)
    # text-message.handler.js:1899 — text in AWAITING_VOICE_INPUT → prompt.

  @e2e @wip @flow @negative @config-gated @P2
  Scenario: Tap marking falls back to text when the marking Flow is unset
    Given ATTENDANCE_MARKING_FLOW_ID is unset on the runtime
    When a teacher chooses the tap marking method
    Then the bot falls back to text and tells the teacher to use voice
    # attendance-flow / flow-type-detector: empty ATTENDANCE_MARKING_FLOW_ID → text fallback.

  @e2e @wip @negative @destructive @P2
  Scenario: A class deleted mid-flow is reported, not silently dropped
    Given a teacher is mid-attendance for a class that is then deleted
    When the marking is submitted
    Then the bot says the class no longer exists
    # attendance-flow.handler.js validates the listId still exists (class-deleted
    # guard) before delivery → session cleared, told loudly.

  @e2e @wip @new @negative @P2
  Scenario: A principal with no school on file is told setup is needed
    Given the NIETE bot chat is open on a PRINCIPAL account with no school_id
    When I send "attendance"
    Then the bot reports that no school is set up for teacher attendance
    # teacher-attendance-conversation.service.js:126 startSession guards NO_SCHOOL
    # (no user.school_id).

  @e2e @wip @new @negative @P2
  Scenario: A principal whose school has no teachers is told there is nothing to mark
    Given a PRINCIPAL account whose school has no teachers on file
    When I send "attendance"
    Then the bot reports there are no teachers to mark
    # startSession guards NO_TEACHERS (repository.getTeachersBySchool empty).

  @e2e @wip @new @negative @P3
  Scenario: An out-of-range teacher number is rejected, not misapplied
    Given a principal is at the teacher-marking step with N teachers
    When I reply with an index greater than N (e.g. "99")
    Then the bot surfaces a parse/range error and re-asks
    # parseMarkingInput:103 — range/parse errors surfaced (not silently applied).

  @e2e @wip @new @role-fork @negative @P1
  Scenario: A principal is never silently marked into the student flow
    Given the NIETE bot chat is open on a PRINCIPAL account
    When I send "attendance"
    Then I am routed to teacher-marking or asked teachers-or-students — never straight into student marking
    # attendance-router.service.js safety invariant (exhaustively unit-tested):
    # a principal maps to PRINCIPAL_MARKS_TEACHERS or ASK, never
    # TEACHER_MARKS_STUDENTS. This is the load-bearing guarantee of the new channel.
