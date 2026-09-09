@whatsapp @ict @profile:niete @feature:menu @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — the /menu surface
  # Non-determinism: see .claude/qa/shared/non-determinism-contract.md (assert contracts/shape; @content-driven answers resolved live).
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
  Scenario: /menu renders the card and exactly the 4 ICT feature rows
    Given the NIETE bot chat is open
    When I send "/menu"
    Then the message header is "Here's what I can do!"
    And the list opener button is labelled "View Features"
    When I open the "View Features" list
    Then the feature list shows exactly these rows:
      | Teacher Training   |
      | Lesson Plans       |
      | Classroom Coaching |
      | Ask Anything       |
    # MERGED 2026-08-19: was two scenarios ("shows exactly the 4 ICT feature rows"
    # + "header + opener use the expected copy") repeating the same /menu trigger and
    # state. Consolidated per the anti-redundancy rule — one flow, both assertions.
    # Carries @copy because the header/opener lines are exact strings: a fail on those
    # two Then steps is a copy change, not a structural bug. Check WHICH step failed
    # before filing — the row list is the structural contract, the copy is not.
    # Verified live on PROD (2026-08-04): header "Here's what I can do!", opener
    # "View Features" (whatsapp.service.js:1881,1890); exactly these 4 rows
    # (whatsapp.service.js:1897-1921).

  # ═══════════════════════════════ EDGE cases ══════════════════════════════════

  @e2e @menu @edge @P3
  Scenario: /menu is case-insensitive
    Given the NIETE bot chat is open
    When I send "/MENU"
    Then the "View Features" menu is shown with the 4 ICT rows
    # text-message.handler.js:1495 matches messageBody.toLowerCase() === '/menu',
    # so "/MENU" / "/Menu" open the menu too.

  @e2e @menu @edge @P2
  Scenario: /menu re-opens the menu from inside a feature flow (escape hatch)
    Given the NIETE bot chat is open
    And I am mid-way through a feature (e.g. after choosing Classroom Coaching)
    When I send "/menu"
    Then the "View Features" menu is shown again with the 4 ICT rows
    # /menu is a universal re-entry/escape from any state — the bot's own copy
    # tells teachers to "type /menu" to leave a flow (text-message.handler.js:1259;
    # escape handling at :1495, :2195, :2215). Observed live 2026-08-04.

  @e2e @menu @edge @P3
  Scenario: Sending /menu repeatedly is idempotent
    Given the NIETE bot chat is open
    When I send "/menu" twice in a row
    Then each send returns a fresh "View Features" menu with no error
    # Observed live 2026-08-04: repeated /menu just re-sends the list; the
    # awaiting_menu_selection state is overwritten each time (menu.service.js:35-42).

  @e2e @menu @edge @P3
  Scenario: /menu with surrounding whitespace still opens the menu (client trims)
    Given the NIETE bot chat is open
    When I send " /menu " with leading and trailing spaces
    Then the "View Features" menu is shown with the 4 ICT rows
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
    Then the bot does NOT show the "View Features" list (it replies conversationally)
    # Only "/menu" — or the exact WhatsApp ice-breaker "show menu - see all features
    # i can help with" (text-message.handler.js:386) — opens the list. Bare "menu"
    # falls through to the AI/general handler.

  # ═══════════════════════ Ask Anything (4th menu row — Q&A) ════════════════════

  @e2e @ask @menu @P1
  Scenario: The Ask Anything menu row opens general help
    Given the NIETE bot chat is open
    When I send "/menu"
    And I open the "View Features" list
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

  @e2e @config-gated @P3
  Scenario: /settings degrades gracefully when the Settings Flow is not configured
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
