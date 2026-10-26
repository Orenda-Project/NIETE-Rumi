Feature: School leader (principal) portal
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- leader-portal`. Covers: pages/Leader*.tsx, SchoolAnalytics.tsx, SchoolLessons.tsx.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @LP01
  Scenario: Classic portal: the principal's home greets him by name
    Given the teacher app v2 and the coach app v2 are off
    And demo principal 03000000902 is signed in
    When she opens /portal/leader
    Then his home greets him: "Assalam-o-alaikum, Demo Principal …"

  @LP02
  Scenario: Classic portal: Teachers and Observations open
    Given the teacher app v2 and the coach app v2 are off
    And demo principal 03000000902 is signed in
    When she opens /portal/leader/teachers
    Then Teachers opens
    When she opens /portal/leader/observations
    Then Observations opens

  @LP03
  Scenario: Classic portal: School Analytics and Observed lessons open; /portal/leader/attendance lands on School Analytics
    Given the teacher app v2 and the coach app v2 are off
    And demo principal 03000000902 is signed in
    When she opens /portal/leader/school-analytics
    Then School Analytics opens
    When she opens /portal/leader/lessons
    Then Observed lessons opens
    When she opens /portal/leader/attendance
    Then /portal/leader/attendance settles on School Analytics

  @LP04
  Scenario: Classic portal: the child test page opens (Urdu heading)
    Given the teacher app v2 and the coach app v2 are off
    And demo principal 03000000902 is signed in
    When she opens /portal/leader/child-test
    Then the child test page opens: "بچوں کا ٹیسٹ"

  @LP05
  Scenario: Learning assessment: the school search matches a school's EMIS and sector, and each row shows them
    Given the coach app v2 is on and Learning assessment is on for the signed-in coach, with every grade on
    When they open /portal/leader/assess
    Then each school row shows its sector and EMIS under the name, when the school has them
    When they type an EMIS number into "Find a school"
    Then only that school stays in the list and the count reads "1 of <total>"
