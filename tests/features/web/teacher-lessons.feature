Feature: Teacher lesson plans
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- teacher-lessons`. Covers: portal/src/portal/teacher/lessons/**, PortalCurriculum.tsx, PortalLessonPlans.tsx.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @TL01
  Scenario: Teacher app v2: Lesson Plans lists her recent lesson plans
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher/lessons
    Then Lesson Plans shows "Recent Lesson Plans" with at least one

  @TL02
  Scenario: Classic portal: the curriculum opens, and the old /portal/lesson-plans link lands there
    Given the teacher app v2 and the coach app v2 are off
    And demo teacher 03000000911 is signed in
    When she opens /portal/curriculum
    Then the curriculum page "Lesson Plans" opens
    When she opens /portal/lesson-plans
    Then /portal/lesson-plans settles on /portal/curriculum

  # FLN Reading Hour + Numeracy (bd-t7zk3t.11, SPEC_v2 §8; m-app owns FLN01/02/05/07/08, m-links FLN03/04/06).
  # Behind app_settings `portal_fln_lessons` (missing = OFF). Written by hand AFTER the generated TL scenarios: these
  # are not page-health rows, so gen_page_features.py cannot express them and the web driver has no code for them yet
  # (@draft). Re-running the generator rewrites this file — carry this block over when it does.

  @FLN01 @draft @config-gated
  Scenario: FLN switch on: the New lesson plan page shows the FLN band; switch off: the page is unchanged
    Given the teacher app v2 is on and the coach app v2 is off
    And portal_fln_lessons is true
    And the demo teacher is signed in
    When they open /portal/teacher/lessons/new
    Then under the grade and subject picker a band lists Reading Hour English, Reading Hour Urdu and Numeracy
    And each row shows its lesson count and level and links to /portal/fln/list/<subject>?grade=<grade>
    When portal_fln_lessons is removed
    And they open /portal/teacher/lessons/new again
    Then no FLN band is shown and the page is the same as before the FLN release
    And the catalogue answers 404; /me says lessons:false

  @FLN02 @draft @config-gated
  Scenario: A signed-in teacher opens an FLN plan from a deep link
    Given the teacher app v2 is on and the coach app v2 is off
    And portal_fln_lessons is true
    And the demo teacher is signed in
    When they open /portal/teacher/lessons/open?plan=fln:<id of a Reading Hour English grade 1 plan>
    Then the page settles on /portal/fln/p/<that id> and the open page is not left in the history
    And the plan's title, its minutes and its section bands are shown
    And one open is recorded for the plan with kind fln

  @FLN05 @draft @config-gated
  Scenario: A sound plays on tap, one at a time, and tapping it again restarts it
    Given portal_fln_lessons is true
    And the demo teacher is signed in
    And they are on the plan page of a Reading Hour English grade 1 plan with a sound grid
    When they tap the first sound
    Then that sound plays and its tile shows it is playing
    When they tap the second sound while the first is playing
    Then the first sound stops and only the second plays
    When they tap the second sound again
    Then it plays again from the start, and still only one sound plays

  @FLN07 @draft @config-gated
  Scenario: The plan opens with every section closed; a tap opens one in place
    Given portal_fln_lessons is true
    And the demo teacher is signed in
    When they open the plan page of a Reading Hour English grade 1 plan
    Then the sound grid is visible before any tap
    And every section band is closed, showing its title, minutes and first move
    When they tap the second section band
    Then that section opens in place with its moves, its band reads expanded, and the page does not scroll
    And every other section stays closed
    When they tap the same band again
    Then it closes

  # FLN08 (bd-elc1qz, 19 Oct 2026): FLN is for Grades 1–5 only — the team: "they should only be available up to
  # Grade 5". Covers portal/src/portal/fln/FlnBandBody.tsx, FlnRoutes.tsx and the catalogue route's 400 above grade 5.
  # Since FLN09 (bd-4tsjcr) a teacher who teaches only Grades 6–12 sees no band, so the Grade 1 landing is shown
  # here with a teacher who has no classes.
  @FLN08 @draft @config-gated
  Scenario: The FLN band offers Grades 1–5 only, and a teacher with no classes lands on Grade 1
    Given portal_fln_lessons is true
    And the demo teacher is signed in and has no classes
    When they open /portal/teacher/lessons/new
    Then the band's grade chips are Grade 1, 2, 3, 4 and 5, and no other grade
    And Grade 1 is selected and the band's line reads "Foundational reading and maths · Grades 1–5"
    And every row links to /portal/fln/list/<subject>?grade=1
    When they open an old link /portal/fln/list/rh-en?grade=8
    Then the page settles on /portal/fln/list/rh-en?grade=1, the Grade 1 lesson list
    And GET /api/portal/fln/catalogue?grade=8&subject=rh-en answers 400

  # FLN09 (bd-4tsjcr, 20 Oct 2026): asked whether a teacher whose classes are all Grades 6–12 should see the band at
  # Grade 1 or not at all, the operator answered "not at all". Hidden only when the teacher's classes read succeeded,
  # at least one CLASS has a known grade and every known class grade is above 5; no classes, only unknown grades or
  # a failed read (or one with no answer within 8 s) → Grade 1, as before. Lesson-plan history (what the read gives
  # when they have no class) never hides it. Leaders always see it, and plan links keep opening.
  # Covers portal/src/portal/fln/FlnBand.tsx and FlnBandBody.tsx (bandGrade, bandGradeForPairs, the 8 s deadline).
  @FLN09 @draft @config-gated
  Scenario: A teacher who teaches only Grades 6–12 sees no FLN band; a Grade 3 class or a coach still gets it
    Given portal_fln_lessons is true
    And the demo teacher is signed in and teaches only Grade 8
    When they open /portal/teacher/lessons/new
    Then no FLN band is shown: no heading, no grade chips, no rows and no gap under the grade and subject picker
    And the rest of the page is the same as when portal_fln_lessons is off
    And no GET /api/portal/fln/catalogue is made
    When they open a plan link /portal/fln/p/<id of a Reading Hour English grade 1 plan> that a coach sent them
    Then the plan opens
    When the demo teacher teaches Grades 7 and 3
    And they open /portal/teacher/lessons/new again
    Then the FLN band is shown with Grade 3 selected
    And every row links to /portal/fln/list/<subject>?grade=3
    When the demo teacher has no classes and their only lesson-plan history is Grade 7
    And they open /portal/teacher/lessons/new again
    Then the FLN band is shown with Grade 1 selected
    When a demo coach whose only class is Grade 8 is signed in
    And they open /portal/teacher/lessons/new
    Then the FLN band is shown with Grade 1 selected

  # FLN03 (PR-D, m-links): a shared plan link opened signed out → sign-in → back on the plan (next=, replace).
  # Covers portal/src/portal/fln/lib/safeNext.ts, fln/login/FlnLoginBanner.tsx, TeacherGate.tsx:29, PortalLogin.tsx.
  @FLN03
  Scenario: A signed-out teacher opens a shared Reading Hour link, signs in, and lands on that plan
    Given portal_fln_lessons is on for the demo teacher
    And the demo teacher is signed out
    When the teacher opens /portal/fln/p/11156
    Then the sign-in page shows the plan's title with "Sign in to open" and «کھولنے کے لیے سائن اِن کریں»
    When the teacher signs in with a code
    Then /portal/fln/p/11156 opens
    And Back from the plan does not return to the sign-in page
    And a sign-in link whose next= points at another site lands on the teacher's home instead

  # FLN04 (PR-D, m-links): Share is for leaders only, and the builder makes a plain link.
  # Covers dashboard/routes/portal-fln-links.routes.js, fln/share/*, fln/send/SendPage.tsx, FlnSendCard, FlnSendTile.
  @FLN04
  Scenario: A coach sees Share on a plan and finds a plan in the link builder; a teacher sees neither
    Given portal_fln_lessons and portal_fln_share are on for the demo coach and the demo teacher
    And the demo coach is signed in
    When the coach opens /portal/fln/p/11156
    Then a bar with "Send to teacher" and "Share link" sits at the bottom of the plan
    When the coach taps "Share link"
    Then the sheet offers "Send on WhatsApp" and "Copy link"
    And the message names the plan and its level, never a grade, with the link alone on its last line
    When the coach opens "Send a lesson plan" from My Patch
    And picks Grade 1, Reading Hour English
    Then each row shows its position in the level, with Copy and WhatsApp buttons
    When the demo teacher signs in and opens /portal/fln/p/11156
    Then there is no Share bar
    And GET /api/portal/fln/links answers 404 for the teacher

  # FLN06 (PR-E, m-links): Send to teacher. Leader → bot message → the teacher's OWN /go → the FLN plan, signed in.
  # Covers dashboard/routes/portal-fln-send.routes.js, bot/shared/services/fln-send.service.js,
  # bot/shared/services/fln-go-target.js and the /go landing hook. Sandbox test accounts only; never a real teacher.
  @FLN06
  Scenario: A coach sends a Reading Hour plan to an assigned teacher, and the teacher's own link opens it signed in
    Given portal_fln_lessons and portal_fln_share are on for the demo coach and the demo teacher
    And the demo teacher is in the demo coach's school assignments
    And the demo coach is signed in
    When the coach opens Send to teacher on Reading Hour plan 11156
    Then the teacher picker lists the demo teacher by name, with no phone number on screen
    And a teacher outside the coach's schools is not in the list
    When the coach picks the demo teacher and taps Send
    Then the sheet shows "Sent ✓" for 1 teacher
    And the demo teacher's WhatsApp message carries a button to that teacher's own /go link
    When the demo teacher taps the button
    Then /portal/fln/p/11156 opens signed in as the demo teacher, with no Share bar
    And a send to a teacher key outside the coach's scope is refused with 403 and nothing is sent

  # bd-4joiqz — "why can't a coach see LPs in their IAB? Shouldnt we make them available?" (operator, 22 Oct 2026).
  # The leader family (coach, principal off the teacher app, AEO, supervisor, school leader) READS the same Lesson
  # Plans pages a teacher uses. Written by hand like the FLN block above; the web driver has no code for them yet
  # (@draft). Re-running the generator rewrites this file — carry this block over when it does.

  @LDR01 @draft
  Scenario: A coach on the coach app opens Lesson Plans from the menu and reads a grade 1–5 plan
    Given the teacher app v2 is off and the coach app v2 is on
    And demo coach 03000000901 is signed in
    When they open /portal/coach/training
    Then the menu shows Training Library, Lesson Plans and More
    When they tap Lesson Plans
    Then /portal/teacher/lessons opens with New lesson plan and no Recent Lesson Plans, and it has no Back
    When they tap New lesson plan and pick Grade 4, a subject, a chapter and a lesson
    Then the plan opens in the viewer at /portal/teacher/lessons/plan, not on the Training Library
    And the viewer has the answer key and Open in another app
    And the viewer has no Start DC observation, no Thing to try and no Send on WhatsApp
    And Lesson Plans is the current menu item on each of these pages

  @LDR02 @draft
  Scenario: A principal off the teacher app finds Lesson Plans in the leader menu and reads a grade 6–12 plan
    Given the teacher app v2 and the coach app v2 are off
    And demo principal 03000000902 is signed in
    When they open /portal/leader
    Then the leader menu has Lesson Plans, on the phone's bottom bar too
    When they tap Lesson Plans
    Then /portal/teacher/lessons opens and stays open (not sent back to /portal/leader)
    When they open a grade 9 plan
    Then the plan opens in the viewer, with no Start DC observation and no Send on WhatsApp

  @LDR03 @draft
  Scenario: A teacher's Lesson Plans, and a principal's on the teacher app, are unchanged
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When they open /portal/teacher/lessons
    Then it shows "Recent Lesson Plans" under Home, as before
    When they open a grade 1–5 plan
    Then the viewer has Start DC observation, Send on WhatsApp and Open in another app, as before
    And All Lesson Plans opens for them and is still turned away for a coach

  @LDR04 @draft
  Scenario: A leader's open is not a teacher's: no open row, no survey, one lp.leader_open event
    Given demo coach 03000000901 is signed in
    When they open a grade 1–5 plan, a grade 6–12 plan and an FLN plan in the viewer
    Then no niete_lp_opens row is written for the coach
    And no "was this plan useful?" survey is requested
    And the grade 1–5 PDF is asked for without naming the coach, so no lifecycle row and no A/B group
    And their grade 6–12 request is marked opened, so the ready message never chases it
    And one lp.leader_open event is logged per open, with the coach's id, role coach, the plan kind, its ref and the source
    When demo teacher 03000000911 opens the same grade 1–5 plan
    Then one niete_lp_opens row and one survey request are recorded, as before

  @LDR05 @draft @config-gated
  Scenario: A leader's way back from an FLN page is their Lesson Plans tab
    Given portal_fln_lessons is true
    And the coach app v2 is on
    And demo coach 03000000901 is signed in
    When they open /portal/teacher/lessons
    Then the Reading Hour & Numeracy band is on the page
    When they open an FLN list from the band and tap Back
    Then they land on /portal/teacher/lessons/new, not on the Training Library
    When they open /portal/fln/p/999999999
    And they tap the link under "This lesson isn't available"
    Then they land on /portal/teacher/lessons

  @LDR06 @draft @config-gated
  Scenario: Send a lesson plan: each row has View, which opens that plan's page
    Given portal_fln_lessons and portal_fln_share are true
    And demo coach 03000000901 is signed in
    When they open /portal/fln/send and pick Grade 3 and Numeracy
    Then each row has View, Send to teacher and Share link
    When they tap View on a row
    Then /portal/fln/p/<that plan's id>?grade=3 opens
    And Send to teacher and Share link work as before

  # bd-96f69c (queue #153): the survey bar at the end of a grades 1-5 plan (portal_lp_feedback_bar), written by hand.
  # @draft: the web lane's demo data has no lesson-plan PDF in its local file store, so the viewer never reaches its
  # last page here. Covered by portal/src/portal/teacher/lessons/FeedbackBar.test.tsx + ViewerPage tests (vitest) and
  # tests/portal/lp-feedback-route.test.js, tests/feedback/lp-in-app-feedback*.test.js (one row per teacher per plan,
  # trigger_mode 'in_app', the grades 1-5 column). Checked by hand on sandbox with a test teacher.
  @LPBAR01 @draft @config-gated
  Scenario: Teacher app v2: with the survey bar on, a grades 1-5 plan ends with "This plan · Useful · Not useful", and Useful asks In class
    Given the teacher app v2 is on and the survey bar is on for the demo teacher
    And she opens one of her grades 1-5 lesson plans in the viewer
    When she reaches the end of the plan and taps "Useful"
    Then "In class" asks "Taught it today · Planning to · Not yet" in the same place, never as a pop-up
    And tapping "Taught it today" shows "Thanks" and saves one answer for her and this plan

  # bd-snkn32.61 — operator, 20 Nov: "doesnt make sense to show chapters, we can focus on FLN related skills and if
  # teachers want something else, they are free to add those". Written by hand like the blocks above (@draft): the demo
  # stack cannot turn portal_lp_own_goal_start on. Pinned by GoalStep.test.tsx (portal) and tests/lp612/own-goal*.test.js.

  @OWN05 @draft @config-gated
  Scenario: The learning-goal start shows skills only, never a chapter name, and lets her add her own goal
    Given portal_lp_make_own and portal_lp_own_goal_start are on for demo teacher 03000000911
    And she is signed in
    When she opens Make my own, taps "From a learning goal" and picks Grade 3 Math
    Then the goals are grouped by skill such as "Adding and subtracting", with no chapter name under any goal
    When she types "multiply" in "Search goals"
    Then the matching goals show with no chapter name
    When she taps "Add my own goal", types "Adding money at the shop" and taps "Check my goal"
    Then "Use my words" shows with "Did you mean" goals below it, none naming a chapter
    When she taps "Use my words"
    Then the next step opens and the check screen shows her own words as the learning goal
    And a typed goal with a blocked word gets a calm refusal and nothing to use

  @OWN06 @draft @config-gated
  Scenario: A Grades 6–12 learning-goal list is one list with no chapter headings
    Given portal_lp_make_own and portal_lp_own_goal_start are on for demo teacher 03000000911
    And she is signed in
    When she opens Make my own, taps "From a learning goal" and picks Grade 7 General Science
    Then her grade's learning goals show as one list, with no chapter name as a heading or under any goal
    And "Search goals" still narrows the list as she types

  @LPBAR02 @draft @config-gated @negative
  Scenario: Teacher app v2: a plan she already answered, in the app or on WhatsApp, shows no survey bar
    Given the survey bar is on for the demo teacher and she has already answered this grades 1-5 plan
    When she opens the plan and reaches its end
    Then no survey bar is drawn

  # bd-zrdvmi.21 (18 Nov) — ICT Feedback sheet, GB tab row 3 (14 Nov, portal). Failure record only; Send on WhatsApp (GBS01) is not on main.
  @GBS02 @draft @negative
  Scenario: When the reader cannot show a plan, it says which step failed in the logs
    Given the teacher app v2 is on
    And demo teacher 03000000911 is signed in
    And the plan's file request fails or the plan cannot be drawn on her phone
    When she opens a plan
    Then the viewer shows "Can't show it here" with Open in another app
    And the portal logs one lp_viewer.failed with the step, the lane and the file's size, and no plan name

  # bd-snkn32.11, queue #134 C (18 Nov) — her rating of her own plan. Component proof: RateCard.test.tsx,
  # OwnSections.test.tsx; server: tests/lp612/own-rating.test.js, tests/portal/lp612-own-rating-route.test.js.
  @RATE01 @draft @config-gated
  Scenario: Her own plan asks how good it was and saves her rating
    Given the teacher app v2 and "portal_lp_make_own" are on for her
    And her own plan has just opened from its waiting screen
    Then under the plan she sees "How good was this plan?" with five choices, 1 to 5, and "What was confusing?" marked optional
    When she taps 4, types what was confusing and taps Send
    Then she sees "Thank you. Your rating is saved."
    And her own plan's row holds rating 4, her words and when she rated it

  @RATE02 @draft @config-gated @negative
  Scenario: A shelf plan or a ready-made plan has no rating card
    Given the teacher app v2 and "portal_lp_make_own" are on for her
    When she opens a ready-made plan, or another teacher's plan from the shelf
    Then no "How good was this plan?" card is shown

  # bd-snkn32.56, queue #151 (#134 E) — Make my own from a learning goal or topic, no textbook in class (grades 6–12).
  # Behind the LIST-ONLY app_settings key `portal_lp_own_goal_start` (a list of user ids). Component proof:
  # OwnPage.goal.test.tsx, GoalStep.test.tsx, state.goal.test.ts; server: tests/lp612/own-goal*.test.js,
  # tests/portal/lp612-own-goal-route.test.js, tests/portal/lp612-own-goal-config-flag.test.js.
  @GOAL01 @draft @config-gated
  Scenario: A listed teacher starts a plan from a learning goal and it is made with no textbook
    Given the teacher app v2, "portal_lp_make_own" and "portal_lp_own_goal_start" are on for her
    When she opens Make my own on a Grades 6–12 chapter
    Then step 1 offers "Start from a learning goal or topic"
    When she taps it and selects one of her grade's learning goals
    And she answers the rest of the steps and taps Make my plan
    Then her answers carry her goal and the lesson under it, with no textbook and no book pages
    And the Preparing page opens on her plan's id

  @GOAL02 @draft @config-gated
  Scenario: A typed topic with no lesson behind it is said plainly
    Given the teacher app v2, "portal_lp_make_own" and "portal_lp_own_goal_start" are on for her
    When she types a topic no lesson of her grade shares a word with and taps Find
    Then she sees "Not found in your grade’s lessons. Try other words, or select a learning goal."
    And OK stays disabled

  @GOAL03 @draft @config-gated @negative
  Scenario: A teacher not on the list never sees the goal start
    Given the teacher app v2 and "portal_lp_make_own" are on for her, but she is not on "portal_lp_own_goal_start"
    When she opens Make my own on a Grades 6–12 chapter
    Then step 1 has no "Start from a learning goal or topic"
    And a goal address sends her back to the book pages, and the server answers 404 to the goal reads

  @GOAL04 @draft @config-gated
  Scenario: A listed teacher starts a Grades 1–5 plan from an official learning outcome
    Given the teacher app v2, "portal_lp_make_own" and "portal_lp_own_goal_start" are on for her
    When she opens Make my own on a Grades 1–5 Urdu, English or Maths chapter
    Then step 1 offers "Start from a learning goal or topic"
    When she taps it
    Then she sees her grade and subject's official learning outcomes, in the book's language
    When she selects one and answers the rest of the steps and taps Make my plan
    Then her answers carry her goal and the day under it, with no textbook and no book pages
    And the Preparing page opens on her plan's id

  # bd-snkn32.58.1, queue #155 A (Amena 19 Nov: "wrong flow, From textbook chapter OR Start from a learning goal").
  # Same LIST-ONLY switch. Component proof: OwnTwoStarts.test.tsx, GoalStep.test.tsx; server: tests/lp612/own-goal-skills.test.js.
  @GOAL05 @draft @config-gated
  Scenario: Make my own opens on two equal starts, and the goal start needs no chapter
    Given the teacher app v2, "portal_lp_make_own" and "portal_lp_own_goal_start" are on for her
    When she taps "Make my own" on the Lesson Plans main page
    Then she sees two equal cards "From a textbook chapter" and "From a learning goal", and no class picker yet
    When she taps "From a learning goal" and selects Grade 3 Maths
    Then the learning goal step opens for Grade 3 Maths with no chapter screen in between

  @GOAL06 @draft @config-gated
  Scenario: Grades 1–5 learning goals are skill-sized and grouped by skill
    Given the teacher app v2, "portal_lp_make_own" and "portal_lp_own_goal_start" are on for her
    When she reaches the learning goal step for Grade 3 Maths
    Then she sees skill groups such as "Multiplying and dividing", each with its number of goals
    When she taps "Multiplying and dividing"
    Then she sees one goal per official outcome, such as "Multiply 2 digit numbers by 1 digit number mentally and in written form."
    And no "[DERIVED" page note is listed as a goal
    When she types "multiply" in "Search goals"
    Then only goals with that word are listed

  @GOAL07 @draft @config-gated @negative
  Scenario: With the goal switch off, Make my own's first screen is unchanged
    Given the teacher app v2 and "portal_lp_make_own" are on for her, but she is not on "portal_lp_own_goal_start"
    When she taps "Make my own" on the Lesson Plans main page
    Then she sees Grade and subject, as before, with no "From a learning goal" card

  # bd-snkn32.58.2, queue #155 B — guardrails for a typed topic. Component proof: GoalStep.test.tsx, OwnPage.goal.test.tsx;
  # server: tests/lp612/own-goal-guard.test.js, own-goal-note-guard.test.js, tests/portal/lp612-own-goal-route.test.js.
  @GOAL08 @draft @config-gated
  Scenario: A misspelt or Roman Urdu topic offers "Did you mean" goals, and nothing is picked until she taps one
    Given the teacher app v2, "portal_lp_make_own" and "portal_lp_own_goal_start" are on for her
    When she reaches the learning goal step for Grade 3 Maths, types "multiplcation by 2" and taps Find
    Then she sees "Did you mean" with up to 3 of her grade's goals, the first about multiplying a 2-digit number
    And OK stays disabled until she selects one
    When she types "jama 2 hindsay" and taps Find
    Then the first suggestion is about adding numbers

  @GOAL09 @draft @config-gated
  Scenario: A goal of another grade is named
    Given the teacher app v2, "portal_lp_make_own" and "portal_lp_own_goal_start" are on for her
    When she reaches the learning goal step for Grade 3 Maths, types "add unlike fractions" and taps Find
    Then she sees "This is a Grade 4 goal" with "Use it anyway" and "See my grade’s goals"

  @GOAL10 @draft @config-gated @negative
  Scenario: A topic off the curriculum, or with a blocked word, is refused
    Given the teacher app v2, "portal_lp_make_own" and "portal_lp_own_goal_start" are on for her
    When she reaches the learning goal step for Grade 3 Maths, types "cricket world cup" and taps Find
    Then she sees "Not found in your grade’s lessons. Try other words, or select a learning goal." and nothing is picked
    When she types a blocked word and taps Find
    Then she sees "This is not a school topic. Select a learning goal." and nothing is picked

  # bd-snkn32.58.3, queue #155 C — a goal plan is checked (facts + goal) before it is shown; one fix, then refused.
  # Component proof: PreparingPage.goal.test.tsx; worker: tests/lp612/own-goal-check.test.js (seeded wrong fact fixed / refused).
  @GOAL11 @draft @config-gated
  Scenario: A goal plan says it is being checked, and opens with her goal at the top
    Given the teacher app v2, "portal_lp_make_own" and "portal_lp_own_goal_start" are on for her
    When she makes a plan from a Grade 3 Maths learning goal
    Then the Preparing page says "Checking it matches your goal…"
    And when it is ready the plan opens with her official goal at the top

  @GOAL12 @draft @config-gated @negative
  Scenario: A goal plan the check refuses shows a calm refusal, not Try again
    Given a goal plan whose check found problems the one fix did not clear
    When the Preparing page learns it failed with OWN_GOAL_UNSURE
    Then she sees "We could not make a plan we are sure of for this goal." with "Select another goal" and "From a textbook chapter"
    And there is no "Try again"

  # bd-m8zwt1.1 (queue #164 testing): every grades 1-5 goal plan whose first check failed crashed on its one fix
  # ("k5EditMessages: unknown part undefined") and ended "Couldn't make it". Pinned by tests/lp612/own-goal-k5-fix.test.js.
  @GOAL13 @draft @config-gated
  Scenario: A grades 1-5 goal plan the check asks to fix gets its one fix, and ends ready or with the calm refusal
    Given a Grade 3 Maths goal plan whose first goal check found a problem
    When the worker makes its one fix
    Then the plan ends ready with her goal at the top, or with "We could not make a plan we are sure of for this goal."
    And she never sees "Couldn't make it" for that reason

  # bd-m8zwt1.2: the check screen printed the subject KEY from the class picker ("Grade 3 · math").
  @GOAL14 @draft @config-gated
  Scenario: Make my own's check screen names the subject, not its key
    Given the demo teacher picks Grade 3 Maths and a learning goal
    When she reaches "Your plan"
    Then the line under her goal reads "Grade 3 · Math", never "math"
    And in Urdu it reads "ریاضی"

  # bd-m8zwt1.8 / bd-m8zwt1.9 (queue #164 testing), pinned by PreparingPage.retry.test.tsx and Check.test.tsx.
  @GOAL15 @draft @config-gated
  Scenario: Try again after her own plan failed takes her back to her own answers
    Given the demo teacher's own plan failed while it was being made
    When she taps "Try again" on the Preparing page
    Then she is on "Your plan" with the answers she gave
    And she is not shown the ready-made plan of that lesson

  @GOAL16 @draft @config-gated @negative
  Scenario: The daily limit is said where she can see it
    Given the demo teacher has made today's last allowed own plan
    When she taps "Make my plan" again
    Then the refusal is the first thing on "Your plan" and is scrolled into view, not hidden behind the button

  @OWN12 @draft @config-gated
  Scenario: A book-path note with an everyday lesson word is kept; only a goal start drops a blocked-word note
    Given portal_lp_make_own is on for demo teacher 03000000911
    And she is signed in
    When she makes her own plan from a Grade 8 Science book lesson with the note "observe the moon with the naked eye"
    Then no "note was not used" message shows and her plan follows her note
    When portal_lp_own_goal_start is on and she starts from a learning goal with a note holding a blocked word
    Then the plan is still made and a message says her note was not used
    # bd-cyadk0: #5129's note drop ran on every own plan; the blocked list holds ordinary lesson words
    # ("naked", "alcohol", "kill"). Unit: tests/lp612/own-goal-note-guard.test.js.
