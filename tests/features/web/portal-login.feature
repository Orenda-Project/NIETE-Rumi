Feature: Portal sign-in
  # The teacher + coach portal's login page (portal/src/portal/pages/PortalLogin.tsx), driven in a real browser
  # by the web lane: `npm run e2e:web -- portal-login` (scripts/qa/e2e-web.sh, bd-hnhlgn.5).
  # Runs on the local stack with the demo school network (bot/scripts/e2e/portal-demo-seed.js, password Demo2026).
  # Server statuses → messages: portal/src/portal/auth/errors.ts (401 wrongPw, 400 checkNum; bd-x7aprz.3: 403 → back to
  # the WhatsApp code "Log in by code", 404 → "Register on WhatsApp" — never "No password yet" / "No account found").
  # bd-x7aprz.3: the page opens on the WhatsApp code; "she enters … and the password …" taps "Use password instead" first.

  Background:
    Given the portal is open at /portal/login

  # Where a sign-in LANDS depends on the app switches (app_settings portal_teacher_v2 / portal_coach_v2), so every
  # home scenario sets them first, on the run's own database. "Lands on" = where the URL settles, not its first stop:
  # login goes /portal/dashboard -> /portal/leader (a leader) -> /portal/teacher (teacher app v2).

  @PL01
  Scenario: Classic portal: a teacher signs in and lands on her dashboard
    Given the teacher app v2 and the coach app v2 are off
    When she enters demo teacher 03000000911 and the password Demo2026
    And she taps Log in
    Then she is on /portal/dashboard

  @PL02
  Scenario: Classic portal: a principal signs in and lands on the leader portal
    Given the teacher app v2 and the coach app v2 are off
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
  Scenario: A number that is not registered is offered Register on WhatsApp, never "No account found"
    When she enters 03009999999 and any password
    And she taps Log in
    Then a "Register on WhatsApp" button opens the bot's chat with /register typed
    And the page never says "No account found"

  @PL05
  Scenario: A malformed number is stopped before it is sent
    When she enters 12345 and any password
    And she taps Log in
    Then the phone box is marked invalid and says "Check the number"
    And no /login request was sent

  @PL06
  Scenario: An account with no password yet is sent to the WhatsApp code, not shown an error page
    # bd-vdstfr / NIETE #2048: this answered 500 before the fix; now 403 PASSWORD_NOT_SET (bd-x7aprz.3: → the code).
    Given demo teacher 03000000919 is activated but has no password saved
    When she enters 03000000919 and any password
    And she taps Log in
    Then the page says "Log in by code" and offers Send code

  @PL07
  Scenario: Forgot password opens the reset page with her number carried over
    Given she taps Use password instead
    When she enters demo teacher 03000000911
    And she taps Forgot password
    Then she is on /portal/reset-password

  @PL08
  Scenario: Teacher app v2: a teacher signs in and lands on the teacher home
    Given the teacher app v2 is on and the coach app v2 is off
    When she enters demo teacher 03000000911 and the password Demo2026
    And she taps Log in
    Then she settles on /portal/teacher

  @PL09
  Scenario: Teacher app v2: a principal lands on the teacher home too (the teacher app plus her school)
    Given the teacher app v2 is on and the coach app v2 is off
    When he enters demo principal 03000000902 and the password Demo2026
    And he taps Log in
    Then he settles on /portal/teacher

  @PL10
  Scenario: Coach app v2: a coach signs in and lands on the coach home
    Given the teacher app v2 is off and the coach app v2 is on
    When she enters demo coach 03000000901 and the password Demo2026
    And she taps Log in
    Then she settles on /portal/coach

  @PL11
  Scenario: One-tap sign-in from WhatsApp: /menu sends a link that opens her teacher home, signed in
    # The whole round trip on one local stack (bd-hnhlgn.7): the bot behind the mock WhatsApp (Graph API), the portal,
    # one database. Link: bot/shared/services/app-redirect.service.js sendAppLink → <PORTAL_URL>/go/<token>;
    # consumed by dashboard/routes/app-login.routes.js GET /go/:token (session, then 303 to her home).
    Given "Open the NIETE app" from /menu is on for teachers (app_redirect_menu = "teachers")
    And the teacher app v2 is on
    When demo teacher 923000000911 sends /menu on the mock WhatsApp
    Then the bot replies with a link to this run's portal at /go/<token>
    When she opens that link in the browser
    Then she settles on /portal/teacher, signed in, without typing a password

  @PL12
  Scenario: A code on WhatsApp signs her in: number, Send code, the code, her dashboard — no password
    # bd-x7aprz.3: POST /api/portal/request-code → the bot's portal_password_reset_niete template (mock WhatsApp);
    # POST /api/portal/verify-code opens the session. The scenario sets a known code on the run's own database.
    Given the teacher app v2 and the coach app v2 are off
    When she enters demo teacher 03000000911
    And she taps Send code
    Then the code step opens, saying it was sent on WhatsApp
    When she enters the code
    And she taps Log in
    Then she is on /portal/dashboard

  @PL13
  Scenario: One-tap sign-in from a Send to teacher message lands on the FLN plan, whatever the teacher-app switch says
    # PR-E (m-links): a /go token whose feature is fln:<id> (bot/shared/services/fln-go-target.js) is signable
    # (app-login-link.js linkable) and lands on /portal/fln/p/<id>?src=send (app-login.routes.js landing line).
    # Every other /go feature lands exactly where it did before (PL11 unchanged).
    Given the bot minted a /go link for the demo teacher with the target fln:11156
    And the teacher app v2 is off for the demo teacher
    When the demo teacher opens that link in the browser
    Then the teacher settles on /portal/fln/p/11156, signed in, without typing a password
    When the link is altered by one character
    Then the "get a new link" page opens and nobody is signed in

  # Run on sandbox by the QA agent: nothing in the bot mints this link yet (the report button's sender will call
  # signAppLink(userId, 'assessment_report', journeyId, {grade, subject, chapter})), so the run mints it by hand.
  @sandbox
  Scenario: One-tap sign-in from the class report's Make a test button opens the paper maker with the class filled in
    # app-login-link.js: the assessment_report token may carry {grade, subject, chapter}; app-login.routes.js lands on
    # /portal/teacher/assessment/new/class?origin=report&grade=&subject=&chapter= (bd-pw1ccr.2). Every other /go
    # feature lands exactly where it did before (PL11, PL13 unchanged).
    Given a /go link for the demo teacher with the target assessment_report, Grade 3, English, chapter 4
    And the teacher app v2 is on for the demo teacher
    When the demo teacher opens that link in the browser
    Then she is signed in without typing a password
    And the paper maker shows Grade 3, English, chapter 4 chosen, on the step after Class
    When the same link is opened by a teacher who is not on the teacher app v2
    Then she lands on today's portal home

  @PL14
  Scenario: The analytics accounts' own sign-in asks for an account name and a password only, and a refused name stays on it
    # portal/src/portal/auth/AnalyticsLogin.tsx at /portal/analytics/login: no phone, no Send code, no "Use … instead",
    # no Forgot password. The server answers a wrong name and a wrong password with one 401 (loginByAccountName), so
    # the page says "Couldn't log in"; the API client's 401 handler leaves her on this page, never /portal/login.
    When she opens /portal/analytics/login
    Then it asks for an account name and a password, with one Log in button
    And it offers no phone number, no Send code, no "Use … instead" and no Forgot password
    When she enters the account name no_such_account and any password
    And she taps Log in
    Then the page says "Couldn't log in"
    And she is still on /portal/analytics/login
