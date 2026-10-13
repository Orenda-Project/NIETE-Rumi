Feature: Portal sign-in
  # The teacher + coach portal's login page (portal/src/portal/pages/PortalLogin.tsx), driven in a real browser
  # by the web lane: `npm run e2e:web -- portal-login` (scripts/qa/e2e-web.sh, bd-hnhlgn.5).
  # Runs on the local stack with the demo school network (bot/scripts/e2e/portal-demo-seed.js, password Demo2026).
  # Server statuses → field messages: portal/src/portal/auth/errors.ts (401 wrongPw, 403 noPw, 404 noAccount, 400 checkNum).

  Background:
    Given the portal is open at /portal/login

  @PL01
  Scenario: A teacher signs in and lands on her dashboard
    When she enters demo teacher 03000000911 and the password Demo2026
    And she taps Log in
    Then she is on /portal/dashboard

  @PL02
  Scenario: A principal signs in and lands on the leader portal
    When he enters demo principal 03000000902 and the password Demo2026
    And he taps Log in
    Then he is on /portal/leader

  @PL03
  Scenario: A wrong password is named under the password box
    When she enters demo teacher 03000000911 and the password not-her-password
    And she taps Log in
    Then the password box is marked invalid and says "Wrong password"
    And she is still on /portal/login

  @PL04
  Scenario: A number with no account is named under the phone box
    When she enters 03009999999 and any password
    And she taps Log in
    Then the phone box is marked invalid and says "No account found"

  @PL05
  Scenario: A malformed number is stopped before it is sent
    When she enters 12345 and any password
    And she taps Log in
    Then the phone box is marked invalid and says "Check the number"
    And no /login request was sent

  @PL06
  Scenario: An activated account with no password yet is told so, not shown an error page
    # bd-vdstfr / NIETE #2048: this answered 500 before the fix; now 403 PASSWORD_NOT_SET.
    Given demo teacher 03000000919 is activated but has no password saved
    When she enters 03000000919 and any password
    And she taps Log in
    Then the password box is marked invalid and says "No password yet"

  @PL07
  Scenario: Forgot password opens the reset page with her number carried over
    When she enters demo teacher 03000000911
    And she taps Forgot password
    Then she is on /portal/reset-password
