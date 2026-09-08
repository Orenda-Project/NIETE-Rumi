@whatsapp @ict @profile:niete @feature:status @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — /status (what's running + cancel)
  # Non-determinism: see .claude/qa/shared/non-determinism-contract.md (assert contracts/shape; @content-driven answers resolved live).
  # ICT-region only. Driven from a linked WhatsApp Web session via Chrome MCP.
  # /status is a cross-feature snapshot: "what do I have in flight, and stop any
  # of it." (text-message.handler.js:1660-1697). In-flight work is probed by
  # teacher-state.service.js: coaching (coaching_sessions non-terminal, last hour),
  # lesson-plan (lesson_plan_requests pending/processing/extracting), video
  # (Redis awaiting_video_*), reading (Redis current_assessment).
  #
  # THE FLOW-vs-TEXT SPLIT IS PER-ENVIRONMENT — check which one you are on before
  # trusting a text assertion below.
  #
  #   PROD    (verified 2026-08-04): STATUS_FLOW_ID effectively UNSET -> plain-TEXT
  #           summary, NOT the "Open status" Flow. (The repo .env shows it set; the
  #           prod runtime differs — same template-vs-runtime gap as /portal, LP,
  #           registration.)
  #   STAGING (verified 2026-08-24, live drive): STATUS_FLOW_ID IS SET -> /status
  #           returns the Flow card "What's running / See everything you have in
  #           flight — and stop any of it. / Powered by NIETE" + an "Open status"
  #           CTA. The plain-text scenarios below therefore CANNOT be exercised on
  #           the default (staging) target — they are BLOCKED there on env, not
  #           failing. Run them against `niete-prod` to assert the text path.
  # Grouped POSITIVE · EDGE · NEGATIVE.

  # ═══════════════════════════ POSITIVE (happy path) ═══════════════════════════

  @e2e @P1
  Scenario: /status lists the teacher's in-flight work
    Given the NIETE bot chat is open
    And I have a coaching analysis running
    When I send "/status"
    Then the bot's reply starts with the template "Running for you:"
    And the currently-active job appears listed by role (a coaching/LP item), not as a fixed list or fixed count
    # Non-deterministic: WHICH in-flight items are listed and their counts depend on
    # what is actually running for this account (contract §"status": which in-flight
    # items · counts). Assert the "Running for you:" template + that the observed
    # active job (identified by role, e.g. coaching or lesson-plan) is present —
    # never a pinned bullet list or a fixed number of items.
    # Verified live on PROD (2026-08-04): with a coaching analysis in flight, /status
    # returned "Running for you: • Coaching session in progress." Text-fallback path
    # (STATUS_FLOW_ID unset on prod) — text-message.handler.js:1685-1691.

  # ═══════════════════════════════ EDGE cases ══════════════════════════════════

  @e2e @edge @P3
  Scenario: /status is case-insensitive and tolerates trailing text
    Given the NIETE bot chat is open
    When I send "/STATUS now"
    Then the bot replies with the same status summary as "/status"
    # text-message.handler.js:1660 matches /^\/status\b/i — case-insensitive, word-
    # boundary, so "/Status", "/STATUS", "/status now" all trigger it.

  @e2e @menu @negative @content-driven @P3
  Scenario: A bare "status" (no slash) does not open the status surface
    Given the NIETE bot chat is open
    When I send "status"
    Then the bot does NOT show the status summary (assert shape: no "Running for you:" / "Nothing's running right now.")
    And the reply is conversational AI free-text (resolved live — relevance/shape, not wording)
    # @content-driven: the fall-through reply is AI free-text, so assert the SHAPE
    # (the status summary is absent), never its wording. The /^\/status\b/ regex
    # requires the leading slash; a bare "status" falls through to the AI/general
    # handler (same contrast as bare "menu" vs "/menu").

  # ═══════════ ADDED 2026-08-04 · multiple concurrent items (code-grounded) ═══════════

  @e2e @P3
  Scenario: /status lists multiple concurrent items
    Given the NIETE bot chat is open
    And I have more than one kind of work in flight (e.g. a lesson plan AND a video)
    When I send "/status"
    Then the bot lists every in-flight item under "Running for you:"
    # teacher-state.service.js listActiveResources probes coaching + lesson-plan +
    # video + reading independently and lists all non-empty ones.
