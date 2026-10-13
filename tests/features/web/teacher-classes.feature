Feature: Teacher classes and attendance
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- teacher-classes`. Covers: portal/src/portal/teacher/classes/**, teacher/attendance/**, PortalClasses.tsx.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @TK01
  Scenario: Teacher app v2: My Classes lists her class, and Attendance opens
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher/classes
    Then My Classes shows "Classes" with at least one
    When she opens /portal/teacher/attendance
    Then Attendance opens

  @TK02
  Scenario: Classic portal: My classes opens, and /portal/attendance lands on her analytics
    Given the teacher app v2 and the coach app v2 are off
    And demo teacher 03000000911 is signed in
    When she opens /portal/classes
    Then My classes opens
    When she opens /portal/attendance
    Then /portal/attendance settles on /portal/coaching/analytics, with Attendance
