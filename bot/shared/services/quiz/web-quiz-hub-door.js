'use strict';
/**
 * The results card's door to the child's own hub. Children reach the quiz page from a teacher's link, never the hub
 * (that needed /quiz on WhatsApp), so the card offers "My quizzes, videos and challenges" (app_settings
 * web_quiz_hub_door, only with web_quiz_hub on; read fail-closed in web-quiz-hub-flags).
 *
 *   field(s)        finish()'s {hub_door: true} when the card may offer it, else {} (the payload stays today's)
 *   foldField(s)    finish()'s {card_fold: true} (+ no_class, noClassField) with the child home on (app_settings web_quiz_home_v3): a class child's
 *                   own card is the card and ONE next thing, and its Home row (POST /hubdoor {home}) opens on a
 *                   finished run without the card's door or the Home button switched on; else {} (today's payload)
 *   menuFoldField() the Jugnu page's menu's {card_fold: true} with the child home on (its end cards fold too), else {}
 *   noClassField(id) the same menu's {no_class: true} with the home on for a child no teacher's quiz has reached, else {}
 *                   With app_settings web_quiz_class_doors on, a class child's fold also carries {class_doors: true}: the
 *                   card's "See my class" + "School league" and the results' "See my class" (web-quiz-class-doors-flag),
 *                   only when the run's code is one of the child's class quizzes (never the watch root or a code under it).
 *   door({st, home}, Err) {href: '/h/<token>'}: a hub token for THIS session's child only (no name in it), bound to the
 *                   phone in the session token — the body's device_ref is never trusted — so a forwarded copy
 *                   meets the hub's lock on any other phone, like a forwarded /quiz hub link.
 * `home` (the page's Home button, app_settings web_quiz_home_button with the hub on): the same door from any screen
 *                   of the child's own run, finished or not — its own switch, so it opens with the card's door off.
 * A sibling on the same phone gets their own door from their own card: the token never names the phone's other children.
 * Err is web-quiz.service's WqError, passed in by the route: this module never requires the service (whose finish()
 * requires it), so there is no require cycle.
 * Events v2 (web_quiz_events_v2, read fail-closed): the server `web_quiz.hub_door` event carries the writer mark
 * `w:'s'` so a count of server door events reads `w=='s'`; with the switch off the event is today's, byte for byte.
 */
const { read: dbRead } = require('./web-quiz-db-deadline');   // a deadline + one retry on reads (web_quiz_db_deadline)
const K = require('./web-quiz-kid');   // the one home for the v2 event rule (kind 'mark' here)
const T = require('./web-quiz-token');
const Flags = require('./web-quiz-hub-flags');
const Device = require('./web-quiz-hub-device');
const HomeFlags = require('./web-quiz-home-flags');
const ClassDoors = require('./web-quiz-class-doors-flag');

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

async function foldField(s) {
  try {
    // a child with no class (noClassField): the card's share says "Share" (no_class beside card_fold)
    if (!(ownRun(s) && (await HomeFlags.flags()).home)) return {};
    const doorsP = ClassDoors.on().catch(() => false);
    const [list, rootId] = await Promise.all([quizzesOf(s.student_id), doorsP.then((on) => (on ? ClassDoors.root() : null))]);
    const noClass = list && !list.some((e) => e && e.teacherSent) ? { no_class: true } : {};
    return { card_fold: true, ...noClass, ...((await doorsP) && ClassDoors.ownClass(list, s.share_code_id, rootId) ? { class_doors: true } : {}) };
  } catch (_) {
    return {};
  }
}

// The Jugnu page's menu (GET /ch/:token): the same fold for its end cards (read, listen, the numbers games, Story Time).
async function menuFoldField() {
  try {
    return (await HomeFlags.flags()).home ? { card_fold: true } : {};
  } catch (_) {
    return {};
  }
}

// The same menu's {no_class: true} with the child home on, for a child no teacher's quiz has reached (the hub's own
// rule, hasRoot: no teacher-sent code in their quizzes): the card's share says "Share", not "Share to class group".
async function noClassField(studentId) {
  try {
    if (!studentId || !(await HomeFlags.flags()).home) return {};
    const list = await quizzesOf(studentId);
    return !list || list.some((e) => e && e.teacherSent) ? {} : { no_class: true };
  } catch (_) {
    return {};
  }
}
// The child's quizzes (the hub's own read), or null on any failure.
function quizzesOf(studentId) {
  return studentId ? require('./student-quiz.service').quizzesForStudents([{ id: studentId }]).catch(() => null) : Promise.resolve(null);
}

async function door(body = {}, Err = Error) {
  const fail = async (status, error, why) => {
    await K.emit('web_quiz.hub_door', { ok: false, reason: why || error }, { kind: 'mark' });
    const e = new Err(status, { error });
    if (!(e.status && e.body)) Object.assign(e, { status, body: { error } });
    throw e;
  };
  const tok = T.verify(body.st, 's');
  if (!tok || !tok.sid || !tok.d) await fail(401, 'bad_token');
  const { data: s } = await dbRead('door:quiz_sessions:1', (db) => db.from('quiz_sessions')
    .select('id, student_id, user_id, invited_by_student_id, status, share_code_id').eq('id', tok.sid).maybeSingle());
  if (!s || s.share_code_id !== tok.sc) await fail(401, 'bad_token');
  const f = await Flags.flags();
  const home = Boolean(body.home) && f.hub && f.homeButton;
  // A storybook the teacher sent: the book is the run, so its door (to the hub, which shows the book) opens before the
  // session is finished, and with the hub on it does not wait for the card's door switch.
  const story = Boolean(body.story) && f.hub && s.status === 'in_progress' && await require('./story-teacher.service').storyDoorOk(s);
  // The folded card's Home row (web_quiz_home_v3): a finished run's way home, with the Home button's switch off.
  const fold = Boolean(body.home) && !home && f.hub && s.status === 'completed' && (await HomeFlags.flags()).home;
  if (!home && !story && !fold && !(await isOn())) await fail(404, 'no_door', 'off');
  if (!ownRun(s) || (s.status !== 'completed' && !(home && s.status === 'in_progress') && !story)) await fail(404, 'no_door', 'not_own_finished_run');
  // child identity store (web_quiz_identity_canon): the hub link names the child by the id they are known by.
  const hubId = (await require('./web-quiz-identity-flags').flags()).canon ? await require('./web-quiz-identity-roster').canonicalStudentId(s.student_id) : s.student_id;
  // web_quiz_return_lang: the child's own language rides the link (off: today's token)
  const lang = await require('./web-quiz-child-lang').childLang(hubId);
  const token = lang ? T.signHub([hubId], undefined, { lang }) : T.signHub([hubId]);
  if (!token) await fail(404, 'no_door', 'no_secret');
  const bound = await Device.deviceTrusted(token, tok.d);
  if (!bound.ok) await fail(404, 'no_door', bound.why);
  await K.emit('web_quiz.hub_door', { ok: true, sessionId: s.id, reason: bound.why, ...(home ? { home: true } : {}), ...(story ? { story: true } : {}) }, { kind: 'mark' });
  // A story with the one-hop open on (web_quiz_one_hop, with web_quiz_fast): the child's hub chip too, so the hub's head
  // can ask for the book while the hub itself is still being worked out (the hub honours ?kid=<chip>). Off: today's answer.
  return story && require('./web-quiz-one-hop').on() ? { href: `/h/${token}`, kid: T.chipId('h', hubId) } : { href: `/h/${token}` };
}

module.exports = { field, foldField, menuFoldField, noClassField, door };
