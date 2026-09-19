@whatsapp @ict @profile:niete @feature:menu @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — the /menu surface
  # Non-determinism: see .claude/qa/engine/bin/non-determinism-contract.md (assert contracts/shape; @content-driven answers resolved live).
  # Target: the NIETE bot (E2E_TARGET_NUMBER) driven from a linked WhatsApp Web
  # session via Chrome MCP. Region: ICT / Islamabad — ICT-region features ONLY.
  # This file covers the /menu surface itself (the list rows) plus the ancillary
  # commands the ICT deployment offers (/portal, /settings). The /language surface
  # has its own file — language.feature (selection + i18n propagation across flows).
  #
  # This file ALSO covers the Ask Anything feature (the 4th menu row): it is
  # lightweight general Q&A with no dedicated flow, so it lives here rather than in
  # a separate file. The other three rows have rich flows in their own files:
  #   · training.feature      (Teacher Training)
  #   · lesson-plan.feature    (Lesson Plans)
  #   · coaching.feature       (Classroom Coaching)
  # Scenarios are grouped POSITIVE (happy path) · EDGE · NEGATIVE.
  # Tags: @negative = error/invalid path · @edge = boundary/unusual input ·
  # @config-gated = works only when its env/Flow id is set · @slow = needs a
  # multi-minute wait · @defensive = guards an internally-unreachable state ·
  # @known-issue = documents a real gap (should pass once fixed). All excluded
  # from the default run except @e2e without @slow/@wip.

  # ═══════════════════════════ POSITIVE (happy path) ═══════════════════════════

  @e2e @menu @copy @P1
  Scenario: /menu renders the role-aware feature card for a teacher
    Given the NIETE bot chat is open
    When I send "/menu"
    Then the message header is "Here's what I can do"
    And the list opener button is labelled "See what I do"
    When I open the "See what I do" list
    Then the feature list includes these teacher rows:
      | Lesson Plans       |
      | Classroom Coaching |
      | Teacher Training   |
      | Ask Anything       |
    # UPDATED 2026-09-16 (78406d1e "menu: role-aware layouts, and every row reaches a
    # door"): the menu is now role-aware. Button "View Features" -> "See what I do",
    # the header dropped its "!", and the TEACHER layout offers up to ten rows —
    # lesson plans, coaching, training, attendance, my classes, quiz, test paper,
    # student videos, change language, ask anything — ordered by seven-day usage.
    # The exact set is role- AND config-gated (a feature with no Flow has no row), so
    # this asserts the CORE teacher rows are PRESENT, not an exact list — the copy
    # (header/opener) is exact, the full row list is not. Source of truth:
    # bot/shared/config/role-features.js + ux-strings.js menuRow*Title / menuButton.

  # ═══════════════════════════════ EDGE cases ══════════════════════════════════

  @e2e @menu @edge @P3
  Scenario: /menu is case-insensitive
    Given the NIETE bot chat is open
    When I send "/MENU"
    Then the "See what I do" menu is shown with the core teacher rows
    # text-message.handler.js:1495 matches messageBody.toLowerCase() === '/menu',
    # so "/MENU" / "/Menu" open the menu too.

  @e2e @menu @edge @P2
  Scenario: /menu re-opens the menu from inside a feature flow (escape hatch)
    Given the NIETE bot chat is open
    And I am mid-way through a feature (e.g. after choosing Classroom Coaching)
    When I send "/menu"
    Then the "See what I do" menu is shown again with the core teacher rows
    # /menu is a universal re-entry/escape from any state — the bot's own copy
    # tells teachers to "type /menu" to leave a flow (text-message.handler.js:1259;
    # escape handling at :1495, :2195, :2215). Observed live 2026-08-04.

  @e2e @menu @edge @P3
  Scenario: Sending /menu repeatedly is idempotent
    Given the NIETE bot chat is open
    When I send "/menu" twice in a row
    Then each send returns a fresh "See what I do" menu with no error
    # Observed live 2026-08-04: repeated /menu just re-sends the list; the
    # awaiting_menu_selection state is overwritten each time (menu.service.js:35-42).

  @e2e @menu @edge @P3
  Scenario: /menu with surrounding whitespace still opens the menu (client trims)
    Given the NIETE bot chat is open
    When I send " /menu " with leading and trailing spaces
    Then the "See what I do" menu is shown with the core teacher rows
    # Verified live on PROD (2026-08-04): WhatsApp Web TRIMS leading/trailing
    # whitespace before sending, so the bot receives "/menu" and opens the menu.
    # NB a latent server gap remains — text-message.handler.js:1495 matches the
    # UNtrimmed messageBody (unlike /portal at :457, which trims) — but the client
    # masks it for plain surrounding spaces, so it is not user-reproducible here.

  # ═════════════════════════════════ NEGATIVE ══════════════════════════════════

  @e2e @menu @negative @P3
  Scenario: A bare "menu" (no slash) does not open the interactive menu
    Given the NIETE bot chat is open
    When I send "menu"
    Then the bot does NOT show the "See what I do" list (it replies conversationally)
    # Only "/menu" — or the exact WhatsApp ice-breaker "show menu - see all features
    # i can help with" (text-message.handler.js:386) — opens the list. Bare "menu"
    # falls through to the AI/general handler.

  # ═══════════════════════ Ask Anything (4th menu row — Q&A) ════════════════════

  @e2e @ask @menu @P1
  Scenario: The Ask Anything menu row opens general help
    Given the NIETE bot chat is open
    When I send "/menu"
    And I open the "See what I do" list
    And I tap the "Ask Anything" row
    Then the bot replies with "How can I help you today?"
    # Verified live on PROD (2026-08-04): menu.service.js:391 (_handleOtherChoice)
    # → state GENERAL_CONVERSATION.

  @e2e @ask @content-driven @P1
  Scenario: Ask Anything answers a teaching question
    Given the NIETE bot chat is open
    When I send "What are two quick classroom management strategies for a large class?"
    Then the bot reply is relevant to teaching
    And the bot reply is longer than 60 characters
    # Verified live on PROD (2026-08-04): returned a relevant two-strategy answer.

  @e2e @ask @negative @content-driven @P3
  Scenario: Gibberish input is handled gracefully
    Given the NIETE bot chat is open
    When I send "asdfghjkl zxcvbnm qwerty"
    Then the bot reply does not leak an error
    And the bot reply is non-empty
    # Verified live on PROD (2026-08-04): "Looks like random letters! How can I
    # assist you with your teaching or classroom needs today?"

  # ══════════════════ Ancillary commands (positive + config-gated) ══════════════
  # /language moved to language.feature (2026-08-11) — selection + per-flow i18n.

  @e2e @portal @P2
  Scenario: /portal points an activated teacher to their portal login
    Given the NIETE bot chat is open
    And my portal account is already activated
    When I send "/portal"
    Then the bot reply contains a URL matching "portal.niete.edu.pk/portal/login"
    # Verified live on PROD (2026-08-04): "Your NIETE portal is already active!
    # Log in here: https://portal.niete.edu.pk/portal/login". PORTAL_URL IS set on
    # the prod deployment — the earlier @known-fail was wrong: it was based on the
    # repo .env.template (blank), which is the template, not the prod runtime env.
    # A non-activated teacher instead gets a /portal/setup/<token> link
    # (portal-invite.service.js:62).

  @obsolete @config-gated @P3
  Scenario: /settings degrades gracefully when the Settings Flow is not configured
    # OBSOLETE 2026-09-16 (operator): removed from the E2E lane — its precondition (SETTINGS_FLOW_ID unset) cannot be met on any reachable env here, so it only ever SKIPped; the degrade path stays covered by unit tests. Kept (not deleted) for the audit trail.
    Given the NIETE bot chat is open
    When I send "/settings"
    Then the bot reply contains "not available"
    # /settings is a supported command — NOT region-gated. It opens a Settings
    # Flow (language + observation framework) when SETTINGS_FLOW_ID is set. That
    # env var is empty in this deployment, so it returns "Settings are not
    # available yet. Please try again later." (text-message.handler.js:1614-1637).

  # ═══════════ ADDED 2026-08-04 · draft coverage from the feature-map (code-grounded, @wip) ═══════════
  # Ask Anything lacked the capability-inquiry branch. This fills it. @wip @draft.
  # (The /language drafts that lived here moved to language.feature, 2026-08-11 —
  #  and note the old "Auto-detect" scenario is gone entirely: OPS-118 removed the
  #  Auto-detect row on develop, so it is no longer a real surface to test.)

  @e2e @ask @content-driven @P3
  Scenario: A capability question gets a guided answer, not a feature attempt
    Given the NIETE bot chat is open
    When I send "what can you do?"
    Then the bot describes what it can help with rather than starting a feature
    # helper-agent.service.js detectCapabilityInquiry (text-message.handler.js:2219) —
    # a capability question (NOT a "create/make/بنائیں" request) → capability guidance.

  # ═══════════ ADDED 2026-09-08 · spec sync for the out-of-range menu number ═══════════
  # The numeric-choice path had no scenario. FOUND BY THE MOCK LANE on the first drive: a "7"
  # after /menu never reaches MenuService.handleMenuChoice — text-message.handler.js:2540 only
  # forwards "1".."4" and answers anything else with the Helper Agent escape message
  # (helper-agent.service.js:317). The `![1,2,3,4]` guard inside handleMenuChoice is dead from
  # the text path, so its copy is NOT teacher-visible. The scenario pins what teachers see.

  @e2e @menu @negative @copy @P3
  Scenario: A menu number outside 1-4 gets the choose-an-option nudge and starts nothing
    Given the NIETE bot chat is open
    And I have just sent "/menu"
    When I send "7"
    Then the bot reply contains "choose an option (1-4)"
    And the reply offers "/menu" to see the menu again
    And no feature is started
    # HelperAgentService.getEscapePathMessage('AWAITING_MENU_CHOICE') — "📋 Please choose an
    # option (1-4) from the menu above.\n\nOr type /menu to see the menu again."
  # ═══════ ROLE-BASED ROWS (row 122, 2026-09-15) · DC and HITL by persona ═══════
  # The four rows above are the TEACHER menu and remain exactly that. Two of the
  # features are role-shaped and the menu used to say so nowhere: DC is "coach ME
  # on MY lesson", HITL (/observe) is "I observed SOMEONE ELSE". A role='principal'
  # teacher therefore tapped Classroom Coaching, was told to send her recording,
  # and got the observe binding list — "Whose observation is this?" — because
  # observe-audio-router intercepts a leader's audio on role alone. Her recording
  # was parked and never analysed (DC review sheet row 122, Asifa Ayub, 14 Sep).
  #
  # Contract (bot/shared/config/role-features.js):
  #   teacher    → Classroom Coaching only
  #   principal  → BOTH (in ICT a principal also teaches)
  #   coach      → Observe a Teacher only
  #   unknown    → Classroom Coaching only (never grant HITL by accident)
  # The HITL row additionally requires OBSERVE_MEWAKA_FLOW_ID — presence-based.

  @e2e @menu @role @P1
  Scenario: A principal sees BOTH Classroom Coaching and Observe a Teacher
    Given the NIETE bot chat is open
    And my role is "principal"
    When I send "/menu"
    And I open the "See what I do" list
    Then the feature list shows exactly these rows:
      | Teacher Training   |
      | Lesson Plans       |
      | Classroom Coaching |
      | Observe a Teacher  |
      | Ask Anything       |

  @e2e @menu @role @P1
  Scenario: A coach sees Observe a Teacher and NOT Classroom Coaching
    Given the NIETE bot chat is open
    And my role is "coach"
    When I send "/menu"
    And I open the "See what I do" list
    Then the feature list shows exactly these rows:
      | Teacher Training  |
      | Lesson Plans      |
      | Observe a Teacher |
      | Ask Anything      |
    # A coach observes; she does not have her own class to be coached on.

  @e2e @menu @role @P1
  Scenario: A teacher still sees Classroom Coaching and no observe row
    Given the NIETE bot chat is open
    And my role is "teacher"
    When I send "/menu"
    And I open the "See what I do" list
    Then the feature list shows the core teacher rows
    And the feature list does NOT show "Observe a Teacher"

  @e2e @menu @role @negative @P2
  Scenario: A coach tapping a Classroom Coaching row from old scrollback is refused
    Given the NIETE bot chat is open
    And my role is "coach"
    And an older "/menu" message is still in my chat history
    When I scroll back and tap the "Classroom Coaching" row on that old message
    Then the bot does NOT ask me to send a classroom recording
    And the bot reply names "Observe a Teacher" as the row that is mine
    # A WhatsApp list lives in scrollback forever, so hiding the row is not enough
    # — the tap is gated where it LANDS (menu.service.js, case 'menu_coaching').
    # Without this she is told to send a recording that is then parked: row 122's
    # ending, reached by a different door.

  @e2e @menu @role @negative @P3
  Scenario: A teacher tapping a stray Observe row is refused and redirected
    Given the NIETE bot chat is open
    And my role is "teacher"
    When I tap an "Observe a Teacher" row from an older message
    Then the observe flow does not start
    And the bot reply names "Classroom Coaching" as the row that is mine

  @e2e @menu @role @language @P2
  Scenario: The refusal is in the teacher's own language
    Given the NIETE bot chat is open
    And my role is "coach"
    And my preferred language is Urdu
    When I tap the "Classroom Coaching" row
    Then the bot reply is in Urdu
    # Found while building row 122: BOTH menu dispatch sites read `user.language`,
    # and `users` has NO such column (prod: "column users.language does not
    # exist"). Every menu tap had been handled in English for every Urdu teacher.
    # Now reads preferred_language (whatsapp-bot.js, both dispatch sites).
