Feature: Teacher home, analytics, more and profile
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- teacher-home`. Covers: portal/src/portal/teacher/TeacherPage.tsx + pages/, PortalDashboard.tsx.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @TH01
  Scenario: Teacher app v2: her home greets her by name
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher
    Then her home greets her: "Salaam, Ayesha …"

  @TH02
  Scenario: Teacher app v2: More, My profile and Analytics open
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher/more
    Then More opens
    When she opens /portal/teacher/profile
    Then My profile opens
    When she opens /portal/teacher/analytics
    Then Analytics opens

  @TH03
  Scenario: Classic portal: her dashboard greets her by name
    Given the teacher app v2 and the coach app v2 are off
    And demo teacher 03000000911 is signed in
    When she opens /portal/dashboard
    Then her dashboard greets her: "Salaam, Ayesha"

  @TH04
  Scenario: Teacher app v2, new Home look: on a card day the band, the lesson card, the progress strip and All features come in order
    Given the teacher app v2 is on and the coach app v2 is off
    And the Home card is on, and the new Home look is on for demo teacher 03000000911 only
    And the demo teacher is named "Ayesha Testwala"
    And today's Home answer is a lesson card on "Fractions" and a coach score of 29/38
    And demo teacher 03000000911 is signed in on a 412 px phone
    When the teacher opens /portal/teacher
    Then the navy band greets "Salaam, Ayesha Testwala!" on its own row under the date and school (the two-row band)
    And the band's language pill reads "اردو"
    And the lesson card shows "Quiz from your last lesson:" with the topic "Fractions" on its own line
    And the card has one primary button "Quiz this" and "Open the plan" under it
    And the progress strip shows "Your progress" and the chip "Coach 29/38"
    And "All features" labels the 8 feature tiles, and "What would you like to do today?" is not shown
    And the band, the card, the strip, "All features" and the tiles come in that order down the page
    And no page error or 5xx happened

  @TH05
  Scenario: Teacher app v2, new Home look: on a no-card day the two score chips come first, then the question and the features
    Given the teacher app v2 is on and the coach app v2 is off
    And the Home card is on, and the new Home look is on for demo teacher 03000000911 only
    And today's Home answer has no card, a coach score of 29/38 and an observation score of 31/40
    And demo teacher 03000000911 is signed in
    When the teacher opens /portal/teacher
    Then no card is drawn and "All features" is not shown
    And the progress strip shows both chips, "29/38" and "31/40", without the "Your progress" label
    And the heading "What would you like to do today?" comes after the strip and before the 8 feature tiles
    And no page error or 5xx happened

  @TH06
  Scenario: Teacher app v2, new Home look: the language pill switches the Home to Urdu and the "!" stays inside the name
    Given the teacher app v2 is on and the coach app v2 is off
    And the Home card is on, and the new Home look is on for demo teacher 03000000911 only
    And the demo teacher is named "Ayesha Testwala"
    And today's Home answer has no card
    And demo teacher 03000000911 is signed in with English as their language
    When the teacher opens /portal/teacher and taps the "اردو" pill in the band
    Then the band greets "السلام علیکم، Ayesha Testwala!" with the "!" inside the name's isolate, right after "Testwala"
    And the pill now reads "English"
    And the heading reads "آج کیا کریں؟"
    And the teacher's saved language is Urdu
    When the teacher taps the "English" pill
    Then the band greets "Salaam, …" again
    And no page error or 5xx happened

  @TH07
  Scenario: Teacher app v2, new Home look: on a 320 px phone the band is one row and drops the date line
    Given the teacher app v2 is on and the coach app v2 is off
    And the Home card is on, and the new Home look is on for demo teacher 03000000911 only
    And the demo teacher is named "Ayesha Testwala"
    And today's Home answer is a lesson card on "Fractions"
    And demo teacher 03000000911 is signed in on a 320 px phone
    When the teacher opens /portal/teacher
    Then the band is the one-row band: the mark, "Salaam, Ayesha Testwala!" and the language pill on one row
    And the date and school line is not drawn
    And the page does not scroll sideways, and the lesson card is still shown
    And no page error or 5xx happened

  @TH08
  Scenario: Teacher app v2: with the new Home look off, or on without the Home card, the Home is the one before
    Given the teacher app v2 is on and the coach app v2 is off
    And the Home card is on and the new Home look is off
    And the demo teacher is named "Ayesha Testwala"
    And demo teacher 03000000911 is signed in
    When the teacher opens /portal/teacher
    Then the Home greets "Salaam, Ayesha Testwala!" in today's greeting band, with no new band
    And the 8 feature tiles are shown
    Given the Home card is off and the new Home look is on for demo teacher 03000000911 only
    When the teacher signs in again and opens /portal/teacher
    Then there is no new band, because the look only rides with the Home card
    And the 8 feature tiles are shown
    And no page error or 5xx happened

  @TH09
  Scenario: Teacher app v2: with the Quizzes tile on, Quizzes is the 2nd tile, right after Lesson plans, and opens my quiz home
    Given the teacher app v2 is on and the coach app v2 is off
    And the Home card is on, and the Quizzes tile is on for demo teacher 03000000911 only
    And the bot gives demo teacher 03000000911 a quiz home
    And demo teacher 03000000911 is signed in on a 360 px phone
    When the teacher opens /portal/teacher
    Then the feature grid has 9 tiles: Lesson plans, then "Quizzes" (Urdu «کوئز», to the left of Lesson plans in Urdu), then the other 7 in today's order
    And the 9th tile spans both columns
    When the teacher taps "Quizzes"
    Then the page goes to /quiz/teacher/<token>
    Given the Quizzes tile is off
    When the teacher signs in again and opens /portal/teacher
    Then the 8 feature tiles are shown in today's order, none spanning both columns
    And no page error or 5xx happened
    # UPDATED 2026-10-27 (COS ruling, the operator: "figure out the best place for it"): the tile moved from a full-width
    # bar under the eight into the grid as the 2nd tile (7-day reach: Lesson plans 2,179 > coaching 1,578 > training
    # 1,353 ...; a quiz follows a lesson). app_settings portal_teacher_home_quiz_tile (true / "teachers" / a list; default
    # off). GET /me/home answers quizTile:true only with a quiz home (never a coach); the tap logs home_card.tap quiz_tile.
    # Unit: tests/portal/portal-teacher-home.quiz-tile.test.js, portal/src/portal/teacher/home/QuizTile.test.tsx.
