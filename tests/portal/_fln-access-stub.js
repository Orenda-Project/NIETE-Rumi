'use strict';
/**
 * A FAITHFUL stub of m-app's `dashboard/lib/fln-access.js` (PR-C) for the FLN route suites: the same
 * exports and the same middleware order [noStore, requirePortalAuth (401), gate (404 when the access answer says no)].
 * Only `flnAccess` is supplied by the test. Suites INJECT it (`createFlnLinksRouter({ access })`) rather than mocking
 * the module: a `{ virtual: true }` mock of a path that exists once PR-C lands is not reliably applied when another
 * suite in the same jest worker has already resolved the real file.
 */
module.exports = function makeAccessStub(flnAccess) {
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); return next(); };
  const requirePortalAuth = (req, res, next) => {
    if (!req.session || !req.session.portalUserId) {
      return res.status(401).json({ success: false, error: 'Not authenticated. Please log in.' });
    }
    return next();
  };
  const gate = (what) => async (req, res, next) => {
    let access;
    try { access = await flnAccess(req.session.portalUserId); } catch (_) { access = { lessons: false, share: false }; }
    if (!access[what]) return res.status(404).json({ error: 'not_found' });
    req.fln = access;
    return next();
  };
  return {
    flnAccess,
    noStore,
    requirePortalAuth,
    FLN_LESSONS_KEY: 'portal_fln_lessons',
    FLN_SHARE_KEY: 'portal_fln_share',
    requireFln: Object.freeze({ lessons: [noStore, requirePortalAuth, gate('lessons')], share: [noStore, requirePortalAuth, gate('share')] }),
  };
};
