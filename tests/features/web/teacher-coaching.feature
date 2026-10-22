Feature: Teacher digital coaching and coach visits
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- teacher-coaching`. Covers: portal/src/portal/teacher/coaching/**, teacher/observations/**, PortalCoaching*.tsx.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @TC01
  Scenario: Teacher app v2: Digital Coaching lists her recent observations
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher/coaching
    Then Digital Coaching shows "Recent DC Observations" with at least one

  @TC02
  Scenario: Teacher app v2: coach visits (Observations) open
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher/observations
    Then Observations opens

  @TC03
  Scenario: Classic portal: Coaching opens
    Given the teacher app v2 and the coach app v2 are off
    And demo teacher 03000000911 is signed in
    When she opens /portal/coaching
    Then Coaching opens

  @TC04
  Scenario: Teacher app v2: Start DC observation opens its one screen
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher/coaching/new
    Then the one screen opens on "Start DC observation"

  @TC05
  Scenario: Teacher app v2: the link for a recording kept from WhatsApp opens the one screen
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher/coaching/new?recording=whatsapp
    Then the one screen opens on "Start DC observation"
