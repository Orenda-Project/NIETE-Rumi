Feature: Account and the public legal pages
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- portal-account`. Covers: PortalAccount.tsx, PortalPrivacy.tsx, PortalDeleteAccount.tsx.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @PA01
  Scenario: Classic portal: My account opens
    Given the teacher app v2 and the coach app v2 are off
    And demo teacher 03000000911 is signed in
    When she opens /portal/account
    Then My account opens

  @PA02
  Scenario: Signed out: the privacy policy and the delete-account page open (Google Play needs both)
    Given nobody is signed in
    When she opens /portal/privacy
    Then the privacy policy opens
    When she opens /portal/delete-account
    Then the delete-account page opens
