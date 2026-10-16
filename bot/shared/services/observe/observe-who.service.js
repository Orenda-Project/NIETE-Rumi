/**
 * bd-2668 — "Who did you observe?"
 *
 * An observation only recorded WHO was observed when the coach went through
 * the visit picker. Live 2026-08-13: 66 of 85 observations are self-owned —
 * 47 by a coach who HAD the picker and skipped it, 19 by a coach with no patch
 * at all. With no identity on the row, the pending-debrief list can only show a
 * date (bd-2669) and the portal shows "Unassigned" (bd-2670).
 *
 * So when a capture comes in unbound we simply ask, straight after the
 * recording is received. Two hard constraints shaped this design:
 *
 *   1. It must NEVER block or restart the capture. Riffat's worst pain is a
 *      flow that makes her re-record 20-30 minutes of lesson. The prompt is
 *      fire-and-forget: analysis continues regardless, the observe state
 *      machine is untouched, and ignoring the question leaves today's exact
 *      behaviour.
 *   2. It must not invent a new place to keep identity. The answer is written
 *      as an `observation_schedules` row — that table already carries
 *      teacher_name / school_name / school_ext_id and already links to the
 *      session through `session_id` (markDone stamps it for scheduled visits).
 *      A retro-recorded visit is the same shape as a scheduled one that has
 *      been carried out. No new table, no new column, and every existing
 *      reader (portal + the pending list) picks it up for free.
 *
 * Candidate teachers are held in Redis under a key of this service's own, NOT
 * in observe state — sharing that key is how a stray tap could corrupt a
 * capture.
 *
 * "Someone else" asks the coach to TYPE the name (round 6, 15 Oct): the list
 * holds nine and every /observe2 coach has more than nine people in their
 * schools (median 122), so the teacher just observed is often not on it. The
 * next text is matched against the coach's own schools (the derived roster,
 * patch-resolver): one clear match is recorded exactly as a tap; several come
 * back as a list of the matches; none says so, keeps the old fallback (the
 * name can be typed at send time) and allows one more try. The wait has its
 * own short-lived key, for the same reason as above, and a slash command or
 * anything that does not read as a name is never swallowed.
 */

// Requires are LAZY on purpose (the repo's no-eager-SDK-construction contract):
// shared/config/supabase.js process.exit(78)s when its env is absent, so a
// top-level require would make the pure helpers below untestable and would
// couple merely *loading* this module to a fully configured environment.
const { observeStrings, observeLang } = require('./observe-strings');
const { logToFile } = require('../../utils/logger');

const WHO_PREFIX = 'observe_who_';
const TTL_SECONDS = 7200;              // matches the observe-state TTL
const MAX_TEACHER_ROWS = 9;            // +1 escape hatch = the WhatsApp 10-row cap
const TITLE_CAP = 24;
const DESC_CAP = 72;

const key = (userId) => `observe:who:${userId}`;
const clip = (s, n) => (s == null ? '' : String(s)).slice(0, n);

// The wait for a typed name: its own key, short-lived (the coach types it now or not at all).
const TYPED_TTL_SECONDS = 900;
const typedKey = (userId) => `observe:who-typed:${userId}`;
const NAME_MAX_CHARS = 60;
const NAME_MAX_WORDS = 6;
// A title is not part of the name. Compared before folding, on the letters only.
const TITLES = new Set(['ms', 'mr', 'mrs', 'miss', 'madam', 'sir', 'mst', 'dr']);

/**
 * The interactive list. One row per teacher in the coach's patch, plus
 * "someone else" so she is never trapped when the teacher isn't listed.
 */
function buildWhoPayload(teachers, S, sessionId, opts = {}) {
  // Rows of the typed-name matches carry `m`: a tap on an older list keeps meaning that list's teacher.
  const tag = opts.matches ? 'm' : '';
  const rows = (teachers || []).slice(0, MAX_TEACHER_ROWS).map((t, i) => ({
    id: `${WHO_PREFIX}${sessionId}_${tag}${i}`,
    // displayName is patch-resolver's never-empty label; the two named
    // fallbacks are for rows that arrive already shaped by an older path.
    title: clip(t.teacher_name || t.displayName || t.name, TITLE_CAP),
    description: clip(t.school_name || '', DESC_CAP),
  }));
  rows.push({
    id: `${WHO_PREFIX}${sessionId}_other`,
    title: clip(S.who_other, TITLE_CAP),
    description: clip(S.who_other_desc, DESC_CAP),
  });
  return {
    type: 'list',
    header: '',
    body: opts.body || S.who_body,
    action: {
      button: clip(S.who_button, 20),
      sections: [{ title: clip(S.who_section, 24), rows }],
    },
  };
}

/** `observe_who_<sessionId>_<idx|other>` → parts, or null when not ours. */
function parseWhoId(listId) {
  if (!listId || typeof listId !== 'string' || !listId.startsWith(WHO_PREFIX)) return null;
  const rest = listId.slice(WHO_PREFIX.length);
  const cut = rest.lastIndexOf('_');
  if (cut <= 0) return null;
  const sessionId = rest.slice(0, cut);
  const tail = rest.slice(cut + 1);
  if (!sessionId) return null;
  if (tail === 'other') return { sessionId, index: null, other: true };
  const m = /^(m?)(\d+)$/.exec(tail);
  if (!m) return null;
  const index = parseInt(m[2], 10);
  return m[1] ? { sessionId, index, other: false, match: true } : { sessionId, index, other: false };
}

/**
 * The observation_schedules row that records a visit which already happened.
 * Throws rather than writing a record that identifies nothing.
 */
function buildObservationRecord({ leaderUserId, sessionId, teacher, today }) {
  if (!leaderUserId) throw new Error('observe-who: leaderUserId required');
  if (!sessionId) throw new Error('observe-who: sessionId required');
  if (!teacher) throw new Error('observe-who: teacher required');
  return {
    leader_user_id: leaderUserId,
    session_id: sessionId,
    teacher_ext_id: teacher.teacher_ext_id || null,
    teacher_name: teacher.teacher_name || teacher.name || null,
    school_ext_id: teacher.school_ext_id || null,
    school_name: teacher.school_name || null,
    scheduled_for: today,
    status: 'done',
  };
}

/**
 * Attach school_ext_id + school_name to a shortlist of teachers, from the
 * coach's own patch tables. Degrades to the input on any failure — a missing
 * school is cosmetic, a thrown error would cost the whole prompt.
 */
async function _withSchools(leaderUserId, teachers) {
  try {
    if (!teachers.length) return teachers;
    const supabase = require('../../config/supabase');
    const extIds = teachers.map((t) => t.teacher_ext_id).filter(Boolean);
    if (!extIds.length) return teachers;
    // Derived patch: the school comes from users.school_id, which is the same
    // answer the picker used to choose these people.
    const { listPatchViaSupabase } = require('./patch-resolver.service');
    const people = await listPatchViaSupabase(supabase, leaderUserId);
    if (!people.length) return teachers;
    const byPhone = new Map(people.filter((p) => p.phone).map((p) => [p.phone, p]));
    return teachers.map((t) => {
      const p = byPhone.get(t.teacher_ext_id);
      return {
        ...t,
        school_ext_id: p && p.emis ? `niete:${p.emis}` : null,
        school_name: (p && p.schoolName) || null,
      };
    });
  } catch (_) {
    return teachers;
  }
}

/**
 * Ask, if we don't already know. Fire-and-forget: every failure is swallowed —
 * not knowing the teacher's name is a far smaller problem than disturbing a
 * capture.
 */
async function maybeAskObservedTeacher(user, from, sessionId) {
  try {
    if (!user || !sessionId) return false;
    const LeaderSource = require('./assignment/leader-source');
    const WhatsAppService = require('../whatsapp.service');
    const redisService = require('../cache/railway-redis.service');
    const teachers = await LeaderSource.listTeachers(user.id).catch(() => []);
    if (!teachers || !teachers.length) return false;   // nothing to offer — stay silent

    const S = observeStrings(observeLang(user));
    // listTeachers() is used for its ORDER (most-needing-support first) but it
    // projects no school — and Riffat asked for the school precisely because
    // teachers share names. Enrich just the shortlist.
    const shortlist = await _withSchools(user.id, teachers.slice(0, MAX_TEACHER_ROWS));
    await redisService.setexWithCeiling(
      key(user.id), TTL_SECONDS, JSON.stringify({ sessionId, teachers: shortlist }));
    await WhatsAppService.sendInteractiveMessage(from, buildWhoPayload(shortlist, S, sessionId));
    logToFile('🔭 observe-who: asked who was observed', { userId: user.id, sessionId, offered: shortlist.length });
    return true;
  } catch (err) {
    logToFile('⚠️ observe-who: ask failed (non-blocking)', {
      userId: user && user.id, sessionId, error: err.message,
    });
    return false;
  }
}

/** A tap on one of our rows. Returns true when consumed. */
async function handleObservedTeacherPick(user, from, listId) {
  const parsed = parseWhoId(listId);
  if (!parsed || !user) return false;
  const WhatsAppService = require('../whatsapp.service');
  const redisService = require('../cache/railway-redis.service');
  const S = observeStrings(observeLang(user));

  if (parsed.other) {
    await _askForTypedName(user, from, parsed.sessionId, S);
    return true;
  }

  let teacher = null;
  if (parsed.match) {
    const waiting = await _readTyped(user.id);
    teacher = waiting && waiting.sessionId === parsed.sessionId && Array.isArray(waiting.matches)
      ? waiting.matches[parsed.index] : null;
  } else {
    let stash = null;
    try {
      const raw = await redisService.get(key(user.id));
      stash = raw && typeof raw === 'object' ? raw : (raw ? JSON.parse(raw) : null);
    } catch (_) { stash = null; }
    teacher = stash && Array.isArray(stash.teachers) ? stash.teachers[parsed.index] : null;
  }
  if (!teacher) {
    // Stale list (expired stash) — say so plainly rather than guessing a teacher.
    await WhatsAppService.sendMessage(from, S.who_stale);
    return true;
  }
  if (parsed.match) await _endTypedWait(user.id);
  await _recordObservedTeacher(user, from, parsed.sessionId, teacher, S);
  return true;
}

/**
 * Record who was observed: the schedule row (replacing any earlier answer), the /observe2 form and
 * owner when the recording has a form that names no teacher, and the "noted" ack. A tap and a typed
 * match both come here, so a typed name binds exactly as a tap does.
 */
async function _recordObservedTeacher(user, from, sessionId, teacher, S) {
  const supabase = require('../../config/supabase');
  const WhatsAppService = require('../whatsapp.service');
  try {
    const today = new Date().toISOString().slice(0, 10);
    const record = buildObservationRecord({
      leaderUserId: user.id, sessionId, teacher, today,
    });
    // One record per session: replace rather than accumulate if she re-answers.
    await supabase.from('observation_schedules').delete()
      .eq('session_id', sessionId).eq('leader_user_id', user.id).eq('status', 'done');
    const { error } = await supabase.from('observation_schedules').insert(record);
    if (error) throw new Error(error.message);
    // /observe2: a recording linked to a field form that names no teacher (held at capture, or a Start
    // whose bind failed) takes the teacher on its form and as its owner too. Never throws.
    await require('./observe2/capture-link').nameTeacherForRecording(user, sessionId, teacher);
    await WhatsAppService.sendMessage(
      from, (S.who_ack || 'Noted — {name}.').replace('{name}', record.teacher_name || ''));
    logToFile('🔭 observe-who: observed teacher recorded', {
      userId: user.id, sessionId, teacher: record.teacher_name,
    });
    return true;
  } catch (err) {
    logToFile('❌ observe-who: failed to record observed teacher', {
      userId: user.id, sessionId, error: err.message,
    }, 'error');
    await WhatsAppService.sendMessage(from, S.who_stale);
    return false;
  }
}

// ── the typed name ──────────────────────────────────────────────────────────

async function _readTyped(userId) {
  try {
    const redisService = require('../cache/railway-redis.service');
    const raw = await redisService.get(typedKey(userId));
    if (!raw) return null;
    return typeof raw === 'object' ? raw : JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function _writeTyped(userId, value) {
  const redisService = require('../cache/railway-redis.service');
  await redisService.setexWithCeiling(typedKey(userId), TYPED_TTL_SECONDS, JSON.stringify(value));
}

async function _endTypedWait(userId) {
  try {
    const redisService = require('../cache/railway-redis.service');
    await redisService.delete(typedKey(userId));
  } catch (_) { /* it expires on its own */ }
}

async function _askForTypedName(user, from, sessionId, S) {
  const WhatsAppService = require('../whatsapp.service');
  try {
    await _writeTyped(user.id, { sessionId, attempts: 0, askedAt: new Date().toISOString() });
  } catch (err) {
    // Without the wait the name cannot be matched: today's answer, which is still true.
    logToFile('❌ observe-who: the typed-name wait was not stored', { userId: user.id, sessionId, error: err.message }, 'error');
    await WhatsAppService.sendMessage(from, S.who_other_ack);
    return;
  }
  await WhatsAppService.sendMessage(from, S.who_type_name);
  logToFile('🔭 observe-who: asked for the teacher\'s name', { userId: user.id, sessionId });
}

/**
 * A name folded for matching: lower case, letters only, and the spellings Urdu names are commonly
 * written with in English made equal (Aamna/Amna, Rukhsanah/Rukhsana, Kausar/Kousar, Fozia/Foziya,
 * Noor/Nur, Zeenat/Zinat, Rizwana/Rizvana, Qasim/Kasim). Both sides are folded the same way.
 */
function foldToken(token) {
  return String(token || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '')
    .replace(/(?!^)h/g, '')
    .replace(/au|ou/g, 'o').replace(/ee/g, 'i').replace(/oo/g, 'u')
    .replace(/y/g, 'i').replace(/w/g, 'v').replace(/q/g, 'k')
    .replace(/(.)\1+/g, '$1');
}

function nameTokens(name) {
  return String(name || '').split(/[\s.,]+/)
    .filter((t) => t && !TITLES.has(t.toLowerCase().replace(/[^a-z]/g, '')))
    .map(foldToken).filter(Boolean);
}

/**
 * The roster people a typed name points at, in roster order. Each typed word must begin a word of
 * the name; a person whose whole name is exactly what was typed is the one clear match.
 * @returns {{exact: object|null, matches: object[]}}
 */
function matchTypedName(roster, typed) {
  const want = nameTokens(typed);
  if (!want.length || want.join('').length < 2) return { exact: null, matches: [] };
  const scored = [];
  for (const p of roster || []) {
    const have = nameTokens(p.name);
    if (!have.length) continue;
    if (want.every((w) => have.some((h) => h.startsWith(w)))) {
      scored.push({ p, exact: have.join(' ') === want.join(' ') });
    }
  }
  const exact = scored.filter((x) => x.exact);
  return { exact: exact.length === 1 ? exact[0].p : null, matches: scored.map((x) => x.p) };
}

// Does this text read as a name? Not a command, a question, a number or a sentence.
function readsAsName(text) {
  const t = String(text || '').trim();
  if (!t || t.startsWith('/')) return false;
  if ([...t].length > NAME_MAX_CHARS) return false;
  if (t.split(/\s+/).length > NAME_MAX_WORDS) return false;
  return !/[?\d@:/]/.test(t);
}

// The coach's own schools, as the picker derives them: a person row the list and the bind both read.
async function _rosterForMatching(leaderUserId) {
  const supabase = require('../../config/supabase');
  const { listPatchViaSupabase } = require('./patch-resolver.service');
  const people = await listPatchViaSupabase(supabase, leaderUserId);
  return (people || [])
    .filter((p) => p && String(p.userId || '') !== String(leaderUserId))
    .map((p) => ({
      teacher_ext_id: p.phone || null,
      teacher_name: p.displayName || p.name || null,
      name: p.name || null,
      phone_e164: p.phone || null,
      user_id: p.userId || null,
      school_ext_id: p.emis ? `niete:${p.emis}` : null,
      school_name: p.schoolName || null,
    }));
}

/**
 * The coach's text after "Someone else". Returns true when it was taken as the teacher's name.
 * @param {object} [opts]
 * @param {string} [opts.otherPromptAt] when the send flow last asked for the teacher's name and number
 *   (the observe state's updatedAt): a more recent prompt there is what the coach is answering.
 */
async function handleTypedTeacherName(user, from, text, opts = {}) {
  if (!user || !user.id) return false;
  const waiting = await _readTyped(user.id);
  if (!waiting || !waiting.sessionId) return false;
  if (opts.otherPromptAt && Date.parse(opts.otherPromptAt) > Date.parse(waiting.askedAt || 0)) return false;
  const typed = String(text || '').trim();
  if (!readsAsName(typed)) {
    // The coach has moved on (a command, a question): never swallow it, and stop waiting.
    await _endTypedWait(user.id);
    return false;
  }

  const WhatsAppService = require('../whatsapp.service');
  const S = observeStrings(observeLang(user));
  let roster;
  try {
    roster = await _rosterForMatching(user.id);
  } catch (err) {
    logToFile('❌ observe-who: the roster could not be read to match a typed name', { userId: user.id, error: err.message }, 'error');
    await _endTypedWait(user.id);
    await WhatsAppService.sendMessage(from, S.who_other_ack);
    return true;
  }
  const { exact, matches } = matchTypedName(roster, typed);
  const one = exact || (matches.length === 1 ? matches[0] : null);
  logToFile('🔭 observe-who: typed name matched', {
    userId: user.id, sessionId: waiting.sessionId, matches: matches.length, clear: Boolean(one), attempt: waiting.attempts || 0,
  });

  if (one) {
    await _endTypedWait(user.id);
    await _recordObservedTeacher(user, from, waiting.sessionId, one, S);
    return true;
  }
  if (matches.length) {
    const shown = matches.slice(0, MAX_TEACHER_ROWS);
    await _writeTyped(user.id, { ...waiting, matches: shown });
    await WhatsAppService.sendInteractiveMessage(from, buildWhoPayload(shown, S, waiting.sessionId, {
      matches: true, body: S.who_name_matches_body.replace('{name}', typed),
    }));
    return true;
  }
  if (!waiting.attempts) {
    await _writeTyped(user.id, { ...waiting, attempts: 1 });
    await WhatsAppService.sendMessage(from, S.who_name_none_retry.replace('{name}', typed));
    return true;
  }
  await _endTypedWait(user.id);
  await WhatsAppService.sendMessage(from, S.who_name_none_final.replace('{name}', typed));
  return true;
}

module.exports = {
  buildWhoPayload,
  parseWhoId,
  buildObservationRecord,
  maybeAskObservedTeacher,
  handleObservedTeacherPick,
  handleTypedTeacherName,
  matchTypedName,
  foldToken,
  WHO_PREFIX,
};
