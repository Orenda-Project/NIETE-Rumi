'use strict';
/**
 * bd-chz35n.25 (1) — the "Open my report" button on the closed-window report template.
 *
 * The 25 Nov trace: when her 24 h window is closed the report goes as share_dc_report_v1 (image, no buttons) and the
 * free-form link message after it is skipped (report-window-send followUpsAllowed), so a third of new reports never
 * got the link. With report_delivery_fixes.template_link naming an approved template (the dc header and body plus a
 * URL button `<portal>/cr/{{1}}`), a new-report teacher's closed-window report goes as that template, the button's
 * parameter being her /cr token (report-link-token.js).
 *
 * { template, token } — the same shape share-send takes as `clip` (one URL button with one parameter) — or null: the
 * switch off, a teacher without the new report (groupFor), or no token (key or Supabase host missing). Never throws.
 */

const { groupFor } = require('./ab-v10-arms');
const { current } = require('./report-delivery-switch');
const { signReportLink } = require('./report-link-token');

async function linkButtonFor({ userId, sessionId } = {}) {
  try {
    if (!userId || !sessionId) return null;
    const { linkTemplate } = await current();
    if (!linkTemplate) return null;
    const g = await groupFor(userId);
    if (!g || g.report !== 'new') return null;
    const token = signReportLink({ sessionId, userId });
    return token ? { template: linkTemplate, token } : null;
  } catch (_) {
    return null;
  }
}

module.exports = { linkButtonFor };
