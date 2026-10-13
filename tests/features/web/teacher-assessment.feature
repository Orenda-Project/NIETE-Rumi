Feature: Teacher assessment
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- teacher-assessment`. Covers: portal/src/portal/teacher/assessment/**, PortalAssessment.tsx, ClassicAssessment.tsx, newui/assessment/**.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @TA01
  Scenario: Teacher app v2: Assessment opens
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher/assessment
    Then Assessment opens

  @TA02
  Scenario: Classic portal: Assessment opens
    Given the teacher app v2 and the coach app v2 are off
    And demo teacher 03000000911 is signed in
    When she opens /portal/assessment
    Then Assessment opens
