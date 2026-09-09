@whatsapp @ict @profile:niete @feature:status @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — /status (what's running + cancel)
  # Non-determinism: see .claude/qa/shared/non-determinism-contract.md (assert contracts/shape; @content-driven answers resolved live).
  # ICT-region only. Driven from a linked WhatsApp Web session via Chrome MCP.
  # /status is a cross-feature snapshot: "what do I have in flight, and stop any of it."
  # In-flight work is probed by teacher-state.service.js: coaching (non-terminal, last hour),
  # lesson-plan (pending/processing/extracting), video, reading, and the conversation store
  # (registration / lesson-plan / attendance flows mid-way). Opening the menu is a GLANCE,
  # not work — it is never counted and never listed (PR #801, 2026-09-08).
  #
  # SINCE PR #801 (2026-09-08) THE COMMAND ASKS WHAT IS RUNNING BEFORE IT SENDS ANYTHING:
  #   nothing running   -> a plain chat reply, in the teacher's language, on EVERY environment,
  #                        whether or not the status Flow is published. Before this the Flow
  #                        flashed open and shut on its terminal screen and the chat said nothing.
  #   something running -> the surface is PER-ENVIRONMENT, as before — check which one you are on:
  #     PROD    (verified 2026-08-04): STATUS_FLOW_ID effectively UNSET -> plain-TEXT list
  #             "Running for you: • …". (The repo .env shows it set; the prod runtime differs —
  #             same template-vs-runtime gap as /portal, LP, registration.)
  #     STAGING (verified 2026-08-24, live drive): STATUS_FLOW_ID IS SET -> the Flow card
  #             "What's running / See everything you have in flight — and stop any of it. /
  #             Powered by NIETE" + an "Open status" CTA; the listing lives INSIDE the Flow.
  #   probe failed      -> never reported as "nothing running": the Flow opens anyway (or, with no
  #                        Flow published, "I couldn't check what's running just now…"). Not drivable
  #                        from WhatsApp — covered by tests/status/status-command.test.js.
  # Grouped POSITIVE · RULES · NEGATIVE · EDGE.

  # ═══════════════════════════ POSITIVE (happy path) ═══════════════════════════

  @e2e @P1
  Scenario: /status lists the teacher's in-flight work
    Given the NIETE bot chat is open
    And I have a coaching analysis running
    When I send "/status"
    Then the bot shows what is running — where the status Flow is published, the "What's running" card whose list names the item; otherwise a text reply starting "Running for you:" that lists it
    And the currently-active job appears listed by role (a coaching/LP item), not as a fixed list or fixed count
    # Non-deterministic: WHICH in-flight items are listed and their counts depend on
    # what is actually running for this account (contract §"status": which in-flight
    # items · counts). Assert the surface + that the observed active job (identified by
    # role, e.g. coaching or lesson-plan) is present — never a pinned bullet list or a
    # fixed number of items.
    # Verified live on PROD (2026-08-04): with a coaching analysis in flight, /status
    # returned "Running for you: • Coaching session in progress." (text path). On STAGING
    # the same state opens the "What's running" Flow (verified 2026-08-24). Updated
    # 2026-09-08 (PR #801 sync): the Then used to name only the text template, which
    # could not pass on staging even when the feature worked.

  @e2e @P1 @copy
  Scenario: /status with nothing running answers in the chat and does not open the Flow
    Given the NIETE bot chat is open
    And I have nothing in flight
    When I send "/status"
    Then the bot replies in the chat "Nothing's running right now. Send /menu to start something."
    And no "What's running" card with an "Open status" button is sent
    # PR #801. The probe now runs BEFORE the Flow CTA, so an empty store is
    # answered in words on every environment. Before: the CTA went out unconditionally,
    # the Flow's INIT returned a terminal screen for an empty store and flashed shut, and
    # the chat stayed silent — "a tap, a flicker, and silence". The reply points at /menu
    # rather than naming features (the old inline copy advertised a reading assessment
    # NIETE does not offer).

  # ═══════════════════════ RULES · valid variations ════════════════════════════

  @e2e @P2 @copy @language
  Scenario: The nothing-running answer is in the teacher's language
    Given the NIETE bot chat is open
    And my account language is Urdu
    And I have nothing in flight
    When I send "/status"
    Then the bot replies in the chat "اس وقت کچھ نہیں چل رہا۔ کچھ شروع کرنے کے لیے /menu بھیجیں۔"
    # Same string catalog entry as the English reply, resolved per preferred_language.
    # Language is LOCKED once chosen (language.feature), so this needs an Urdu account;
    # the shared English driver reports BLOCKED (state), not FAIL.

  @e2e @P2
  Scenario: Opening the menu is a glance, not work — /status right after /menu still says nothing is running
    Given the NIETE bot chat is open
    And I have nothing in flight
    When I send "/menu"
    And I send "/status"
    Then the bot replies in the chat "Nothing's running right now. Send /menu to start something."
    And nothing about the menu is listed as running or offered to be stopped
    # PR #801: the menu wait lasts an hour and used to count as work in flight — /status
    # said "You have 1 thing running" and offered to Stop something the teacher never
    # started. Both store questions ("is she busy?" / "what is running?") now read ONE
    # glance list so they cannot drift apart again.

  @e2e @P2 @draft
  Scenario: An in-flight item is named in plain words, never as an internal identifier
    Given the NIETE bot chat is open as a principal
    And I am part-way through marking an attendance register
    When I send "/status"
    Then the running item is named in words (e.g. "attendance marking")
    And no identifier with underscores appears anywhere in the status reply
    # PR #801: flows outside the resumable set rendered their raw id — a principal
    # mid-register read "Continue: attendance_marking", the exact thing the resume
    # header forbids. The fallback is now a plain de-snaked title; proper bilingual
    # names come with the decision on whether those flows should be resumable at all.
    # @draft: code-grounded, not yet driven — needs the principal persona mid-attendance
    # (attendance.feature is itself @wip).

  # ═══════════════════════════════ NEGATIVE ═════════════════════════════════════

  @e2e @menu @negative @content-driven @P3
  Scenario: A bare "status" (no slash) does not open the status surface
    Given the NIETE bot chat is open
    When I send "status"
    Then the bot does NOT show the status surface (assert shape: no "Running for you:" / "Nothing's running right now." / "What's running" card)
    And the reply is conversational AI free-text (resolved live — relevance/shape, not wording)
    # @content-driven: the fall-through reply is AI free-text, so assert the SHAPE
    # (the status surface is absent), never its wording. The /^\/status\b/i regex
    # requires the leading slash; a bare "status" falls through to the AI/general
    # handler (same contrast as bare "menu" vs "/menu").

  # ═══════════════════════════════ EDGE cases ══════════════════════════════════

  @e2e @edge @P3
  Scenario: /status is case-insensitive and tolerates trailing text
    Given the NIETE bot chat is open
    When I send "/STATUS now"
    Then the bot replies with the same status surface as "/status"
    # The command matches /^\/status\b/i — case-insensitive, word-boundary, so
    # "/Status", "/STATUS", "/status now" all trigger it.

  @e2e @P3
  Scenario: /status lists multiple concurrent items
    Given the NIETE bot chat is open
    And I have more than one kind of work in flight (e.g. a lesson plan AND a video)
    When I send "/status"
    Then every in-flight item is listed on the status surface (inside the Flow where it is published, under "Running for you:" otherwise)
    # teacher-state.service.js listActiveResources probes coaching + lesson-plan +
    # video + reading + the conversation store independently and lists all non-empty ones.
