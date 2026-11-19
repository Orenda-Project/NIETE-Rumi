@whatsapp @ict @profile:niete @feature:child-test @persona:coach
Feature: NIETE (ICT) WhatsApp bot — Child test (/egra, the coach's five-minute EGRA/EGMA test per child)
  # Non-determinism: see .claude/qa/engine/bin/non-determinism-contract.md (assert contracts/shape; AI marks are @content-driven).
  # ═══════════════════════════════════════════════════════════════════════════
  # STATUS: SPEC AHEAD OF CODE (2026-10-02, bd-s1oo0.9). Written from the build contract while the
  # lanes build it, so EVERY scenario is @wip @draft until it is driven against merged code. The
  # mock-lane driver (.claude/qa/shared/features/child-test.cjs) records each id as BLOCKED with the
  # lane it waits on, never a PASS it did not earn. To promote a scenario: merge the lane, drive it on
  # the mock lane (and the chrome lane for the @no-mock-driver ones), drop @wip @draft, add a
  # "Verified on <lane> (<date>)" comment.
  #
  # WHAT THIS IS. After a lesson observation (observe2) the coach tests five children of that school's
  # Grade 3 or Grade 5: Rumi picks them (4 new + 1 returning, drawn on the server and never redrawn),
  # the coach records ONE voice note per block (Urdu, English, maths) and photographs the child's
  # written maths strip, Rumi marks every recording, and the coach confirms or corrects a pre-filled
  # check Flow. Target: 5 minutes of coach time per child, under 30 minutes for five with the checks.
  # Sources: golive/PLAN.md §3 + §5, golive/CONTRACT.md v0.6 §5 (interfaces), §10 (CR-1 maths
  # pending/force), §11 (album rule, printed card primary).
  #
  # WHERE EACH STEP LIVES (CONTRACT §1):
  #   gate + entry + list + per-child state machine + strings   L4  bot/shared/handlers/child-test.handler.js,
  #                                                                 bot/shared/services/child-test/conversation/
  #   the draw (todaysList / markOutcome), store.js, tables      L3  bot/shared/services/child-test/draw/, store.js
  #   stimulus cards (inline PNG + printed PDF)                  L2  bot/shared/services/child-test/render/
  #   AI marking (scoreBlock → ai_marks, write-once)             L5  bot/shared/services/child-test/scoring/
  #   check Flow + data_exchange endpoint + sendCheck            L6  bot/shared/routes/child-test-check-endpoint.js,
  #                                                                 bot/shared/services/child-test/check-flow/,
  #                                                                 docs/flows/child-test-check.json
  #
  # GATING (CONTRACT §6; L4 conversation/gate.js): CHILD_TEST_ENABLED=true AND users.role is a leader
  # role (observe-gate LEADER_ROLES) AND the user's region is ICT (CHILD_TEST_REGIONS, default
  # niete,ict,islamabad,federal). Flag off or region outside ICT → the message falls through as if the
  # command did not exist. A teacher in ICT with the flag on is told the test is for coaches.
  # The draw also needs CHILD_TEST_DRAW_SECRET. So the whole feature is @config-gated.
  #
  # TEST ACCOUNT + DATA. A throwaway COACH account in an ICT region, assigned (leader_schools) to the
  # sandbox SIM school seeded by scripts/child-test/seed-sandbox.js (L3: Grade 3 and Grade 5 classes of
  # 25 children, roll numbers 1–25, placeholder names "Child 3A-07"). Never a real school's roster.
  # @destructive: the draw is a per-cycle ledger with NO redraw path, so every scenario that opens a
  # list consumes children of the SIM frame for the quarter. Fixture audio and strip photos live in the
  # project folder (golive/fixtures/), never in git; refer to children by draw id in assertions (L25: rolls are never shown).
  #
  # DRIVING. Text, reply buttons (ids prefixed ctst_), one interactive list (rows ctst_child:<drawId>,
  # ctst_alt:<drawId>), voice notes (Attach → Audio on the mock lane; a real held voice note on chrome),
  # the strip photo (Attach → Photos & videos), and the check Flow (data_exchange, emulated on the mock
  # lane — the emulator models ChipsSelector since bd-s1oo0.9). @no-mock-driver = needs real pixels or a
  # real phone (album grouping, bubble legibility); those run on the chrome lane only.
  #
  # Scenarios grouped POSITIVE · BUSINESS RULES · NEGATIVE · EDGE.

  # ═══════════════════════════ POSITIVE (happy path) ═══════════════════════════

  @e2e @wip @draft @flow @destructive @config-gated @P1 @CT01
  Scenario: A coach tests five children after an observation, end to end, with timings recorded
    Given the NIETE bot chat is open on a COACH account in an ICT region, with the child test enabled
    And the coach has just finished an observe2 visit at the SIM school whose observed teacher has a Grade 3 class
    When I tap "Yes, test now" on the child-test offer
    And for each of the 5 children on today's list I tap the child, tap "Present", send one voice note for Urdu, one for English and one for maths, and send a photo of the maths strip
    And I open each child's "Check" Flow and submit it without changes
    Then all 5 children show "Done ✓" on today's list and "Checks waiting: 0"
    And child_test_sessions holds 5 rows for this visit with status "completed", each with 3 child_test_blocks rows carrying ai_marks and coach_marks
    And each session's timings carry list_opened, child_tapped, <block>.prompt_sent, <block>.voice_received, <block>.scored, check.opened and check.submitted
    # The timing keys are what L8 measures the 5-minute / 30-minute pass mark from (PLAN §7).
    # L4 store.recordTiming (first write of a key wins), L3 STORE_API "sessions".

  @e2e @wip @draft @destructive @config-gated @P1 @CT02
  Scenario: The observe2 brief ends with the child-test offer, carrying the visit
    Given the NIETE bot chat is open on a COACH account in an ICT region, with the child test enabled and linked to the observation (CHILD_TEST_OBSERVE_LINK=true)
    When I submit the observe2 "What Rumi heard" check and the brief arrives
    Then the next message is the offer "Test 5 children now? About 25 minutes." with buttons "Yes, test now" and "Not now"
    And the "Yes, test now" button id is "ctst_offer:<kind>:<visit id>" for this visit's observation_field_forms row
    # L4: sent right after sendBrief in observe2-check-endpoint.js; string key childTestOfferBody.

  @e2e @wip @draft @destructive @config-gated @P1 @CT03
  Scenario: Today's list shows five drawn children by full name, the returning child marked, and two alternates
    Given a COACH account in an ICT region at the SIM school on a visit day, with the child test enabled
    When I open today's list
    Then one interactive list arrives headed "Grade <3|5> · Class <section>" with a "Today's children" section of 5 rows titled with each child's full name and an "Alternates" section of 2 rows
    And each child row's description is "<class label> · Teacher: <class teacher> · New" (or "· Returning (Form B)" under the v1 form policy), and never a roll number
    And a name longer than 24 characters is clipped in the title and given in full at the start of the description
    And the body says the children were picked by the server and cannot be changed, and "Done: 0 of 5"
    And child_test_draws holds those 7 children with list_slot main/alternate and last_listed_visit_id = this visit
    # In the first weeks of a cycle no child is eligible to return, so all 5 are "New" (CT11).
    # L3 draw.todaysList; L4 machine.js list rows ctst_child:<drawId> / ctst_alt:<drawId>.

  @e2e @wip @draft @destructive @config-gated @P1 @CT04
  Scenario: Tapping a present child sends the Urdu coach script with the exact cue phrase and waits for one voice note
    Given today's list is open
    When I tap the first child and tap "Present"
    Then a child_test_sessions row is created for that draw with status "in_progress"
    And the next message is ONE line "Child 1 of 5 · <name> · Urdu 1/3 · Form <A|B> card, Urdu page · Say «<item-bank cue.urdu.start>» · one locked note, flip pages without stopping"
    And a second line says "While waiting, give <next child's name> the maths strip: write <next child's number> in its Child no. box first."
    And the message offers "No printed card", "Stop this child" and "Menu"
    And no card image is sent
    And no AI scoring has started yet
    # The printed card is the primary stimulus (CONTRACT §11, §16): no card images by default; with
    # CHILD_TEST_INCHAT_CARDS=on the line goes first, then ≤ 3 images. bd-s1oo0.15.

  @e2e @wip @draft @audio @destructive @config-gated @P1 @CT05
  Scenario: Each block's voice note is acknowledged at once, stored, scored off the critical path, and moves to the next block
    Given child 1 is present and the Urdu block is waiting for its voice note
    When I send one voice note for the Urdu block
    Then the bot replies "🎧 Got it · Urdu" within the WhatsApp reply budget, before any mark exists
    And the audio is stored at child-test/<env>/<school_id>/<session_id>/urdu.ogg and child_test_blocks.audio_r2_key points at it
    And the next message is the English block "Child 1 of 5 · English 2/3" with the English cue «Please start reading»
    When I send one voice note for the English block
    Then the maths block "Child 1 of 5 · Maths 3/3" follows: «<cue.maths.numbers>», then «<cue.maths.start>» for <quick_sums_seconds> s of quick sums
    And child_test_blocks.ai_status for urdu moves from "pending" to "scored" or "partial" without a further coach message
    # CONTRACT §5: scoreBlock must not throw into the conversation and L4 never waits on it.

  @e2e @wip @draft @audio @destructive @config-gated @P1 @CT06
  Scenario: The maths voice note is followed by the strip-photo ask, and the photo completes the child
    Given child 1 is on the maths block
    When I send the maths voice note
    Then the bot acknowledges "🎧 Got it · Maths" and says "<name>'s strip (Child no. <k>): send its photo once it is written, or send all the strips at the end. Tap the next child now.", with a "No strip photo" button
    And maths ai_status stays "pending" with reason "awaiting_photo" and ai_marks is still empty
    When I send a photo of the maths strip
    Then the bot replies "📷 Strip no. <k> saved for <name>." and then "All three parts for <name> are in"
    And child_test_blocks.photo_r2_key = child-test/<env>/<school_id>/<session_id>/maths-strip.jpg and maths is scored once, with both the spoken and the written items
    # CR-1 (CONTRACT §10): maths ai_marks are written only when audio AND photo are both present.

  @e2e @wip @draft @flow @destructive @config-gated @P1 @CT07
  Scenario: When a child's marks are in, a Check button opens a pre-filled check Flow
    Given child 1's three blocks are scored
    Then the bot sends a check message naming the child (full name and class, never a roll) with the button «جانچ کریں»
    And it states only the numbers the check form shows filled in, and names what I must fill in
    When I open the check Flow
    Then the URDU screen shows story words correct and words attempted pre-filled from ai_marks.story
    And the words the model heard wrong are pre-ticked chips (at most 20)
    And each comprehension question shows the child's heard answer with Correct / Wrong / No answer
    And the ENGLISH and MATHS screens follow in that order, then DONE
    # L6 docs/flows/child-test-check.json (v7.3, data_api_version 3.0); token
    # <coachUserId>:child-test-check:<sessionId>; INIT returns screen 1 pre-filled.

  @e2e @wip @draft @flow @destructive @config-gated @P1 @CT08
  Scenario: Submitting the check saves the coach's marks and edits beside the AI marks, which never change
    Given the check Flow for child 1 is open
    When I untick one chip on the URDU screen, change the English words-correct count, and submit through DONE
    Then child_test_blocks.coach_marks is saved for each block with checked_at stamped
    And coach_edits lists exactly the changed paths as {path, ai, coach}
    And ai_marks for every block is byte-identical to what it was before the check
    And today's list shows "Checks waiting" one lower
    # CONTRACT §3: ai_marks write-once (L3 DB trigger); §5: coach_edits shape.

  # ═══════════════════════ BUSINESS RULES / VALID VARIATIONS ═══════════════════

  @e2e @wip @draft @destructive @config-gated @P1 @CT09
  Scenario: /egra outside an observation opens today's list for the coach's school without asking what it can infer
    Given a COACH account in an ICT region assigned to exactly one school, with the child test enabled and no observe2 visit today
    When I send "/egra"
    Then today's list for that school arrives directly, with no question about the school, grade or teacher
    # L4 context.js: today's observe2 visit if one exists, else the coach's assigned school(s).
    # Needs L3 todaysList without a visitId (L4 CHANGE_REQUEST, pending at the time of writing).

  @e2e @wip @draft @destructive @config-gated @P2 @CT10
  Scenario Outline: The Urdu label and the aliases open the same list as /egra
    Given a COACH account in an ICT region on a visit day at the SIM school, with the child test enabled
    When I send "<command>"
    Then the reply is today's list, identical to the one "/egra" opens
    Examples:
      | command      |
      | بچوں کا ٹیسٹ |
      | /childtest   |

  @e2e @wip @draft @destructive @config-gated @P1 @CT11
  Scenario: Reopening today's list shows the same children with their status — the list is never redrawn
    Given today's list was opened for this visit and child 1 is done and child 2 was absent
    When I send "/egra" again
    Then the same children arrive in the same order: child 1 "Done ✓", child 2 "Absent", and the alternate promoted in its place
    And child_test_draws has no new rows and no changed draw_rank for this class and cycle
    # PLAN §5 "No redraws"; L3 todaysList is idempotent per visit (reused: true).

  @e2e @wip @draft @destructive @config-gated @P1 @CT12
  Scenario Outline: An absent or refused child is recorded with its reason and the first alternate joins the list
    Given today's list is open
    When I tap child 2 and tap "<button>"
    Then the bot replies "<name> <recorded>" and "<alt name> from the alternates joins today's list."
    And child 2's draw row has status "<status>", attempts + 1, and no session was created for it
    And the list now holds 5 main children with the promoted alternate, and the alternates are topped up to 2 in rank order
    Examples:
      | button  | recorded            | status  |
      | Absent  | marked absent.      | absent  |
      | Refused | marked as refused.  | refused |
    # A second absence at a later visit makes it absent_final (PLAN §5, two tries) — L3 unit tests own that.

  @e2e @wip @draft @destructive @config-gated @P2 @CT13
  Scenario: The returning child reads Form B; new children read Form A
    Given the SIM school has a Grade 3 child tested at least 6 weeks ago and not retested this cycle
    When I open today's list on a new visit
    Then exactly one child is marked "Returning (Form B)" and its session uses form B; the other four use form A
    And when no child is eligible to return, a fifth new child takes the slot and all five use form A
    # PLAN §5 returning rule (≥ 42 days, not retested this cycle). Needs a seeded past test.

  @e2e @wip @draft @destructive @config-gated @P2 @CT14
  Scenario: "No printed card" sends the block's cards in the chat, three at a time
    Given child 1 is on the Urdu block and the coach has no printed card
    When I tap "No printed card"
    Then at most 3 card images arrive, followed by the short text "Cards 1–3 of <n>. Tap «No printed card» again for the next ones."
    And each further tap sends the next 3 (the story cards, then the made-up words, then the letters-and-words fallback), wrapping round
    And the block still waits for the same single voice note
    # CONTRACT §11 album rule, §16 (bd-s1oo0.15). Fallback cards: render/ L2 {part:'fallback_*'}.

  @e2e @wip @draft @audio @destructive @config-gated @P2 @CT15
  Scenario: The strip photo can arrive after the next child has started
    Given child 1 has sent the maths voice note but not the strip photo
    When I tap child 2, tap "Present" and send child 2's Urdu voice note
    And I then send child 1's strip photo
    Then the photo is saved to child 1's maths block, not child 2's, with "📷 Strip no. 1 saved for <child 1's name>."
    And child 2 is still waiting on its English block
    # L4: the photo state is per session, not per "current child".

  @e2e @wip @draft @destructive @config-gated @P2 @CT16
  Scenario: A strip photo that never comes is scored with force, written items left for the coach
    Given child 1 has sent the maths voice note
    When I tap "No strip photo"
    Then the bot replies "OK, no strip photo for <name>. The written sums stay blank."
    And scoring is called with force: true, maths ai_status is "partial" and every written item is "unreadable" with confidence 0
    And in the check Flow the written answers arrive empty and required
    # CR-1: L4 also forces at the end of the visit when the coach moved on without a photo.

  @e2e @wip @draft @flow @destructive @config-gated @P1 @CT17
  Scenario: Fields the model is not confident about arrive empty and must be answered before the check saves
    Given child 1's ai_marks hold a comprehension verdict and a first sound below their confidence bars (scoring/thresholds.js)
    When I open the check Flow
    Then those fields are shown empty, and the screen's Footer stays disabled until each is answered
    And confident fields arrive pre-filled
    And submitting saves the coach's answers in coach_marks and lists them in coach_edits against the AI's value
    # CONTRACT §5: the low-confidence value is still written to ai_marks; L6 decides to show it empty.

  @e2e @wip @draft @destructive @config-gated @P2 @CT18
  Scenario: The coach can check between children or in one batch at the end
    Given children 1 and 2 are scored and neither is checked
    When I continue with child 3 without opening a check
    Then the list message shows "Checks waiting: 2"
    And each pending check can still be opened later from its own Check button, and from the child's row on the list

  @e2e @wip @draft @i18n @copy @destructive @config-gated @P1 @CT19
  Scenario: An Urdu coach gets the whole journey in Urdu, every interactive label within WhatsApp's caps
    Given the coach's preferred_language is "ur"
    When I walk the offer, today's list, one child's three blocks and the check message
    Then every message is Urdu first («ہاں، ابھی», «آج کے بچے», «موجود», «غیر حاضر», «انکار», «🎧 ملا · اردو»)
    And every button title is ≤ 20, list row title ≤ 24, row description ≤ 72 and header/footer ≤ 60 code points
    And no copy genders the coach, the teacher or the child
    # The mock rejects any over-cap field (code points, like Meta). language-audit.js must pass.

  # ═══════════════════════════════ NEGATIVE ═══════════════════════════════════

  @e2e @wip @draft @negative @config-gated @P1 @CT20
  Scenario: With the flag off, /egra is inert and falls through as ordinary chat
    Given CHILD_TEST_ENABLED is not "true" on the runtime
    And the NIETE bot chat is open on a COACH account in an ICT region
    When I send "/egra"
    Then no child-test message, list or button arrives and the message is handled as ordinary chat
    And after an observe2 brief no child-test offer is sent
    # L4 gate.js isEnabled() → {match:false}. Mock lane: restart the bot with CHILD_TEST_ENABLED= .

  @e2e @wip @draft @negative @config-gated @P1 @CT21
  Scenario: A teacher account is told the test is for coaches, and nothing is drawn
    Given the child test is enabled and the NIETE bot chat is open on a TEACHER account in an ICT region
    When I send "/egra"
    Then the bot replies "The child test is for coaches and school leaders."
    And child_test_draws gains no row

  @e2e @wip @draft @negative @config-gated @P2 @CT22
  Scenario: A coach outside the ICT region gets nothing — the command does not exist for them
    Given the child test is enabled and the NIETE bot chat is open on a COACH account whose region is not in CHILD_TEST_REGIONS
    When I send "/egra"
    Then no child-test message arrives and the message is handled as ordinary chat

  @e2e @wip @draft @audio @negative @destructive @config-gated @P1 @CT23
  Scenario: A voice note sent when the child test is not waiting for one is not swallowed
    Given a COACH account with today's list open but no child started
    When I send a voice note
    Then the child test does not claim it: it goes to the normal pipeline (observe capture or coaching) exactly as without the child test
    And no child_test_blocks row gains an audio key
    # L4 voice claim sits BEFORE routeLeaderAudio but claims only in its own Redis state "block".

  @e2e @wip @draft @audio @negative @destructive @config-gated @P2 @CT24
  Scenario: A voice note recorded before the next block's card was sent is not filed under that block
    Given child 1's Urdu voice note was received and the English line was then sent
    When a second voice note arrives whose WhatsApp timestamp is earlier than the Urdu note's (a re-delivered older recording)
    Then the bot replies "That voice note was sent before the English card, so I kept the first Urdu note. Record English now."
    And urdu.ogg is unchanged and the English block still has no audio key, and the next voice note is filed as English
    # L13 machine.js processVoice: the note claims English, then its timestamp < the Urdu claim's sentAt → released, childTestVoiceEarly.

  @e2e @wip @draft @negative @destructive @config-gated @P1 @CT25
  Scenario: A stimulus image that fails to send falls back to the text version, logged at error
    Given the WhatsApp image send for the Urdu story card fails
    When I tap "No printed card" on the Urdu block
    Then the coach receives "(The picture did not send. Here is the same text.)" followed by the story text
    And the failure is logged as child_test.* at error level, with ids only
    # CONTRACT §4. Mock lane: make the mock answer the media send with an error.

  @e2e @wip @draft @negative @destructive @config-gated @P1 @CT26
  Scenario: A save failure is told to the coach plainly, never swallowed
    Given the database write for the voice note fails
    When I send the Urdu voice note
    Then the bot replies "⚠️ The Urdu voice note did not save. Please send the same voice note again."
    And the block still waits for the Urdu note
    # PLAN §8: every save failure is visible to the coach and logged at error level.

  @e2e @wip @draft @negative @destructive @config-gated @P2 @CT27
  Scenario: Scoring that is still running, or failed, is shown as pending — a check is never sent on missing marks
    Given child 1's three notes are in but a block's ai_status is "scoring" or "failed"
    When I open today's list
    Then no Check button is sent for child 1 and the list shows child 1 as in progress
    And once the block is scored the Check button is offered
    # L4 sends the check only when every block is scored, partial or failed-and-retried (CONTRACT §5).

  @e2e @wip @draft @negative @destructive @config-gated @P1 @CT28
  Scenario Outline: /cancel and /menu work in every child-test state, and cancelling never releases a drawn child
    Given the child test is in state "<state>"
    When I send "<command>"
    Then the child test closes ("Child test closed. Send /egra to reopen the same list." for /cancel; the main menu for /menu)
    And reopening with /egra shows the same list; no draw row changed status because of the command
    Examples:
      | state                          | command |
      | offer shown                    | /cancel |
      | list open                      | /cancel |
      | presence asked                 | /menu   |
      | Urdu block waiting             | /cancel |
      | maths waiting for strip photo  | /menu   |
    # The "Stop this child" and "Menu" buttons are the tapped forms of the same exits (ctst_stop, ctst_menu).

  @e2e @wip @draft @negative @destructive @config-gated @P2 @CT29
  Scenario: A child already done cannot be retested, and an old list's button is refused politely
    Given child 1 is "Done ✓" today
    When I tap child 1 again
    Then the bot replies "<name> is already done today." and no second session is created
    And tapping a button from a previous day's list replies "That button is from an older list. Send /egra for today's list."

  # ═══════════════════════════════════ EDGE ═══════════════════════════════════

  @e2e @wip @draft @negative @destructive @config-gated @P2 @CT30
  Scenario: A school with no Grade 3 or Grade 5 class list is told what to do, not shown an empty list
    Given a COACH account assigned to a school with no Grade 3 or Grade 5 class enrolments
    When I send "/egra"
    Then the bot replies that the school has no Grade 3 or Grade 5 class list yet and to send the register photos with /roster first
    # L3 todaysList → {ok:false, reason:'no_class_list'}.

  @e2e @wip @draft @edge @destructive @config-gated @P3 @CT31
  Scenario: An absent child with no alternate left is recorded, and the list carries on with fewer children
    Given both alternates were already promoted today
    When I mark another child "Absent"
    Then the bot replies "No alternate is left for today." and the list shows the remaining children only

  @e2e @wip @draft @edge @no-mock-driver @config-gated @P2 @CT32
  Scenario: The inline story cards are legible inside the chat bubble and never collapse into an album
    Given a Grade 5 child is present on a real phone
    When I tap "No printed card" on the Urdu block
    Then no more than 3 images arrive back to back, and WhatsApp does not group them into an album collage
    And the story text can be read in the bubble without opening the image
    # Needs real pixels and a real WhatsApp client (CONTRACT §11 item 6). Chrome lane only.

  # ---- the five-minute protocol (bd-s1oo0.12, lane L11) ----

  @e2e @wip @draft @destructive @config-gated @P1 @CT33
  Scenario: The list tells the coach which children to ask the class teacher for, by name in order, and "Send to teacher" sends them
    Given today's list is open after an observe2 visit of the class teacher of the drawn class
    Then the list body says "Ask the class teacher for these children, one at a time, in this order: <name>, …"
    And one message with a "Send to teacher" button follows, once per visit
    When I tap "Send to teacher"
    Then the class teacher receives ONE message with "<name>" for each child still to test, in list order (v2: one message per class teacher, only their own room — CT71)
    And I get "Sent the order to the class teacher." and nobody outside the visit is messaged
    # With CHILD_TEST_OBSERVE_LINK=true: the button appears when class_teachers links the observed teacher
    # to a class on the list; the tap re-checks it. A failed send says "I couldn't reach the class teacher
    # on WhatsApp…". Without the link (the default), see CT62: the class teacher comes from the drawn class.

  @e2e @wip @draft @destructive @config-gated @P1 @CT34
  Scenario: Strip photos are claimed in list order, any time during the visit or as a batch at the end
    Given child 1 is present, so child 2 was handed the strip to write while waiting
    And neither strip's "Child no." box can be read
    When I send two strip photos during child 1's Urdu block
    Then the first is saved for child 1's session and the second is held for child 2 under child-test/<env>/<school_id>/held/<draw_id>/maths-strip.jpg
    And child 1's maths voice note finishes child 1 at once (no strip ask), and child 2's held strip is attached when child 2 is marked "Present"
    When the last child's maths note arrives and strips are still missing
    Then the bot says "Send the strip photos now, one per child, in any order. Each strip needs its Child no. written clearly: <name> (no. <k>), …"
    And each photo whose number cannot be read is claimed for the oldest child on the list whose strip is missing, and maths is scored once with force

  @e2e @wip @draft @audio @destructive @config-gated @P2 @CT35
  Scenario: One locked voice note keeps recording through card flips
    Given child 1 is on the Urdu block
    When I lock the recording, flip the printed card through all its pages, and send one 4-minute voice note
    Then the bot replies "🎧 Got it · Urdu" and stores the whole note as urdu.ogg
    # No size or duration limit exists on the child-test audio path (L11 checked the claim, download and R2 upload).

  @e2e @wip @draft @config-gated @P2 @CT36
  Scenario: Quick sums run for the one configured number of seconds
    Given the sandbox bot runs with CHILD_TEST_QUICK_SUMS_SECONDS=30
    When child 1 reaches the maths block
    Then the maths line says "for 30 s of quick sums" and the coach sheet prints "Quick sums (30 seconds)"
    # Bank maths.quick_sums_seconds stays 60; the override is sandbox-only (30 or 60).

  @e2e @wip @draft @audio @destructive @config-gated @P1 @CT37
  Scenario: Three voice notes sent within seconds fill the three blocks in order, none overwritten
    Given child 1 is present and the Urdu line has arrived, and the coach uses the printed card
    When I send the Urdu, English and maths voice notes within 5 seconds of each other
    Then the bot acknowledges "Got it · Urdu", "Got it · English" and "Got it · Maths", one each
    And child_test_blocks holds three rows for the session, urdu, english and maths, each with its own audio key
    And the strip photo is asked for once
    # bd-s1oo0.14 / CONTRACT §16: each note claims ctst:block:<session>:<block> (setNX) before the ack and the upload.

  @e2e @wip @draft @audio @negative @destructive @config-gated @P1 @CT38
  Scenario: A fourth voice note for a child whose three notes are in is not stored
    Given child 1's three voice notes have been received and the maths note is still being stored
    When I send a fourth voice note
    Then the bot replies "All three voice notes for <name> are already in, so I did not use this one."
    And no block's audio key changes

  @e2e @wip @draft @audio @negative @destructive @config-gated @P1 @CT39
  Scenario: A voice note that fails to save frees its block, and the next voice note fills it first
    Given the Urdu, English and maths notes were sent together and the English upload fails
    Then the bot replies "The English voice note did not save. Please send the same voice note again." and the strip photo is not asked for yet
    When I send the English voice note again
    Then it is stored as English and the strip photo is asked for

  @e2e @wip @draft @timing @config-gated @P1 @CT40
  Scenario: A block costs the bot two messages with the printed card
    Given CHILD_TEST_INCHAT_CARDS is not "on"
    When I send the Urdu voice note
    Then the bot sends exactly two messages before the next voice note is welcome: "Got it · Urdu" and the English line
    # bd-s1oo0.15: the send pacer (6 s/send after a burst of 8) is unchanged; the cards no longer queue ahead.

  @e2e @wip @draft @audio @destructive @config-gated @P1 @CT41
  Scenario: A voice note saved just before Rumi restarts is still marked, and the check still arrives
    Given the Urdu voice note was stored and Rumi restarted before marking it
    When the English and maths notes and the strip photo are sent after the restart
    Then the Urdu block is marked once, within about a minute of the restart
    And the check button for this child arrives once
    # bd-s1oo0.22: scoring is claimed in the database and a sweep recovers blocks a dead process left unmarked.

  @e2e @wip @draft @audio @negative @config-gated @P2 @CT42
  Scenario: A block that cannot be marked is retried, and after the last try the check still opens
    Given the English block fails to be marked
    Then Rumi tries again, up to three times in all
    And when every try fails, the check button arrives with the English fields left for me to fill

  @e2e @wip @draft @config-gated @P2 @CT43
  Scenario: In assist mode every mark Rumi made arrives filled, and the unsure ones are named
    Given CHILD_TEST_PREFILL_MODE is "assist"
    When I open the check for a child
    Then every field Rumi marked arrives filled, including the flagged story words
    And one line on each screen lists the marks Rumi is unsure of, for me to look at
    And a field Rumi did not mark arrives empty

  @e2e @wip @draft @config-gated @P1 @CT44
  Scenario: Kept separate from the observation by default: no offer after observe2, and /egra stands alone
    Given a COACH account in an ICT region at the SIM school, with the child test enabled and CHILD_TEST_OBSERVE_LINK unset
    When I submit the observe2 "What Rumi heard" check and the brief arrives
    Then no child-test offer follows the brief
    When I send "/egra" on the same day
    Then today's list is drawn for my school on the day key, not on the observe2 visit
    # bd-s1oo0.25 (operator, 3 Oct 2026: "for now keep both separate"); the same holds after classic /observe.

  # ---- names first, never broken by a missing roll (bd-s1oo0.37, bd-s1oo0.36, lane L19; CONTRACT §18) ----

  @e2e @wip @draft @negative @destructive @config-gated @P1 @CT45
  Scenario: A drawn child with no roll number is named on the list and through the test, and nothing breaks
    Given the SIM class has children with no roll number in the register and one of them is drawn
    When I send "/egra"
    Then today's list arrives, the roll-less child's row is titled with the full name and its description has no roll
    And no line anywhere says "null", "Roll" or «رول»
    When I tap that child
    Then the presence prompt reads "<name>" then "Is the child here and willing to read?"
    And "/egra" again shows the same list
    # NIETE roster 3 Oct: 3.4% of Grade 3/5 children have no roll; before bd-s1oo0.36 one on the list made
    # resolveUx throw "missing param roll", the coach got no list, and every /egra that quarter threw again.

  @e2e @wip @draft @destructive @config-gated @P2 @CT46
  Scenario: Two children with the same name are told apart by the father's name, never by a roll
    Given two children called the same name are drawn for today
    When I send "/egra"
    Then no row shows a roll, even when the roster has one
    And a same-name row starts its description with "father: <father's name>" when the roster has it
    # students.father_name; superseded for the v2 list by CT74 (namesakes counted against the class roster, L25).

  # ── L20 (bd-s1oo0.38, CONTRACT §18): each strip carries the child's number and goes to that child ──
  # The child number is the child's place on today's list as first sent (main 1–5, alternates after) and
  # never moves. The coach writes it in the strip's «بچہ نمبر / Child no.» box. A quick vision read at
  # receipt (Gemini 3.8 Flash, cut off at 8 s, no names in the prompt) attaches the photo to that child.

  @e2e @wip @draft @destructive @config-gated @P1 @CT47
  Scenario: Strip photos sent out of order land on the children whose numbers they carry
    Given all five children on today's list have sent their three voice notes and no strip photo
    And each strip has its child's number written in the "Child no." box
    When I send the five strip photos together in the order 3, 1, 5, 2, 4
    Then each photo is saved to the maths block of the child whose number it carries
    And each reply names the child it was saved for: "📷 Strip no. <k> saved for <name>."
    And each child's maths is scored once, and each child's check arrives once

  @e2e @wip @draft @negative @destructive @config-gated @P1 @CT48
  Scenario: A strip whose number cannot be read goes to the next child in order, and the reply says so
    Given child 1 and child 2 have each sent their maths voice note and no strip photo
    When I send a strip photo whose "Child no." box is empty
    Then the photo is saved for child 1 and the bot replies "📷 I couldn't read a child number on this strip, so it is saved for the next in order: <child 1's name> (no. 1)."
    When I send a strip photo whose box says 9, a number not on today's list
    Then the photo is saved for child 2 and the reply says "Child no. 9 is not waiting for a strip"

  @e2e @wip @draft @negative @destructive @config-gated @P1 @CT49
  Scenario: A number for a child whose strip is already in is not overwritten
    Given child 2's strip photo has been saved
    When I send another strip photo with 2 in its "Child no." box
    Then nothing is saved and child 2's maths block keeps its first photo
    And the bot replies "📷 <child 2's name>'s strip (no. 2) is already in, so this photo was not used. If it is another child's strip, correct the number on it and send it again."

  @e2e @wip @draft @config-gated @P2 @CT50
  Scenario: The child number stays the same when a child is absent and an alternate steps in
    Given today's list is open with children 1–5 and alternates 6 and 7
    When I mark child 2 "Absent"
    Then the alternate who joins keeps number 6, and every other child keeps their number
    And the hand-over line for that alternate says "write 6 in its Child no. box"

  # ---- L21: the check message tells the truth; "Send to teacher" without an observation (bd-s1oo0.27/.28) ----

  @e2e @wip @draft @flow @config-gated @P1 @CT61
  Scenario: The check message states only the numbers the form shows filled in, names the child, and promises two minutes
    Given child 1's three blocks are scored, and the Urdu story count is under its bar so the form leaves it empty
    When the check message arrives
    Then its header is "Check: <full name> · <grade>-<section>" (60 code points at most; never a roll)
    And it states the English and maths numbers that arrive filled in, and does not state the Urdu story count
    And it says "You fill in: Urdu: story count, …" with every field the form leaves empty, per block
    And it ends "About 2 minutes"
    And the check Flow's heading reads "<full name> · <grade>-<section> · Grade <g>"
    # Sandbox run sandbox5-syn-2032 child 1 said "Urdu 57 words … About a minute" while the form's Urdu count
    # was empty (0.69 < 0.7) and the check took 107–144 s. In assist mode an unsure number is stated as
    # "Filled in, please check: …". The Flow JSON is unchanged: the heading is data_exchange data.

  @e2e @wip @draft @config-gated @P1 @CT62
  Scenario: Without an observation, "Send to <name>" offers the drawn class's class teacher
    Given CHILD_TEST_OBSERVE_LINK is unset and the drawn class has one active class teacher with a WhatsApp number
    When I send "/egra" and today's list arrives
    Then one message follows with the button "Send to <first name>", once per visit
    When I tap it
    Then that teacher receives ONE message with the children still to test, in list order
    And I get "Sent the order to <their name>."
    # Several class teachers (the list spans sections): one button each up to 3, a list beyond. None: no
    # offer and the list is unchanged. The flagged class teacher (is_class_teacher) is preferred; without
    # one, the class's active teacher. The tap re-checks the teacher against the list's classes.

  @e2e @wip @draft @P0 @CT63
  Scenario: A count typed in the check is accepted, in Latin or Urdu digits
    Given child 1's check Flow is open and the Urdu story count arrived empty
    When I type "58" in words correct and "۶۰" in words attempted
    Then neither field shows a phone-number error and the screen's save button is enabled
    And when I save, the stored coach marks read 58 and 60
    # Found in the real WhatsApp capture on sandbox (3 Oct, WhatsApp Web): the count inputs were
    # input-type phone, so "60" showed "Enter a valid phone number" and save stayed disabled for every
    # child. Counts are now text inputs (3 characters); the endpoint reads Latin, Urdu and Arabic-Indic
    # digits and still refuses letters ("Enter a whole number"). bd-s1oo0.43.

  # ---- L26: the coach journey v2 (bd-s1oo0.46.2, design/COACH_JOURNEY_V2.md §3.1, CONTRACT §19) ----
  # v2 is the default: CHILD_TEST_BATTERY=v2 and CHILD_TEST_MATHS_MODE=oral. Either v1 value
  # (CHILD_TEST_BATTERY=v1 or CHILD_TEST_MATHS_MODE=strip) brings back the whole v1 conversation above.
  # Jest-proven in tests/child-test/L26 (journey-v2 + integration-l3-v2); the mock-lane drive is not written yet.

  @e2e @wip @draft @config-gated @P0 @CT80
  Scenario: v2 list — one message by classroom with Start and Send to teachers
    Given CHILD_TEST_ENABLED is true and the v2 switches are at their defaults
    When I send "/egra"
    Then one buttons message arrives: "Grade <g> · 5 children", the children grouped by classroom with each room's teacher, the alternates last
    And its buttons are "Start" and "Send to teachers"
    And no child is shown with a roll number, and no list rows are sent

  @e2e @wip @draft @config-gated @P1 @CT81
  Scenario: v2 Send to teachers — each class teacher gets only their own room, in their own language
    Given today's list spans two classrooms with a reachable class teacher each
    When I tap "Send to teachers"
    Then each teacher receives one message with only their room's children still to test, in order
    And I get "Sent to <teacher>, <teacher>."

  @e2e @wip @draft @config-gated @P1 @CT82
  Scenario: v2 before the first child — the setup picture, once per visit
    When I tap "Start"
    Then the setup picture arrives with the caption naming the card colour and grade, and the button "Start with <first name>"
    When I tap "Start" again later in the visit
    Then no picture is sent again; the next child's "here?" prompt comes instead

  @e2e @wip @draft @config-gated @P0 @CT83
  Scenario: v2 presence — "Child n of 5 · <name · class · teacher>" with the greeting to say
    When I tap "Start with <first name>"
    Then the prompt reads "Child 1 of 5 · <full name> · <class> · Teacher: <name>" and the greeting to say in «quotes»
    And its buttons are "Here, start", "Absent" and "Doesn't want to"
    When I tap "Absent"
    Then I am told the child is absent and which alternate joins, and the next child's prompt follows (no list)

  @e2e @wip @draft @config-gated @P0 @CT84
  Scenario: v2 steps — three plain-text messages, no buttons, the words to say in «quotes»
    When I tap "Here, start"
    Then "1/3 Urdu story · <name>" arrives as plain text with no buttons: the card by colour, grade and side, numbered steps, the start, go-on and stop lines and the three questions in «quotes»
    When I send one voice note
    Then "2/3 English story · <name>" arrives the same way, with the English lines in «quotes»
    When I send one voice note
    Then "3/3 Maths · <name>" arrives: point at pairs A–D and sums 1–4, then the two word problems to read aloud
    And no step mentions a roll, a child number, a form, a strip or a photo, and none carries a Menu button
    # An English-set coach gets English steps with Urdu words for the child; an Urdu-set coach gets Urdu steps.

  @e2e @wip @draft @config-gated @P0 @CT85
  Scenario: v2 auto-advance — the next child follows the third note
    When I send the maths voice note
    Then maths is scored once, straight away, with no photo asked for
    And one message arrives: "✅ <name> done. Thank the child." above the next child's "here?" prompt

  @e2e @wip @draft @config-gated @P0 @CT86
  Scenario: v2 end of the visit — minutes, results, one review
    Given CHILD_TEST_CHECK_MODE is end_review (the default)
    When the last child's third note is in
    Then "🎉 All 5 children done (<n> min). Thank the teachers." arrives
    And the visit summary follows once the marks are in, then one review message (L28) if any answer needs the coach's ear
    And no per-child check message is sent during the visit
    # With CHILD_TEST_CHECK_MODE=per_child the per-child check is sent as in v1 and there is no review.

  @e2e @wip @draft @config-gated @P1 @CT87
  Scenario: v2 unsent-draft nudge — once, 4 minutes after a step with no note
    Given a step message is the last bubble and no voice note arrives
    When 4 minutes pass (CHILD_TEST_STEP_NUDGE_MS, default 240000)
    Then "<b>/3 <part> · <name>" and "Did the recording stop? Look for an unsent voice note above the keyboard and press send. If it's gone, record this part again." arrive once
    And a later sweep does not repeat it, and a step whose note arrived is never nudged
    # Runs on the child test's existing 30 s recovery sweep (restart-safe); reads open sessions from the DB.

  @e2e @wip @draft @config-gated @P1 @CT88
  Scenario: v2 resume — /egra mid-child says where the child is
    Given a child is on part 2 of 3
    When I send "/egra"
    Then "<name> is on part 2/3 (English)." arrives with "Continue" and "Stop this child"
    When I tap "Continue"
    Then the English step is sent again as the last bubble

  # ── L28 (bd-s1oo0.46.4): the end-of-visit review, v2 (CHILD_TEST_CHECK_MODE=end_review, the default) ──
  # Ids CT90–CT94 are reserved for L28 so the v2 lanes appending here do not collide.

  @e2e @wip @draft @flow @config-gated @P0 @CT90
  Scenario: After the last child, one form asks only the answers the recording did not settle
    Given I have tested 5 children on this visit and every part is marked
    And 3 answers across the visit are under their confidence bar
    When the last child's maths note is marked
    Then I get ONE message with each child's results and "3 answers need your ear (about a minute)"
    And its button "Check answers" opens a single screen with exactly 3 items
    And each item shows the child's full name and part ("Ayesha Khan · Urdu question 2"), the question, and "Heard: «…»"
    And each item offers Right / Wrong / Didn't answer, none pre-selected
    And no item asks for a count (story words, letters or words)
    # Navigate mode: the form opens from the message itself, with no server round trip, on weak data.

  @e2e @wip @draft @config-gated @P0 @CT91
  Scenario: Submitting the review saves every child's marks once
    Given the review form from CT90 is open
    When I mark the 3 items and tap "Save answers"
    Then I get "✓ Saved. The marks for this visit are complete. Thank you."
    And every part of every child on the visit has my marks stored next to the AI's, with what I changed
    And the AI's own marks are unchanged

  @e2e @wip @draft @config-gated @P1 @CT92
  Scenario: Sending the review form a second time changes nothing
    Given I have already saved the review for this visit
    When I open the same form again and save different answers
    Then I get "These answers were saved earlier. Nothing was changed."
    And the stored marks are the ones from my first save

  @e2e @wip @draft @config-gated @P1 @CT93
  Scenario: Nothing doubtful — no form, the visit is finished at once
    Given every answer on the visit is above its confidence bar
    When the last child's maths note is marked
    Then I get the results with no "Check answers" button
    And every part of every child is stored as checked, marked "not reviewed by the coach"

  @e2e @wip @draft @config-gated @P2 @CT94
  Scenario: More than 15 doubtful answers — the 15 least certain are asked
    Given 18 answers across the visit are under their bar
    When the review arrives
    Then the form has 15 items, in the order the children were tested
    And the 3 most certain of the doubtful answers keep the AI's verdict and are listed as AI-only
    # A part whose scoring failed reads "not scored" in the results; it is never a review item.

  # ── L34 (bd-s1oo0.47, CONTRACT §20): ask only the comprehension questions the child reached (EGRA) ──
  # A question with needs_line = k is reached iff the child attempted every word up to the end of story line k.
  # The step message and the coach card show, before each gated question, "Only if the child read past:"
  # and the last words of that line. Scored correct out of those reached AND asked; the review never lists
  # an unreached or not-asked question.

  @e2e @wip @draft @config-gated @P0 @CT95
  Scenario: A child who read the whole story is asked every question, scored out of those asked
    Given the Urdu step for a Grade 5 child is on screen
    Then step 3 says "Look where the child's finger is, then turn the card face down."
    And step 4 lists question ① with no condition, and before ② and ③ "Only if the child read past:" with the last words of the line each one needs
    When the child reads past the line question ③ needs and I ask all 3
    Then the results read "Urdu <n> words/min, answers <right> of 3 asked" with no "not reached"
    # scoring/reach.js reachedQuestions; ai_marks comp_correct / comp_asked / comp_total.

  @e2e @wip @draft @config-gated @P0 @CT96
  Scenario: A child who stops early is asked only the questions they reached
    Given a Grade 5 child stops reading before the line question ③ needs
    When I ask questions ① and ② only and send the note
    Then the results read "answers <right> of 2 asked (1 not reached)"
    And the review form never shows question ③ of that child
    And question ③ is stored as not asked, never as wrong
    # A child who reached no question reads "no questions asked (3 not reached)", never "0 of 0".

  @e2e @wip @draft @negative @config-gated @P1 @CT97
  Scenario: A question asked beyond what the child read is kept but not scored
    Given a Grade 5 child stops reading before the line question ③ needs
    When I ask all 3 questions anyway
    Then the results read "answers <right> of 2 asked (1 not reached)"
    And question ③ keeps the AI's verdict, is marked beyond reach, and is not a review item

  # ── L25 (bd-s1oo0.46.1, CONTRACT §19, R1 §7, design §3.1): find the child without rolls ──
  # Children are named the way a school names them: full name · the roster's class label · class teacher.
  # The list is grouped by classroom; each class teacher gets only their own room. One shift per list.
  # One card set per grade per term (CHILD_TEST_FORM_POLICY=term). No roll number is shown anywhere.

  @e2e @wip @draft @destructive @config-gated @P0 @CT70
  Scenario: Today's list is grouped by classroom, each room with its class teacher, and no roll anywhere
    Given the SIM school's Grade 3 has sections A (class teacher Saima Bibi) and B (class teacher Tariq Mehmood)
    When I send "/egra"
    Then the list message is headed "Grade 3 · 5 children"
    And its body has a block "*Grade 3 - A* · Teacher: Saima Bibi" with that room's children numbered 1, 2, …, then a block "*Grade 3 - B* · Teacher: Tariq Mehmood" continuing the numbers
    And the returning child, if any, is inside their own room's block
    And the last line is "Only if someone is absent: <name> (3-A), <name> (3-B)"
    And the buttons are "Start" and "Send to the teachers"
    And no line says "Roll", «رول» or a roll number, though the roster has one for every child
    # conversation/list.js buildListMessage; body ≤ 1024, header ≤ 60, buttons ≤ 20 code points.

  @e2e @wip @draft @destructive @config-gated @P0 @CT71
  Scenario: "Send to the teachers" sends each class teacher only their own room's children
    Given today's list spans Grade 3 - A and Grade 3 - B
    When I tap "Send to the teachers"
    Then Saima Bibi receives ONE message: "For today's reading and maths check, please send these children from Grade 3 - A to the coach one at a time, in this order:" followed by only room A's children still waiting
    And Tariq Mehmood receives ONE message naming only room B's children
    And neither message names a child from the other room, or a roll
    # Fixes R1 §5: one teacher used to get every room's children. list.buildTeacherMessages.

  @e2e @wip @draft @negative @destructive @config-gated @P1 @CT72
  Scenario: A room with no reachable class teacher tells the coach to ask the head teacher
    Given Grade 3 - C has no active class teacher with a WhatsApp number
    And today's list includes a child from Grade 3 - C
    When I send "/egra"
    Then that room's block reads "*Grade 3 - C* · ask the head teacher for this room"
    And "Send to the teachers" sends nothing for Grade 3 - C
    # A class with no flagged class teacher and two reachable teachers is treated the same way.

  @e2e @wip @draft @destructive @config-gated @P1 @CT73
  Scenario: Class labels use the roster's own words
    Given a school whose Grade 3 is one class with no section
    When I send "/egra"
    Then the room reads "*Grade 3*", never "Class —"
    And for a school whose only Grade 3 class is an evening class, the room reads "*Grade 3 - A (evening)*"
    And in Urdu the room reads "جماعت سوم - A" (and «(شام)» for an evening class)

  @e2e @wip @draft @destructive @config-gated @P1 @CT74
  Scenario: A same-name classmate is resolved by the father's name, or flagged with the count in the class
    Given Ali Hassan is drawn and another Ali Hassan is in the same class but not on today's list
    When I send "/egra"
    Then Ali Hassan's line reads "Ali Hassan (father: <father's name>)" when the two fathers' names differ
    And it reads "Ali Hassan (2 in this class)" when nothing on the roster tells them apart
    And a child listed with "(N in this class)" is never drawn back as a returning child
    # Namesakes are counted against the class roster (listActiveEnrollments), names compared lower-cased
    # without punctuation or digits (R1 §4). R1 §7.4 option A.

  @e2e @wip @draft @destructive @config-gated @P1 @CT75
  Scenario: A school-grade with morning and evening classes is drawn from the morning shift only
    Given the SIM school's Grade 3 has a morning section A and an evening section A
    When I send "/egra" on two visits
    Then every child on both lists is from the morning class
    And the evening class is drawn only where the grade has no morning class with children
    # R1 §5: in 9 mixed school-grades every list mixed shifts, and other-shift children were coded absent.

  @e2e @wip @draft @destructive @config-gated @P1 @CT76
  Scenario: Every child in a term reads the term's card set; a returning child never reads a set twice
    Given CHILD_TEST_FORM_POLICY is unset (term) and the cycle is ICT-2026-Q4
    When today's list is drawn
    Then every child, new or returning, has form "A"
    And in ICT-2027-Q1 every child has form "B"
    And a child tested in ICT-2026-Q4 can return in ICT-2027-Q1, but no child is drawn back in the same term or into a set they already read
    And with CHILD_TEST_FORM_POLICY=returning_b new children read Form A and the returning child Form B, as before

  # ── L36 (bd-s1oo0.50.2, CONTRACT §21.4, design/COACH_JOURNEY_V3.md §3): battery v3, CHILD_TEST_BATTERY=v3 ──
  # The unit is the task: 18 per child (ur.* 5, en.* 5, ma.* 8), one plain step message (no buttons, so it stays
  # the last bubble above the recorder) and one voice note each. The words to the child come verbatim from the
  # item bank's script. v3 implies oral maths and the end-of-visit review. The default battery stays v2.

  @e2e @wip @draft @config-gated @P0 @CT51
  Scenario: v3 order — eighteen tasks per child, Urdu 5, English 5, Maths 8, one step and one note each
    Given CHILD_TEST_BATTERY is v3 and I tapped "Here, start" for Ayesha Khan
    Then the step "*Ayesha Khan* · Urdu 1 of 5 · Listening" arrives as plain text with no buttons
    When I send one voice note per step
    Then the steps come in the order Urdu 1–5, English 1–5, Maths 1–8, each starting with "🎧 Got it · <the task just sent>"
    And each note is stored as its own task row (ur.listening … ma.word_problems) and scored by task
    And after the 18th task "✅ Ayesha Khan done. Thank the child." arrives with the next child's prompt
    # conversation/steps-v3.js taskStep; machine.js unitsOf(); the visit end is the v2 one, handed to L39's review.

  @e2e @wip @draft @config-gated @P0 @CT52
  Scenario: v3 timed step — practice first, then 🎤, the begin line, stop at 1:00, send at about 1:05
    Given the Urdu letters step for Ayesha Khan is on screen
    Then it names "Urdu booklet, page 1: letters"
    And it gives the bank's intro and instructions to say before recording, and the practice row (marked "not recorded") when the bank has one
    And it says to tap 🎤 and lock, say the bank's begin line, and «آگے پڑھیں» after 3 seconds stuck
    And "At 1:00 on the mic" say «بس، شکریہ», and send at about 1:05
    And one line gives the stop rule: "Nothing right in the first row? Say «شکریہ!» and send."

  @e2e @wip @draft @config-gated @P0 @CT53
  Scenario: v3 untimed step — record the whole task, stop after 4 wrong in a row
    Given the "Which is bigger" step for a Grade 3 child is on screen
    Then it says "Maths 2 of 8 · Which is bigger" and "Maths booklet Grade 3, page 2"
    And it gives the practice pairs before the mic, then says to record the whole task
    And it gives the bank's line to ask for each pair, and «اگلا» after 5 seconds with no answer
    And one line says "Stop after 4 wrong in a row"
    And the step has no 1:00 or 1:05
    # Word problems: no booklet page; the six problems are listed in Urdu for the coach to read aloud.

  @e2e @wip @draft @config-gated @P0 @CT54
  Scenario: v3 skip — "skip" stores the task as skipped by the coach and sends the next step
    Given the "Harder addition" step is open because the quick additions were all wrong
    When I type "skip"
    Then "⏭️ Skipped: <title>." arrives on top of the "Maths 7 of 8" step, in one bubble
    And the task row is stored with ai-marks-v3 { skipped_by_coach: true }, no audio and no model call
    And «چھوڑیں», "next" and «اگلا» do the same
    And "skip" when no step is open is not taken by the child test

  @e2e @wip @draft @config-gated @P1 @CT55
  Scenario: v3 gap — a task with no official items is skipped with an honest line
    Given the item bank marks Urdu made-up words as { gap: true }
    When I send the voice note for Urdu letters
    Then "⏭️ Made-up words: not part of this test yet, so it is skipped." arrives on top of the "Urdu 4 of 5 · Familiar words" step
    And the gap task is stored with { skipped_by_coach: true, gap: true } and never counted as wrong

  @e2e @wip @draft @config-gated @P1 @CT56
  Scenario: v3 nudge and resume name the task
    Given the "Urdu 2 of 5 · Letters" step has been open for 4 minutes with no note
    Then "*Ayesha Khan* · Urdu 2 of 5 · Letters" arrives with "Did the recording stop?…", once
    When I send "/egra"
    Then "Ayesha Khan is on Urdu 2 of 5 (Letters)." arrives with "Continue" and "Stop this child"
    When I tap "Continue"
    Then the letters step is sent again as the last bubble

  # L39 (bd-s1oo0.50.5, CONTRACT §21.6): battery v3 results and the end-of-visit review, from ai-marks-v3 task rows.
  @e2e @wip @draft @config-gated @P0 @CT57
  Scenario: v3 results — one line per block per child, rates per minute, ≈ for provisional tasks
    Given CHILD_TEST_BATTERY is "v3" and all five children's tasks are scored
    When the last child's last task is stored
    Then the results arrive as text, each message at most 4096 characters, never split inside a child
    And each child reads "Urdu: listening 4/6 · letters ≈57/min · made-up ≈12/min · words 20/min · story 29/min, answers 3 of 4 asked (2 not reached)"
    And a task the coach skipped reads "skipped", e.g. "harder + skipped"
    And an Urdu coach reads Urdu digits, e.g. "حروف ≈۵۷ فی منٹ"

  @e2e @wip @draft @config-gated @P0 @CT58
  Scenario: v3 review — the unsettled items, child by child, in pages of 15, saved once per task
    Given the AI could not settle 25 items across the visit (provisional tasks are never asked)
    Then "25 answers need your ear · 1/2" arrives as a form listing "Ayesha Khan · Maths which is bigger" with "Which is bigger: 39 or 23?", "Heard: nothing clear" and Right / Wrong / Didn't answer
    When I mark the 15 items and tap "Save answers"
    Then those tasks are saved with my verdicts next to the AI's, and page "2/2" arrives
    When I save page 2
    Then "✓ Saved. The marks for this visit are complete. Thank you." arrives and every task row is checked

  # ── Any school (app_settings sa_any_school, default OFF; JSON true or a list of users.id) ──
  # For the people who support the visits and have no schools of their own: the coach app's Learning assessment lists
  # every live programme school (active, not a probable test school) with its EMIS and sector, and opens at any of them.
  # services/child-test/app/any-school-switch.js, sa-api.service.js listSchools / visitFor.
  @e2e @wip @draft @config-gated @P1 @CT98
  Scenario: A user on sa_any_school sees every live school with its EMIS and sector, and opens today's list at one they are not linked to
    Given sa_any_school names my user id and I have no schools of my own
    When I open Learning assessment in the coach app
    Then the school list holds every active school that is not a probable test school, each with its sector and EMIS under the name
    When I type an EMIS or a sector into the search box
    Then only the matching schools stay, and the count reads "<n> of <total>"
    When I pick a school I am not linked to
    Then today's children at that school are listed and I can mark them and start the test

  @e2e @wip @draft @negative @config-gated @P1 @CT99
  Scenario: Without sa_any_school, or at a test or closed school, nothing changes
    Given sa_any_school is off for my user id
    Then the school list holds only my own schools and today's observe visit
    And a list asked for at a school I am not linked to is not found
    Given sa_any_school names my user id
    Then a list asked for at a probable test school or a closed school is still not found
    And a practice-only coach still sees their practice schools only

  # ── Round 7b (27 Oct tester list): every skip and stop is recorded ─────────────────────────────────────────
  @e2e @wip @draft @config-gated @P1 @CT100
  Scenario: Every skip and stop is one event record on the session
    Given a coach's Learning assessment session is running
    When the child or the coach goes Back, ends a section, ends the test, restarts the child, or the app repeats a silent section or moves a child on under 20%
    Then the session keeps one event of that type (back, end_section, end_test, restart, silence_repeat, under20_move_on) with its subtask and time
    And no such event is ever dropped by the kept-events cap

  @e2e @wip @draft @config-gated @P1 @CT101
  Scenario: With sa_dash_filters on, the results dashboard's read carries each session's mode, coach and stops
    Given sa_dash_filters is on
    When the results dashboard reads the sessions
    Then each session says coach-led (RDF manual) or auto, its block, its coach's id and name, when it started, and its skips and stops
    And a session with a stop but no task yet comes back apart, for the stops view only
    And no child's name, student id or draw id is in the answer

  @e2e @wip @draft @config-gated @P1 @CT102
  Scenario: With sa_dash_filters on, each session says whether its child came from the random draw or was added
    Given sa_dash_filters is on
    When the results dashboard reads the sessions
    Then each session says drawn or added (a child added with "Add a child" has an on-the-spot draw), read once for all sessions
    And the stops include the completion rule's "incomplete_move_on" and any earlier "under20_move_on"
    And the draw ids never leave the bot

  # ── Round 7b · A · the child's screens (back, audio-gated Next, story arrow, instructions, tick prompt, T) ──
  @e2e @wip @draft @config-gated @P1 @CT101
  Scenario: Back on the item screens, in RDF auto and RDF manual, replaces the answer
    Given sa_back_button is on and a child is on the second letter of a part shown one at a time
    When the child presses Back
    Then the letter before shows again, the part's clock keeps running, and its new pass replaces the old one
    And the session keeps one back event with its subtask, who pressed it, and from and to
    And there is no Back on the first letter, on the story, or into another part

  @e2e @wip @draft @config-gated @P1 @CT102
  Scenario: Next waits until Jugnu has finished the instructions
    Given sa_audio_gated_next is on and a part's instructions are playing in RDF auto
    Then Next (and Go on the Ready screen) cannot be pressed until Jugnu stops
    And if the voice never ends, Next works after 30 seconds

  # @no-mock-driver: hiding the page and the phone's browser pausing or refusing a clip happen in the child's browser;
  # the mock lane drives the bot over WhatsApp and never runs the assessment page. Covered at unit level by
  # dashboard/tests/sa-voice-tabswitch.service.test.js (the real voice engine and page engine, a fake Audio element).
  @e2e @wip @draft @no-mock-driver @P1 @CT107
  Scenario: Leaving the page mid-instruction and coming back carries on in Jugnu's voice
    Given a part's instructions are playing in RDF auto or coach-led
    When the phone switches to another tab or app and then comes back
    Then Jugnu's instruction plays on, and Next works when it ends
    And the phone's own speech voice never says Jugnu's lines
    And if the clip will not play again, the words stay on screen and Next works within a few seconds

  @e2e @wip @draft @config-gated @P1 @CT103
  Scenario: The instructions say "say it, then press Next" (or Done), in Urdu and English
    Given sa_say_then_next is on
    Then a part read one at a time says and shows "Say each one out loud, then press Next" after its own instructions
    And the story questions say and show "Say your answer out loud, then press Done"
    And the same words stay under the item while the child answers

  @e2e @wip @draft @config-gated @P1 @CT104
  Scenario: The story shows a down arrow while more of it is below
    Given sa_story_scroll is on and the story is longer than the phone's screen
    Then the story's instructions tell the child to slide the page up to read all of it
    And an arrow under the story shows while more is below, and goes at the end

  @e2e @wip @draft @config-gated @P1 @CT105
  Scenario: Missing number (typed): the instructions say to press the tick
    Given sa_tick_prompt is on and a Grade 4 or 5 child reaches the missing-number part
    Then the instructions say and show "Type the number, then press the tick ✓"

  @e2e @wip @draft @config-gated @P1 @CT106
  Scenario: The English letter sound of T is "ta"
    Given sa_t_sound_ta is on
    Then Jugnu says "ta" for T in the English letter sounds, on the English and the Urdu page



  # ── Round 7b · B · the coach's controls and the auto stop-checks ─────────────────────────────────────────
  @e2e @wip @draft @config-gated @P1 @CT101
  Scenario: The coach's End test is a tap and a question, and the ended child can be restarted
    Given sa_end_test_restart is on and a child is taking the Learning assessment (RDF auto or RDF manual)
    When the coach taps "End test (coach)" in the corner
    Then a question asks to end the child's test, with "End test" and "Keep going"
    When the coach taps "End test"
    Then the coach is back on the list, the child reads "Stopped" with a "Restart test" button, and one end_test event is kept
    When the coach taps "Restart test" and starts again
    Then a new attempt opens for the same child with a new phone id, the ended attempt is set aside (never scored, never on Results), and one restart event is kept

  @e2e @wip @draft @config-gated @P1 @CT102
  Scenario: Coach-led End this section skips to the next section
    Given sa_end_section is on and a child is taking RDF manual
    When the coach taps "End this section" and confirms
    Then the part on show ends as end_section, the rest of its section is skipped (skipped_end_section), and the test goes on at the next section (Urdu, then English, then maths)
    And one end_section event is kept
    And that session's Results say, under "How it ended", "Ended by the coach" for the part ended and "Skipped" for the parts after it, never the code

  @e2e @wip @draft @config-gated @P1 @CT103
  Scenario: RDF auto, no voice heard on a read-aloud part: a reminder and one repeat
    Given sa_silence_repeat is on and a child is taking RDF auto with a working microphone
    When a read-aloud part ends with no voice heard
    Then Jugnu says (and the screen shows) to say each answer out loud, with "Try again"
    And the part runs once more from its start; the silent recording is never uploaded; one silence_repeat event is kept
    And a second silent attempt ends as before

  @e2e @wip @draft @config-gated @P1 @CT104
  Scenario Outline: RDF auto, a part the child does not finish: move on to the next subject
    Given sa_incomplete_move_on is on and a child is taking RDF auto
    When the child leaves "<part>" unfinished because <why>
    Then the rest of that subject is skipped (skipped_incomplete, shown as not taken) and the next subject starts (Urdu, then English, then maths); after maths the test ends
    And one incomplete_move_on event is kept with the subject, the reason "<reason>", how far the child got and the part's length
    Examples:
      | part                       | why                                               | reason          |
      | letter names (one at a time) | the time ran out before Next past the last letter | time_up         |
      | familiar words             | "I'm done" was pressed before the last word         | stopped_early   |
      | the story                  | the time ran out                                    | time_up         |
      | the story                  | the last word tapped is before the end              | last_word_early |
      | the story                  | no voice was heard for 20 seconds                   | silence         |
      | addition                   | the time ran out before the last sum                | time_up         |
      | number identification      | EGMA's stop rule ended it                           | stop_rule       |
      | maths spoken questions     | a question ran out of time with no answer           | time_up         |

  @e2e @wip @draft @negative @config-gated @P1 @CT104
  Scenario: RDF auto, a finished part, a coach's stop, or the switch off: no move-on
    Given a child is taking RDF auto
    When a part is finished (every item reached, right or wrong; or "I'm done" on the story with no last-word step)
    Then the next part of the same subject follows and no incomplete_move_on event is kept
    And the last part of a subject left unfinished moves on as usual, with no event (nothing is skipped)
    And the coach's End test or End this section is never this rule
    And with sa_incomplete_move_on off, or in RDF manual, the runner moves on as before

  # Round 13b: one unanswered spoken question no longer ends the subject; N in a row do (sa_r13_oral_rule = N).
  # @no-mock-driver: the rule runs on the child's page (a browser, not the WhatsApp bot the mock lane drives).
  # Covered by dashboard/tests/sa-r13-oral-rule.service.test.js (the real engine, runner and UI on jsdom).
  @e2e @wip @draft @no-mock-driver @config-gated @P1 @CT173
  Scenario Outline: A spoken part ends the subject only after N unanswered questions in a row
    Given sa_r13_oral_rule is 2 and a child is taking the Whole battery or RDF auto
    When on "<part>" the questions run out with nobody pressing "I've answered" in the pattern "<pattern>"
    Then <outcome>
    And the stored answers still read "spoken"
    Examples:
      | part                | pattern                                      | outcome                                                                                       |
      | Urdu listening      | one unanswered, then answered                | the part finishes and the next Urdu part starts; no incomplete_move_on event                  |
      | Urdu listening      | two unanswered in a row                      | the part ends there and English starts; one incomplete_move_on event with in_a_row 2          |
      | Urdu listening      | unanswered, answered, unanswered             | the part finishes and the next Urdu part starts                                               |
      | Urdu listening      | the last two unanswered                      | the part finishes and the rest of Urdu is skipped                                             |
      | the story questions | two unanswered in a row after the story ran out of time | the rest of Urdu is skipped and English starts                                     |
      | a one-question part | its only question unanswered                 | the part finishes and the subject goes on                                                     |



  # ── Round 8 · offline ──

  # @no-mock-driver: the events come from the child's page (a browser, not the WhatsApp bot the mock lane drives).
  # Covered at unit level by bot/tests/child-test/sa-device-events.test.js and on the browser lane by the throttle runs.
  @e2e @wip @draft @no-mock-driver @P1 @CT120
  Scenario: The phone's readiness is kept on the session
    Given a child's test page has prepared its clips
    When it logs device_ready (ready, voice, clips_total, clips_cached, persisted), and any voice_not_ready or voice_retry
    Then those events are kept on the session's events with their values, for reading a slow or refused start afterwards
    And the browser's offline / online events are not kept (device.offline already says it)

  # @no-mock-driver: a service worker and a dropped network are a real browser's; the mock lane has neither. Covered at
  # unit level by dashboard/tests/sa-r8-offline-prep.service.test.js and portal LeaderAssess.r8offline.test.tsx, and on
  # the browser lane by the throttle runs (offline after the first item).
  @e2e @wip @draft @config-gated @no-mock-driver @P1 @CT121
  Scenario: A test that starts with everything on the phone never asks for the network (sa_r8_offline_first)
    Given sa_r8_offline_first is on and the coach page put the child's whole battery on the phone before Start
    When the phone loses the network at any point after the first item
    Then every instruction, item, picture and clip still plays from the phone, and answers and recordings wait on the phone and sync later
    And "The voice is not ready yet" does not appear

  # ── Round 8 · item 35 · the content owner's question counts per RDF subsection (sa_r8_counts) ─────────────
  @e2e @wip @draft @config-gated @P1 @CT140 @no-mock-driver
  # No mock driver: the counts are a served-battery shape (dashboard/tests/sa-r8-counts.service.test.js); the screens are checked on a phone.
  Scenario: With sa_r8_counts on, each RDF subsection has the practice and scored items the content owner asked for
    Given sa_r8_counts is on and a child takes the Learning assessment in RDF auto
    Then Urdu letter sounds has 1 practice and 5 letters, Urdu familiar words 2 practice and 5 words
    And English letter names and letter sounds have 1 practice and 5 letters each, English familiar words 2 practice and 5 words
    And which is bigger asks 3, addition 5, subtraction 5 and multiplication 4
    And number identification, missing number and quick sums are as today

  @e2e @wip @draft @config-gated @P1 @CT141 @no-mock-driver
  # No mock driver: a timer on the child's screen (dashboard/tests/sa-r8-counts.service.test.js runs the real runner).
  Scenario: With sa_r8_counts on, a story question waits 15 seconds, one replay, and Next moves on sooner
    Given sa_r8_counts is on and a child reaches the story questions in RDF auto
    Then each question waits 15 seconds before it moves on, with one replay
    And the child can press Next to move on before the 15 seconds are up

  @e2e @wip @draft @config-gated @P1 @CT142 @no-mock-driver
  # No mock driver: the switch-off form is asserted byte for byte on every coach battery (dashboard/tests/sa-r8-counts.service.test.js).
  Scenario: With sa_r8_counts off, every RDF subsection is as today
    Given sa_r8_counts is off
    Then every RDF subsection has today's practice and scored items, and a story question waits 10 seconds

  @e2e @wip @draft @config-gated @P1 @CT150 @no-mock-driver
  # No mock driver: the mock browser has no loudspeaker or call mode. The recorder opening and closing the microphone per
  # recording is asserted in dashboard/tests/sa-r9-audio.service.test.js; the loudness itself needs a real phone.
  Scenario: With sa_r9_audio on, Jugnu speaks with no microphone open, so a phone plays him at full media volume
    Given sa_r9_audio is on and a child runs a battery with spoken answers on a phone
    When Jugnu says a line between two recordings
    Then no microphone is open while he speaks
    And the microphone opens when a recording starts and closes when it ends

  @e2e @wip @draft @config-gated @P1 @CT150 @no-mock-driver
  # No mock driver: the switch-off recorder is asserted in dashboard/tests/sa-r9-audio.service.test.js.
  Scenario: With sa_r9_audio off, the microphone stays open for the whole battery as today
    Given sa_r9_audio is off
    Then the microphone is asked for once and kept open until the battery ends

  @e2e @wip @draft @config-gated @P1 @CT171 @no-mock-driver
  # No mock driver: the mock browser plays every clip. The Android in-app browser's rule (a new clip only inside a tap) is
  # modelled in dashboard/tests/sa-r10-audio.service.test.js; that the instruction is heard needs a real phone.
  Scenario: With sa_r10_bigger_audio on, an instruction reached with no tap is still heard ("Which is bigger")
    Given sa_r10_bigger_audio is on and a child runs RDF auto on a phone's in-app browser
    And the child has tapped at least once since the test began
    When a part ends by itself and the next part's instruction starts with no tap behind it
    Then Jugnu says the instruction
    And a clip the browser still refuses is kept on the session as voice_held "refused"

  @e2e @wip @draft @config-gated @P1 @CT172 @no-mock-driver
  # No mock driver: preloading and the browser's start delay are not visible to the mock. Asserted in
  # dashboard/tests/sa-r10-audio.service.test.js; smoothness to the ear needs a real phone.
  Scenario: With sa_r10_practice_gap on, the practice answer follows "The answer is:" without a break
    Given sa_r10_practice_gap is on and a practice item models its answer as "The answer is:" then the answer
    When Jugnu says "The answer is:"
    Then the answer clip is already loaded and starts as soon as "The answer is:" ends

  @e2e @wip @draft @config-gated @P1 @CT172 @no-mock-driver
  Scenario: With sa_r10_bigger_audio and sa_r10_practice_gap off, every clip plays on a new element as today
    Given sa_r10_bigger_audio and sa_r10_practice_gap are off
    Then the served battery has neither r10_bigger_audio nor r10_practice_gap

  # Children per visit (app_settings sa_per_visit, absent = 5): bot/shared/services/child-test/app/per-visit-switch.js,
  # draw/index.js todaysList; the visit bar in portal/src/portal/pages/LeaderAssess.tsx.
  @e2e @wip @draft @config-gated @P1 @CT175 @no-mock-driver
  # No mock driver: the draw runs against the database. Asserted in tests/child-test/L3/draw-per-visit.test.js,
  # bot/tests/child-test/sa-per-visit.test.js and portal/src/portal/pages/LeaderAssess.perVisit.test.tsx.
  Scenario: With sa_per_visit at 3, a new visit lists 3 children and 2 alternates
    Given sa_per_visit is 3
    When I open today's list at a school in the coach app
    Then the list has 3 children to test and 2 alternates, and the visit bar reads "Children done 0/3"
    When I mark a child absent
    Then the first alternate moves onto the list and the alternates are topped up to 2

  @e2e @wip @draft @negative @config-gated @P1 @CT176 @no-mock-driver
  # No mock driver: as @CT175.
  Scenario: A list drawn before sa_per_visit changes keeps its size, and without the switch nothing changes
    Given a visit's list was drawn with 5 children
    When sa_per_visit is set to 3 and I open that visit's list again
    Then the same 5 children and alternates are listed
    And with sa_per_visit absent a new visit lists 5 children and 2 alternates, as today

  # The visit clock follows the list (portal/src/portal/lib/assess/visitStore.ts visitLimitMs, AssessVisitBar limitMs).
  @e2e @wip @draft @config-gated @P1 @CT177 @no-mock-driver
  # No mock driver: as @CT175. Asserted in portal/src/portal/components/assess/AssessVisitBar.test.tsx and
  # portal/src/portal/pages/LeaderAssess.perVisit.test.tsx.
  Scenario: The visit clock is 20 minutes a child on a list drawn at 3, and 45 minutes on any other list
    Given sa_per_visit is 3
    When I open today's list at a school in the coach app
    Then the visit bar shows "Time for the whole visit (3 children)" over a large "00:00 / 60:00"
    And the clock turns red only after 60 minutes
    And a list drawn at 5, or before the switch, reads "Time for the whole visit (5 children)" over "/ 45:00" as today
    And in Urdu the label reads «پورے دورے کا وقت (۳ بچوں کے لیے)» over «۰۰:۰۰ / ۶۰:۰۰»

  # Round 19: the practice school first (app_settings sa_r19_practice_first, default OFF). Asserted in
  # bot/tests/child-test/sa-practice-first.test.js (listSchools and conversation/context.js coachSchools).
  @e2e @wip @draft @config-gated @P1 @CT178 @no-mock-driver
  # No mock driver: as @CT175.
  Scenario: With sa_r19_practice_first on, the practice school comes first in the coach's school lists
    Given sa_r19_practice_first is on and the coach is linked to the SIM practice school and to two of their own schools
    When I send /egra with no visit today
    Then the school picker lists the SIM practice school first, then the coach's schools by name
    And the coach app's Learning assessment lists the SIM school first, marked practice, above today's visit
    And with the switch absent both lists are in today's order: today's visit first, then by name

  # Round 20: a child silent through a section moves on to the next subject (sa_r20_silence_stop = N), and the coach can end a
  # section in RDF auto too (sa_r20_auto_end_section). @no-mock-driver: the rule runs on the child's page, not the WhatsApp bot.
  # Covered by dashboard/tests/sa-r20-auto-stop.service.test.js (the real runner and engine) and AssessEngineSlot.r20.test.tsx.
  @e2e @wip @draft @no-mock-driver @config-gated @P1 @CT180
  Scenario Outline: RDF auto, silent letter or word parts in a row end the subject
    Given sa_r20_silence_stop is <n>, sa_silence_repeat and sa_incomplete_move_on are on, and a child is taking RDF auto with a working microphone
    When the Urdu letter and word parts run in the pattern "<pattern>" (each silent part after its one reminder and repeat)
    Then <outcome>
    Examples:
      | n | pattern                    | outcome                                                                                                                 |
      | 2 | silent, silent             | the rest of Urdu is skipped (skipped_incomplete), English starts, and one incomplete_move_on event says reason silence, in a row 2 |
      | 2 | silent, voice, silent      | every Urdu part runs and no incomplete_move_on event is kept                                                              |
      | 1 | silent                     | the rest of Urdu is skipped after that one part, with in a row 1                                                          |
      | 2 | voice heard, then time up  | the part is finished and the subject goes on (time-up stays finished)                                                     |

  @e2e @wip @draft @negative @no-mock-driver @config-gated @P1 @CT184
  Scenario: The silence stop never fires without evidence, in RDF manual, or with the switch off
    Given a child is taking RDF auto
    When the phone's ear could not listen, or the test is coach-led (RDF manual), or sa_r20_silence_stop has no row
    Then no part is counted as silent and every part runs as today

  @e2e @wip @draft @no-mock-driver @config-gated @P1 @CT181
  Scenario: The coach ends a section in RDF auto
    Given sa_end_section and sa_r20_auto_end_section are on and a child is taking RDF auto
    When the coach taps "End this section" and confirms
    Then the part on show ends as end_section, the rest of its subject is skipped (skipped_end_section), and the test goes on at the next subject
    And one end_section event is kept with by coach
    And that session's Results say, under "How it ended", "Ended by the coach" for the part ended and "Skipped" for the parts after it, never the code
    And with sa_r20_auto_end_section off, RDF auto shows no End this section button, as today

  # Round 20, the child's level per subject (app_settings sa_r20_level, absent = OFF): bot/shared/services/child-test/sa/level.js
  # (level words and cut-offs as approved by the content owner on 13 Nov: story 20 words; maths Numbers, Compare numbers, Add, Subtract and multiply),
  # app/level-switch.js, app/sa-api.service.js saResults /
  # saSessions; portal/src/portal/pages/LeaderAssessResults.tsx and LeaderAssessDashboard.tsx.
  @e2e @wip @draft @config-gated @P1 @CT182 @no-mock-driver
  # No mock driver: the results read the database. Asserted in bot/tests/child-test/sa-r20-level.test.js and
  # portal/src/portal/pages/LeaderAssessResults.test.tsx.
  Scenario: A session's Results show, per subject, where the child reached, the level, and why the subject stopped
    Given sa_r20_level is on and a child finished an RDF auto battery
    When the coach opens that session's Results
    Then above the task cards each subject (Urdu, English, Maths) reads "Reached: <the last part the child did>" and "Level: <level>"
    And a spoken part not scored yet reads "Waiting for scores", or the level so far with "more to come"
    And a subject a silence stop ended reads "Stopped: no answer", and one the coach ended reads "Stopped by the coach"
    And in Urdu the same lines are in Urdu script, with the approved Urdu words: "ٹیسٹ کہاں تک پہنچا" for Reached, "ٹیسٹ رک گیا: کوئی جواب نہیں" for a silence stop, and "اعداد کی پہچان" for the maths Numbers level
    And with sa_r20_level off the Results are exactly as before

  @e2e @wip @draft @config-gated @P1 @CT183 @no-mock-driver
  # No mock driver: as @CT182. Asserted in bot/tests/child-test/sa-r20-level.test.js and
  # portal/src/portal/pages/LeaderAssessDashboard.test.tsx.
  Scenario: The results dashboard's sub-region and school table gains a Level column per subject
    Given sa_r20_level is on and the live results dashboard is on
    When the user opens the results dashboard
    Then the sub-region table has an "Urdu level", "English level" and "Maths level" column with each row's typical level
    And a row of fewer than 5 children shows "–" in those columns
    And with sa_r20_level off the table has no level columns

  @e2e @wip @draft @config-gated @P1 @CT185 @no-mock-driver
  # No mock driver: the check runs in the scoring sweep against a model and speech-to-text, not in the chat.
  # Asserted in bot/tests/child-test/sa-score-voice-strict.test.js.
  Scenario: With sa_r26_voice_strict on, "Another voice heard" is not shown when nobody else's words are in the recording
    Given sa_r26_voice_strict is on and the another-voice check is on
    And the check says another person spoke in a child's recording
    When no word was heard in that recording, or the other person's words are not among the words heard
    Then the coach's Results for that task do not say another voice was heard
    And the child's marks are the same as without the check
    And with sa_r26_voice_strict off the Results are exactly as before

  @e2e @wip @draft @config-gated @P1 @CT186 @no-mock-driver
  # No mock driver: as @CT185. Asserted in bot/tests/child-test/sa-score-voice-strict.test.js.
  Scenario: With sa_r26_voice_strict on, an adult heard prompting the child is still flagged
    Given sa_r26_voice_strict is on and the another-voice check is on
    And an adult speaks to the child during a recorded part, for example "speak louder" or "go ahead"
    When the adult's words are among the words heard in that recording
    Then the coach's Results for that task say another voice was heard
    And the child's marks are the same as without the check

  @e2e @wip @draft @config-gated @P1 @CT187 @no-mock-driver
  # No mock driver: as @CT185. Asserted in bot/tests/child-test/sa-score-voice-strict.test.js and sa-stt-plain.test.js.
  Scenario: With sa_r26_voice_strict on, an adult the first listen missed is still flagged after a second listen
    Given sa_r26_voice_strict is on and the another-voice check is on
    And an adult speaks to the child during a recorded part
    When the first listen of the recording heard no word, or not the adult's words
    And a second listen with both Urdu and English expected hears the adult's words
    Then the coach's Results for that task say another voice was heard
    And when neither listen hears the adult's words, the Results do not say another voice was heard

  @e2e @wip @draft @config-gated @P2 @CT188 @no-mock-driver
  # No mock driver: as @CT185. Asserted in bot/tests/child-test/sa-score-voice-strict.test.js.
  Scenario: sa_r26_voice_strict set to a number sets how much of the adult's words must be heard
    Given sa_r26_voice_strict is set to a number from 0.2 to 0.9
    When the check says another person spoke and part of their words were heard
    Then the flag stands when at least that share of their words was heard, and is cleared otherwise
    And a value of true uses the default share, and any other value turns the stricter check off

  @e2e @wip @draft @config-gated @P1 @CT240 @no-mock-driver
  # No mock driver: the check runs in the scoring sweep against speech-to-text and a model, not in the chat.
  # Asserted in bot/tests/child-test/sa-score-voice-help.test.js.
  Scenario: With sa_r28_voice_help on, an adult only encouraging the child is not flagged
    Given sa_r28_voice_help is on and the another-voice check is on
    And an adult speaks to the child during a recorded part only to instruct or encourage, for example "speak louder", "press next" or "well done", or asks a question again and the child keeps the answer or changes it to another wrong one
    When the recording is scored
    Then the coach's Results for that task do not say another voice was heard
    And the task's detail logs the adult's speech as support, never as a flag
    And the child's marks are the same as without the check

  @e2e @wip @draft @config-gated @P1 @CT241 @no-mock-driver
  # No mock driver: as @CT240. Asserted in bot/tests/child-test/sa-score-voice-help.test.js.
  Scenario: With sa_r28_voice_help on, an adult saying the answer is flagged as help
    Given sa_r28_voice_help is on and the another-voice check is on
    And an adult says an item or the answer before the child does, corrects the child, or asks again after a wrong answer and the child changes it to the right answer
    When the adult's words are among the words heard in that recording
    Then the task is flagged, with the kind of help and only the words that are the task's own items or answers
    And the child's marks are the same as without the check

  @e2e @wip @draft @config-gated @P1 @CT242 @no-mock-driver
  # No mock driver: as @CT240. Asserted in bot/tests/child-test/sa-score-voice-help.test.js and sa-stt-plain.test.js.
  Scenario: With sa_r28_voice_help on, a recording with no word heard is never flagged, and off changes nothing
    Given sa_r28_voice_help is on and the another-voice check is on
    When no word is heard in a recording (noise or silence)
    Then the task is not flagged and no model is asked
    And with sa_r28_voice_help off the check and the Results are exactly as before

  @e2e @wip @draft @config-gated @P1 @CT207 @no-mock-driver
  # No mock driver: the gate runs in the scoring sweep against a model and speech-to-text, not in the chat.
  # Asserted in bot/tests/child-test/sa-r28-letter-gate.test.js.
  Scenario: With sa_r28_letter_gate on, a letter-sound recording is judged by whether a voice is heard, not by words heard
    Given sa_r28_letter_gate is on and the speech gate is on
    And a child says bare letter sounds in a letter-sound recording, with no whole word
    When the recording is scored
    Then speech-to-text is not asked about that recording, a voice check on the recording passes and the model marks the letters it hears
    And the model is not shown the expected answers for the letters
    And a silent recording, or one holding only steady noise, is not reached and the model is not asked
    And a recording shorter than the minimum speech length, or one the model finds holds no letters, is still not reached
    And letter-name, word, passage, question and spoken-maths recordings are muted as before when speech-to-text hears no word
    And with sa_r28_letter_gate off a letter-sound recording with no word heard is not reached, exactly as before
    And word, passage and question recordings are muted as before when speech-to-text hears no word
    And with sa_r28_letter_gate off a letter recording with no word heard is not reached, exactly as before

  @e2e @wip @draft @config-gated @P1 @CT211 @no-mock-driver
  # No mock driver: as @CT207. Asserted in bot/tests/child-test/sa-r28-no-echo-ur.test.js.
  Scenario: With sa_r28_no_echo_ur on, a quiet Urdu answer is not zeroed because speech-to-text heard only the question
    Given sa_r28_no_echo_ur is on and the speech gate is on
    And in an Urdu comprehension question speech-to-text hears the phone's question but not the child's short answer
    When the model marks the child's answer correct
    Then the answer counts as correct
    And the Urdu questions prompt tells the model that repeating the question is not an answer
    And English questions keep the echo check
    And with sa_r28_no_echo_ur off the answer is not counted, exactly as before

  @e2e @wip @draft @config-gated @P1 @CT212 @no-mock-driver
  # No mock driver: as @CT207. Asserted in bot/tests/child-test/sa-r28-child-only-answer.test.js.
  Scenario: With sa_r28_child_only_answer on, spoken maths marks only the child's own final answer
    Given sa_r28_child_only_answer is on
    And in a spoken sum the child says a wrong number and then another person says the right one
    When the recording is scored
    Then the scoring instructions say to mark only the child's own answer and to ignore any other speaker
    And a number another person said is never the child's answer, nor a change the child makes to it afterwards
    And such an item is marked from what the child said before the other person spoke
    And the child's own self-correction still counts
    And another person's instructions or encouragement do not change the mark
    And with sa_r28_child_only_answer off the scoring instructions are exactly as before

  @e2e @wip @draft @config-gated @P2 @CT213 @no-mock-driver
  # No mock driver: as @CT207. Asserted in bot/tests/child-test/sa-r28-raw-verdicts.test.js.
  Scenario: With the r28 switches on, a recording a gate overrode keeps what the model and speech-to-text said
    Given sa_r28_letter_gate is on, or sa_r28_no_echo_ur is on for the echo check
    When a gate mutes a recording, or overrides the model's marks for it
    Then each item keeps why it was overridden, the recording's length and how many words speech-to-text heard
    And the model's own "no child heard" is its own reason, apart from a short or a silent recording
    And when the model was asked, each item keeps the model's own verdict and what it heard
    And the transcript itself, cut to 80 characters, is kept only on the echo check, never on a muted recording
    And the child's marks are the same as without the switch
    And with the switches off nothing new is stored

  @e2e @wip @draft @config-gated @P1 @CT204 @no-mock-driver
  # No mock driver: the battery route serves a JSON file to the child's page, not a chat. Asserted in
  # dashboard/tests/sa-r28-off-identity.service.test.js and sa-r28-switches.service.test.js.
  Scenario: With every sa_r28_* switch off, the battery a phone receives is exactly today's
    Given the built battery carries the listen-and-tap letter sounds, the spoken MCQ and the extension items
    And sa_r28_letter_pick, sa_r28_mcq and sa_r28_ceiling are all off
    When a phone fetches any coach form battery
    Then it receives today's battery byte for byte: no new task, no extension item, no round-28 line, no round-28 flag
    And a scripted child through the Urdu and the English RDF auto forms produces today's events and results

  @e2e @wip @draft @config-gated @P1 @CT205 @no-mock-driver
  # No mock driver: as @CT204. Asserted in dashboard/tests/sa-r28-switches.service.test.js.
  Scenario: With sa_r28_letter_pick on, the listen-and-tap letter sounds take the place of the read-aloud ones
    Given sa_r28_letter_pick is on
    When a phone fetches a coach form battery
    Then the RDF auto and RDF manual lists name the listen-and-tap letter-sound task where the read-aloud one was
    And the read-aloud letter-sound task is not in the battery
    And the battery carries the round-28 lines for that task and the flag the engine reads
    And with sa_r28_mcq on, the spoken MCQ takes the place of the spoken story questions the same way, keeping its gate

  @e2e @wip @draft @config-gated @P1 @CT206 @no-mock-driver
  # No mock driver: as @CT204. Asserted in dashboard/tests/sa-r28-switches.service.test.js.
  Scenario: With sa_r28_ceiling on, a timed task's grid runs past today's first items
    Given sa_r28_ceiling is on
    When a phone fetches a coach form battery
    Then every timed letter, word, number and quick-sum task carries its extension items after today's first ones
    And its grid lists every item in order, and the task says how many of them are today's
    And with the switch off those items are sliced away and the task is exactly today's
  @e2e @wip @draft @config-gated @P1 @CT199 @no-mock-driver
  # No mock driver: the extension is the phone's battery engine and the scoring sweep, not the chat.
  # Asserted in dashboard/tests/sa-r28-ceiling-core.service.test.js.
  Scenario: With sa_r28_ceiling on, a fast child keeps getting new words until the minute ends
    Given sa_r28_ceiling is on
    And a child has read all of today's words before the minute is over
    When the child moves on from the last of today's words
    Then the next word of the longer published list is shown
    And the task ends only when the minute ends, or when the whole list has been read
    And with sa_r28_ceiling off the task has today's words only

  @e2e @wip @draft @config-gated @P1 @CT200 @no-mock-driver
  # No mock driver: as @CT199. Asserted in dashboard/tests/sa-r28-ceiling-core.service.test.js and
  # bot/tests/child-test/sa-r28-ceiling.test.js.
  Scenario: With sa_r28_ceiling on, an item shown for under half a second at the end of the minute is not counted as tried
    Given sa_r28_ceiling is on
    When the minute ends less than half a second after an item came up
    Then that item is still listed as shown, with how long it was on show
    And it is not counted among the items the child tried
    And an item on show for longer than half a second is marked from the recording as today

  @e2e @wip @draft @config-gated @P1 @CT201 @no-mock-driver
  # No mock driver: the scoring sweep runs against a model. Asserted in bot/tests/child-test/sa-r28-ceiling.test.js.
  Scenario: The scorer marks only the items the child reached, and keeps today's first items as a fixed anchor
    Given a child reached 12 words of a 50-word list whose first 4 are today's words
    When the recording is scored
    Then the scorer is given the 12 words reached, never the whole list
    And the marks say how many were reached, how many of today's first 4 were right, and the rate over the time used
    And a child who reached fewer than today's 4 is scored on today's 4 exactly as before

  @e2e @wip @draft @config-gated @P1 @CT202 @no-mock-driver
  # No mock driver: as @CT201. Asserted in bot/tests/child-test/sa-r28-ceiling.test.js.
  Scenario: With sa_r28_ceiling on, the first-line rule and the missing clock are applied when the recording is scored
    Given sa_r28_ceiling is on
    When a child read past today's letters and got none of the first 10 right and some later ones right
    Then the letters score is 0, with the items tried and the time used kept as they were
    And with sa_r28_ceiling on a result without the time used gets no rate until the time is known
    And a run that stayed inside today's letters (every run with sa_r28_ceiling off) is scored as today

  @e2e @wip @draft @config-gated @P1 @CT203 @no-mock-driver
  # No mock driver: the Results level lines are computed on the server. Asserted in bot/tests/child-test/sa-r28-ceiling.test.js.
  Scenario: The Results level reads today's first items of a longer list
    Given sa_r20_level is on and a child reached 12 letters, 5 of them today's first 5
    When the coach opens Results
    Then the letters level is decided on today's first 5 letters, all right, so it is met
    And a child with 3 of today's first 5 right does not meet it however many later letters were right
  @e2e @wip @draft @config-gated @P1 @CT189 @no-mock-driver
  # No mock driver: the picker runs on the child's phone screen (the battery engine), not in the chat.
  # Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js.
  Scenario: With sa_r28_letter_pick on, the letter-sound picker plays a sound and is scored on the phone by the letter tapped
    Given sa_r28_letter_pick is on and a child's battery has the letter-sound picker
    When an item shows five letter cards and Jugnu plays its sound
    And the child taps a card, during the sound or after it
    Then the tap counts once for that item, right when it is the letter for the sound, wrong otherwise
    And the answer keeps how many times the child played the sound again and how long after the sound the tap came
    And no right or wrong is shown on a scored item
    And with sa_r28_letter_pick off the battery runs exactly as before

  @e2e @wip @draft @config-gated @P1 @CT190 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js.
  Scenario: With sa_r28_letter_pick on, the big speaker plays the sound again and a child who never taps is not stuck
    Given sa_r28_letter_pick is on and an item of the letter-sound picker is on show
    When the child taps the big speaker under the cards
    Then only the item's sound plays again, never the instruction, and the replay is recorded
    And with no tap 10 seconds after the sound ends Jugnu plays it once more by itself
    And at 15 seconds Next is offered, and an item passed with Next is scored wrong

  @e2e @wip @draft @config-gated @P1 @CT191 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js.
  Scenario: With sa_r28_letter_pick on, the first practice is shown by Jugnu and the second is the child's try
    Given sa_r28_letter_pick is on and the letter-sound picker's practice is on show
    When the first practice item shows
    Then the right card is lit, no card can be tapped, and once the part's sounds are loaded (or after 5 seconds) Jugnu plays the sound and says the model line
    And Next then appears, and in RDF auto the practice moves on by itself 2 seconds later
    When the child gets the second practice item wrong twice
    Then the child is asked to try again once, and then the right card is shown

  @e2e @wip @draft @config-gated @P1 @CT192 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js.
  Scenario: With sa_r28_letter_pick on, a sound that cannot play leaves out that item only and is never said by the phone's voice
    Given sa_r28_letter_pick is on and the sound of one letter-sound item cannot play, even after one more try
    When that item shows
    Then that item is left out: not attempted, not wrong, and the next item shows
    And the answers given before it are kept
    And a replay that cannot play leaves the item open, and the cards still take a tap
    And with fewer than 6 items whose sound played, the part runs to its end and is not rated
    And the phone's own voice never says the letter

  @e2e @wip @draft @config-gated @P1 @CT193 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js.
  Scenario: With sa_r28_letter_pick on, coach-led, Jugnu still plays the sound and the coach sees the answer folded
    Given sa_r28_letter_pick is on and the battery is coach-led (RDF manual)
    When an item of the letter-sound picker shows
    Then Jugnu plays the sound from the phone, the coach does not say it
    And the coach's screen shows the sound and its letter folded away, not in the open

  @e2e @wip @draft @config-gated @P1 @CT247 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js
  # ("a tap at speech_start + 100 ms is logged …", "two pre-sound taps …", "no timing entry …", "practice (P2) …").
  Scenario: With sa_r28_letter_pick on, a tap before the sound starts is logged and never scored
    Given sa_r28_letter_pick is on and the sound's timing is known
    When the child taps a card before the sound has started
    Then that tap is not the child's answer and the item stays on screen while the sound plays on
    And the next tap after the sound has started is the answer, with the early taps counted beside it
    And in practice the early tap gets no feedback; without the sound's timing every tap answers as before

  @e2e @wip @draft @config-gated @P1 @CT248 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js and
  # dashboard/tests/sa-r28-mcq.service.test.js ("Next per mode …", "r9 ON, coach-led …", "r9 ON, RDF auto …").
  Scenario: With sa_r28_letter_pick or sa_r28_mcq on, Next comes after 15 s coach-led and 30 s on the child's own
    Given the picker or the story questions are on, with longer question time on
    When an item waits for the child's tap
    Then coach-led Next is offered 15 s after the sound ends, and on the child's own 30 s after
    And the older maths tap parts keep their own waits

  @e2e @wip @draft @config-gated @P1 @CT249 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js
  # ("a child replay at 8 s …", "a child replay 8 s after the first play …").
  Scenario: With sa_r28_letter_pick on, a replay restarts the wait for the auto replay and Next
    Given sa_r28_letter_pick is on
    When the child presses the sound button 8 s after the sound ended
    Then neither the auto replay nor Next comes while that sound plays
    And both count again from the end of that replay

  @e2e @wip @draft @config-gated @P1 @CT250 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js
  # ("coach-led: the coach line …", "coach line: English …", "the folded target …", "sa.css: the replay pill …").
  Scenario: With sa_r28_letter_pick on, coach-led, the coach is told not to say the sound
    Given sa_r28_letter_pick is on and the battery is coach-led (RDF manual)
    When any picker screen shows, practice included
    Then a line above the coach's fold asks the coach not to say the sound and to press the sound button instead
    And the fold opens only when the coach taps it and is folded again on the next item
    And on the child's own run there is no such line
  @e2e @wip @draft @config-gated @P1 @CT260 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js ("round 28 A5: …": "ur/en:
  # the open fold on every live item …", "served batteries …", "practice P2: the glyph may show …").
  Scenario: With sa_r28_letter_pick on, coach-led, the open fold never shows the letter being asked for
    Given sa_r28_letter_pick is on and the battery is coach-led (RDF manual)
    When the coach opens the fold on a scored letter-sound item
    Then the fold shows the sound button and no letter, so the child never sees the answer's shape before choosing
    And on the practice item the fold still shows the sound and its letter
  @e2e @wip @draft @config-gated @P1 @CT261 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js ("round 28 A5: modal: …",
  # "the item's sound never starts while the fold is open …", "the fold's own replay button …", "RDF auto: no fold …").
  Scenario: With sa_r28_letter_pick on, coach-led, the open fold takes the next tap and is logged
    Given sa_r28_letter_pick is on, the battery is coach-led and the coach has opened the fold on an item
    When anyone taps a letter card, the big sound button or the coach's Next
    Then that tap only closes the fold: no answer is recorded, no sound plays and the item stays
    And the next tap answers, plays the sound or moves on as usual
    And the item's sound never starts while the fold is open; it starts once the fold is closed
    And the run logs one fold_open and one fold_close for the item, the close saying whether the coach folded it or a tap closed it and which card was under that tap
    And the child's own run has no fold and logs neither
  @e2e @wip @draft @config-gated @P1 @CT262 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js ("the picker, coach-led on a
  # 360×640 phone: …"; real browser, skipped where none is installed).
  Scenario: With sa_r28_letter_pick on, coach-led, the letter-sound screen fits a small phone in every state
    Given sa_r28_letter_pick is on, the battery is coach-led and the phone is 360 by 640 with the usual Urdu layout settings
    When the item is playing, has played, has a card chosen, offers Next, or has the fold open
    Then the five letter cards and the big sound button are whole on screen without scrolling and never move
    And every letter's ink sits inside its card
  @e2e @wip @draft @config-gated @P1 @CT263 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js ("round 28 A6: scored item:
  # fold open → …", "the summary close arms the guard too …", "practice P2: the same guard …", "RDF auto (no fold) …").
  Scenario: With sa_r28_letter_pick on, coach-led, a double tap that closes the fold never also answers
    Given sa_r28_letter_pick is on, the battery is coach-led and the coach has opened the fold on an item
    When a tap closes the fold and a second tap lands on a letter card within 300 ms
    Then the second tap records no answer and no card is pressed, and it is logged once as a ghost tap with its card
    And a tap on a card after 300 ms answers as usual, on scored and practice items alike
    And without the fold (RDF auto) no tap is ever logged as a ghost tap
  @e2e @wip @draft @config-gated @P1 @CT264 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js ("round 28 A6: the fold's own
  # replay …", "a fold opened in the 400 ms press window …", "the modal reads the fold's live state …", "a fold no longer
  # on the screen …").
  Scenario: With sa_r28_letter_pick on, coach-led, every opening of the fold has its closing in the log
    Given sa_r28_letter_pick is on and the battery is coach-led
    When the coach closes the fold with its own sound button
    Then the log shows the fold closed by that button, then the replay
    And when the coach opens the fold just after an answer, the next item logs the old fold's closing and starts folded
    And a card tapped in the same instant as the fold is opened only closes it
  @e2e @wip @draft @config-gated @P1 @CT265 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js ("ur/en, the coach line
  # (A6): …"; real browser, skipped where none is installed).
  Scenario: With sa_r28_letter_pick on, coach-led, the coach's line keeps whole lines on a small phone
    Given sa_r28_letter_pick is on, the battery is coach-led and the phone is 360 by 640 with the usual Urdu layout settings
    When the coach's line shows above the fold
    Then its lines do not run into each other and its last line is whole, never under the fold
  @e2e @wip @draft @config-gated @P1 @CT270 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js ("ur/en, the served
  # practice (A7): …"; real browser, skipped where none is installed).
  Scenario: With sa_r28_letter_pick on, coach-led, every practice screen fits a small phone with all five cards reachable
    Given sa_r28_letter_pick is on, the battery is coach-led and the phone is 360 by 640 with the usual layout settings
    When the practice example is modelled with its Next showing, with the coach's fold open or closed
    And the practice item is answered wrong, tried again, and answered, with the coach's fold open or closed
    Then the screen never scrolls, all five letter cards can be tapped, and the replay button does not move
    And the feedback line shows whole beside the practice label, and the fold still shows the sound and its letter
  @e2e @wip @draft @config-gated @P1 @CT271 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js ("ur/en, the served
  # practice with the coach's Skip (A8): …" and the tablet row; real browser, skipped where none is installed).
  Scenario: With sa_r28_letter_pick and the coach's Skip instructions on, coach-led, the Skip shares the practice head row on a small phone
    Given sa_r28_letter_pick and sa_r9_skip_instructions are on, the battery is coach-led and the phone is 360 by 640
    When the practice example is modelled and the practice item is heard, answered and tried again, with the fold open or closed
    Then the Skip instructions button shows on one line at its usual size, in the same place in the head row on every practice screen
    And Jugnu, the practice label and the Skip button all sit whole on the screen and can each be tapped
    And the cards, the replay button, the Next button and the fold are where they are without the Skip button
  @e2e @wip @draft @config-gated @P1 @CT272 @no-mock-driver
  # No mock driver: as @CT189. Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js ("… (A8): …").
  Scenario: With sa_r28_letter_pick and the coach's Skip instructions on, coach-led, the try-again line takes the label's place
    Given sa_r28_letter_pick and sa_r9_skip_instructions are on, the battery is coach-led and the phone is 360 by 640
    When the child taps a wrong card on the practice item and Jugnu asks them to try again
    Then the feedback line shows whole beside Jugnu in place of the practice label, and the Skip button is not drawn
    And when the item is shown again the practice label and the Skip button come back in the same place
    And on a tablet the same moment keeps all five cards on screen with nothing scrolling
  @e2e @wip @draft @config-gated @P1 @CT251 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("every rotated variant …"),
  # bot/tests/child-test/sa-r28-mcq-of-all.test.js, portal cohortStats.r28.test.ts and LeaderAssessResults.r28.test.tsx.
  Scenario: With sa_r28_mcq on, a child served a 5-question story is read out of 5, never 6
    Given sa_r28_mcq is on and the phone rotated the child to a story variant with 5 questions
    When the child answers 4 of the 5 questions right
    Then the result records of_all 5, the questions of the served variant before any lost clip
    And the child meets the comprehension rung and counts in the 80%+ share
    And Results reads the guessing floor on 4 of 5
    And the 5-question variant is never padded to 6
  @e2e @wip @draft @config-gated @P1 @CT286 @no-mock-driver
  # No mock driver: as @CT194. Asserted in bot/tests/child-test/sa-r28-mcq-readers.test.js, sa-r28-mcq-gate.test.js,
  # portal LeaderAssessResults.r28.test.tsx and copy.stops.test.ts.
  Scenario: With sa_r28_mcq on, a tapped MCQ the reading floor withheld reads "Not counted" on Results, with no guessing line
    Given sa_r28_mcq is on and the child's passage read stopped on its first line
    And the child tapped all 6 story questions on the phone
    When the coach opens Results for that child
    Then the MCQ row keeps Attempted 6, Correct 0, Options 4 and Chance-corrected 0
    And How it ended reads "Not counted: the reading stopped early (EGRA's rule). Scored 0." and in Urdu "نمبر نہیں گنے گئے: پڑھائی پہلے ہی رک گئی تھی (EGRA کا اصول)۔ نمبر: ۰"
    And no "By guessing alone" line is shown beside it
    And the spoken story questions withheld the same way still read "Questions not asked: the reading stopped early. Scored 0."
    And the child's taps are kept by the server and never shown on the page
    And with sa_r28_mcq off no tapped row ever carries the reading floor's stop
  @e2e @wip @draft @config-gated @P1 @CT255 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("modal fold …").
  Scenario: With sa_r28_mcq on, coach-led, the open coach fold is modal and every opening has its close
    Given sa_r28_mcq is on, the run is coach-led and the coach has opened the fold on a story question
    When the child taps a card, the replay, Jugnu, the Next or anywhere else on the screen
    Then that first tap only closes the fold and the four cards show at once; no answer, no replay, no skip
    And a second tap within 300 ms of the close is ignored and logged as a ghost tap, never scored
    And the next tap after that answers as usual, and the read-out is never interrupted by the fold
    And the screen logs fold_open and fold_close with the task and question, the close saying whether the summary, a tap (and on which card) or the question changing closed it
    And RDF auto never shows the fold, and a card tap there answers at once
  @e2e @wip @draft @config-gated @P1 @CT256 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js (the round 5 browser rows).
  Scenario: With sa_r28_mcq on, coach-led on a 360x640 phone, the coach's Urdu answer list keeps every line whole
    Given sa_r28_mcq is on and a coach-led phone shows any served Urdu story question
    When the coach opens the fold
    Then no line of the answer list touches the next, at least 2 px of clear space between their ink on every served set
    And the open fold stays on the screen, and the English list keeps its own line height
  @e2e @wip @draft @config-gated @P1 @CT257 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js (the round 5 browser rows).
  Scenario: With sa_r28_mcq on, coach-led on a 360x640 phone, the question card keeps its descenders and the coach's line stays whole
    Given sa_r28_mcq is on and a coach-led phone shows any served question
    Then the question card's last line keeps its descenders inside the card and no Urdu question runs past two lines
    And a one-line question keeps its first line's ascenders inside the card
    And the coach's line ends above the fold's box
    And the four answer cards stay 56 px tall and on the screen, nothing scrolls
  @e2e @wip @draft @config-gated @P1 @CT258 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("the coach's Next is in the coach's register …").
  Scenario: With sa_r28_mcq on, coach-led, the coach's Next looks like the coach's and stands away from the child's replay
    Given sa_r28_mcq is on, the run is coach-led and the Next is offered
    Then the Next is a dashed box with no fill, never a pill like the child's replay
    And it stands at least 48 px from the replay on a 360 px phone
  @e2e @wip @draft @config-gated @P1 @CT259 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("?probe=1 …", "chosen_at_option 0 …").
  Scenario: With sa_r28_mcq on, the question itself counts as option 0
    Given sa_r28_mcq is on and the debug probe is on
    When Jugnu reads the question
    Then the probe logs hl 0 when the question's clip starts and ends, and no card lights for it
    And a choice made while a replayed question is read, or before the first answer lights, records chosen_at_option 0
    And a tap during the first reading of the question is still ignored
  @e2e @wip @draft @config-gated @P1 @CT266 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("sa_r28_mcq round 6: the task title …",
  # "ur: every served question and answer set …", "… listening, speaking, chosen, Next offered, fold open …", "modal fold: a double tap …").
  Scenario: With sa_r28_mcq on, the coach-led phone question screen has no task title and every Urdu question is whole
    Given sa_r28_mcq is on and a coach runs the battery on a 360x640 phone
    When any story question is on screen
    Then the task title is not shown (the coach's line names the task and Jugnu says it)
    And no stroke of the Urdu question is cut at the top or bottom of its card, on every served question
    And the lowest answer card's ring ends at least 8 px above the bottom of the screen in every coach state
    And in RDF auto, and on a tablet in either mode, the task title is still shown
    And closing the coach's fold with its own label logs fold_close with card null
  @e2e @wip @draft @config-gated @P1 @CT267 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("ur, the layout switches on: the coach's line keeps ≥ 2 px of ink between its lines …",
  # "en, the layout switches on: the coach's line keeps ≥ 2 px of ink between its lines …").
  Scenario: With sa_r28_mcq on, the coach's Urdu line on the coach-led phone question screen keeps its lines apart and inside its box
    Given sa_r28_mcq is on and a coach runs the battery on a 360x640 phone with the Urdu layout switches
    When a story question is on screen, in any coach state (listening, an answer read, an answer chosen, Next offered, the fold open)
    Then every line of the coach's Urdu line is at least 2 px of ink away from the next one
    And the last line's ink stays inside the coach's line box
    And the coach's line keeps its 13 px size, and the lowest answer card's ring still ends at least 8 px above the bottom of the screen
    And the English coach's line is as it was
  @e2e @wip @draft @config-gated @P1 @CT273 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("ur: every practice state — the head row whole on the phone with the Skip on one line …",
  # "en: every practice state — the head row whole on the phone with the Skip on one line …").
  Scenario: With sa_r28_mcq on, the coach's Skip instructions sits whole in the practice question's top row on a phone
    Given sa_r28_mcq and the coach's Skip instructions are on and a coach runs the practice story question on a 360x640 phone
    When the practice question is on screen, in any practice state (the question read, an answer lit, the answers over, an answer chosen, the feedback shown, the coach's fold open or closed)
    Then Jugnu, the replay button and the Skip instructions button sit in one row inside the screen, each whole and tappable at its centre
    And the Skip instructions button shows its label on one line at its usual size and stays in the same place in every practice state
    And the Practice label gives its place to the Skip instructions button
    And the replay button and the Skip instructions button are at least 24 px apart
    And the question and the answer cards keep their distance from the top row
    And with the coach's fold open, a tap on Skip instructions only closes the fold
    And with the fold closed, a tap on Skip instructions goes to the part's Ready screen and nothing more is read or lit
  @e2e @wip @draft @config-gated @P1 @CT274 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("row 31 (coach-led): the passage step …",
  # "row 31 (RDF auto): the passage step …", "row 31: the child's replay in the passage step …", "row 31 (coach-led, no Skip drawn): the coach's Next …").
  Scenario: With sa_r28_mcq on, the practice story is its own step before the practice question
    Given sa_r28_mcq is on and the practice question has a practice story with its recording
    When the practice question begins, coach-led or on the child's own run
    Then Jugnu reads the practice story with the story on screen and no answer cards
    And a tap on the story does not move on
    And the child's replay button plays the story again and nothing else
    And the question follows when the story's recording ends and a moment has passed, or when the coach taps Next
    And the question screen then shows no story, and the coach's fold shows only the question and the four answers
    And Jugnu reads the question and the four answers as in the scored questions
    And a second try at the practice question does not read the story again
    And the story step is logged once with how long it took
  @e2e @wip @draft @config-gated @P1 @CT275 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("row 31 guard (coach-led): a passage with NO clip key …",
  # "row 31 guard (RDF auto): …", "row 31 guard (…): the passage clip lost at play time …").
  Scenario: With sa_r28_mcq on, a practice story without a recording never shows on its own
    Given sa_r28_mcq is on and the practice story has no recording, or its recording fails to play
    When the practice question begins, coach-led or on the child's own run
    Then the practice question shows at once and Jugnu reads the question and its answers
    And the story never shows with the answer cards and nothing waits for a tap
    And the story step is logged once as having no recording
  @e2e @wip @draft @config-gated @P1 @CT276 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("ur, with the Skip: the passage step whole with no cards, then all eleven practice question frames …",
  # and the same for "ur, without the Skip", "en, with the Skip", "en, without the Skip").
  Scenario: With sa_r28_mcq on, the practice question fits a coach's phone in Urdu and English
    Given sa_r28_mcq and the production screen settings are on and a coach runs the practice story question on a 360x640 phone, with or without Skip instructions
    When the practice story or the practice question is on screen, in any practice state (the story read, the question read, an answer lit, the answers over, an answer chosen, the feedback shown, the right answer shown, the coach's fold open or closed)
    Then the screen does not scroll and the story shows whole on its own step
    And all four answer cards are whole and tappable at their centres, the lowest card's ring at least 8 px above the bottom
    And the top row is the same height in every state, so the question and the cards never move
    And the feedback line shows under the cards without pushing them
    And the coach's open fold stays on the screen
  @e2e @wip @draft @config-gated @P1 @CT277 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("row 32 (coach-led, round 11): …",
  # the "[prod] ur …" browser rows of the coach-led phone (scored states, the per-question sweep with the fold's scroll and summary, the practice frames)).
  Scenario: With sa_r28_mcq on, the coach's fold on a phone's Urdu question screens holds the question and answers and never scrolls
    Given sa_r28_mcq and the production screen settings are on and a coach runs the story questions in Urdu on a 360x640 phone inside the coach page, with a session syncing
    When a practice or scored question is on screen
    Then the coach's fold holds the question and the four answers, the question first
    And its folded title «جگنو پوچھے گا — یہ آپ نہ پڑھیں:» is the coach's visible line, whole, with the fold closed and open
    And the open fold's body never scrolls (its scroll height equals its height) and ends on the screen
    And the coach's line «جگنو سوال اور چاروں جواب خود پڑھے گا۔ …» shows above the fold on the practice story's own step, before any question
    And on a tablet, or in English, the coach's line stays above the fold as before
  @e2e @wip @draft @config-gated @P1 @CT278 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js (every "[prod] …" and "[prod_notoggle] …" browser row: the coach page's frame, the sync dot, the language switch drawn or not).
  Scenario: With sa_r28_mcq on, the story questions fit a coach's phone inside the coach page while a session syncs
    Given sa_r28_mcq and the production screen settings are on and a coach runs the story questions on a 360x640 phone inside the coach page, with a session syncing, with or without the other language ready
    When a practice or scored question is on screen in any state, in Urdu or English
    Then the screen does not scroll and no scroll cue shows
    And all four answer cards are whole and tappable at their centres, the lowest card's ring at least 8 px above the bottom
    And the practice feedback line shows on the screen under the cards
    And nothing the child or the coach taps lies under the coach page's own buttons or the sync dot
    And the same holds on the page without the coach page's frame
  @e2e @wip @draft @config-gated @P1 @CT252 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-skip-wait.service.test.js.
  Scenario: With sa_r28_letter_pick or sa_r28_mcq on, a skipped item says how long the child had
    Given sa_r28_letter_pick or sa_r28_mcq is on and an item's sound (or the fourth option) has finished playing
    When the item is skipped with Next, the child's own run or the coach's
    Then the answer is recorded as skipped, not right
    And it carries wait_ms, the time from the end of the last play to the skip
    And a stuck child on the child's own run reads 30 seconds or more, a coach's quick Next a few seconds
    And every other tapped task records a skipped item exactly as today
  @e2e @wip @draft @config-gated @P1 @CT194 @no-mock-driver
  # No mock driver: the story's questions run on the child's assessment page, not in the chat.
  # Asserted in dashboard/tests/sa-r28-mcq.service.test.js.
  Scenario: With sa_r28_mcq on, Jugnu reads the question and then each of the four answers with its card lit
    Given sa_r28_mcq is on and a child has read the story
    When a story question shows
    Then Jugnu reads the question while the four answer cards are dimmed and taps do nothing
    And Jugnu then reads the four answers in order, each card lit only while its own recording plays
    And after the last answer every card is ready, no card is lit and the replay button works
    And with sa_r28_mcq off the story's questions are asked aloud and answered aloud as before

  @e2e @wip @draft @config-gated @P1 @CT195 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js.
  Scenario: With sa_r28_mcq on, a tap while the answers are read is held and the reading goes on
    Given sa_r28_mcq is on and a story question is being read
    When the child taps an answer card while Jugnu is reading the answers
    Then that card stays chosen and Jugnu still reads every remaining answer
    And the chosen card is filled in the battery's colour, the brightest card on the screen, while the card being read has only a ring around it
    And a tap on another card before the choice stands moves the choice and is counted as a change
    And the choice stands 600 ms after the last answer has been read, and only then is it scored
    And a child who has not tapped by then can tap a card, which stands 600 ms later

  @e2e @wip @draft @config-gated @P1 @CT196 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js.
  Scenario: With sa_r28_mcq on, the replay reads the question and all four answers again and keeps the choice
    Given sa_r28_mcq is on and Jugnu has finished reading a question and its answers
    When the child presses the replay button or taps Jugnu
    Then Jugnu reads the question and the four answers again, each card lit in turn
    And the replay button cannot be pressed while that reading runs
    And a card the child had chosen stays chosen
    And the cards are never greyed out during the replay: a tap, even while the question is read again, is a choice that stands 600 ms after the reading ends
    And only the first reading of a question keeps the cards grey and ignores taps
    And neither Next nor the automatic replay comes during the replay: both wait their full time again from the end of the replay

  @e2e @wip @draft @config-gated @P1 @CT197 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js.
  Scenario: With sa_r28_mcq on, the phone scores each answer and asks the same questions as before
    Given sa_r28_mcq is on
    When the child's story reading allows some of its questions
    Then the same questions are asked as the spoken questions would have been
    And each answer is scored on the phone as right or wrong, with which answer was playing at the first tap, how many times the choice changed and how many replays there were
    And a question the child does not answer offers Next after the wait, and Next counts it as wrong
    And a child who read fewer than 10 words, or stopped on the story's first line, is asked no question, coach-led too
    And a question whose recording cannot be played is left out: not asked, not wrong, and the next question shows
    And when fewer than 4 questions could be played the part is kept but not rated

  @e2e @wip @draft @config-gated @P2 @CT198 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js.
  Scenario: With sa_r28_mcq on, a coach-led test still has Jugnu read the questions and answers
    Given sa_r28_mcq is on and the test is coach-led
    When a story question shows
    Then Jugnu reads the question and the four answers from the phone
    And the coach's screen shows the question and the answers folded away, without marking the right one

  @e2e @wip @draft @config-gated @P1 @CT253 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js (the coach-led phone fit runs in a
  # real browser when playwright-core is present).
  Scenario: With sa_r28_mcq on, a coach-led story question fits a 360x640 phone in every coach state
    Given sa_r28_mcq is on, the test is coach-led on a 360x640 phone and the question is the bank's longest
    When Jugnu reads the question, then each answer, the child holds an answer, the Next is offered, and the coach opens the fold
    Then the four answer cards and the replay are whole on the screen and stay in the same place in every one of those states, with nothing to scroll
    And the coach's Next shows in the row with the replay, never below the cards, and the open fold lies over the screen without pushing the cards
    And the coach's line reads "Jugnu reads the question and all four answers. Do not read, translate or give the answer. Let the child tap the answer." and in Urdu «جگنو سوال اور چاروں جواب خود پڑھے گا۔ آپ نہ پڑھیں، نہ ترجمہ کریں، نہ جواب بتائیں۔ بچے کو خود جواب دبانے دیں۔»
    And with sa_r28_mcq off neither that line nor the old one shows

  @e2e @wip @draft @config-gated @P1 @CT254 @no-mock-driver
  # No mock driver: as @CT194. Asserted in dashboard/tests/sa-r28-mcq.service.test.js.
  Scenario: With sa_r28_mcq on, every story and story-question result names the version of the story the child had
    Given sa_r28_mcq is on and the battery rotates between versions of the story
    When a child reads the story and answers its questions
    Then the story's result and the questions' result both name the version this phone showed, the same one
    And with no rotation both results say no version (null), never leave it out
  @e2e @wip @draft @config-gated @P1 @CT208 @no-mock-driver
  # No mock driver: the portal reads the server's results. Asserted in portal/src/portal/lib/assess/cohortStats.r28.test.ts,
  # portal/src/portal/pages/LeaderAssessDashboard.r28.test.tsx, portal/src/portal/pages/LeaderAssessResults.r28.test.tsx
  # and bot/tests/child-test/sa-r28-results-detail.test.js.
  Scenario: the round-28 tapped tasks carry their own labels and rows on Results and the dashboard, never merged with the old ones
    Given sa_r28_letter_pick and sa_r28_mcq are on and some children took the tapped letter-sounds and story-question tasks
    When a coach opens the results dashboard and a child's Results
    Then the tapped tasks show as "Letter sounds (listen and tap)" and "Story questions (listen and tap)" in English, and in Urdu «حروف کی آوازیں (سن کر ٹیپ)» and «کہانی کے سوال (سن کر ٹیپ)»
    And the old spoken tasks keep their titles and their own rows, and a tapped task's card shows only when a child in view has a score for it
    And a tapped task the child heard too few items of says "not rated (too few items heard)" and shows no score
    And a timed task that ran past its first items shows "First N correct" beside its rate

  @e2e @wip @draft @config-gated @P1 @CT243 @no-mock-driver
  # No mock driver: the portal reads the server's results. Asserted in portal/src/portal/lib/assess/cohortStats.r28.test.ts
  # and portal/src/portal/pages/LeaderAssessDashboard.r28.test.tsx.
  Scenario: the dashboard's "reading with comprehension" is reported per form, spoken and tapped, never one pooled share
    Given sa_r28_mcq is on and some children in view answered the spoken story questions and others the tapped ones
    When a coach opens the results dashboard
    Then the headline shows two numbers side by side, labelled "spoken" and "listen and tap" (Urdu «بول کر» and «سن کر ٹیپ»)
    And each sub-region or school row shows the same two numbers, never one merged number
    And a cohort with only one form shows that one number in today's tile
    And a tapped task the child heard too few items of counts in neither number

  @e2e @wip @draft @config-gated @P1 @CT244 @no-mock-driver
  # No mock driver: as @CT243. Asserted in portal/src/portal/lib/assess/guessFloor.test.ts,
  # portal/src/portal/pages/LeaderAssessDashboard.r28.test.tsx, portal/src/portal/pages/LeaderAssessResults.r28.test.tsx
  # and bot/tests/child-test/sa-r28-results-detail.test.js.
  Scenario: every tapped score says how many children reach it by guessing alone, and the picker says how often children tapped before the sound
    Given sa_r28_letter_pick and sa_r28_mcq are on and at least 5 children in view took the tapped tasks
    When a coach opens the results dashboard or a child's Results
    Then the story-questions card says "By guessing alone, 3.8% of children reach 4 of 6."
    And the letter-sounds card says how many reach 8 of 10 and 6 of 10 by guessing alone
    And the dashboard's letter-sounds card shows the share of taps made before the sound, and "read with care" above 10%
    And a child's Results shows that child's own count, as "Taps before the sound: 1 of 10"
    And no score, band or level changes, and a card hidden for fewer than 5 children shows neither line

  @e2e @wip @draft @config-gated @P1 @CT214 @no-mock-driver
  # No mock driver: the Results level lines are computed on the server. Asserted in bot/tests/child-test/sa-r28-ceiling.test.js.
  Scenario: With sa_r28_mcq on, the story questions picked from four are judged out of six, less the questions whose sound was lost
    Given sa_r20_level and sa_r28_mcq are on
    When a child answered the story questions picked from four
    Then the comprehension level is met at two thirds of 6 questions, less any question whose sound could not be played
    And a question the reading gate did not ask counts as not right
    And a child asked 3 questions who got 2 right does not meet it, and a child asked 6 with 1 lost who got 4 right does

  @e2e @wip @draft @config-gated @P1 @CT215 @no-mock-driver
  # No mock driver: as @CT214. Asserted in bot/tests/child-test/sa-r28-ceiling.test.js.
  Scenario: A part with too few items presented is left out of the level, never shown as waiting
    Given sa_r20_level is on
    When a child's letter picker presented too few letters to be rated, and the letter names were 2 of 5
    Then the letters level is not met and the line is not waiting for a score
    And a subject whose level parts were all too short to rate says so, with no level and nothing waiting

  @e2e @wip @draft @config-gated @P1 @CT216 @no-mock-driver
  # No mock driver: the scoring sweep runs against a model. Asserted in bot/tests/child-test/sa-r28-ceiling.test.js.
  Scenario: With sa_r28_ceiling on, a timed task without the phone's clock gets no rate until the clock is known
    Given sa_r28_ceiling is on
    When a timed task's result arrives without the time used, whether or not it went past today's items
    Then the task is scored but its rate is left waiting, never worked out on an assumed minute
    And with sa_r28_ceiling off the rate uses the minute as today and the marks say the minute was assumed

  @e2e @wip @draft @config-gated @P1 @CT245 @no-mock-driver
  # No mock driver: the scoring sweep runs against a model. Asserted in bot/tests/child-test/sa-r28-base-served.test.js
  # and dashboard/tests/sa-r28-base-served.service.test.js.
  Scenario: With sa_r28_ceiling on, the words task's first-words anchor is the five words the child was served
    Given sa_r28_ceiling is on
    And sa_r8_counts is on, so every child is served a fifth word
    When a child reads past the fifth word before the minute ends
    Then the words rung, the first-words count and the first-line rule all read the first five words, as today's five
    And with sa_r8_counts off they read the first four words the child was served

  @e2e @wip @draft @config-gated @P1 @CT279 @no-mock-driver
  # No mock driver: the coach's fold and the picker run on the phone screen (the battery engine), not in the chat.
  # Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js ("since_fold_ms: ...").
  Scenario: With sa_r28_letter_pick on, each scored letter answer says how long after the coach's fold closed it came
    Given sa_r28_letter_pick is on and the test is coach-led
    When the coach opens and closes the fold on an item and the child taps a letter 400 ms later
    Then that answer keeps since_fold_ms 400
    And a tap within the ghost window after the close writes no answer at all
    And an answer on an item where no fold closed keeps since_fold_ms null, as does every answer in RDF auto
    And practice answers do not carry it, and with sa_r28_letter_pick off the answer has no since_fold_ms

  @e2e @wip @draft @config-gated @P1 @CT280 @no-mock-driver
  # No mock driver: as @CT279. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("since_fold_ms: ...").
  Scenario: With sa_r28_mcq on, each scored story-question answer says how long after the coach's fold closed it came
    Given sa_r28_mcq is on and the test is coach-led
    When the coach closes the fold on a question and the child's answer that stands is tapped about 400 ms later
    Then that answer keeps since_fold_ms of about 400
    And an answer on a question where no fold closed keeps since_fold_ms null
    And with sa_r28_mcq off the answer has no since_fold_ms

  @e2e @wip @draft @config-gated @P1 @CT281 @no-mock-driver
  # No mock driver: needs real pixels on a 360x640 phone. Asserted in dashboard/tests/sa-r28-pick-back.service.test.js.
  Scenario: With sa_r28_letter_pick or sa_r28_mcq on, their item screens have no Back, so a phone keeps every card and the replay in reach
    Given sa_back_button is on, with every switch the tier serves
    And sa_r28_letter_pick and sa_r28_mcq are on
    When a child on a 360x640 phone reaches the second letter-sound item, or the second story question, coach-led or RDF auto
    Then no Back button is drawn on that screen
    And all five letter cards and the replay button can be tapped without scrolling, on every item from the first to the tenth
    And every other task keeps its Back, and with both switches off the Back is drawn as before

  @e2e @wip @draft @config-gated @P1 @CT282 @no-mock-driver
  # No mock driver: needs real pixels on a 360x640 phone. Asserted in dashboard/tests/sa-audio-check-fit.service.test.js.
  Scenario: With sa_r28_check_fit on, the Urdu sound check fits a 360x640 phone, both pictures tappable without scrolling
    Given sa_ur_fit and sa_r8_layout are on, with every switch the tier serves
    And sa_r28_check_fit is on
    When a child on a 360x640 phone in the coach page's frame reaches the Urdu sound check, coach-led or RDF auto
    Then both picture tiles, the replay button and "I can't hear" are whole on screen and can be tapped without scrolling
    And no scroll cue is drawn
    And with sa_r28_check_fit off the screen is as today, and the English phone and the tablet are unchanged either way

  @e2e @wip @draft @config-gated @P1 @CT283 @no-mock-driver
  # No mock driver: needs real pixels on a 360x640 phone. Asserted in dashboard/tests/sa-r28-pick-auto-practice.service.test.js.
  Scenario: With sa_r28_letter_pick on, the letter-sound practice example in RDF auto fits a 360x640 phone without scrolling
    Given sa_r28_letter_pick is on, with every switch the tier serves
    When a child alone (RDF auto) on a 360x640 phone sees the letter-sound practice example, modelled with the pointing hand, and then tries one
    Then nothing scrolls on any practice screen, all five letter cards are whole and can be tapped, and the replay and Next are in reach
    And no scroll cue is drawn, and the tablet reads the same

  @e2e @wip @draft @config-gated @P1 @CT284 @no-mock-driver
  # No mock driver: needs real pixels on a 360x640 phone. Asserted in dashboard/tests/sa-r28-pick-auto-offer.service.test.js and sa-r28-mcq-auto-phone.service.test.js.
  Scenario: With sa_r28_letter_pick or sa_r28_mcq on, a child alone (RDF auto) sees Next in the head row, and nothing on the screen moves when it is offered
    Given sa_r28_letter_pick and sa_r28_mcq are on, with every switch the tier serves
    When a child alone on a 360x640 phone leaves a letter-sound item, or a story question, unanswered until Next is offered
    Then Next is drawn in the head row beside Jugnu, in a place held for it since the item opened, never at the foot
    And every letter card, every option, the replay and Next can be tapped without scrolling, and no scroll cue is drawn
    And nothing else on the screen changes its place when Next appears, in Urdu and in English

  @e2e @wip @draft @config-gated @P1 @CT291 @no-mock-driver
  # No mock driver: needs real pixels on a 360x640 phone. Asserted in dashboard/tests/sa-r28-mcq.service.test.js ("RDF auto on a 360x640 Urdu phone").
  Scenario: With sa_r28_mcq on, the Urdu story question's card holds both lines of a two-line question in RDF auto on a phone
    Given sa_r28_mcq is on, with every switch the tier serves
    When a child alone (RDF auto) on a 360x640 phone reaches an Urdu story question that runs to two lines
    Then both lines of the question are drawn inside the question's card, while Jugnu reads it, after the read-out and once Next is offered
    And no part of the question's writing runs into the gap above the first answer
    And the four answer cards are whole and can be tapped without scrolling while the question is read and answered
    And coach-led, English and the tablet are unchanged, and with sa_r28_mcq off the screen is as today

  @e2e @wip @draft @config-gated @P1 @CT246 @no-mock-driver
  # No mock driver: the prompt is sent in the scoring sweep to a model, not in the chat.
  # Asserted in bot/tests/child-test/sa-r28-words-prompt.test.js.
  Scenario: With sa_r28_words_prompt on, a familiar-words recording is marked as a list of words shown one at a time, with the accent rule
    Given sa_r28_words_prompt is on
    When a familiar-words recording is scored
    Then the model is shown the words as a numbered list, one per line, shown one at a time, not as a story
    And it is told that a local accent that keeps the same word is correct, and any accepted forms of a word are listed beside it
    And the speech gate, the marks, the words per minute and the first-row stop work as before
    And with sa_r28_words_prompt off the prompt and the marks are exactly as before

  @e2e @wip @draft @config-gated @P1 @CT300 @no-mock-driver
  # No mock driver: as @CT246. Asserted in bot/tests/child-test/sa-r28-words-prompt.test.js.
  Scenario: With sa_r28_words_prompt and sa_r28_ceiling on, the model is given only the words the child reached
    Given sa_r28_words_prompt and sa_r28_ceiling are on
    And a child reached 7 words of a 20-word list whose first 4 are today's words
    When the familiar-words recording is scored
    Then the model is shown words 1 to 7 only, each with its own accepted forms beside it
    And a child who reached fewer than today's 4 words is shown today's 4
    And a word list without today's count is shown whole, as before

  @e2e @wip @draft @config-gated @P1 @CT301 @no-mock-driver
  # No mock driver: as @CT246. Asserted in bot/tests/child-test/sa-r28-words-prompt.test.js.
  Scenario: With sa_r28_words_prompt and sa_r8_counts on, the fifth word keeps its accepted forms
    Given sa_r28_words_prompt and sa_r8_counts are on
    And the spare word that becomes today's fifth word has accepted forms
    When the familiar-words recording is scored
    Then the model is shown the fifth word with its accepted forms beside it
    And a spare word without accepted forms is served and listed exactly as before

  @e2e @wip @draft @config-gated @P1 @CT287 @no-mock-driver
  # No mock driver: the practice runs on the child's phone screen (the battery engine), not in the chat.
  # Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js and sa-r28-mcq.service.test.js.
  Scenario: With sa_r28_letter_pick on, Jugnu says the practice feedback in coach-led as in RDF auto
    Given sa_r28_letter_pick is on and a coach-led child is on the letter-sound picker's practice
    When the child taps a wrong card
    Then Jugnu says "try again" and the line also shows on the screen
    And after a second wrong tap Jugnu says the line naming the sound and the right card is shown
    And after a right tap Jugnu says the right line
    And the feedback stays on the screen until Jugnu's line ends, and never less than 1.2 seconds
    And with sa_r28_mcq on the spoken MCQ's practice feedback is said by Jugnu in coach-led the same way
    And today's tap practice in coach-led stays silent, its feedback read by the coach from the screen
    And with sa_r28_letter_pick and sa_r28_mcq off the battery runs exactly as before


  @e2e @wip @draft @P2 @CT288 @no-mock-driver
  # No mock driver: the service worker's offline copy runs on the phone (the battery engine), not in the chat.
  # Asserted in dashboard/tests/sa-r28-timings-index.service.test.js and sa-r28-prompt-timings-offline.service.test.js.
  Scenario: A session page asks only for the word-timing files that exist, and the letter picker's prompt timings first
    Given the battery's clips are served from sa/v4 and its letter-sound prompts from sa/v5
    When the child's page, or the coach's Get ready, prepares the session for offline
    Then sa/v5/prompt_timings.json is asked for before any clip
    And the v4 word-timing files asked for are exactly those dashboard/sa/timings.index.json lists, none beside a clip that has none
    And when the index cannot be read, no v4 word-timing file is asked for and prompt_timings.json still is
    And no screen and no score changes

  @e2e @wip @draft @config-gated @P1 @CT289 @no-mock-driver
  # No mock driver: the instruction is said on the child's phone screen (the battery engine), not in the chat.
  # Asserted in dashboard/tests/sa-r28-letter-pick.service.test.js and sa-r28-mcq.service.test.js.
  Scenario: With sa_r28_letter_pick on, Jugnu says the picker's instruction in coach-led as in RDF auto
    Given sa_r28_letter_pick is on and a coach-led child reaches the letter-sound picker
    When the coach's screen for the picker shows
    Then Jugnu says the picker's instruction with its example sound, instead of saying that the coach will instruct
    And the coach's own line is still drawn on the coach's screen
    And on the ready screen Jugnu says the ready lines as in RDF auto
    And with sa_r28_mcq on the spoken MCQ's instruction and ready lines are said by Jugnu in coach-led the same way
    And every other task's instruction in coach-led stays the coach's to read, Jugnu saying only that the coach will instruct
    And with sa_r28_letter_pick and sa_r28_mcq off the battery runs exactly as before

  @e2e @wip @draft @config-gated @P1 @CT290 @no-mock-driver
  # No mock driver: the practice runs on the child's phone screen (the battery engine), not in the chat.
  # Asserted in bot/tests/child-test/sa-r28-bank.test.js and dashboard/tests/sa-r28-letter-pick.service.test.js.
  Scenario: With sa_r28_letter_pick on, the picker's practice names the sound after a second wrong tap
    Given sa_r28_letter_pick is on and a child is on the letter-sound picker's practice, coach-led or alone
    When the child taps a wrong card twice
    Then Jugnu says "The sound of this letter is:" and then the same sound the child just heard, and the right card is shown
    And the sound is never a letter's name
    And in Urdu Jugnu says «اس حرف کی آواز ہے:» and then the sound the same way
    And when the child taps the right card Jugnu says the right line as today, without repeating the sound
    And with sa_r28_letter_pick off the battery runs exactly as before

  @e2e @wip @draft @config-gated @P1 @CT292 @no-mock-driver
  # No mock driver: as @CT246. Asserted in bot/tests/child-test/sa-r28-ceiling-no-response.test.js.
  Scenario: With sa_r28_ceiling on, a grid cell shown and passed in silence is marked wrong, not unreached
    Given sa_r28_ceiling is on
    And a child read 5 cells of a 100-cell letter grid, let 30 more pass in silence, and the clock ended before the other 65 were shown
    When the letter-names recording is scored
    Then 5 cells are correct, 35 are attempted and the 30 silent cells are wrong with the reason no response
    And the 65 cells never shown are not counted as attempted
    And the rate stays 5 a minute and today's first-5 score stays 5 of 5
    And a final cell on show under half a second at time up is still not counted as attempted
    And a recording with no speech at all leaves every cell unreached, never wrong
    And with sa_r28_ceiling off, or on a grid that does not extend, the marks are exactly as before

  @e2e @wip @draft @config-gated @P1 @CT293 @no-mock-driver
  # No mock driver: the coach's press-and-hold menu inside the engine page. Asserted in
  # dashboard/tests/sa-r28-end-task-copy.service.test.js (the switch, the route's read and the menu's label).
  Scenario: With sa_r28_end_task_copy on, the coach's hold menu says End this task in Urdu in words of its own
    Given sa_r28_end_task_copy is on and a coach runs the test in Urdu
    When the coach presses and holds the corner on any coach-led screen
    Then the menu's button that ends the test reads «یہ کام ختم کریں»
    And it no longer reads «یہ حصہ ختم کریں», the words of the portal's End this section button, which is unchanged
    And in English the button reads "End this task", with the switch on or off
    And with sa_r28_end_task_copy off, or its row holding anything but true, the Urdu button reads «یہ حصہ ختم کریں» as before

  @e2e @wip @draft @config-gated @P2 @CT295 @no-mock-driver
  # No mock driver: the spoken MCQ screen inside the engine page. Asserted in
  # dashboard/tests/sa-r28-mcq-nowrap.service.test.js.
  Scenario: With sa_r28_mcq on, a name or paired phrase in an Urdu story question or answer never splits across two lines
    Given sa_r28_mcq is on and a child takes the Urdu story questions on a phone
    When the question «بلال کس کے ساتھ دریائے جہلم گیا؟» is shown and Jugnu reads it
    Then «دریائے جہلم» sits on one line, before Jugnu starts and after he has said «جہلم»
    And an answer such as «رنگ برنگے پھول» keeps «رنگ برنگے» on one line
    And the coach's folded copy of the question and answers keeps the same words together
    And two words that are not on the list, such as «گئے» and the word after it, can still break as before
    And the words shown, and so the clip Jugnu plays, are exactly the same as before
    And the story passage the child reads is unchanged
    And with sa_r28_mcq off the battery runs exactly as before

  @e2e @wip @draft @config-gated @P2 @CT296 @no-mock-driver
  # No mock driver: the engine page's layout on a phone. Asserted in dashboard/tests/sa-r28-mcq.service.test.js
  # (real Chromium, 360×640 at DPR 3 and 2, the coach page's frame, both tiers' switches).
  Scenario: With sa_r28_mcq on, a two-line Urdu story question in RDF auto keeps its two lines apart on a phone
    Given sa_r28_mcq is on and a child answers the Urdu story questions alone (RDF auto) on a 360×640 phone
    When a question that takes two lines is on the screen, such as «بلال کس کے ساتھ دریائے جہلم گیا؟»
    Then the second line's letters start below the first line's and never run into them
    And the four answers, the replay and the Next offered later are all on the screen and tappable, with nothing to scroll
    And the coach-led phone and the tablet show the question exactly as before
    And with sa_r28_mcq off there is no story question screen and nothing changes

  @e2e @wip @draft @config-gated @P1 @CT297 @no-mock-driver
  # No mock driver: a weak link that starts a clip and then stops feeding it. Asserted in
  # dashboard/tests/sa-r28-clip-stall.service.test.js (the real voice with a stub audio, and the picker and MCQ screens).
  Scenario: A picker sound or a story question whose clip starts and then stalls is given up, not scored as heard
    Given sa_r28_letter_pick or sa_r28_mcq is on and the phone's link is weak
    When an item's sound or a question's read-out starts and then makes no progress for 5 seconds
    Then Jugnu tries the clip once more from the start
    And if it stalls again the item is set aside as unavailable within about 11 seconds: not asked, not counted, never wrong
    And a tap the child makes while that first play is stalled is dropped, never held or scored
    And a clip that plays slowly but keeps moving, or pauses for 3 seconds and then plays on, is heard as before
    And a stall on a replay the child asked for only ends that replay: the item stays open and the next tap scores
    And a line not marked clip-only still waits up to 60 seconds as before

  @e2e @wip @draft @config-gated @P1 @CT298 @no-mock-driver
  # No mock driver: the minute is the scorer's, on a recording already uploaded. Asserted in
  # bot/tests/child-test/sa-r28-story-minute.test.js (the real scoring path, the clip and the model stand-ins).
  Scenario: With sa_r28_story_minute on, a child who stops the story before its last line is rated on the full minute
    Given sa_r28_story_minute is on
    When a child taps "done" on the story after 9 seconds having read 11 of its 60 words, all correctly
    Then the story's reading rate is 11 words a minute, not 75, and the marks say the full minute was used
    And a child who reached the first word of the passage's last printed line, by the recording or by the last word tapped, is rated on the time actually used and the marks say the last line was reached
    And the last line is read from the passage variant the child was shown, never a fixed word count
    And a run that ended when the minute ran out, a run stopped on the first line, and a run without the phone's clock are scored exactly as before
    And the letters, words and maths timed tasks are scored exactly as before
    And with sa_r28_story_minute off every story's marks are exactly as before and carry no minute stamp

  @e2e @wip @draft @config-gated @P1 @CT299 @no-mock-driver
  # No mock driver: the engine page's layout on a phone. Asserted in
  # dashboard/tests/sa-r28-mcq-auto-practice.service.test.js (real Chromium, 360×640 at DPR 3 and 2, the coach page's
  # frame, both tiers' switches; the tablet as the control).
  Scenario: With sa_r28_mcq on, the Urdu story questions' practice in RDF auto fits a phone like the scored questions
    Given sa_r28_mcq is on and a child answers the Urdu story questions alone (RDF auto) on a 360×640 phone
    When the practice question is read out, waits for a tap, takes the child's answer and gives its feedback
    Then all four answers are whole on the screen and tappable, with nothing to scroll and no scroll cue
    And the head row (Jugnu, the practice chip, the replay) is no taller than on the scored questions
    And the four answers stay 56 px tall and at least 8 px apart, on the practice and on the scored questions
    And English, the coach-led phone and the tablet show these screens as before
    And with sa_r28_mcq off there is no story question screen and nothing changes
