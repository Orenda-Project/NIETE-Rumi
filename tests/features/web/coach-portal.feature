Feature: Coach app
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- coach-portal`. Covers: portal/src/portal/coach/**.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @CP01
  Scenario: Coach app v2: her home sends her to the Training Library
    Given the teacher app v2 is off and the coach app v2 is on
    And demo coach 03000000901 is signed in
    When she opens /portal/coach
    Then /portal/coach settles on /portal/coach/training, with "Training Library"

  @CP02
  Scenario: Coach app v2: Schools & teachers, My schedule and Team schedule send her to the Training Library
    Given the teacher app v2 is off and the coach app v2 is on
    And demo coach 03000000901 is signed in
    When she opens /portal/coach/people
    Then /portal/coach/people settles on /portal/coach/training
    When she opens /portal/coach/schedule
    Then /portal/coach/schedule settles on /portal/coach/training
    When she opens /portal/coach/team
    Then /portal/coach/team settles on /portal/coach/training

  @CP03
  Scenario: Coach app v2: Reports and Analytics send her to the Training Library
    Given the teacher app v2 is off and the coach app v2 is on
    And demo coach 03000000901 is signed in
    When she opens /portal/coach/reports
    Then /portal/coach/reports settles on /portal/coach/training
    When she opens /portal/coach/analytics
    Then /portal/coach/analytics settles on /portal/coach/training

  @CP04
  Scenario: Coach app v2: Observe sends her to the Training Library; More and My profile open
    Given the teacher app v2 is off and the coach app v2 is on
    And demo coach 03000000901 is signed in
    When she opens /portal/coach/observe
    Then /portal/coach/observe settles on /portal/coach/training
    When she opens /portal/coach/more
    Then More opens
    When she opens /portal/coach/profile
    Then My profile opens

  @CP05
  Scenario: Coach app v2: a teacher's disagreement opens as the card, and The teacher was right flags the report
    Given the teacher app v2 is off and the coach app v2 is on
    And the coach disagreement card is on
    And demo teacher 03000000911 disagrees with her latest DC report because of her score
    And demo coach 03000000901 is signed in
    When she opens /portal/coach/disagreements
    Then the teacher's request is on the To do list
    When she opens it
    Then the score reason is one line ending "Details in B."
    And the card shows "Is this a pattern?" and the coaching suggestion
    When she taps "The teacher was right"
    Then it says the report was sent to the DC team for review
    And the request is flagged for the DC team
    And no page error or 5xx happened

  @CP06
  Scenario: Coach app v2: a disagreement added to her next visit shows at the top of her disagreements list and opens its card
    Given the teacher app v2 is off and the coach app v2 is on
    And the coach disagreement card is on
    And demo teacher 03000000911 disagrees with her latest DC report because of her score
    And the coach added it to her next visit
    And demo coach 03000000901 is signed in
    When she opens /portal/coach/disagreements
    Then For your next visit lists the teacher's request
    When she opens it
    Then the teacher's card opens
    And no page error or 5xx happened

  # The School card, with its switch (portal_coach_school_card) on and off. The driver waits for /config to agree
  # with the switch (the dashboard caches it 30 s) and puts it back OFF after every scenario.
  @CP07
  Scenario: Coach app v2 with the School card on: her home is the slim Coach Home, the menu is Home, Lesson Plans and More, and the hidden pages land on Home
    Given the teacher app v2 is off and the coach app v2 is on
    And the School card is on
    And demo coach 03000000901 is signed in
    When she opens /portal/coach
    Then it is the slim Coach Home with exactly two tiles, Training Library and My schools
    And the menu is Home, Lesson Plans and More
    When she opens Schedule, My schedule, Team schedule, New visit, Observe, Reports, Analytics or Insights
    Then each settles on /portal/coach
    And no page error or 5xx happened

  @CP08
  Scenario: Coach app v2 with the School card on: a school opens as its School card; This month, a feature's grid and a teacher's page open from it
    Given the teacher app v2 is off and the coach app v2 is on
    And the School card is on
    And demo coach 03000000901 is signed in
    When she opens /portal/coach/school/DEMO-001
    Then it shows the period chips Today, This week and This month, the Digital Coaching and Coach observations tiles first, then Lesson plans, Assessments and Training parts, and the Manage group
    And there is no Share with principal and no Schedule a visit
    When she taps "This month"
    Then the Lesson plans tile shows one bar per week, from "Wk 1"
    When she taps the Lesson plans tile
    Then "Lesson plans by teacher" opens for This month, with a row per teacher and the School row
    When she taps a teacher's row
    Then her Teacher page opens with the Digital Coaching and Coach observations tiles first
    When she taps her Digital Coaching tile
    Then her Digital Coaching page opens for This month
    And no page error or 5xx happened

  @CP09
  Scenario: Coach app v2 with the School card on: a teacher's DC report opens in the coach's view, with no transcript
    Given the teacher app v2 is off and the coach app v2 is on
    And the School card is on
    And a teacher at one of demo coach 03000000901's schools has a completed DC report
    And demo coach 03000000901 is signed in
    When she opens that report at /portal/coach/session/<its id>
    Then "Report" opens with the overall AI score and the "Coach view" chip
    And it shows no transcript and no "Focus here"
    And no page error or 5xx happened

  @CP10
  Scenario: Coach app v2 with the School card off: her home is the Training Library, a school opens as before, and the School card's own pages do not open
    Given the teacher app v2 is off and the coach app v2 is on
    And the School card is off
    And demo coach 03000000901 is signed in
    When she opens /portal/coach
    Then /portal/coach settles on /portal/coach/training
    When she opens a School card DC report address, /portal/coach/session/<id>
    Then it settles on /portal/coach/training
    When she opens /portal/coach/school/DEMO-001
    Then it is today's school page, with "Visits · last 3 months" and no School card
    And the menu has no Home
    And no page error or 5xx happened

  @CP11
  Scenario: Coach app v2 with the School card on: Digital Coaching by teacher opens a teacher's Digital Coaching page, whose report opens in the coach's view, and her old addresses open her pages
    Given the teacher app v2 is off and the coach app v2 is on
    And the School card is on
    And a teacher at one of demo coach 03000000901's schools has a scored DC report this month
    And demo coach 03000000901 is signed in
    When she opens Digital Coaching by teacher for that teacher's school, This month
    Then that teacher's row shows her observations and her average
    When she taps that teacher's row
    Then her Digital Coaching page opens with the average, the graph, "Average by practice" and "Her reports"
    When she taps her first report
    Then that DC report opens in the coach's view
    When she opens /portal/coach/teacher/<her number>/observations?period=month
    Then her Coach observations page opens
    When she opens /portal/coach/teacher/<her number>/reports
    Then it settles on her Digital Coaching page
    And no page error or 5xx happened

  @CP12
  Scenario: Coach app v2 with the School card on: a teacher's reviewed coach observation opens in the coach's report view with its Coach score
    Given the teacher app v2 is off and the coach app v2 is on
    And the School card is on
    And a teacher at one of demo coach 03000000901's schools has a reviewed coach observation
    And demo coach 03000000901 is signed in
    When she opens that observation at /portal/coach/session/<its id>
    Then "Report" opens with the Coach score and the "Coach view" chip
    And it shows no transcript and no "Focus here"
    And no page error or 5xx happened

  # bd-4joiqz — the coach app's Lesson Plans tab: the teacher Lesson Plans pages, read as a leader. Written by hand; the
  # web driver has no code for it yet (@draft). The full journey is teacher-lessons LDR01.
  @LDR07 @draft
  Scenario: Coach app v2: Lesson Plans is in their menu and opens the Lesson Plans pages; their other pages still land on the Training Library
    Given the teacher app v2 is off and the coach app v2 is on
    And demo coach 03000000901 is signed in
    When they open /portal/coach/training
    Then the menu is Training Library, Lesson Plans and More
    When they open /portal/teacher/lessons/new
    Then it opens healthy and stays on /portal/teacher/lessons/new
    When they open /portal/teacher/coaching
    Then /portal/teacher/coaching settles on /portal/coach/training
    When they open /portal/teacher/lessons/all
    Then /portal/teacher/lessons/all does not open for them
