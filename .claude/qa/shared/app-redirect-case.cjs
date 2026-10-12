'use strict';
/* app-redirect-case.cjs — the one step every app-redirect scenario takes (bd-z3ze4).
 *
 * A feature "moved to the NIETE app" is a GLOBAL switch: app_settings.app_redirect_<feature>, read by every
 * teacher (bot/shared/services/app-redirect.service.js). A scenario may only turn one on where it reaches
 * nobody else — the run's own local database (E2E_LOCAL_DB=1); api.setAppSetting refuses anywhere else.
 *
 *   const r = await withRedirect(api, 'app_redirect_teacher_training', async () => { …drive, return evidence… });
 *   r.ran === false → record BLOCKED with r.reason (shared sandbox, or the chrome lane).
 *
 * Before the scenario runs, the driver's quiet-hour marker is cleared: the notice goes out once per teacher
 * per hour ACROSS every switch, so an earlier redirect scenario on the same driver would otherwise silence
 * this one. The switch is put back whatever happens — even if the scenario throws.
 */

const STORE_LINK = /play\.google\.com\/store\/apps/i;

/** Does this reply carry the Play Store notice? (the link is the one thing both languages share) */
function isStoreNotice(txt) { return STORE_LINK.test(String(txt || '')); }

async function withRedirect(api, key, scenario) {
  if (!api || typeof api.setAppSetting !== 'function') return { ran: false, reason: 'GLOBAL_SWITCH: this lane cannot flip app_settings' };
  const flip = await api.setAppSetting(key, true);
  if (!flip || !flip.ok) return { ran: false, reason: (flip && flip.err) || 'GLOBAL_SWITCH' };
  try {
    if (typeof api.resetRedirectNotice === 'function') await api.resetRedirectNotice();
    return { ran: true, value: await scenario() };
  } finally {
    await api.restoreAppSettings();
  }
}

/** The BLOCKED reason a redirect scenario records off the local lane. */
const REDIRECT_BLOCKED = 'needs an app_redirect_* switch turned ON, and the switch is global: on a shared database it would redirect every teacher for the length of the run. Runs on the local lane (E2E_LOCAL_DB=1), where the database is the run\'s own. Covered by tests/app-redirect/ (red-first).';

module.exports = { withRedirect, isStoreNotice, REDIRECT_BLOCKED };
