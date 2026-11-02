@whatsapp @ict @profile:niete @feature:registration @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — Registration
  # Non-determinism: see .claude/qa/engine/bin/non-determinism-contract.md (assert contracts/shape; @content-driven answers resolved live).
  # ICT-region only. Driven from a linked WhatsApp Web session via Chrome MCP.
  # /register opens a native onboarding Flow (REGISTRATION_FLOW_ID is set on PROD).
  # Flow screens, v5 (docs/flows/registration-flow-v5.json, bd-x7aprz.2, operator decisions
  # 2026-10-16): INIT → PERSONAL_INFO (full_name + language; bilingual) → ROLE_SCHOOL (role:
  # Teacher / Principal only + one school search box) → SCHOOL_PICK (up to 10 real schools + "My
  # school isn't here") → TEACHING (grades + subjects) → SUCCESS. No country and no organization
  # question (set automatically); the school is CHOSEN from the schools table, never typed in.
  # Each screen writes to the user row as it is submitted; on Done the bot sends "Thank you for
  # registering, <name>!" with an "Open portal" button (the signed /go link). The v4 screens
  # (country / region / organization) stay served until each environment's Flow is republished.
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
  Scenario: The registration Flow first screen asks for a name and a language
    Given the NIETE bot chat is open
    And I open the registration Flow via "Get started"
    Then the PERSONAL_INFO screen asks for "Name / نام" and "Language / زبان"
    And it does not ask for a country
    # registration-endpoint.js INIT → PERSONAL_INFO, pre-filled from the user row (name, and the
    # language only if she chose one). Non-destructive to view; do NOT submit on the shared driver.

  @e2e @flow @P1 @destructive @R03
  Scenario: Completing the Flow registers the teacher
    Given the NIETE bot chat is open
    And I am a fresh (unregistered) test teacher
    When I complete the registration Flow (name, language, role, school, grades, subjects)
    And I tap "Finish" once
    Then the Flow closes at once — no screen is left open and "Finish" never needs a second tap
    And the bot replies with "Thank you for registering, <name>!"
    And the reply carries an "Open portal" button that opens the portal through the signed /go link
    # The endpoint closes the Flow: its TEACHING reply is SUCCESS + extension_message_response.params
    # (registration-endpoint.js handleTeachingSubmit), which WhatsApp turns into the nfm_reply that
    # sends the welcome. Production 2026-10-19 (Flow v5): that reply carried no
    # extension_message_response, the client never moved off TEACHING, four Finish taps did nothing
    # and no welcome arrived — fixed in v5.1 (bd-x7aprz.9).
    # flow-response.handler.js sendRegistrationWelcome: ONE cta_url message to <portal>/go/<token>
    # (app-login-link.js, 24 h, her users.id). No portal URL or signing key → the same welcome, no
    # button. The 7-day /portal/setup/<token> link is no longer sent.
    # @destructive: writes registration data + flips registration_completed — run
    # ONLY on a throwaway teacher.

  @e2e @flow @P1 @R05
  Scenario: The completion greeting names the teacher, in the language she chose
    Given the NIETE bot chat is open
    When I complete the registration Flow with name "Mahnoor" and language "English"
    Then the greeting should be "Thank you for registering, Mahnoor!" in English
    # The language is the one picked on PERSONAL_INFO (stored locked through setUserLanguage), never
    # inferred from the country. The SUCCESS card greets her by name too — it read "Welcome,
    # Teacher!" while the endpoint's Redis read returned {} (fixed in bd-x7aprz.2).

  # ═══════════════════════════════ EDGE cases ══════════════════════════════════

  @e2e @edge @P3 @R06
  Scenario: /register is case-insensitive
    Given the NIETE bot chat is open
    When I send "/REGISTER"
    Then the registration Flow is returned
    # UPDATED 2026-10-16: utils/registration-intent.js folds case; there is no
    # "already registered" reply any more (a registered teacher gets the Flow to update).

  @e2e @flow @edge @P2 @R07
  Scenario: The second screen asks the role (Teacher or Principal only) and searches for a school
    Given the NIETE bot chat is open
    And I submit the first screen of the registration Flow
    Then the ROLE_SCHOOL screen offers "Teacher" and "Principal / Head Teacher" and nothing else
    And it has one "School name or EMIS" search box
    # registration-roles.js FORM_ROLES — Coach and AEO are admin-set and never offered (bd-3goqc0).
    # An existing coach/AEO is not asked (the radio is hidden) and keeps her role. Non-destructive.

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
    Examples:
      | field |
      | name  |
    # The language radio is pre-selected, so the name is the one gate; the Flow disables Next.

  @e2e @flow @negative @P3 @R10
  Scenario: Abandoning the registration Flow leaves the teacher unregistered
    Given the NIETE bot chat is open
    And I am not yet registered
    And I open the registration Flow
    When I close the Flow without completing it
    Then no registration is recorded and I remain unregistered
    And I can run "/register" again to start over

  # ═══════════ ADDED 2026-08-04 · DRIVEN LIVE 2026-08-19 (staging) ═══════════
  # The role choice (which unlocks the principal's My Patch and attendance channel), the
  # school search and pick, and the no-school way out. Rewritten for the v5 Flow
  # (bd-x7aprz.2, 2026-10-16): the v4 non-PK branch and org=Other screens no longer exist.
  # Not yet driven live on v5 — the walk is in .claude/qa/shared/features/registration.cjs.

  # ── POSITIVE / EDGE ──
  @e2e @flow @destructive @P1 @R11
  Scenario: The registration Flow persists the selected role
    Given the NIETE bot chat is open
    And I am a fresh test teacher completing registration
    When I select "Principal / Head Teacher" on the ROLE_SCHOOL screen
    Then my account is created with role "principal"
    # registration-endpoint.js ROLE_SCHOOL writes the role as the screen is submitted, through
    # registration-roles.js roleToWrite (teacher | principal; never over an admin-set coach/AEO).
    # A Principal is granted directly (operator, 2026-10-16) — it opens her school's My Patch.
    # @destructive: creates/updates the account.

  @e2e @flow @destructive @P1
  Scenario: Searching a school's EMIS code links the account to that school
    Given the NIETE bot chat is open
    And I am a fresh test teacher on the ROLE_SCHOOL screen
    When I search a real school's EMIS code (e.g. "215" on sandbox), pick that school and complete the Flow
    Then my account's school_id is that school and its region is that school's sector
    # registration-endpoint.js SCHOOL_PICK re-checks the picked id against the schools table
    # (school-search.service findPickableSchool — real, non-test rows only) and persists
    # { school_id, region: school.region }. A forged or test-school id stores nothing.
    # @destructive: writes school_id/region.

  @e2e @flow @edge @P2 @R12
  Scenario Outline: A school search finds the school, with a "My school isn't here" way out
    Given the NIETE bot chat is open
    And I am on the ROLE_SCHOOL screen
    When I search "<query>"
    Then SCHOOL_PICK lists the matching school first, each row with its sector and EMIS
    And the last option is "My school isn't here"
    Examples:
      | query        |
      | 215          |
      | IMSG G7/3-2  |
    # school-search.service.js: case, spaces, brackets, hyphens and slashes are ignored; IMSG /
    # IMSB / IMS / IMCG / IMCB are searchable spelled out; the sector is searchable; an exact EMIS
    # ranks first; test schools never appear. Searching again is the Flow's own back arrow.

  @e2e @flow @edge @P3 @destructive @R13
  Scenario: A teacher whose school is not listed can finish without one
    Given the NIETE bot chat is open
    And I am a fresh test teacher on the ROLE_SCHOOL screen
    When I search a school that does not exist, choose "My school isn't here" and complete the Flow
    Then registration completes, no school is written to my account
    And the welcome says my school is not linked yet and a coach can add it
    # Operator, 2026-10-16: she can never add a school; she finishes without one and the school
    # features stay locked until a coach links her.

  @e2e @flow @negative @P3 @wip
  Scenario: A search that matches nothing offers only "My school isn't here"
    Given the NIETE bot chat is open
    And I am on the ROLE_SCHOOL screen
    When I search "zzqx no such school"
    Then SCHOOL_PICK says no school matched and offers only "My school isn't here"
    # registration-endpoint.js handleRoleSchoolSubmit logs "registration: school search" with the
    # query and the result count, so the miss rate is measurable in Axiom.

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

  # ═══════════ ADDED 2026-10-16 (later) · partly-known adults (code-grounded, not yet driven live) ═══════════
  # isRegistered() is true for anyone with a name, so roster/coach-added adults with a name but no
  # school or role — and anyone who quit the form after its first screen — were never offered it.
  # One predicate decides now: utils/registration-status.js needsRegistrationForm / needsSchoolForFeature.

  @e2e @wip @draft @flow @P1 @destructive @R20
  Scenario Outline: A partly-known adult is offered the form once, after her reply
    Given the NIETE bot chat is open
    And my account has <on_file> and the form has never been offered to me
    When I send "/menu"
    Then the bot answers my message first
    And after the answer the bot sends the registration Flow
    When I send another message
    Then the bot does not send the registration Flow again
    Examples:
      | on_file                                  |
      | a name but no school                     |
      | a name and a school but no teacher role  |
    # A roster row with a name, a school AND role teacher/principal is complete and is NOT offered.
    # An admin-set coach/AEO and a child's quiz phone are never offered. @destructive: stamps
    # users.registration_started_at.

  @e2e @wip @draft @flow @P1 @R21
  Scenario Outline: A registered teacher with no school is asked for it before a school feature
    Given the NIETE bot chat is open
    And I am a registered teacher with no school on my account
    When I send "<command>"
    Then the bot sends a "First, your school" registration Flow
    And it does not open <feature> or tell me to ask my coach
    Examples:
      | command  | feature           |
      | /classes | the class manager |
      | /roster  | the roster upload |
    # needsSchoolForFeature: any adult without users.school_id, registered or not, completed or
    # not — except an admin-set coach/AEO, whose schools are allocated. The form's INIT pre-fills
    # what is on file, so she only picks the school.

  @e2e @wip @draft @flow @P1 @destructive @R23
  Scenario Outline: A lesson-plan first message gets the catalogue alone; the registration Flow comes on a later turn
    # SPEC_FTUE §12 (NIETE row): «registration Flow after, not with, the plan». Behind REGISTRATION_AFTER_PLAN=true on the
    # bot service; with it unset the plan turn still sends both (today). Unit cover: bot/tests/first-touch/reg-after-plan-turn.test.js.
    Given the NIETE bot chat is open
    And REGISTRATION_AFTER_PLAN is "true" on the bot service under test
    And I am a fresh test number that has never been offered the registration form
    When I send "<request>"
    Then the bot sends the lesson-plan catalogue Flow
    And it does not send the registration Flow in the same turn
    When I send "hi"
    Then the bot answers it and sends the registration Flow once
    Examples:
      | request                                        |
      | lesson plan                                    |
      | I need a lesson plan on fractions for class 4  |
      | لیسن پلان                                      |
    # @destructive: stamps users.registration_started_at (reset it to test again on one number).
