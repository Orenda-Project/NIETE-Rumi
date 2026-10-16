'use strict';
/**
 * The standing class link `/j/<code>` (switch `web_quiz_class_link`, parent `web_quiz_challenge_v2`; OFF by default).
 *
 * One link per class per term, minted only for a class the teacher actually teaches (class_teachers) that has an
 * enrolled roster (class_enrollments). The teacher forwards it once a term; a child who opens it is placed by the
 * SERVER, and the page never receives the class list before the gate:
 *
 *   resolve(code, {preview, jt})    the landing: the link is live? → {lang}; else not_found (the edge renders exactly
 *                                   an unknown /q/ code's page). door_shown{class_link}, except for a link-preview
 *                                   fetch or the teacher's own visit from the card (jt, its signed preview token).
 *   arrive({code, device_ref, jt})  a device that played as (or whose hub was opened for) a child enrolled in this class →
 *                                   "Whose turn?" with ONLY those children; any other device → "Tap your teacher's name"
 *   teacher({code, s, tk})          the right teacher → the letter step (the script's whole alphabet, never only the
 *                                   letters present); a wrong one → the teacher step again, no children
 *   letter({code, s, letter})       the chips whose canon first name starts with that letter, FIRST NAMES ONLY
 *   pick({code, s, chip, device_ref})  → {href: /h/<token>}: a hub token for that child carrying the pick
 *                                   (`cl`: class, id_src, id_confidence, homonym_in_list, practice) to the run row
 *   runColumns(cl, studentId)       the run-row columns a class-link pick writes (web-quiz-challenge insertRun)
 *   mint / forTeacher / forwardHref the teacher's side: the card on the report's class tab and its Forward link
 *   renew({teacherId, classId})     "Make a new link": revokes the class's live link and mints a new one
 *
 * Step tokens (`s`) are signed by web-quiz-token (kind 'cl', 10 minutes) and name the step the device reached; a
 * chip is HMAC(secret, "cl:<code>" | studentId), never reversible. Events go through the event key module
 * (web-quiz-kid.js), required lazily: absent → no new event. Nothing here sends a message (0 cost).
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const Identity = require('./web-quiz-identity');
const HubDevice = require('./web-quiz-hub-device');
const Flags = require('./web-quiz-class-link-flags');
const { clampLanguage } = require('../../config/ux-strings');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 10;
const CODE_RX = /^[A-HJ-NP-Z2-9]{8,16}$/;
const STEP_TTL_S = 10 * 60;
const TEACHER_PREVIEW_TTL_S = 15 * 60;
const TEACHER_CHIPS_MAX = 3;
const PKT_MS = 5 * 3600 * 1000;
// The letters a child can tap: the whole alphabet of the roster's script, fixed (never only the letters present).
const LETTERS = {
  latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  urdu: ['ا', 'ب', 'پ', 'ت', 'ٹ', 'ث', 'ج', 'چ', 'ح', 'خ', 'د', 'ڈ', 'ذ', 'ر', 'ڑ', 'ز', 'ژ', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ک', 'گ', 'ل', 'م', 'ن', 'و', 'ہ', 'ی'],
};
const URDU_FOLD = { 'آ': 'ا', 'أ': 'ا', 'إ': 'ا', 'ك': 'ک', 'ي': 'ی', 'ى': 'ی', 'ے': 'ی', 'ه': 'ہ', 'ة': 'ہ', 'ۃ': 'ہ', 'ھ': 'ہ' };
const ARABIC = /[؀-ۿ]/;
// A teacher's stored title is not part of the name a child knows to tap (as quiz-teacher-label.js strips it).
const LEAD_TITLE = /^(?:(?:teacher|sir|miss|madam|mrs|mr|ms)\.?(?=\s|$)|(?:استاد|استانی|سر|مس|میڈم)(?=\s|$))\s*/i;
const TAIL_TITLE = /\s+(?:صاحبہ|صاحب)$/;

class ClassLinkError extends Error {
  constructor(status, body) { super(body && body.error); this.status = status; this.body = body; }
}
// The class-link routes (web-quiz-class-link.routes.js) answer it with its status and body.
function fail(status, error) {
  throw new ClassLinkError(status, { error });
}
const notFound = () => fail(404, 'not_found');

// ── pure helpers ───────────────────────────────────────────────────────────────────────────────────

/** The term a moment falls in (IDENTITY §17): 'YYYY-YYa' 1 Apr–30 Sep, 'YYYY-YYb' 1 Oct–31 Mar, PKT; expiry = its last second. */
function termOf(date = new Date()) {
  const pkt = new Date(date.getTime() + PKT_MS);
  const y = pkt.getUTCFullYear();
  const m = pkt.getUTCMonth() + 1;
  const startYear = m >= 4 ? y : y - 1;
  const half = m >= 4 && m <= 9 ? 'a' : 'b';
  const code = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}${half}`;
  // The term's last second in PKT is 23:59:59 on 30 Sep or 31 Mar = 18:59:59Z that day.
  const end = half === 'a' ? Date.UTC(startYear, 8, 30, 18, 59, 59) : Date.UTC(startYear + 1, 2, 31, 18, 59, 59);
  return { term_code: code, expires_at: new Date(end).toISOString() };
}

/** A fresh code: CODE_LEN characters of ALPHABET from crypto.randomInt (never derived from the class). */
function newCode(randomInt = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < CODE_LEN; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

function stripTitle(name) {
  let out = String(name || '').trim();
  for (let k = 0; k < 2 && LEAD_TITLE.test(out); k += 1) out = out.replace(LEAD_TITLE, '');
  return out.replace(TAIL_TITLE, '').trim();
}

/**
 * IDENTITY §2.1: the canon first name (first token; the second when the first is a Muhammad form) and the word
 * shown on the chip (the name's own word at that position).
 */
function firstNameOf(name) {
  const words = String(name || '').normalize('NFKC').trim().split(/[\s.\-_,/]+/).filter(Boolean);
  const toks = Identity.tokens(name);
  if (!toks.length) return { canon: '', shown: '' };
  const i = toks[0] === 'muhammad' && toks.length > 1 && words.length > 1 ? 1 : 0;
  return { canon: toks[i], shown: words[i] || words[0] };
}

function letterOf(shown, script) {
  const ch = String(shown || '').normalize('NFKC').trim().charAt(0);
  if (!ch) return '';
  if (script === 'urdu') return URDU_FOLD[ch] || ch;
  return ch.normalize('NFD').charAt(0).toUpperCase();
}

const shuffle = (xs) => {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

const kidChip = (code, studentId) => T.chipId(`cl:${code}`, studentId);
const teacherChip = (code, teacherId) => T.chipId(`clt:${code}`, teacherId);
const nowS = () => Math.floor(Date.now() / 1000);
const stepToken = (code, fields) => T.sign({ k: 'cl', c: code, ...fields, exp: nowS() + STEP_TTL_S });
function stepOf(code, s, want) {
  const p = T.verify(s, 'cl');
  if (!p || p.c !== code || (want && !want.includes(p.st))) fail(403, 'bad_step');
  return p;
}

/** The teacher card's own link: a short-lived signed claim that this visit is the teacher's (plays as practice). */
function signTeacherPreview(code) {
  return T.sign({ k: 'jt', c: code, exp: nowS() + TEACHER_PREVIEW_TTL_S });
}
const isTeacherPreview = (code, jt) => {
  const p = typeof jt === 'string' ? T.verify(jt, 'jt') : null;
  return Boolean(p && p.c === code);
};

/** The run-row columns a class-link pick writes (the v2 run columns). {} for anything else. */
function runColumns(cl, studentId) {
  if (!cl || typeof cl !== 'object' || typeof cl.c !== 'string') return {};
  const out = {
    via: 'class_link',
    class_id: cl.c,
    id_src: cl.s === 'remembered' ? 'remembered' : 'roster_pick',
    id_confidence: cl.q === 'low' ? 'low' : 'high',
    homonym_in_list: cl.h === true,
    canonical_id: studentId || null,
  };
  if (cl.m === 'practice') out.mode = 'practice';
  return out;
}

/**
 * What the Challenge's v2 serve is asked for a class-link pick: the route 'class_link', the link's class, and
 * 'practice' for the teacher's own visit (a caller's own mode wins). `w` is the challenge's entry, `opts` its options.
 */
function serveArgs(w, opts = {}) {
  const cl = (w && w.cl) || {};
  const o = opts || {};
  return { w: { ...w, via: 'class_link' }, mode: o.mode || (cl.m === 'practice' ? 'practice' : undefined), classId: o.classId || cl.c };
}

// ── events (lazily through the event key module) ────────────────────────────────────────────────

let warnedNoKid = false;
function emit(name, fields, { classId = null, studentId } = {}) {
  let Kid;
  try {
    Kid = require('./web-quiz-kid');
  } catch (_) {
    if (!warnedNoKid) { warnedNoKid = true; logToFile('ℹ️ web quiz class link: web-quiz-kid not on this build — no class-link event written'); }
    return;
  }
  try {
    const data = { w: 's', ...fields };
    if (classId) data.cls = Kid.cls(classId);
    if (studentId !== undefined) data.kid = studentId ? Kid.kid(studentId) : null;
    logEvent(`web_quiz.${name}`, Kid.envelope(data));
  } catch (err) {
    logToFile('⚠️ web quiz class link: event not written', { name, error: err.message });
  }
}

// ── reads ──────────────────────────────────────────────────────────────────────────────────────────

/** The live link row for a code, or null (off, malformed, unknown, revoked, expired). */
async function liveLink(code, now = new Date()) {
  if (typeof code !== 'string' || !CODE_RX.test(code)) return null;
  if (!(await Flags.classLinkOn())) return null;
  const { data, error } = await supabase.from('class_links').select('code, class_id, teacher_id, term_code, expires_at, revoked_at')
    .eq('code', code).maybeSingle();
  if (error) { logToFile('⚠️ web quiz class link: link read failed', { error: error.message }); return null; }
  if (!data || data.revoked_at || !data.expires_at || new Date(data.expires_at).getTime() <= now.getTime()) return null;
  return data;
}

async function teacherRow(teacherId) {
  const { data } = await supabase.from('users').select('id, name, school_id, preferred_language').eq('id', teacherId).maybeSingle();
  return data || null;
}
const langOf = (t) => clampLanguage(t && t.preferred_language);

/** The roster children of the link's class, each with its chip, shown first name and canon first name. */
async function rosterKids(link) {
  const Roster = require('./web-quiz-identity-roster');
  const kids = (await Roster.loadClassRoster(link.class_id)) || [];
  return kids.map((k) => ({ id: k.id, ids: k.ids, name: k.student_name, nameUrdu: k.nameUrdu }));
}

/** The roster's script: Urdu when the class reads Urdu and most children have an Urdu name; else Latin. */
function scriptOf(kids, lang) {
  if (lang !== 'ur' || !kids.length) return 'latin';
  const urdu = kids.filter((k) => k.nameUrdu && ARABIC.test(k.nameUrdu)).length;
  return urdu * 2 > kids.length ? 'urdu' : 'latin';
}
const shownName = (k, script) => (script === 'urdu' && k.nameUrdu ? k.nameUrdu : k.name);

/**
 * The children this device is remembered as who are in the class: the ones it played as on a teacher's quiz
 * (quiz_sessions.device_ref) and the ones a hub trusted it with (the hub's device record, HubDevice.deviceKids), so a
 * phone whose only door is this link is remembered here too. Redis down → the device record adds nothing.
 */
async function rememberedInClass(link, deviceRef, kids) {
  const d = T.cleanDeviceRef(deviceRef);
  if (!d || !kids.length) return [];
  const { data } = await supabase.from('quiz_sessions').select('student_id').eq('device_ref', d).limit(50);
  const hubKids = await HubDevice.deviceKids(d);
  const played = [...new Set([...(data || []).map((r) => r.student_id), ...hubKids].filter(Boolean).map(String))];
  if (!played.length) return [];
  const Roster = require('./web-quiz-identity-roster');
  const canon = await Roster.canonicalStudentIds(played);
  const ids = new Set(played.map((id) => canon.get(id) || id));
  return kids.filter((k) => ids.has(k.id) || k.ids.some((x) => ids.has(x)));
}

/** The class's teacher first, then up to two other teachers of the same school, shuffled; named ones only. */
async function teacherChips(link) {
  const own = await teacherRow(link.teacher_id);
  if (!own || !stripTitle(own.name)) return [];
  let others = [];
  if (own.school_id) {
    const { data: classes } = await supabase.from('classes').select('id').eq('school_id', own.school_id).eq('is_active', true);
    const classIds = (classes || []).map((c) => c.id);
    if (classIds.length) {
      const { data: ct } = await supabase.from('class_teachers').select('teacher_user_id').in('class_id', classIds).eq('is_active', true);
      const ids = [...new Set((ct || []).map((r) => r.teacher_user_id).filter((id) => id && id !== link.teacher_id))];
      if (ids.length) {
        const { data: users } = await supabase.from('users').select('id, name').in('id', ids);
        const ownName = stripTitle(own.name).toLowerCase();
        others = shuffle((users || []).filter((u) => stripTitle(u.name) && stripTitle(u.name).toLowerCase() !== ownName)).slice(0, TEACHER_CHIPS_MAX - 1);
      }
    }
  }
  return shuffle([own, ...others]).map((u) => ({ tk: teacherChip(link.code, u.id), name: stripTitle(u.name), id: u.id }));
}

// ── the child's side ───────────────────────────────────────────────────────────────────────────────

async function resolve(code, { preview = false, jt = null } = {}) {
  const link = await liveLink(code);
  if (!link) return notFound();
  const lang = langOf(await teacherRow(link.teacher_id));
  // Not a child's door: a link-preview fetch, or the teacher's own visit from the card (its signed token for this code).
  if (!preview && !isTeacherPreview(code, jt)) emit('door_shown', { door: 'class_link', surface: 'landing' }, { classId: link.class_id, studentId: null });
  return { lang };
}

async function arrive({ code, device_ref: deviceRef, jt } = {}) {
  const link = await liveLink(code);
  if (!link) return notFound();
  const practice = isTeacherPreview(code, jt);
  const kids = await rosterKids(link);
  const lang = langOf(await teacherRow(link.teacher_id));
  const mine = await rememberedInClass(link, deviceRef, kids);
  if (mine.length) {
    const script = scriptOf(kids, lang);
    return {
      step: 'who',
      s: stepToken(code, { st: 'who', ...(practice ? { p: 1 } : {}) }),
      kids: mine.map((k) => ({ chip: kidChip(code, k.id), first: firstNameOf(shownName(k, script)).shown, animal: T.animalFor(k.id) })),
    };
  }
  const teachers = await teacherChips(link);
  if (!teachers.length) return notFound();
  return { step: 'teacher', s: stepToken(code, { st: 'teacher', ...(practice ? { p: 1 } : {}) }), teachers: teachers.map(({ tk, name }) => ({ tk, name })) };
}

async function teacher({ code, s, tk } = {}) {
  const link = await liveLink(code);
  if (!link) return notFound();
  const step = stepOf(code, s, ['teacher']);
  const p = step.p ? { p: 1 } : {};
  if (typeof tk !== 'string' || tk !== teacherChip(code, link.teacher_id)) {
    // A wrong tap: the same step again, freshly shuffled; no children.
    const teachers = await teacherChips(link);
    return { step: 'teacher', again: true, s: stepToken(code, { st: 'teacher', ...p }), teachers: teachers.map((t) => ({ tk: t.tk, name: t.name })) };
  }
  const kids = await rosterKids(link);
  const script = scriptOf(kids, langOf(await teacherRow(link.teacher_id)));
  return { step: 'letter', script, letters: LETTERS[script], s: stepToken(code, { st: 'letter', ...p }) };
}

/** The children under one letter, with the homonym fact of THAT rendered list (IDENTITY §2 steps 1 and 4). */
async function chipsFor(link, letter, lang) {
  const kids = await rosterKids(link);
  const script = scriptOf(kids, lang);
  const want = letterOf(letter, script);
  const list = kids.map((k) => ({ k, f: firstNameOf(shownName(k, script)) }))
    .filter((x) => x.f.shown && letterOf(x.f.shown, script) === want)
    .sort((a, b) => a.f.canon.localeCompare(b.f.canon));
  const count = new Map();
  list.forEach((x) => count.set(x.f.canon, (count.get(x.f.canon) || 0) + 1));
  return list.map((x) => ({ id: x.k.id, chip: kidChip(link.code, x.k.id), first: x.f.shown, homonym: count.get(x.f.canon) > 1 }));
}

async function letter({ code, s, letter: l } = {}) {
  const link = await liveLink(code);
  if (!link) return notFound();
  const step = stepOf(code, s, ['letter', 'chips']);
  if (typeof l !== 'string' || !l || l.length > 2) fail(400, 'bad_letter');
  const chips = await chipsFor(link, l, langOf(await teacherRow(link.teacher_id)));
  return {
    step: 'chips',
    s: stepToken(code, { st: 'chips', l, ...(step.p ? { p: 1 } : {}) }),
    // FIRST NAMES ONLY on the stranger path (IDENTITY §2(b)): no surname, no initial, no father's name.
    kids: chips.map((c) => ({ chip: c.chip, first: c.first })),
  };
}

async function pick({ code, s, chip, device_ref: deviceRef } = {}) {
  const link = await liveLink(code);
  if (!link) return notFound();
  const step = stepOf(code, s, ['who', 'chips']);
  if (typeof chip !== 'string') fail(400, 'bad_chip');
  let hit = null;
  let cl = null;
  if (step.st === 'who') {
    // "Whose turn?": re-check the gate at the pick, so a remembered chip only ever opens on the device that played.
    const kids = await rosterKids(link);
    const mine = await rememberedInClass(link, deviceRef, kids);
    hit = mine.find((k) => kidChip(code, k.id) === chip) || null;
    if (hit) cl = { c: link.class_id, s: 'remembered', q: 'high', h: false };
  } else {
    const chips = await chipsFor(link, step.l, langOf(await teacherRow(link.teacher_id)));
    const c = chips.find((x) => x.chip === chip) || null;
    if (c) {
      hit = { id: c.id };
      cl = { c: link.class_id, s: 'roster_pick', q: c.homonym ? 'low' : 'high', h: c.homonym };
    }
  }
  if (!hit) fail(403, 'bad_chip');
  if (step.p) cl.m = 'practice';
  const token = T.sign({ k: 'h', ids: [hit.id], exp: nowS() + T.HUB_TTL_S, src: 'cl', cl });
  if (!token) fail(503, 'web_quiz_off');
  // The teacher's own preview is not a child's door: no door_tap.
  if (!step.p) emit('door_tap', { door: 'class_link', surface: 'landing' }, { classId: link.class_id, studentId: hit.id });
  // ?from=class_link: the hub (the one writer of hub_open) logs the source; this module emits no hub_open.
  return { href: `/h/${token}?from=class_link` };
}

// ── the teacher's side ─────────────────────────────────────────────────────────────────────────────

/** Does this teacher teach this class (class_teachers, active) and does it have an enrolled child? */
async function teachesEnrolled(teacherId, classId) {
  const { data: ct } = await supabase.from('class_teachers').select('class_id').eq('teacher_user_id', teacherId).eq('class_id', classId).eq('is_active', true);
  if (!(ct || []).length) return 'not_your_class';
  const { data: cls } = await supabase.from('classes').select('id').eq('id', classId).eq('is_active', true).maybeSingle();
  if (!cls) return 'not_your_class';
  const { data: enr } = await supabase.from('class_enrollments').select('student_id').eq('class_id', classId).eq('is_active', true).limit(1);
  return (enr || []).length ? null : 'no_roster';
}

/**
 * The class's link for this term: the live one, else a new one. `renew` ("Make a new link") revokes the live one
 * first, so the old code falls back like an unknown code. Only for an enrolled class of this teacher.
 */
async function mint({ teacherId, classId, renew = false, now = new Date() } = {}) {
  const refused = await teachesEnrolled(teacherId, classId);
  if (refused) return { ok: false, reason: refused };
  const term = termOf(now);
  const { data: live } = await supabase.from('class_links').select('code, expires_at, revoked_at')
    .eq('class_id', classId).eq('term_code', term.term_code).is('revoked_at', null);
  const current = (live || []).find((r) => new Date(r.expires_at).getTime() > now.getTime());
  if (current && !renew) return { ok: true, code: current.code, ...term };
  if (renew && (live || []).length) {
    await supabase.from('class_links').update({ revoked_at: now.toISOString() })
      .eq('class_id', classId).eq('term_code', term.term_code).is('revoked_at', null);
  }
  for (let tries = 0; tries < 3; tries += 1) {
    const code = newCode();
    const { error } = await supabase.from('class_links').insert({
      code, class_id: classId, teacher_id: teacherId, term_code: term.term_code, minted_at: now.toISOString(), expires_at: term.expires_at, revoked_at: null,
    });
    if (!error) return { ok: true, code, ...term };
    if (error.code !== '23505') { logToFile('⚠️ web quiz class link: mint failed', { error: error.message }); return { ok: false, reason: 'store_failed' }; }
    // A clash: another tab minted this class's link first (the partial unique index), or the code was taken.
    const { data: again } = await supabase.from('class_links').select('code, expires_at')
      .eq('class_id', classId).eq('term_code', term.term_code).is('revoked_at', null);
    const won = (again || [])[0];
    if (won) return { ok: true, code: won.code, ...term };
  }
  return { ok: false, reason: 'store_failed' };
}

function linkUrl(code) {
  const base = require('./web-quiz-link').webBaseUrl();
  return base ? `${base}/j/${code}` : null;
}

/** The teacher card's data for the report's class tab, or null (switch off, no base URL, no enrolled class). */
async function forTeacher(teacherId) {
  try {
    if (!teacherId || !(await Flags.classLinkOn())) return null;
    const { data: ct } = await supabase.from('class_teachers').select('class_id').eq('teacher_user_id', teacherId).eq('is_active', true);
    const classIds = [...new Set((ct || []).map((r) => r.class_id).filter(Boolean))];
    const cards = [];
    for (const classId of classIds) {
      const m = await mint({ teacherId, classId });
      const url = m.ok ? linkUrl(m.code) : null;
      if (url) cards.push({ classId, url, preview: `${url}?t=${encodeURIComponent(signTeacherPreview(m.code) || '')}` });
    }
    return cards.length ? { cards } : null;
  } catch (err) {
    logToFile('⚠️ web quiz class link: teacher card unavailable', { error: err.message });
    return null;
  }
}

/**
 * The card's Forward and Copy (no JS): both log class_link_forwarded{cls, how}. Forward → wa.me with the URL ONLY
 * (no count, no name); Copy → back to the report's class tab with this class's card open (the link as selectable
 * text). Null when the class is not this teacher's or the switch is off.
 */
async function forwardHref({ teacherId, classId, how = 'forward', reportBase = null } = {}) {
  if (!teacherId || !classId || !(await Flags.classLinkOn())) return null;
  const copy = how === 'copy';
  if (copy && (typeof reportBase !== 'string' || !reportBase.startsWith('/'))) return null;
  const m = await mint({ teacherId, classId });
  const url = m.ok ? linkUrl(m.code) : null;
  if (!url) return null;
  emit('class_link_forwarded', { how: copy ? 'copy' : 'forward' }, { classId });
  if (copy) return `${reportBase}?tab=class&cl_open=${encodeURIComponent(classId)}#class-link`;
  return `https://wa.me/?text=${encodeURIComponent(url)}`;
}

/**
 * "Make a new link" (the card's POST form): the class's live link is revoked (its code then gets the unknown-code
 * page) and a new one minted. Only the class's own teacher, only with the switch on; null otherwise, and then no
 * row changes. Nothing is sent.
 */
async function renew({ teacherId, classId } = {}) {
  if (!teacherId || !classId || !(await Flags.classLinkOn())) return null;
  const m = await mint({ teacherId, classId, renew: true });
  return m.ok ? { code: m.code } : null;
}

module.exports = {
  ClassLinkError, ALPHABET, CODE_LEN, CODE_RX, LETTERS,
  termOf, newCode, firstNameOf, letterOf, runColumns, serveArgs, signTeacherPreview, isTeacherPreview, stripTitle,
  resolve, arrive, teacher, letter, pick, mint, renew, forTeacher, forwardHref, linkUrl,
};
