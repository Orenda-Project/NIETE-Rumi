@whatsapp @ict @profile:niete @feature:registration @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — Registration
  # Non-determinism: see .claude/qa/shared/non-determinism-contract.md (assert contracts/shape; @content-driven answers resolved live).
  # ICT-region only. Driven from a linked WhatsApp Web session via Chrome MCP.
  # /register opens a native onboarding Flow (REGISTRATION_FLOW_ID is set on PROD).
  # Flow screens (registration-endpoint.js): INIT → PERSONAL_INFO (full_name,
  # country) → REGION_INFO (Pakistan only) → PROFESSIONAL_INFO (organization,
  # school_name, grade, subjects) → ORG_DETAILS → SUCCESS. On submit the user row
  # is updated (first_name, registration_completed) and the bot sends a
  # "Thank you for registering, <name>!" message (flow-response.handler.js:822/826).
  # bd-2447: conversational/deferred registration is DEPRECATED — /register ALWAYS
  # opens the Flow when configured, regardless of onboarding state.
  #
  # ⚠️ Completing the Flow MUTATES the account's registration (name, school, org),
  # and the already-registered / pending-name paths need a specific account state
  # — so most of this file needs a THROWAWAY test teacher (fresh + registered
  # variants), not the shared driver. Tags mark what's runnable where.
  # Grouped POSITIVE · EDGE · NEGATIVE.

  # ═══════════════════════════ POSITIVE (happy path) ═══════════════════════════

  @e2e @flow @P1
  Scenario: /register opens the registration Flow
    Given the NIETE bot chat is open
    And I am not yet registered (no first_name)
    When I send "/register"
    Then the bot sends a "Welcome" Flow with body "Quick setup — tell us a little about you."
    And a "Get started" Flow CTA is shown
    # Verified live on PROD (2026-08-04): "Welcome / Quick setup — tell us a little
    # about you. / Powered by NIETE" + "Get started". text-message.handler.js:1527-1540.

  @e2e @flow @P1
  Scenario: The registration Flow first screen collects name and country
    Given the NIETE bot chat is open
    And I open the registration Flow via "Get started"
    Then the PERSONAL_INFO screen asks for a full name and a country
    # registration-endpoint.js INIT → PERSONAL_INFO (full_name + country dropdown).
    # Non-destructive to view; do NOT submit on the shared driver.

  @e2e @flow @P1 @destructive
  Scenario: Completing the Flow registers the teacher
    Given the NIETE bot chat is open
    And I am a fresh (unregistered) test teacher
    When I complete the registration Flow (name, country, school, grade, subjects)
    Then the bot replies with "Thank you for registering, <name>!"
    And the reply says "You're all set" with a portal setup link matching the URL shape "portal.niete.edu.pk/portal/setup/<token>" (assert shape, not a fixed token)
    # Verified live on PROD (2026-08-04): the Flow completes end-to-end and delivers
    # "You're all set to use NIETE" + a portal setup link. flow-response.handler.js:822.
    # @destructive: writes registration data + flips registration_completed — run
    # ONLY on a throwaway teacher.

  @e2e @flow @negative @known-fail @P1
  Scenario: The completion greeting drops the teacher's name (and PK language)
    Given the NIETE bot chat is open
    When I complete the registration Flow with name "Mahnoor" and country "Pakistan"
    Then the greeting should be "Thank you for registering, Mahnoor!" in Urdu (PK)
    # F-REG1 — BUG reproduced live TWICE on PROD (2026-08-04), with both fill() and
    # type_text (real key events; the field showed value + a "Clear input" chip):
    # the greeting comes back "Thank you for registering, ! You're all set…" —
    # EMPTY name — and in ENGLISH despite selecting Pakistan. Root cause (to confirm
    # via Axiom): the terminal completion payload (nfm_reply.response_json) does not
    # carry the PERSONAL_INFO fields, so flow-response.handler.js:760 fullName='' →
    # :780 firstName='' and :819 country!=='PK' → en. The `Object.keys(responseJson)`
    # log at :757 shows exactly which keys arrive. NOT a harness artifact.

  # ═══════════════════════════════ EDGE cases ══════════════════════════════════

  @e2e @edge @P3
  Scenario: /register is case-insensitive
    Given the NIETE bot chat is open
    When I send "/REGISTER"
    Then the registration Flow (or already-registered reply) is returned
    # text-message.handler.js:1511 matches messageBody.toLowerCase() === '/register'.

  @e2e @flow @edge @P2
  Scenario: Pakistan teachers get an extra region screen
    Given the NIETE bot chat is open
    And I open the registration Flow and choose country "Pakistan"
    Then the next screen is REGION_INFO (a Pakistan-only step)
    # Split-screen routing: PERSONAL_INFO → REGION_INFO for PK, else straight to
    # PROFESSIONAL_INFO (registration-endpoint.js:123-145). Non-destructive to view.

  @e2e @edge @P2
  Scenario: An already-registered teacher is not re-onboarded
    Given the NIETE bot chat is open
    And I am already registered (have a first_name)
    When I send "/register"
    Then the bot replies with "You're already registered"
    And it greets me by my first name
    # text-message.handler.js:1516-1518 short-circuits before the Flow. Needs a
    # registered account — the shared driver was unregistered on 2026-08-04, so
    # this path was not reproducible there.

  # ═══════════════════════════════ NEGATIVE ══════════════════════════════════

  @e2e @flow @negative @P2
  Scenario Outline: A required field on the personal-info screen must be provided
    Given the NIETE bot chat is open
    And I have opened the registration Flow to the personal-info screen
    When I try to continue with the "<field>" left empty
    Then the Flow does not advance
    And it tells me the "<field>" is required
    Examples:
      | field   |
      | name    |
      | country |
    # handlePersonalInfoSubmit rejects an empty full_name / country ("Name is required" / "Country is required").

  @e2e @flow @negative @P3
  Scenario: Abandoning the registration Flow leaves the teacher unregistered
    Given the NIETE bot chat is open
    And I am not yet registered
    And I open the registration Flow
    When I close the Flow without completing it
    Then no registration is recorded and I remain unregistered
    And I can run "/register" again to start over

  # ═══════════ ADDED 2026-08-04 · DRIVEN LIVE 2026-08-19 (staging) ═══════════
  # The role dropdown (which unlocks /observe + the principal attendance channel),
  # the non-PK branch, org=Other, and the no-downgrade guard. @wip/@draft removed
  # on 2026-08-19 — all four were driven live against staging; per-scenario results
  # are recorded in the comment under each.

  # ── POSITIVE / EDGE ──
  @e2e @flow @destructive @known-fail @P1
  Scenario: The registration Flow persists the selected role
    Given the NIETE bot chat is open
    And I am a fresh test teacher completing registration
    When I select a role of "Coach" (or "Principal" / "AEO") on the PROFESSIONAL_INFO screen
    Then my account is created with that leader role
    # registration-endpoint.js:212 PROFESSIONAL_INFO role dropdown; normalizeRole:54;
    # flow-response.handler.js:772-797 writes users.role. bd-2404. This role is what
    # unlocks /observe (observe-gate.js:25) and the principal attendance channel — so
    # it MUST persist. @destructive: creates/updates the account.
    # DRIVEN LIVE 2026-08-19 (staging 923028931858): FAILS. Selected role "Teacher" on
    # PROFESSIONAL_INFO, completed the Flow — users.role stayed NULL. Not a missing
    # component (the dropdown is live: Teacher/Coach/Principal-Head Teacher/AEO-Cluster
    # Coordinator); it is the terminal-payload defect bd-2773, which drops every field
    # except organization. @known-fail until bd-2773 is fixed.

  @e2e @flow @edge @P2
  Scenario: A non-Pakistan teacher skips the region screen
    Given the NIETE bot chat is open
    And I open the registration Flow and choose a country other than Pakistan
    Then the next screen is PROFESSIONAL_INFO (REGION_INFO is skipped)
    # registration-endpoint.js:123 split-screen routing — non-PK goes straight to
    # PROFESSIONAL_INFO (PK-only gets the extra REGION_INFO). Non-destructive to view.
    # DRIVEN LIVE 2026-08-19 (staging): PASSES. Country=Tanzania → Next landed on
    # "Professional Details", REGION_INFO never rendered.

  @e2e @flow @edge @P3
  Scenario: Choosing organization "Other" adds an organization-details screen
    Given the NIETE bot chat is open
    And I am on the PROFESSIONAL_INFO screen
    When I choose organization "Other"
    Then an ORG_DETAILS screen asks for the organization name before SUCCESS
    # registration-endpoint.js:212 org='other' → ORG_DETAILS:289 → SUCCESS.
    # DRIVEN LIVE 2026-08-19 (staging): PASSES. org="Other" + Complete Registration
    # routed to ORG_DETAILS ("Enter Organization Name / Please type your organization
    # or partner name below."). Note: no inline "specify" field appears on
    # PROFESSIONAL_INFO — the extra screen only appears after submit.
