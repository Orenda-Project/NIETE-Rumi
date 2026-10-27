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

  @e2e @menu @copy @P1 @M01
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

  @e2e @menu @edge @P3 @M02
  Scenario: /menu is case-insensitive
    Given the NIETE bot chat is open
    When I send "/MENU"
    Then the "See what I do" menu is shown with the core teacher rows
    # text-message.handler.js:1495 matches messageBody.toLowerCase() === '/menu',
    # so "/MENU" / "/Menu" open the menu too.

  @e2e @menu @edge @P1 @M28
  Scenario: /menu typed back the way Urdu text showed it ("Menu/") still opens the menu
    Given the NIETE bot chat is open
    When I send "Menu/"
    Then the "See what I do" menu is shown with the core teacher rows
    # ADDED 2026-10-13 (bd-5ls6qy.7): an Urdu line showed a bare "/menu" as "menu/"
    # (right-to-left paragraph), and teachers typed what they saw — 43 such messages
    # in 10–13 Oct, none reached the menu. shared/utils/slash-command.js rewrites a
    # whole-message reversed command to "/menu" before any door runs.

  @e2e @menu @edge @P2 @M22
  Scenario: "/ menu" (a space after the slash) opens the menu
    Given the NIETE bot chat is open
    When I send "/ menu"
    Then the "See what I do" menu is shown with the core teacher rows
    # ADDED 2026-10-13 (bd-5ls6qy.7): 76 "/ menu" messages in 10–13 Oct went to the
    # general chat. Same canonicaliser as M28. A bare "menu" stays a non-command (M06).

  @e2e @menu @edge @P2 @M03
  Scenario: /menu re-opens the menu from inside a feature flow (escape hatch)
    Given the NIETE bot chat is open
    And I am mid-way through a feature (e.g. after choosing Classroom Coaching)
    When I send "/menu"
    Then the "See what I do" menu is shown again with the core teacher rows
    # /menu is a universal re-entry/escape from any state — the bot's own copy
    # tells teachers to "type /menu" to leave a flow (text-message.handler.js:1259;
    # escape handling at :1495, :2195, :2215). Observed live 2026-08-04.

  @e2e @menu @edge @P3 @M04
  Scenario: Sending /menu repeatedly is idempotent
    Given the NIETE bot chat is open
    When I send "/menu" twice in a row
    Then each send returns a fresh "See what I do" menu with no error
    # Observed live 2026-08-04: repeated /menu just re-sends the list; the
    # awaiting_menu_selection state is overwritten each time (menu.service.js:35-42).

  @e2e @menu @edge @P3 @M05
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

  @obsolete @menu @negative @P3 @M06
  Scenario: A bare "menu" (no slash) does not open the interactive menu
    # OBSOLETE 2026-10-20 (bd-xw56ed): a message no door catches is now read against the live menu, and a bare
    # "menu" opens the menu (@M25). Kept (not deleted) for the audit trail.
    Given the NIETE bot chat is open
    When I send "menu"
    Then the bot does NOT show the "See what I do" list (it replies conversationally)
    # Only "/menu" — or the exact WhatsApp ice-breaker "show menu - see all features
    # i can help with" (text-message.handler.js:386) — opens the list. Bare "menu"
    # falls through to the AI/general handler.

  # ═══════════════════════ Ask Anything (4th menu row — Q&A) ════════════════════

  @e2e @ask @menu @P1 @M07
  Scenario: The Ask Anything menu row opens general help
    Given the NIETE bot chat is open
    When I send "/menu"
    And I open the "See what I do" list
    And I tap the "Ask Anything" row
    Then the bot replies with "How can I help you today?"
    # Verified live on PROD (2026-08-04): menu.service.js:391 (_handleOtherChoice)
    # → state GENERAL_CONVERSATION.

  @e2e @ask @content-driven @P1 @M08
  Scenario: Ask Anything answers a teaching question
    Given the NIETE bot chat is open
    When I send "What are two quick classroom management strategies for a large class?"
    Then the bot reply is relevant to teaching
    And the bot reply is longer than 60 characters
    # Verified live on PROD (2026-08-04): returned a relevant two-strategy answer.

  @e2e @ask @negative @content-driven @P3 @M09
  Scenario: Gibberish input is handled gracefully
    Given the NIETE bot chat is open
    When I send "asdfghjkl zxcvbnm qwerty"
    Then the bot reply does not leak an error
    And the bot reply is non-empty
    # Verified live on PROD (2026-08-04): "Looks like random letters! How can I
    # assist you with your teaching or classroom needs today?"

  # ══════════════════ Ancillary commands (positive + config-gated) ══════════════
  # /language moved to language.feature (2026-08-11) — selection + per-flow i18n.

  @e2e @portal @P2 @M10
  Scenario: /portal opens the portal already signed in — one "Open portal" button with her own sign-in link
    Given the NIETE bot chat is open
    And I am a registered teacher
    When I send "/portal"
    Then I get one message with an "Open portal" button
    And the button's link is this portal's /go/<token> sign-in link, not a /portal/setup/ or /portal/login link
    # UPDATED 2026-10-16 (bd-x7aprz.3): /portal no longer sends a 7-day set-up link or "log in with the
    # password you created". A registered adult gets ONE cta_url button carrying her signed /go link
    # (app-login-link.js — her user id, encrypted, 24 h, re-tappable); the portal turns it into a session and
    # lands her on her home (dashboard/routes/app-login.routes.js). portal-command.handler.js.
    # Someone NOT registered is offered the registration Flow by the text handler before /portal reaches it.
    # History: until 2026-10-16 this scenario expected "portal.niete.edu.pk/portal/login" (verified on PROD
    # 2026-08-04), and a non-activated teacher got a /portal/setup/<token> link (portal-invite.service.js).

  @e2e @portal @P1 @M29
  Scenario Outline: "portal" typed without the slash opens the portal the same way as /portal
    Given the NIETE bot chat is open
    And I am a registered teacher
    When I send "<typed>"
    Then I get one message with an "Open portal" button
    And the button's link is this portal's /go/<token> sign-in link
    And the bot reply does not say it is unsure
    Examples:
      | typed       |
      | portal      |
      | Portal      |
      | open portal |
      | mera portal |
      | پورٹل       |
    # ADDED 2026-10-27: the whole message being the portal word plus at most a few words that only ask for it
    # (portal-request.js isPortalRequest) is the /portal command (text-message.handler.js portalRequest). Before,
    # a bare "portal" got "not sure which feature you meant" and the menu (prod, 7 days to 27 Oct: 3 turns, 0 links).
    # Not registered: the registration Flow, exactly as for /portal. Kill switch PORTAL_KEYWORD_ROUTING (env, unset = on).
    # Unit: bot/tests/handlers/portal-bare-word.test.js (the real handler), portal-request.test.js (the word table).

  @e2e @portal @negative @P2 @M30
  Scenario: A sentence that mentions the portal is not the portal command
    Given the NIETE bot chat is open
    And I am a registered teacher
    When I send "portal pe lesson nahi khul raha"
    Then no "Open portal" button is sent
    # A message carrying content (a question, a problem) goes to the classifier and the chat, as before.

  @e2e @portal @P1 @M21
  Scenario: /portal gives an activated teacher with no password the same sign-in link — no password asked
    Given the NIETE bot chat is open
    And my portal account is already activated
    And I have never set a portal password
    When I send "/portal"
    Then I get one message with an "Open portal" button
    And the button's link is this portal's /go/<token> sign-in link, not a /portal/setup/ or /portal/login link
    # UPDATED 2026-10-16 (bd-x7aprz.3): the July 2026 migration left 3,350 prod accounts activated with
    # portal_password_hash NULL. bd-kkpg4t sent them the set-up invite; now no account is asked for a password —
    # the WhatsApp sign-in link is the way in, password or not (portal-command.handler.js).

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

  @e2e @ask @content-driven @P3 @M12
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

  @e2e @menu @negative @copy @P3 @M13
  Scenario: Free text after /menu is answered as an ordinary message, not with a choose-1-4 nudge
    Given the NIETE bot chat is open
    And I have just sent "/menu"
    When I send "7"
    Then the bot answers the message
    And the reply does NOT contain "choose an option (1-4)"
    And no feature is started
    # UPDATED 2026-10-01 (Meta bill cut, NO3): the menu a teacher sees is a WhatsApp LIST of named
    # rows with no 1-4 in it, and the wait it parks (AWAITING_MENU_CHOICE) lasts an hour. Any free
    # text in that hour used to get "📋 Please choose an option (1-4) from the menu above…" and was
    # dropped — 712 a week, 478 of them real requests, 562 followed by the teacher writing again
    # within 5 minutes. Free text now ENDS the menu wait (flow-scoped) and is routed like any other
    # message (text-message.handler.js, the AWAITING_MENU_CHOICE block). A digit 1-4 still picks from
    # the numbered TEXT menu, which is sent when the list cannot be.

  @e2e @menu @edge @P2
  Scenario: Tapping a menu row ends the menu wait, so the next free text is answered
    Given the NIETE bot chat is open
    And I have just sent "/menu"
    When I tap a menu row that opens a Flow, such as "Lesson Plans"
    And I then send "Lesson for class 4 Urdu"
    Then the bot answers that message as a request
    And it does NOT reply "choose an option (1-4)"
    # menu.service.js handleMenuButtonResponse clears the 'menu' flow's wait (flow-scoped — another
    # feature's work in progress is untouched) before routing the row.
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

  @e2e @menu @role @P1 @M14
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

  @e2e @menu @role @P1 @M15
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

  @e2e @menu @role @P1 @M16
  Scenario: A teacher still sees Classroom Coaching and no observe row
    Given the NIETE bot chat is open
    And my role is "teacher"
    When I send "/menu"
    And I open the "See what I do" list
    Then the feature list shows the core teacher rows
    And the feature list does NOT show "Observe a Teacher"

  @e2e @menu @role @negative @P2 @M17
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

  @e2e @menu @role @negative @P3 @M18
  Scenario: A teacher tapping a stray Observe row is refused and redirected
    Given the NIETE bot chat is open
    And my role is "teacher"
    When I tap an "Observe a Teacher" row from an older message
    Then the observe flow does not start
    And the bot reply names "Classroom Coaching" as the row that is mine

  @e2e @menu @role @language @P2 @M19
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

  # ═══════ ADDED 2026-09-22 · one coaching door, one instruction (@wip) ═══════
  # menu.service _handleClassroomCoachingChoice now sends the catalog string
  # lpAskYesReply — the same copy the lesson-plan coaching ask's "Record my lesson"
  # sends (intended: it changes every entry). Driven by the E2E lane.

  @e2e @menu @wip @draft @P1
  Scenario: The coaching prompt says 20–45 minutes
    Given the NIETE bot chat is open
    And my role is "teacher"
    When I send "/menu"
    And I open the "See what I do" list
    And I tap the "Classroom Coaching" row
    Then the bot reply contains "Record your lesson with the WhatsApp mic"
    And the bot reply asks for 20 to 45 minutes of the lesson
    And the bot reply does not say "at least 15 minutes"

  # ─────────── app redirect (bd-onxyu) — a menu row whose feature moved to the NIETE app ───────────
  # Each row answers to its feature's switch (app_redirect_<feature>), off by default. Unit:
  # tests/app-redirect/app-redirect-routing.test.js drives every row.

  @e2e @menu @config-gated @P1 @M20
  Scenario: A menu row whose feature moved to the app sends me to the Play Store instead
    Given the NIETE bot chat is open
    And Lesson Plans has been switched to the NIETE app
    When I send "/menu"
    And I open the "See what I do" list
    And I tap the "Lesson Plans" row
    Then I get one message telling me to use the NIETE app, with the NIETE Play Store link
    And no lesson-plan menu opens

  # ADDED 2026-10-19 (bd-zcgpkx): with leader_app_lesson_plan on, a leader's "Lesson Plans" row (and its number) opens
  # Send a lesson plan in the app, like "lesson plan" typed. "coaches" covers coaches only; a principal keeps the
  # WhatsApp lesson-plan menu until the switch is true. Unit: tests/app-redirect/app-link-leader-lesson-plan.test.js.
  # UPDATED 2026-10-23 (bd-a73p5m): the row (and its number) opens the Lesson Plans tab now (/portal/teacher/lessons),
  # not Send a lesson plan, and needs no FLN share. Unit: tests/app-redirect/app-link-leader-lessons-doors.test.js.
  @obsolete @menu @config-gated @P1
  Scenario: A coach tapping the Lesson Plans row gets one button that opens Send a lesson plan
    # OBSOLETE 2026-10-23 (bd-a73p5m): the row opens the Lesson Plans tab now — replaced by "A coach tapping the Lesson Plans row gets one button that opens the Lesson Plans tab" below. Kept (not deleted) for the audit trail.
    Given the NIETE bot chat is open on a coach account
    And lesson plans for leaders open in the app (leader_app_lesson_plan is on)
    When I send "/menu"
    And I open the "See what I do" list
    And I tap the "Lesson Plans" row
    Then I get one message with a "Send a plan" button that opens Send a lesson plan, signed in
    And no lesson-plan menu opens

  @e2e @menu @config-gated @P1
  Scenario: A coach tapping the Lesson Plans row gets one button that opens the Lesson Plans tab
    Given the NIETE bot chat is open on a coach account
    And lesson plans for leaders open in the app (leader_app_lesson_plan is on)
    When I send "/menu"
    And I open the "See what I do" list
    And I tap the "Lesson Plans" row
    Then I get one message with a "Lesson plans" button that opens the Lesson Plans tab, signed in
    And no lesson-plan menu opens

  # ═══════ ADDED 2026-10-20 (bd-xw56ed) · a message no door catches is read against the live menu (@wip) ═══════
  # canonicalizeSlashCommand corrects a slip of a known command by edit distance (one edit for a word of up to five
  # letters, two for longer; a tie is no match). Anything still unmatched reaches detectIntent, whose choices are this
  # teacher's live menu rows (featureMenuRows + menuGates): a row → that row's own door (the in-app button when she
  # is on the app), "menu" → the menu, unsure → "not sure" + the menu, a question → the AI chat as before.
  # Presentations are no longer routed (operator, 2026-10-20). Unit: tests/menu-match/*,
  # tests/handlers/slash-command-similarity.test.js. Eval on a week of production messages: the investigation's v1.

  @e2e @menu @edge @wip @draft @P1 @M23
  Scenario: A slip of a command opens that command
    Given the NIETE bot chat is open
    When I send "/assesments"
    Then the bot opens the Test Paper (the "Open app" button, or the assessment form when the app is off)
    And the bot does NOT reply conversationally

  @e2e @menu @content-driven @wip @draft @P1 @M24
  Scenario: Naming a menu entry in words opens it
    Given the NIETE bot chat is open
    When I send "Exam generator"
    Then the bot opens the Test Paper (the "Open app" button, or the assessment form when the app is off)
    And the bot does NOT reply conversationally

  @e2e @menu @wip @draft @P2 @M25
  Scenario: A bare "menu" (no slash) opens the menu
    Given the NIETE bot chat is open
    When I send "menu"
    Then the bot opens the menu (the "Open app" Home button, or the "See what I do" list)
    And the bot reply does not say it is unsure
    # Replaces @M06.

  @e2e @menu @negative @wip @draft @P2 @M26
  Scenario: An unknown one-word command gets "not sure" and the menu, never the AI chat
    Given the NIETE bot chat is open
    When I send "/xyzzy"
    Then the bot reply contains "not sure which feature you meant"
    And the bot then opens the menu (the "Open app" Home button, or the "See what I do" list)

  @e2e @ask @content-driven @wip @draft @P2 @M27
  Scenario: A presentation request is not promised
    Given the NIETE bot chat is open
    When I send "make a presentation about photosynthesis"
    Then no presentation is started
    And the bot reply does not say it is preparing a presentation

  # ══════════════════ INBOUND SIGNATURE (every message passes it) ═══════════════════
  # Meta signs every webhook and Flow endpoint request: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256 of the
  # raw body with the App Secret of the app subscribed to the WABA. bot/shared/services/webhook-signature.js
  # checks it in front of POST /webhook and POST /api/flows/*. Mode: app_settings `webhook_signature_mode`, else
  # WHATSAPP_WEBHOOK_SIGNATURE_MODE, else log. These are HTTP-level (@chunk) and need the mode and a lane App
  # Secret (@config-gated): the mock Graph API does not sign what it injects yet, so the mock driver records them
  # BLOCKED. Executed at the HTTP layer by tests/whatsapp/webhook-signature.test.js (the real Express app); on a
  # deployed tier the proof is the webhook.signature_valid / _missing / _invalid counts in the logs.
  # /menu is the probe because it is the one message every teacher state answers the same way.

  @e2e @menu @chunk @config-gated @P1 @M31
  Scenario: A message Meta signed is answered when the signature is enforced
    Given the webhook signature mode is "enforce"
    And the bot holds the App Secret of the Meta app subscribed to its number
    When Meta delivers "/menu" from a teacher, signed with that App Secret
    Then the bot acknowledges the webhook with 200
    And the "See what I do" menu is shown to that teacher

  @e2e @menu @chunk @config-gated @P1 @M32
  Scenario: In log mode (the default) an unsigned message is still answered and recorded as unsigned
    Given the webhook signature mode is "log"
    When "/menu" arrives for a teacher's number with no signature
    Then the bot acknowledges the webhook with 200
    And the "See what I do" menu is shown to that teacher
    And the bot logs "webhook.signature_missing" for route "webhook"

  @e2e @menu @chunk @config-gated @negative @P1 @M33
  Scenario Outline: A forged message is refused when the signature is enforced, and the teacher gets nothing
    Given the webhook signature mode is "enforce"
    When "/menu" arrives for a teacher's number <how>
    Then the bot answers the webhook with 401
    And no message is sent to that teacher
    And the bot logs "<event>" for route "webhook"

    Examples:
      | how                                           | event                     |
      | with no signature                             | webhook.signature_missing |
      | signed, then changed after signing            | webhook.signature_invalid |
      | signed with a secret that is not the App's    | webhook.signature_invalid |

  @e2e @menu @chunk @config-gated @negative @P2 @M34
  Scenario: An unsigned Flow endpoint request is refused with Meta's signature code, and signed ones still open the form
    Given the webhook signature mode is "enforce"
    When a Flow data request reaches /api/flows/registration with no signature
    Then the bot answers 432 without decrypting it
    And the same request signed with the App Secret is decrypted and answered as before
