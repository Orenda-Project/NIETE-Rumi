/**
 * For portal route suites that are NOT about the sign-in check: every session user's account reads as live, at once,
 * with no database read.
 *
 * The portal's one sign-in check (dashboard/lib/portal-auth.js) also asks whether the session's account is still live
 * (users.deleted_at), and a session whose users row is retired or GONE is ended with a 401. A route suite's own fake
 * database rarely holds a users row for its session user, and some suites count every read ("nothing is read"), so
 * without this they would test the account check instead of their route.
 *
 * Only the account lookup is replaced. The rest of the check is the real one: no session user is still a 401 with the
 * same body and log line. The account check itself is pinned in tests/portal/portal-auth-retired-user.test.js.
 *
 * Call inside beforeEach, after jest.resetModules() and before the router is required:
 *
 *     installLivePortalAccounts();
 */
function installLivePortalAccounts() {
  jest.doMock('../../dashboard/lib/portal-auth', () => {
    const real = jest.requireActual('../../dashboard/lib/portal-auth');
    return { ...real, requirePortalAuth: real.createRequirePortalAuth({ accountState: () => 'live' }) };
  });
}

module.exports = { installLivePortalAccounts };
