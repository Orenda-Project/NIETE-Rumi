/**
 * v10 coaching test (bd-v0toag.12): log every report part a teacher is sent.
 *
 * One tracker per report. `opts(part)` goes to the sender, which hands back Meta's message id
 * (the wamid); `record(part, ok, error)` logs coaching.report.sent or coaching.report.failed with
 * that wamid and the school's group. Delivered and read are NOT stored here: the status webhook
 * already logs every delivered/read with its wamid (data_json.messageWamid), and the tracker joins
 * the two on the wamid. Only while ab_v10_enabled is on. Never throws.
 */

const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { v10Enabled } = require('./ab-v10-switch');
const { groupFor } = require('./ab-v10-arms');

function createReportTracker({ coachingSessionId, userId }) {
  const wamids = {};
  let group; // undefined = not read yet; a promise once read

  function opts(part) {
    return { onMessageId: (id) => { if (id) wamids[part] = id; } };
  }

  async function record(part, ok, error = null) {
    try {
      if (!(await v10Enabled())) return;
      if (group === undefined) group = groupFor(userId).catch(() => null);
      const g = await group;
      logEvent(ok ? 'coaching.report.sent' : 'coaching.report.failed', {
        coachingSessionId,
        userId,
        part,
        wamid: wamids[part] || null,
        group: g ? g.group : null,
        report: g ? g.report : null,
        error: error ? error.message || String(error) : null,
      });
    } catch (err) {
      logToFile('v10 test: report tracking failed (the report itself is unaffected)', {
        coachingSessionId, part, error: err.message,
      });
    }
  }

  return { opts, record };
}

module.exports = { createReportTracker };
