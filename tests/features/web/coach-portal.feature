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
