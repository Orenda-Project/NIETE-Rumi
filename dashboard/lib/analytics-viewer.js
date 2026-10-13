/**
 * Server-side gate for the analytics-only endpoints (school-wise analytics for federal and
 * sector officials). Sits beside makeRequireLeaderRole and follows its shape: runs AFTER
 * requirePortalAuth, 403s whoever is not allowed, 500s when it cannot check.
 *
 * Who is allowed is ONE app_settings row, portal_analytics_only: a JSON array of users.id.
 * It is not a role — the account's users.role stays 'unregistered' — so every leader and
 * teacher endpoint already turns these accounts away, and this gate turns everyone else
 * away from theirs.
 *
 * Fail-closed in both directions: not on the list is 403; a failed read of the list is a
 * 500 ("try again"), and neither ever calls next().
 */

/**
 * @param {{getViewerIds: () => Promise<string[]>}} deps resolves the list; THROWS when it
 *   cannot be read (feature-flags.readUserListFlag)
 */
function makeRequireAnalyticsViewer({ getViewerIds }) {
  return async function requireAnalyticsViewer(req, res, next) {
    const userId = req.session && req.session.portalUserId;
    let ids;
    try {
      ids = await getViewerIds();
    } catch (err) {
      console.error('requireAnalyticsViewer: could not read the viewer list:', err && err.message);
      return res.status(500).json({
        success: false,
        error: 'Could not verify access. Please try again.',
      });
    }
    if (!userId || !Array.isArray(ids) || !ids.includes(userId)) {
      return res.status(403).json({
        success: false,
        error: 'This page is for analytics accounts only.',
      });
    }
    return next();
  };
}

module.exports = { makeRequireAnalyticsViewer };
