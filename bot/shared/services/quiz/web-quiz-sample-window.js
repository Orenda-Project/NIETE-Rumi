'use strict';
/**
 * The class sample windows: web_quiz.sample_window{arm, unit:'class', cls, opens_at, closes_at, w:'s'} for every
 * drawn class whose round window (arm 'class_round', window_start/window_end) or week window (arm 'class_week',
 * week_start/week_end, only when set) opens that PKT day, read from class_round_draws (the class round's table).
 * This is the event's one writer.
 *
 * daily({ now }) is called once per PKT day by the Challenge daily job (web-quiz-challenge-sweeper.js, under its day
 * claim); once a day is the caller's. Switches, read fresh, a failed read is off:
 *   web_quiz_class_round, with its parents web_quiz_challenge_v2 and web_quiz_challenge;
 *   web_quiz_events_v2, with its parent web_quiz_hub (a v2 event).
 * Any of them off ⇒ the switches read only: no draws read, no event, no log.
 * The class is keyed (web-quiz-kid.js cls, inside its envelope): a raw class id never rides the event. The keyed-id
 * module absent, or the table not there yet ⇒ no event and one log line. Never throws.
 * Returns the number of events written, or null when off.
 */
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const KEYS = ['web_quiz_challenge', 'web_quiz_challenge_v2', 'web_quiz_class_round', 'web_quiz_hub', 'web_quiz_events_v2'];
const PKT_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ARMS = [['class_round', 'window_start', 'window_end'], ['class_week', 'week_start', 'week_end']];

function isTrue(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { /* plain string */ } }
  return x === true || (typeof x === 'string' && x.trim().toLowerCase() === 'true');
}

const errText = (e) => String(e && e.message || e).slice(0, 120);
const isMissingTable = (e) => !!e && (e.code === '42P01' || /does not exist|schema cache/i.test(String(e.message || '')));
const pktDay = (now) => new Date(now + PKT_MS).toISOString().slice(0, 10);

/** Every switch this step needs, on: true; any off or a failed read: false. */
async function switchesOn() {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', KEYS);
    if (error) return false;
    const by = Object.fromEntries((data || []).map((r) => [r.key, isTrue(r.value)]));
    return KEYS.every((k) => by[k]);
  } catch (_) {
    return false;
  }
}

/** The PKT day's bounds in UTC: [00:00 PKT, the next 00:00 PKT). */
function pktDayBounds(now) {
  const start = Date.parse(`${pktDay(now)}T00:00:00Z`) - PKT_MS;
  return { start: new Date(start).toISOString(), end: new Date(start + DAY_MS).toISOString() };
}

async function daily({ now = Date.now() } = {}) {
  try {
    if (!(await switchesOn())) return null;
    let Kid = null;
    try { Kid = require('./web-quiz-kid'); } catch (_) { Kid = null; }
    if (!Kid || typeof Kid.envelope !== 'function' || typeof Kid.cls !== 'function') {
      logToFile('Challenge daily job: sample_window skipped (keyed ids not available)', { day: pktDay(now) });
      return 0;
    }
    const { start, end } = pktDayBounds(now);
    let n = 0;
    for (const [arm, opens, closes] of ARMS) {
      const { data, error } = await supabase.from('class_round_draws').select(`class_id, ${opens}, ${closes}`)
        .gte(opens, start).lt(opens, end);
      if (error) {
        if (isMissingTable(error)) logToFile('Challenge daily job: sample_window skipped (class_round_draws not there yet)', { day: pktDay(now) });
        else logError('web_quiz.ch_sample_window_read_failed', { code: error.code || null, error: errText(error) });
        return n;
      }
      for (const r of data || []) {
        if (!r[opens] || !r[closes]) continue;
        logEvent('web_quiz.sample_window', Kid.envelope({
          arm, unit: 'class', cls: Kid.cls(r.class_id),
          opens_at: new Date(r[opens]).toISOString(), closes_at: new Date(r[closes]).toISOString(), w: 's',
        }));
        n += 1;
      }
    }
    return n;
  } catch (e) {
    logError('web_quiz.ch_sample_window_failed', { error: errText(e) });
    return null;
  }
}

module.exports = { daily, KEYS };
