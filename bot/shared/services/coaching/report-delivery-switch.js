'use strict';
/**
 * bd-chz35n.25 — the coaching report delivery fixes (25 Nov report-opens trace), one switch, OFF by default.
 *
 *   app_settings.report_delivery_fixes, a JSON object; every part is off unless set exactly:
 *     "template_link": "<template name>"  window closed → the report goes as this template: the dc share template's
 *                                          header and body plus a URL button `<PORTAL_URL>/cr/{{1}}` (report-link-button.js).
 *                                          Name it only once Meta has approved it on this number.
 *     "tip_wording":   true                the link message names the report's one thing to try (report-link-send.js)
 *     "time_on_page":  true                the /cr page records how long it stayed open (dashboard coaching-report.routes.js)
 *
 * No row, a value of another shape, or a failed read → all off: teachers get exactly today's report. 30 s cache.
 * Undo: delete the row, or set a part to false. The portal requires this file for parse() and fetchFrom() only, so it
 * loads nothing of the bot's at module scope (the portal has no pino).
 */

const KEY = 'report_delivery_fixes';
const TTL_MS = 30 * 1000;
const OFF = Object.freeze({ linkTemplate: null, tipWording: false, timeOnPage: false });

const truthy = (v) => v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');

/** The switch's parts from the row's value. Pure; anything unexpected is off. */
function parse(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return { ...OFF }; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...OFF };
  const name = typeof v.template_link === 'string' ? v.template_link.trim() : '';
  return { linkTemplate: name || null, tipWording: truthy(v.tip_wording), timeOnPage: truthy(v.time_on_page) };
}

/** One read through the given client. Throws on a failed read (the caller decides: off). */
async function fetchFrom(db) {
  const { data, error } = await db.from('app_settings').select('key,value').eq('key', KEY);
  if (error) throw new Error(error.message || 'app_settings read failed');
  const row = (data || [])[0];
  return parse(row ? row.value : undefined);
}

let cache = null;
function botCache() {
  if (!cache) {
    const { cachedSwitch } = require('../settings/switch-cache'); // eslint-disable-line global-require
    cache = cachedSwitch({
      ttlMs: TTL_MS,
      off: () => ({ ...OFF }),
      read: () => fetchFrom(require('../../config/supabase')), // eslint-disable-line global-require
      log: (err) => {
        try { require('../../utils/logger').logToFile('report delivery switch: settings read failed — off', { error: err.message }, 'warn'); } catch (_) { /* never throws */ } // eslint-disable-line global-require
      },
    });
  }
  return cache;
}

const READ_BOUND_MS = 2000;

/**
 * The bot's view of the switch. Never throws: off on any failure, and off when the read takes longer than
 * `timeoutMs` (a stalled settings read must never hold up a teacher's report).
 */
async function current(now = Date.now(), { timeoutMs = READ_BOUND_MS } = {}) {
  let timer = null;
  try {
    const bound = new Promise((resolve) => { timer = setTimeout(() => resolve({ ...OFF }), timeoutMs); });
    return { ...OFF, ...(await Promise.race([botCache().get(now), bound])) };
  } catch (_) {
    return { ...OFF };
  } finally {
    clearTimeout(timer);
  }
}

function _resetCache() { if (cache) cache.reset(); }

module.exports = { KEY, OFF, parse, fetchFrom, current, _resetCache };
