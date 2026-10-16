'use strict';
/**
 * AN OLD, FINISHED CLASS LINK OPENS THE CHILD'S OWN HUB.
 *
 * A teacher's /q/<code> link stays in the class group for days. A child who already finished that quiz, on the
 * phone that played it, used to land on the same quiz again. With app_settings `web_quiz_link_home` on (only with
 * `web_quiz_hub` on; read fail-closed, 30 s cache) the quiz page asks once and goes to that child's hub instead.
 *
 *   field(ctx, {preview})   true when the quiz payload may name `link_home` (the page then asks), else false
 *                           (the payload stays today's)
 *   home({code, device_ref}) {home: '/h/<token>?from=link'} or {home: null}. A hub token for THAT child only,
 *                           bound to this phone (web-quiz-hub-device deviceTrusted, as the results card's door).
 *
 * Never for: a phone that has not played this code; a phone that played it as two or more children (the
 * landing's own "Whose turn?" runs; nothing is auto-picked); a child whose run here is not finished; a teacher's
 * device (a run with a user); a friend's challenge code; a forwarded copy on another phone (no run on it).
 * The server writes `door_shown{door:'link_home', surface:'hub', w:'s'}` when it routes the child.
 */
const supabase = require('../../config/supabase');
const { read: dbRead } = require('./web-quiz-db-deadline');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const Flags = require('./web-quiz-hub-flags');
const Device = require('./web-quiz-hub-device');

const LINK_HOME_KEY = 'web_quiz_link_home';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** The switch, effective only with the hub on. Fail closed (never cached on an error). */
async function isOn(now = Date.now()) {
  let own = false;
  if (cache && now - cache.at < TTL_MS) own = cache.on;
  else {
    try {
      const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [LINK_HOME_KEY]);
      if (error) throw new Error(error.message || 'app_settings read failed');
      const row = (data || []).find((r) => r.key === LINK_HOME_KEY);
      cache = { at: now, on: Boolean(row) && isTrue(row.value) };
      own = cache.on;
    } catch (err) {
      logToFile('⚠️ web quiz link home: settings lookup failed — off', { error: err.message });
      return false;
    }
  }
  if (!own) return false;
  return Boolean((await Flags.flags()).hub);
}

/** May the quiz payload carry `link_home`? Never on a friend's challenge or the teacher's preview. Never throws. */
async function field(ctx, { preview = false } = {}) {
  try {
    if (!ctx || ctx.invitedByStudentId || preview) return false;
    return await isOn();
  } catch (_) {
    return false;
  }
}

// A class child's own run: never the teacher's test run, an invited friend's, or a run with no child.
function ownRun(s) {
  return Boolean(s && s.student_id && !s.user_id && !(s.invited_by_student_id && s.invited_by_student_id !== s.student_id));
}

async function home(body = {}, resolveCode = null) {
  const no = (reason) => { logEvent('web_quiz.link_home', { ok: false, reason }); return { home: null }; };
  try {
    if (!(await isOn())) return { home: null };
    const d = T.cleanDeviceRef(body.device_ref);
    if (!d) return no('no_device');
    let ctx;
    // The quiz service's resolveCode, handed in by the route (this module never requires the service: no require loop).
    if (typeof resolveCode !== 'function') return no('no_code');
    try { ctx = await resolveCode(body.code); } catch (_) { return no('no_code'); }
    if (ctx.invitedByStudentId) return no('challenge');
    const { data, error } = await dbRead('linkHome:quiz_sessions:1', (db) => db.from('quiz_sessions')
      .select('id, student_id, user_id, invited_by_student_id, status, created_at')
      .eq('share_code_id', ctx.shareCodeId).eq('device_ref', d).limit(50));
    if (error) return no('db');
    const rows = data || [];
    if (!rows.length) return no('not_played_here');
    if (rows.some((s) => s.user_id)) return no('teacher_device');
    const own = rows.filter(ownRun);
    const kids = [...new Set(own.map((s) => String(s.student_id)))];
    if (kids.length !== 1) return no(kids.length ? 'many_children' : 'no_child');
    if (own.some((s) => s.status !== 'completed')) return no('not_finished');
    const token = T.signHub([kids[0]]);
    if (!token) return no('no_secret');
    const bound = await Device.deviceTrusted(token, d);
    if (!bound.ok) return no(bound.why);
    logEvent('web_quiz.door_shown', { door: 'link_home', surface: 'hub', w: 's' });
    return { home: `/h/${token}?from=link` };
  } catch (err) {
    return no('error');
  }
}

module.exports = { field, home, isOn, LINK_HOME_KEY, _resetCache: () => { cache = null; } };
