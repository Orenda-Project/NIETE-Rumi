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

  @TK03
  Scenario: Teacher app v2: Remove class asks first; Keep leaves it, Remove takes it off My Classes
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    And she has added a class she was not already on
    When she opens that class and taps "Remove class"
    Then a tray asks first, with "Keep" and "Remove"
    When she taps "Keep"
    Then the tray closes and the class is still on her list
    When she taps "Remove class" again and then "Remove"
    Then she is back on My Classes with one class fewer, and that class is not listed
    And no page error or 5xx happened

  @TK04
  Scenario: Teacher app v2: Add students is rows, numbered from 1, and saves each name as typed
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    And she has added a class she was not already on, with no students
    When she opens that class and taps "Add students"
    Then a page opens with two empty rows, roll 1 and roll 2, and no paste box
    When she types "Ayesha" in roll 1 and "Khan, Bilal" in roll 2
    And she taps "Add student" and types "Hira" in roll 3
    And she taps "Save 3 students"
    Then it says "3 students added"
    And the class roster is Ayesha, "Khan, Bilal" and Hira as rolls 1, 2 and 3, each name exactly as typed
    And no page error or 5xx happened

  @TK05
  Scenario: Teacher app v2: tapping a child opens Edit student; Save fixes the name and keeps the roll no
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    And she has added a class she was not already on, with one student "Fatma" as roll 1
    When she opens that class and taps the row for "Fatma"
    Then the Edit student tray opens with the name box focused and holding "Fatma"
    And "Save" is off until the name changes
    When she changes the name to "Fatima" and taps "Save"
    Then the tray closes and it says "Name saved"
    And the class roster is Fatima as roll 1, the same child, with no other student
    And the row has no bin; "Remove student" is inside the tray
    And no page error or 5xx happened

  @TK06
  Scenario: Teacher app v2: Add a class asks only class, section and shift; a class she is already on is not saved again
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    And she has added a class she was not already on
    When she opens Add a class
    Then there is no Subjects field, the year is shown on top, and the Section note says "No sections: select A"
    And "Save class" is off until a class, a section and a shift are all chosen
    When she chooses that same class, section and shift and taps "Save class"
    Then it says "Already on your list" with that class, and no class is posted
    When she taps "Open class"
    Then that class's page opens
    And no page error or 5xx happened
