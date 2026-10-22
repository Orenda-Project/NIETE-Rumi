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
