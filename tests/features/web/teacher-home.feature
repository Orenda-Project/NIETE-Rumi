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

  # 810b3bae2 (30 Oct 2026, mockup v6 option B): the look's header is the kit's HomeGreeting (the mark and NIETE, the
  # small language pill, the greeting, today's date, her school), the features are the kit's tiles three per row, and
  # there is no "All features" label and no question line (operator: "this is not a chat app").
  @TH04
  Scenario: Teacher app v2, new Home look: on a card day the band, the lesson card, the progress strip and the features come in order
    Given the teacher app v2 is on and the coach app v2 is off
    And the Home card is on, and the new Home look is on for demo teacher 03000000911 only
    And the demo teacher is named "Ayesha Testwala"
    And today's Home answer is a lesson card on "Fractions" and a coach score of 29/38
    And demo teacher 03000000911 is signed in on a 412 px phone
    When the teacher opens /portal/teacher
    Then the navy band greets "Salaam, Ayesha Testwala!" over today's date and her school
    And the band's language pill reads "اردو"
    And the lesson card shows "Quiz from your last lesson:" with the topic "Fractions"
    And the card has one primary button "Quiz this" with "Open the plan" beside it
    And the progress strip shows "Your progress" and the chip "Coach 29/38"
    And the 8 feature tiles are drawn three per row, with no "All features" label and no question line
    And the band, the card, the strip and the tiles come in that order down the page
    And no page error or 5xx happened

  @TH05
  Scenario: Teacher app v2, new Home look: on a no-card day the two score chips come straight after the band, then the features
    Given the teacher app v2 is on and the coach app v2 is off
    And the Home card is on, and the new Home look is on for demo teacher 03000000911 only
    And today's Home answer has no card, a coach score of 29/38 and an observation score of 31/40
    And demo teacher 03000000911 is signed in
    When the teacher opens /portal/teacher
    Then no card is drawn
    And the progress strip shows both chips, "29/38" and "31/40", without the "Your progress" label
    And the 8 feature tiles follow the strip, with no question line between them
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
    And today's date in the band is written in Urdu
    And the teacher's saved language is Urdu
    When the teacher taps the "English" pill
    Then the band greets "Salaam, …" again
    And no page error or 5xx happened

  @TH07 @obsolete
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
    # OBSOLETE 2026-11-18 (bd-j7czk9.1): 810b3bae2 (30 Oct 2026) removed the look's own band (HomeBand, bandShape): the
    # header is the kit's HomeGreeting at every width, so there is no one-row band and the date line is never dropped.
    # What still holds at 320 px is TH10.

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

  # TH10 replaces TH07's narrow-phone check for the kit header (810b3bae2): nothing is dropped, nothing scrolls sideways.
  @TH10
  Scenario: Teacher app v2, new Home look: on a 320 px phone the whole header and the lesson card fit without sideways scroll
    Given the teacher app v2 is on and the coach app v2 is off
    And the Home card is on, and the new Home look is on for demo teacher 03000000911 only
    And the demo teacher is named "Ayesha Testwala"
    And today's Home answer is a lesson card on "Fractions"
    And demo teacher 03000000911 is signed in on a 320 px phone
    When the teacher opens /portal/teacher
    Then the band greets "Salaam, Ayesha Testwala!" with the language pill, today's date and her school
    And the lesson card is shown
    And the page does not scroll sideways
    And no page error or 5xx happened

  # bd-96f69c (queue #153): Home's Last 30 days block (portal_teacher_home_activity, with portal_teacher_home_card)
  # and My journey (portal_teacher_journey). The numbers are counted twice a day by the worker into Redis; opening
  # Home reads only that stored value. Unit: tests/portal/teacher-activity-store.test.js, home/activity/*.test.tsx.
  @TH11
  Scenario: Teacher app v2: with Home activity on and her numbers counted, Home shows her last 30 days and My journey
    Given the teacher app v2 is on, the Home card is on, and Home activity and My journey are on for the demo teacher only
    And her counted numbers are stored: 14 plans opened, 3 taught in class, 2 DC observations, 4 quizzes and 1 paper
    And the demo teacher is signed in on a 360 px phone
    When the teacher opens /portal/teacher
    Then a "Last 30 days" block shows "Updated today" and the tiles Plans opened 14, Taught in class 3, DC observations and Quizzes · Papers
    And a "My journey" row is under the tiles
    And on a day her lesson card is the slim one, the block comes right after that card, never above it
    And the page does not scroll sideways, and no page error or 5xx happened

  @TH12
  Scenario: Teacher app v2: with Home activity on in Urdu, the block and My journey read in Urdu
    Given Home activity and My journey are on for the demo teacher, her numbers are stored, and her language is Urdu
    When the teacher opens /portal/teacher and then /portal/teacher/journey
    Then the block is headed "پچھلے 30 دن" with a "میرا سفر" row
    And My journey lists "لیسن پلان کھولا" and "کلاس میں پڑھایا"
    And no page error or 5xx happened

  @TH13
  Scenario: Teacher app v2: My journey lists her stored steps newest first, with the updated line
    Given Home activity and My journey are on for the demo teacher, and her stored steps are a plan opened, a lesson taught and a DC observation
    When the teacher taps "My journey" on her Home
    Then /portal/teacher/journey lists Opened a lesson plan, Taught in class and DC observation, newest first
    And it says "Updated today …"

  @TH14
  Scenario: Teacher app v2: with Home activity on but no numbers counted yet, Home loads with no numbers and no error
    Given Home activity is on for the demo teacher and nothing is stored for her
    When the teacher opens /portal/teacher
    Then no number tiles are drawn
    And the rest of Home loads with no page error or 5xx

  @TH15
  Scenario: Teacher app v2: with Home activity and My journey off, Home has no Last 30 days block, even with numbers stored
    Given Home activity and My journey are off, and numbers are stored for the demo teacher
    When the teacher opens /portal/teacher
    Then there is no "Last 30 days" block

  # bd-pdwwk4.2: when the bot skips today's 15:00 lesson-plan quiz offer (or the lesson-plan coaching ask) because the
  # teacher's WhatsApp window was shut, Home's "Ready for you" lists ONE quiz card (app_settings
  # quiz_offer_closed_window, key app_card; missing or any other shape = off, today's list). The skipped offer is a
  # real teacher_nudges row on the run's database. The card's switch has its own 30 s cache, so the driver polls Home.
  # Unit: tests/portal/qfix-offers-app-quiz-card.test.js, portal/src/portal/teacher/notices/ReadyForYou.quizOffer.test.tsx.
  @TH16
  Scenario: Teacher app v2: when today's WhatsApp quiz offer could not reach the teacher, Home lists "Make today's quiz" and its tap opens the quiz home
    Given the teacher app v2 is on and the quiz card is on
    And today's 15:00 quiz offer for the demo teacher was skipped because the WhatsApp window was shut, for the lesson "Comparing fractions"
    And the demo teacher is signed in on a 360 px phone
    When the teacher opens /portal/teacher
    Then "Ready for you" lists "Make today's quiz" with "Quiz · Comparing fractions"
    When the teacher taps it
    Then the page goes to /quiz/teacher/<token>
    And the offer row is stamped as opened from the app, and keeps its status and reason
    And the card is no longer on Home
    And no page error or 5xx happened

  @TH17
  Scenario: Teacher app v2: the quiz card reads in Urdu for a teacher whose language is Urdu
    Given the quiz card is on, today's quiz offer was skipped for a shut window, and the teacher's language is Urdu
    When the teacher opens /portal/teacher
    Then "Ready for you" lists «آج کا کوئز بنائیں» with «کوئز»
    And no page error or 5xx happened

  @TH18
  Scenario: Teacher app v2: with the quiz card switch off, a skipped quiz offer adds nothing to Home
    Given the quiz card is off, and today's quiz offer was skipped for a shut window
    When the teacher opens /portal/teacher
    Then Home lists no quiz card
