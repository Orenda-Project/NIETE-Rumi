'use strict';
/**
 * The one list of Server-Timing items a child answer may carry, shared by every bot writer and the portal
 * (dashboard/routes/web-quiz.routes.js requires this file directly; it requires nothing, so the portal can load it).
 *
 * An item is `<name>;dur=<ms>` with a name from NAMES (ms everywhere, `db;dur` included), or the round-trip count
 * `dbq;desc="<n>"`. Every bot writer appends its items to the one header (appendTiming: never overwrites); the portal
 * passes on only these items (clean). A new writer adds its names here, in this one list.
 */
const NAMES = Object.freeze([
  // the request as a whole: the portal's wait for the bot, the bot's own clock, its database time, the page render
  'edge', 'app', 'db', 'render',
  // the child home's build, step by step (web-quiz-server-timing.js), and its total
  'ui', 'gate', 'kids', 'ctx', 'take', 'teacher', 'recs', 'play', 'home', 'other', 'tail', 'total',
  // the teacher home's answers (their own writers: settings wait, db, total, and the two routes by name)
  'settings', 'th_home', 'th_library',
]);
const COUNT = 'dbq';
const MAX_LEN = 300;

const DUR_RX = new RegExp(`^(?:${NAMES.join('|')});dur=\\d{1,7}(?:\\.\\d{1,3})?$`);
const COUNT_RX = new RegExp(`^${COUNT};desc="\\d{1,5}"$`);
const isItem = (item) => DUR_RX.test(item) || COUNT_RX.test(item);

/** A header value (or array of them) → only the allowed items, in order, each name once, at most MAX_LEN chars; null if none. */
function clean(value) {
  const raw = Array.isArray(value) ? value.join(',') : value;
  if (typeof raw !== 'string') return null;
  const seen = new Set();
  let out = '';
  for (const part of raw.split(',')) {
    const item = part.trim();
    const name = item.split(';')[0];
    if (!isItem(item) || seen.has(name) || out.length + item.length + (out ? 2 : 0) > MAX_LEN) continue;
    seen.add(name);
    out += (out ? ', ' : '') + item;
  }
  return out || null;
}

/**
 * Add timing items to a response's one Server-Timing header, after any already on it (never overwriting). `entries` is
 * a string or an array of items; only listed items are written. Nothing once the headers have gone. Never throws.
 */
function appendTiming(res, entries) {
  try {
    if (!res || res.headersSent) return;
    const add = clean(Array.isArray(entries) ? entries.join(', ') : entries);
    if (!add) return;
    const prev = res.getHeader('Server-Timing');
    const prior = Array.isArray(prev) ? prev.join(', ') : (prev == null ? '' : String(prev));
    res.setHeader('Server-Timing', prior ? `${prior}, ${add}` : add);
  } catch (_) { /* a timing never decides a response */ }
}

module.exports = { NAMES, COUNT, MAX_LEN, isItem, clean, appendTiming };
