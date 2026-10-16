@whatsapp @ict @profile:niete @feature:registration @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — Registration
  # Non-determinism: see .claude/qa/shared/non-determinism-contract.md (assert contracts/shape; @content-driven answers resolved live).
  # ICT-region only. Driven from a linked WhatsApp Web session via Chrome MCP.
  # /register opens a native onboarding Flow (REGISTRATION_FLOW_ID is set on PROD).
  # Flow screens (registration-endpoint.js): INIT → PERSONAL_INFO (full_name,
  # country) → REGION_INFO (Pakistan only: province + emis_code → users.school_id) → PROFESSIONAL_INFO (organization,
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

  @e2e @flow @P1 @R01
  Scenario: /register opens the registration Flow
    Given the NIETE bot chat is open
    And I am not yet registered (no name)
    When I send "/register"
    Then the bot sends a "Welcome to NIETE" Flow whose body asks for my name, my school and the classes I teach
    And a "Get started" Flow CTA is shown
    # UPDATED 2026-10-16: the invite copy now comes from ux-strings (registrationInviteNew*),
    # sent by services/registration-invite.service.js — the one sender every door uses. In
    # Urdu: "خوش آمدید!" / "شروع کریں". No footer. The 2026-08-04 live check saw the old copy
    # ("Welcome / Quick setup — tell us a little about you. / Powered by NIETE").

  @e2e @flow @P1 @R02
  Scenario: The registration Flow first screen collects name and country
    Given the NIETE bot chat is open
    And I open the registration Flow via "Get started"
    Then the PERSONAL_INFO screen asks for a full name and a country
    # registration-endpoint.js INIT → PERSONAL_INFO (full_name + country dropdown).
    # Non-destructive to view; do NOT submit on the shared driver.

  @e2e @flow @P1 @destructive @R03
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

  @e2e @flow @P1 @R05
  Scenario: The completion greeting names the teacher, in Urdu for Pakistan
    Given the NIETE bot chat is open
    When I complete the registration Flow with name "Mahnoor" and country "Pakistan"
    Then the greeting should be "Thank you for registering, Mahnoor!" in Urdu (PK)
    # @known-fail REMOVED 2026-09-08: driven live on staging (driver 923028931858) the greeting was
    # "رجسٹریشن کا شکریہ، Mahnoor! …" — name present, Urdu. F-REG1 is fixed on this build. The
    # history below is kept for the record.
    # F-REG1 — BUG reproduced live TWICE on PROD (2026-08-04), with both fill() and
    # type_text (real key events; the field showed value + a "Clear input" chip):
    # the greeting comes back "Thank you for registering, ! You're all set…" —
    # EMPTY name — and in ENGLISH despite selecting Pakistan. Root cause (to confirm
    # via Axiom): the terminal completion payload (nfm_reply.response_json) does not
    # carry the PERSONAL_INFO fields, so flow-response.handler.js:760 fullName='' →
    # :780 firstName='' and :819 country!=='PK' → en. The `Object.keys(responseJson)`
    # log at :757 shows exactly which keys arrive. NOT a harness artifact.

  # ═══════════════════════════════ EDGE cases ══════════════════════════════════

  @e2e @edge @P3 @R06
  Scenario: /register is case-insensitive
    Given the NIETE bot chat is open
    When I send "/REGISTER"
    Then the registration Flow is returned
    # UPDATED 2026-10-16: utils/registration-intent.js folds case; there is no
    # "already registered" reply any more (a registered teacher gets the Flow to update).

  @e2e @flow @edge @P2 @R07
  Scenario: Pakistan teachers get an extra region screen
    Given the NIETE bot chat is open
    And I open the registration Flow and choose country "Pakistan"
    Then the next screen is REGION_INFO (a Pakistan-only step)
    # Split-screen routing: PERSONAL_INFO → REGION_INFO for PK, else straight to
    # PROFESSIONAL_INFO (registration-endpoint.js:123-145). Non-destructive to view.

  @e2e @flow @edge @P2 @R08
  Scenario: An already-registered teacher gets the Flow to update her details
    Given the NIETE bot chat is open
    And I am already registered (have a name)
    When I send "/register"
    Then the bot sends an "Update your details" Flow with an "Update details" CTA
    And it does not reply "You're already registered"
    # UPDATED 2026-10-16. Re-opening the Flow is how a registered teacher corrects her
    # name or school (a number reissued with the previous holder's name on it); the
    # "You're already registered" short-circuit left her no way to fix it.
    # registration-invite.service.js variant "update". Needs a registered account.

  # ═══════════════════════════════ NEGATIVE ══════════════════════════════════

  @e2e @flow @negative @P2 @R09
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

  @e2e @flow @negative @P3 @R10
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
  @e2e @flow @destructive @P1 @R11
  Scenario: The registration Flow persists the selected role
    Given the NIETE bot chat is open
    And I am a fresh test teacher completing registration
    When I select a role of "Coach" (or "Principal" / "AEO") on the PROFESSIONAL_INFO screen
    Then my account is created with that leader role
    # registration-endpoint.js:212 PROFESSIONAL_INFO role dropdown; normalizeRole:54;
    # flow-response.handler.js:772-797 writes users.role. bd-2404. This role is what
    # unlocks /observe (observe-gate.js:25) and the principal attendance channel — so
    # it MUST persist. @destructive: creates/updates the account.
    # @known-fail REMOVED 2026-09-08: driven live again on staging (923028931858), selected "Coach"
    # → users.role = "coach" persisted. Fixed on this build; the 2026-08-19 record stays below.
    # DRIVEN LIVE 2026-08-19 (staging 923028931858): FAILS. Selected role "Teacher" on
    # PROFESSIONAL_INFO, completed the Flow — users.role stayed NULL. Not a missing
    # component (the dropdown is live: Teacher/Coach/Principal-Head Teacher/AEO-Cluster
    # Coordinator); it is the terminal-payload defect bd-2773, which drops every field
    # except organization. @known-fail until bd-2773 is fixed.

  @e2e @flow @destructive @P1
  Scenario: Typing the school's EMIS code on the region screen links the account to that school
    Given the NIETE bot chat is open
    And I am a fresh Pakistan test teacher on the REGION_INFO screen
    When I select any province, type a real school EMIS code (e.g. "216") in the EMIS field, and complete the Flow
    Then my account's school_id is the school with that EMIS and its region is that school's sector (e.g. "Urban-I"), not the province
    # registration-endpoint.js handleRegionInfoSubmit resolves form.emis_code through
    # school-resolver.findSchoolByEmis and persists { school_id, region: school.region };
    # the flow-response.handler.js completion write no longer copies the payload's province
    # onto users.region. bd-z8p96. The Flow has carried the emis_code TextInput all along
    # (REGION_INFO, init_emis_code pre-fill) — verified on the PUBLISHED prod (2010172012940869)
    # and staging (1492701779552399) Flows on 2026-09-23. @destructive: writes school_id/region.
    # DRIVEN LIVE 2026-09-24 (staging 923236172838, build 5ddb5d36): PASSES. Province "Federal" +
    # EMIS "216" on REGION_INFO → users.school_id = IMS(I-V) G-7/1 (emis 216), users.region =
    # "Urban-I" right after the screen submit; completion at 07:46 UTC left region at "Urban-I"
    # (the province was NOT written back) and the bot sent the registration thanks + portal link.

  @e2e @flow @edge @P2 @R12
  Scenario: A non-Pakistan teacher skips the region screen
    Given the NIETE bot chat is open
    And I open the registration Flow and choose a country other than Pakistan
    Then the next screen is PROFESSIONAL_INFO (REGION_INFO is skipped)
    # registration-endpoint.js:123 split-screen routing — non-PK goes straight to
    # PROFESSIONAL_INFO (PK-only gets the extra REGION_INFO). Non-destructive to view.
    # DRIVEN LIVE 2026-08-19 (staging): PASSES. Country=Tanzania → Next landed on
    # "Professional Details", REGION_INFO never rendered.

  @e2e @flow @edge @P3 @R13
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

  @e2e @flow @negative @P3 @wip
  Scenario: An unknown EMIS code leaves the account unlinked and keeps the province
    Given the NIETE bot chat is open
    And I am a fresh Pakistan test teacher on the REGION_INFO screen
    When I type an EMIS code that matches no school (e.g. "999999") and complete the Flow
    Then my account has no school_id, its region is the province I selected, and the bot logs "registration: emis_not_found" with the code
    # registration-endpoint.js handleRegionInfoSubmit: a miss keeps the old behaviour
    # (province stored, no link) and logs 'emis_not_found' so the mistype rate is
    # measurable in Axiom. bd-z8p96. @wip: not yet driven live.

  # ═══════════ ADDED 2026-10-16 · the front door (code-grounded, not yet driven live) ═══════════
  # Every new or unregistered adult reaches the registration Flow. Live evidence it was
  # missing (niete-logs, 16 Sep – 16 Oct 2026): 25 bare "Register", 3 "Register me" and 16
  # slash near-misses never opened the Flow, and a new number got no welcome at all.
  # Sender: services/registration-invite.service.js. Matcher: utils/registration-intent.js.

  @e2e @wip @draft @flow @P1 @R14
  Scenario Outline: Every way of asking to register opens the registration Flow
    Given the NIETE bot chat is open
    And I am not yet registered
    When I send "<message>"
    Then the bot sends the registration Flow
    And it does not reply "I'll ask for your name after you try one of my features!"
    Examples:
      | message            |
      | Register           |
      | Register me        |
      | i need to register |
      | /registered        |
      | / register         |
      | Type/register      |
      | رجسٹر              |
    # The old substring keyword branch (text-message.handler.js) is gone.

  @e2e @wip @draft @negative @P2 @R15
  Scenario Outline: Talking about a register is not a registration request
    Given the NIETE bot chat is open
    When I send "<message>"
    Then the bot does not send the registration Flow
    Examples:
      | message                          |
      | attendance register              |
      | Mera registration number kia hai |
    # registration-intent.js is a whitelist: attendance/class/number words, digits and long
    # forwarded text are never a request to set up her own account.

  @e2e @wip @draft @flow @P1 @destructive @R16
  Scenario: A new person's first message is answered first, then the Flow is offered once
    Given the NIETE bot chat is open
    And I am a fresh test number that has never messaged the bot
    When I send "Assalam o alaikum, can you help me plan a lesson?"
    Then the bot answers my message first
    And after the answer the bot sends the registration Flow
    When I send another message without registering
    Then the bot answers it and does not send the registration Flow again
    # text-message.handler.js handleTextMessage → offerRegistrationAfterReply →
    # offerRegistrationOnce, claimed on users.registration_started_at. Never offered to a
    # registered teacher, a child's quiz handset, or during an account-lookup outage.
    # @destructive: stamps registration_started_at on the account.

  @e2e @wip @draft @flow @P2 @R17
  Scenario: /portal from someone not yet registered opens the registration Flow
    Given the NIETE bot chat is open
    And I am not yet registered
    When I send "/portal"
    Then the bot sends the registration Flow
    And it does not send a portal setup link
    # Before 2026-10-16 /portal handed an unregistered sender a setup link for an account
    # with no name, role or school behind it. Registered teachers are unchanged.

  @e2e @wip @draft @flow @P2 @R18
  Scenario Outline: A feature that needs a school asks an unregistered person to register first
    Given the NIETE bot chat is open
    And I am not yet registered
    When I send "<command>"
    Then the bot sends a "First, your school" registration Flow
    And it does not open <feature>
    Examples:
      | command  | feature           |
      | /classes | the class manager |
      | /roster  | the roster upload |
    # text-message.handler.js /classes, /roster and the attendance keyword; variant "school".

  @e2e @wip @draft @P2 @R19
  Scenario: After the first lesson plan, a person already offered the Flow is not asked her name in chat
    Given the NIETE bot chat is open
    And I am not yet registered and the bot has already sent me the registration Flow
    When I request a lesson plan and it is delivered
    Then the bot does not ask "By the way, what should I call you?"
    And my next message is not taken as my name
    # feature-registration.service.js checkAndTriggerRegistration: with a Flow id it uses the
    # once-only offer; without one (production workers today) it stops when
    # registration_started_at is set.
