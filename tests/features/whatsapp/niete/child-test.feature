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
  # project folder (golive/fixtures/), never in git; refer to children by roll number in assertions.
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
    Given the NIETE bot chat is open on a COACH account in an ICT region, with the child test enabled
    When I submit the observe2 "What Rumi heard" check and the brief arrives
    Then the next message is the offer "Test 5 children now? About 25 minutes." with buttons "Yes, test now" and "Not now"
    And the "Yes, test now" button id is "ctst_offer:<kind>:<visit id>" for this visit's observation_field_forms row
    # L4: sent right after sendBrief in observe2-check-endpoint.js; string key childTestOfferBody.

  @e2e @wip @draft @destructive @config-gated @P1 @CT03
  Scenario: Today's list shows five drawn children with roll numbers, the returning child marked, and two alternates
    Given a COACH account in an ICT region at the SIM school on a visit day, with the child test enabled
    When I open today's list
    Then one interactive list arrives headed "Grade <3|5> · Class <section>" with a "Today's children" section of 5 rows "Roll <n> · <name>" and an "Alternates" section of 2 rows
    And each child row is marked "New" or "Returning (Form B)"
    And the body says the children were picked by the server and cannot be changed, and "Done: 0 of 5"
    And child_test_draws holds those 7 children with list_slot main/alternate and last_listed_visit_id = this visit
    # In the first weeks of a cycle no child is eligible to return, so all 5 are "New" (CT11).
    # L3 draw.todaysList; L4 machine.js list rows ctst_child:<drawId> / ctst_alt:<drawId>.

  @e2e @wip @draft @destructive @config-gated @P1 @CT04
  Scenario: Tapping a present child sends the Urdu coach script with the exact cue phrase and waits for one voice note
    Given today's list is open
    When I tap the first child and tap "Present"
    Then a child_test_sessions row is created for that draw with status "in_progress"
    And the next message is ONE line "Child 1 of 5 · Urdu 1/3 · Form <A|B> card, Urdu page · Say «<item-bank cue.urdu.start>» · one locked note, flip pages without stopping"
    And a second line says "Give Roll <next child's roll> the maths strip to write while waiting."
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
    Then the bot acknowledges "🎧 Got it · Maths" and says "Roll <n>'s strip: send its photo once it is written, or send all the strips at the end. Tap the next child now.", with a "No strip photo" button
    And maths ai_status stays "pending" with reason "awaiting_photo" and ai_marks is still empty
    When I send a photo of the maths strip
    Then the bot replies "📷 Strip saved for Roll <n>." and then "All three parts for Roll <n> are in"
    And child_test_blocks.photo_r2_key = child-test/<env>/<school_id>/<session_id>/maths-strip.jpg and maths is scored once, with both the spoken and the written items
    # CR-1 (CONTRACT §10): maths ai_marks are written only when audio AND photo are both present.

  @e2e @wip @draft @flow @destructive @config-gated @P1 @CT07
  Scenario: When a child's marks are in, a Check button opens a pre-filled check Flow
    Given child 1's three blocks are scored
    Then the bot sends a check message for Roll <n> with the child's three headline numbers and the button «جانچ کریں»
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
    Then the bot replies "Roll <n> <recorded>" and "Roll <alt> from the alternates joins today's list."
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
    Then the photo is saved to child 1's maths block, not child 2's, with "📷 Strip saved for Roll <child 1>."
    And child 2 is still waiting on its English block
    # L4: the photo state is per session, not per "current child".

  @e2e @wip @draft @destructive @config-gated @P2 @CT16
  Scenario: A strip photo that never comes is scored with force, written items left for the coach
    Given child 1 has sent the maths voice note
    When I tap "No strip photo"
    Then the bot replies "OK, no strip photo for Roll <n>. The written sums stay blank."
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
    Then the bot replies "Roll <n> is already done today." and no second session is created
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
  Scenario: The list tells the coach to give the class teacher the roll numbers in order, and "Send to teacher" sends them
    Given today's list is open after an observe2 visit of the class teacher of the drawn class
    Then the list body says "Give the class teacher these roll numbers, in this order, to send one child at a time: <rolls>"
    And one message with a "Send to teacher" button follows, once per visit
    When I tap "Send to teacher"
    Then the class teacher receives ONE message with "Roll <n> (<name>)" for each child still to test, in list order
    And I get "Sent the order to the class teacher." and nobody outside the visit is messaged
    # The button appears only when class_teachers links the observed teacher to a class on the list; the
    # tap re-checks it. A failed send says "I couldn't reach the class teacher on WhatsApp…".

  @e2e @wip @draft @destructive @config-gated @P1 @CT34
  Scenario: Strip photos are claimed in list order, any time during the visit or as a batch at the end
    Given child 1 is present, so Roll <child 2> was handed the strip to write while waiting
    When I send two strip photos during child 1's Urdu block
    Then the first is saved for child 1's session and the second is held for child 2 under child-test/<env>/<school_id>/held/<draw_id>/maths-strip.jpg
    And child 1's maths voice note finishes child 1 at once (no strip ask), and child 2's held strip is attached when child 2 is marked "Present"
    When the last child's maths note arrives and strips are still missing
    Then the bot says "Send the strip photos now, one per child, in list order: Roll …"
    And each photo I send is claimed for the oldest child on the list whose strip is missing, and maths is scored once with force

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
    Then the bot replies "Roll <roll>'s three voice notes are already in, so I did not use this one."
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
