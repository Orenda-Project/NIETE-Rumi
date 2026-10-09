'use strict';
/**
 * The results card's door to the child's own hub. Children reach the quiz page from a teacher's link, never the hub
 * (that needed /quiz on WhatsApp), so the card offers "My quizzes, videos and challenges" (app_settings
 * web_quiz_hub_door, only with web_quiz_hub on; read fail-closed in web-quiz-hub-flags).
 *
 *   field(s)        finish()'s {hub_door: true} when the card may offer it, else {} (the payload stays today's)
 *   door({st, home}, Err) {href: '/h/<token>'}: a hub token for THIS session's child only (no name in it), bound to the
 *                   phone in the session token — the body's device_ref is never trusted — so a forwarded copy
 *                   meets the hub's lock on any other phone, like a forwarded /quiz hub link.
 * `home` (the page's Home button, app_settings web_quiz_home_button with the hub on): the same door from any screen
 *                   of the child's own run, finished or not — its own switch, so it opens with the card's door off.
 * A sibling on the same phone gets their own door from their own card: the token never names the phone's other children.
 * Err is web-quiz.service's WqError, passed in by the route: this module never requires the service (whose finish()
 * requires it), so there is no require cycle.
 */
const { read: dbRead } = require('./web-quiz-db-deadline');   // a deadline + one retry on reads (web_quiz_db_deadline)
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const Flags = require('./web-quiz-hub-flags');
const Device = require('./web-quiz-hub-device');

// A class child's own run: never the teacher's test run, an invited friend's, or a run with no child.
function ownRun(s) {
  return Boolean(s && s.student_id && !s.user_id && !(s.invited_by_student_id && s.invited_by_student_id !== s.student_id));
}

async function isOn() {
  const f = await Flags.flags();
  return Boolean(f.hub && f.door);
}

async function field(s) {
  try {
    return ownRun(s) && (await isOn()) ? { hub_door: true } : {};
  } catch (_) {
    return {};
  }
}

async function door(body = {}, Err = Error) {
  const fail = (status, error, why) => {
    logEvent('web_quiz.hub_door', { ok: false, reason: why || error });
    const e = new Err(status, { error });
    if (!(e.status && e.body)) Object.assign(e, { status, body: { error } });
    throw e;
  };
  const tok = T.verify(body.st, 's');
  if (!tok || !tok.sid || !tok.d) fail(401, 'bad_token');
  const { data: s } = await dbRead('door:quiz_sessions:1', (db) => db.from('quiz_sessions')
    .select('id, student_id, user_id, invited_by_student_id, status, share_code_id').eq('id', tok.sid).maybeSingle());
  if (!s || s.share_code_id !== tok.sc) fail(401, 'bad_token');
  const f = await Flags.flags();
  const home = Boolean(body.home) && f.hub && f.homeButton;
  if (!home && !(await isOn())) fail(404, 'no_door', 'off');
  if (!ownRun(s) || (s.status !== 'completed' && !(home && s.status === 'in_progress'))) fail(404, 'no_door', 'not_own_finished_run');
  const token = T.signHub([s.student_id]);
  if (!token) fail(404, 'no_door', 'no_secret');
  const bound = await Device.deviceTrusted(token, tok.d);
  if (!bound.ok) fail(404, 'no_door', bound.why);
  logEvent('web_quiz.hub_door', { ok: true, sessionId: s.id, reason: bound.why, ...(home ? { home: true } : {}) });
  return { href: `/h/${token}` };
}

module.exports = { field, door };
