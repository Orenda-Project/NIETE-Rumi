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
