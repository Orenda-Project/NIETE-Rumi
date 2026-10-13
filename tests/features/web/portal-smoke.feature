Feature: Portal-wide smoke — every main page, every role
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- portal-smoke`. Covers: the web lane's SAFE subset: selected for shared plumbing (App.tsx, api.ts, the UI kit) and any portal file no area claims.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @PS01
  Scenario: Teacher app v2: every main page opens healthy
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher
    Then it opens healthy
    When she opens /portal/teacher/lessons
    Then it opens healthy
    When she opens /portal/teacher/coaching
    Then it opens healthy
    When she opens /portal/teacher/observations
    Then it opens healthy
    When she opens /portal/teacher/training
    Then it opens healthy
    When she opens /portal/teacher/assessment
    Then it opens healthy
    When she opens /portal/teacher/attendance
    Then it opens healthy
    When she opens /portal/teacher/classes
    Then it opens healthy
    When she opens /portal/teacher/analytics
    Then it opens healthy
    When she opens /portal/teacher/more
    Then it opens healthy
    When she opens /portal/teacher/profile
    Then it opens healthy

  @PS02
  Scenario: Classic portal (teacher): every main page opens healthy
    Given the teacher app v2 and the coach app v2 are off
    And demo teacher 03000000911 is signed in
    When she opens /portal/dashboard
    Then it opens healthy
    When she opens /portal/curriculum
    Then it opens healthy
    When she opens /portal/coaching
    Then it opens healthy
    When she opens /portal/training
    Then it opens healthy
    When she opens /portal/classes
    Then it opens healthy
    When she opens /portal/assessment
    Then it opens healthy
    When she opens /portal/account
    Then it opens healthy

  @PS03
  Scenario: Coach app v2: every main page opens healthy
    Given the teacher app v2 is off and the coach app v2 is on
    And demo coach 03000000901 is signed in
    When she opens /portal/coach
    Then it opens healthy
    When she opens /portal/coach/people
    Then it opens healthy
    When she opens /portal/coach/schedule
    Then it opens healthy
    When she opens /portal/coach/team
    Then it opens healthy
    When she opens /portal/coach/reports
    Then it opens healthy
    When she opens /portal/coach/analytics
    Then it opens healthy
    When she opens /portal/coach/observe
    Then it opens healthy
    When she opens /portal/coach/more
    Then it opens healthy
    When she opens /portal/coach/profile
    Then it opens healthy

  @PS04
  Scenario: Leader portal: every main page opens healthy
    Given the teacher app v2 and the coach app v2 are off
    And demo principal 03000000902 is signed in
    When she opens /portal/leader
    Then it opens healthy
    When she opens /portal/leader/teachers
    Then it opens healthy
    When she opens /portal/leader/observations
    Then it opens healthy
    When she opens /portal/leader/school-analytics
    Then it opens healthy
    When she opens /portal/leader/lessons
    Then it opens healthy
    When she opens /portal/leader/child-test
    Then it opens healthy

  @PS05
  Scenario: Signed out: login, password reset, privacy and delete-account open healthy
    Given nobody is signed in
    When she opens /portal/login
    Then it opens healthy
    When she opens /portal/reset-password
    Then it opens healthy
    When she opens /portal/privacy
    Then it opens healthy
    When she opens /portal/delete-account
    Then it opens healthy
