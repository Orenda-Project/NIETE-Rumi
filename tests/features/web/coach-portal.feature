Feature: Coach app
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- coach-portal`. Covers: portal/src/portal/coach/**.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @CP01
  Scenario: Coach app v2: her home greets her and shows today's visits
    Given the teacher app v2 is off and the coach app v2 is on
    And demo coach 03000000901 is signed in
    When she opens /portal/coach
    Then her home shows "Today's visits"

  @CP02
  Scenario: Coach app v2: Schools & teachers, My schedule and Team schedule open
    Given the teacher app v2 is off and the coach app v2 is on
    And demo coach 03000000901 is signed in
    When she opens /portal/coach/people
    Then Schools & teachers opens
    When she opens /portal/coach/schedule
    Then My schedule opens
    When she opens /portal/coach/team
    Then Team schedule opens

  @CP03
  Scenario: Coach app v2: Reports open, and Analytics counts her teachers
    Given the teacher app v2 is off and the coach app v2 is on
    And demo coach 03000000901 is signed in
    When she opens /portal/coach/reports
    Then Reports opens
    When she opens /portal/coach/analytics
    Then Analytics shows "Teachers" with at least one

  @CP04
  Scenario: Coach app v2: Observe, More and My profile open
    Given the teacher app v2 is off and the coach app v2 is on
    And demo coach 03000000901 is signed in
    When she opens /portal/coach/observe
    Then Observe opens
    When she opens /portal/coach/more
    Then More opens
    When she opens /portal/coach/profile
    Then My profile opens
