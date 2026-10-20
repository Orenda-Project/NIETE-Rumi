'use strict';
/**
 * bd-z3cadk — ICT IAB row 23: what the portal's report page needs, beyond the narrative, to match her WhatsApp report.
 *
 *   duplicate    the same recording was sent before: the bot reused the earlier report (audio-hash-cache) and said so
 *                on WhatsApp; the page says so too.
 *   reportDate   the date of the report she is looking at — the ORIGINAL session's for a repeat (it said "today").
 *   lastAsked    the image's "Last time we asked" block, rebuilt from what the report stored (uptake-line.js).
 *
 * `read(id)` returns one of HER sessions (id, created_at, prioritized_action) or null. Any failure leaves the extra
 * out; it never breaks the report.
 */
const { lastAskedFromStored } = require('../../bot/shared/services/coaching/report-v2/uptake-line');

async function reportExtras(session, language, read) {
  const duplicate = !!session.duplicate_of_session_id;
  let reportDate = session.created_at;
  let lastAsked = null;
  try {
    if (duplicate) {
      const original = await read(session.duplicate_of_session_id);
      if (original && original.created_at) reportDate = original.created_at;
    }
    const card = session.prioritized_action;
    const lineage = card && Array.isArray(card.lineage) ? card.lineage : [];
    const priorId = lineage.length ? lineage[lineage.length - 1] : null;
    if (priorId) {
      const prior = await read(priorId);
      lastAsked = lastAskedFromStored(card, prior && prior.prioritized_action, language);
    }
  } catch (_) {
    /* the report shows without the extra */
  }
  return { duplicate, reportDate, lastAsked };
}

module.exports = { reportExtras };
