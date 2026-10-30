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
 * WHOSE regions it sees (bd-97daxo.3) is its organization, attached as req.analyticsOrganization: the
 * account's entry in app_settings portal_analytics_organizations ({"<users.id>": "<organization>"}), or
 * DEFAULT_ANALYTICS_ORGANIZATION ('niete', FDE's programme) when it has none — so every account that existed
 * before organizations sees what it saw. The routes turn the organization into its regions through the
 * region registry (bot/shared/services/region-registry.js).
 *
 * Fail-closed in every direction: not on the list is 403; a failed read of the list, or of the
 * organization map, or an entry that is not a non-empty string, is a 500 ("try again"), and none
 * of them ever calls next(). The map is read only for an account on the list.
 */

/** The organization an analytics account belongs to when the organization map does not name it: FDE's. */
const DEFAULT_ANALYTICS_ORGANIZATION = 'niete';

const TRY_AGAIN = Object.freeze({ success: false, error: 'Could not verify access. Please try again.' });

/**
 * @param {{
 *   getViewerIds: () => Promise<string[]>,
 *   getViewerOrganizations?: () => Promise<Record<string, unknown>>
 * }} deps getViewerIds resolves the list and THROWS when it cannot be read (feature-flags.readUserListFlag);
 *   getViewerOrganizations resolves the organization map and THROWS when it cannot be read or is malformed
 *   (feature-flags.readUserMapFlag). Without it every account is DEFAULT_ANALYTICS_ORGANIZATION.
 */
function makeRequireAnalyticsViewer({ getViewerIds, getViewerOrganizations = async () => ({}) }) {
  return async function requireAnalyticsViewer(req, res, next) {
    const userId = req.session && req.session.portalUserId;
    let ids;
    try {
      ids = await getViewerIds();
    } catch (err) {
      console.error('requireAnalyticsViewer: could not read the viewer list:', err && err.message);
      return res.status(500).json(TRY_AGAIN);
    }
    if (!userId || !Array.isArray(ids) || !ids.includes(userId)) {
      return res.status(403).json({
        success: false,
        error: 'This page is for analytics accounts only.',
      });
    }

    let organization = DEFAULT_ANALYTICS_ORGANIZATION;
    try {
      const map = await getViewerOrganizations();
      if (map && Object.prototype.hasOwnProperty.call(map, userId)) {
        const v = map[userId];
        if (typeof v !== 'string' || v.trim() === '') throw new Error(`organization entry for ${userId} is malformed`);
        organization = v.trim().toLowerCase();
      }
    } catch (err) {
      console.error('requireAnalyticsViewer: could not read the viewer organization:', err && err.message);
      return res.status(500).json(TRY_AGAIN);
    }
    req.analyticsOrganization = organization;
    return next();
  };
}

module.exports = { makeRequireAnalyticsViewer, DEFAULT_ANALYTICS_ORGANIZATION };
