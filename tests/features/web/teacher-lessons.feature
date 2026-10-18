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

  # FLN Reading Hour + Numeracy (bd-t7zk3t.11, SPEC_v2 §8; m-app owns FLN01/02/05/07, m-links FLN03/04/06).
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
    And every /api/portal/fln/ request answered 404

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
