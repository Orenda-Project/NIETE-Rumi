Feature: Teacher training
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- teacher-training`. Covers: portal/src/portal/teacher/training/**, PortalTraining*.tsx, PortalVideo*.tsx.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @TT01
  Scenario: Teacher app v2: Training lists her courses
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher/training
    Then Training shows "Courses" with at least one

  @TT02
  Scenario: Classic portal: Training opens
    Given the teacher app v2 and the coach app v2 are off
    And demo teacher 03000000911 is signed in
    When she opens /portal/training
    Then Training opens

  # TT03 (bd-te5lae, 19 Oct 2026): the written capstone exam submit used to answer 500 on the portal ("Cannot find
  # module 'dotenv'") and the teacher could never finish a level. Marking now goes to the bot over the internal API
  # inside a 90 s deadline, under a 120 s route budget. Covers TrainingLevelExam.tsx, trainingApi.ts and the capstone
  # attempts route in portal.routes.js.
  @TT03 @draft
  Scenario: A teacher submits the written capstone exam: it is marked and recorded, and a marking outage records nothing
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in and has unlocked a level with a written capstone exam
    When they answer every question and submit the exam
    Then the attempt is marked and recorded once, and the result shows their score
    When marking is unavailable and they submit the exam again
    Then the screen says "Not sent" with the server's words that nothing has been recorded
    And their answers are still in the form

  # TT04 (bd-yef5iq.6 + bd-gbf8ix, 26 Oct 2026): I-SAPS module pages lost their reading list when the vendor was
  # renamed (it was matched by name); it is now matched on the vendor key, and Level 2 has its own list.
  @TT04
  Scenario: An I-SAPS module page shows the partner's required reading, under the renamed programme
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in and can open an I-SAPS Module 1 course
    When she opens that course's module page
    Then it lists the partner's required reading, each with a link
