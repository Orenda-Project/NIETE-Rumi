@whatsapp @ict @profile:niete @feature:child-test @persona:coach
Feature: NIETE (ICT) WhatsApp bot — Child test (/egra, the coach's five-minute EGRA/EGMA test per child)
  # Non-determinism: see .claude/qa/shared/non-determinism-contract.md (assert contracts/shape; AI marks are @content-driven).
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
