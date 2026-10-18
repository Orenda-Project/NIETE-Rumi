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
