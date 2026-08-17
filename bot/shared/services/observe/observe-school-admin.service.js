/**
 * bd-88krt — a coach owns her own school list, from WhatsApp.
 *
 * Riffat (HITL R38/R41) and the operator, 2026-08-17: search the whole universe
 * of schools by NAME or EMIS, add one and inherit its teachers, remove one, and
 * see a plain confirmation of what happened.
 *
 * Live shape this is written against (queried 2026-08-17, not assumed):
 *   · `schools` (465 rows) is the universe a coach may search.
 *   · `leader_teachers` (7,149 rows / 412 schools) is the de-facto school→teacher
 *     roster — there is no separate roster table.
 *   · 139 (school,teacher) pairs are ALREADY held by more than one coach, so
 *     co-assignment is normal. Adding a school someone else has is fine, and an
 *     observation is credited to whoever RECORDS it (observer_user_id), never to
 *     the school's other owner.
 *   · 51 universe schools have no teacher rows at all. Adding one maps nobody,
 *     and the coach is told — silently handing her an empty school is the exact
 *     bug (R41) this exists to prevent.
 *   · Both tables carry CHECK (source = 'niete_ict'), so that is the only value
 *     that may be written. A different literal fails every insert with 23514.
 *
 * The pure matchers/ack below are unit-tested; the supabase calls stay thin.
 */

const { clampLanguage } = require('../../config/ux-strings');

const ROW_SOURCE = 'niete_ict';        // the only value the CHECK constraint allows
const RESULT_CAP = 20;                 // RadioButtonsGroup / readable-list ceiling

// ── pure matchers ──────────────────────────────────────────────────────

/** Digits of a typed phone term, dropped to a comparable local tail. */
function normalisePhoneTerm(term) {
  const d = String(term == null ? '' : term).replace(/\D/g, '');
  if (d.length < 7) return '';                 // too short to be a number
  if (d.startsWith('92')) return d.slice(2);   // 923001234567 -> 3001234567
  if (d.startsWith('0')) return d.slice(1);    // 03001234567  -> 3001234567
  return d;
}

/** A school matches on part of its NAME, its EMIS, or its full ext id. */
function matchSchool(school, term) {
  const t = String(term == null ? '' : term).trim().toLowerCase();
  if (!t) return true;                          // blank shows everything
  const s = school || {};
  return [s.school_name, s.emis, s.school_ext_id]
    .some((v) => String(v == null ? '' : v).toLowerCase().includes(t));
}

/** A teacher matches on part of her NAME or her phone (typed any common way). */
function matchTeacher(teacher, term) {
  const raw = String(term == null ? '' : term).trim();
  if (!raw) return true;
  const t = raw.toLowerCase();
  const x = teacher || {};
  if (String(x.teacher_name == null ? '' : x.teacher_name).toLowerCase().includes(t)) return true;
  const digits = normalisePhoneTerm(raw);
  if (!digits) return false;
  const phone = String(x.teacher_phone_e164 || x.teacher_phone || '').replace(/\D/g, '');
  return phone.includes(digits);
}

// ── the interstitial ───────────────────────────────────────────────────

const ADDED_TEMPLATES = {
  en: { some: '✅ Added *{school}*. {count} now in your teacher list.',
        none: '✅ Added *{school}*. It has no teacher list yet, so no teachers were added — tell the team and they will load it.' },
  ur: { some: '✅ *{school}* شامل کر دیا۔ اب آپ کی فہرست میں {count} ہیں۔',
        none: '✅ *{school}* شامل کر دیا۔ اس کی ٹیچر فہرست ابھی موجود نہیں، اس لیے کوئی ٹیچر شامل نہیں ہوا — ٹیم کو بتائیں، وہ اپ لوڈ کر دیں گے۔' },
  sw: { some: '✅ Nimeongeza *{school}*. Sasa una {count} kwenye orodha yako.',
        none: '✅ Nimeongeza *{school}*. Bado haina orodha ya walimu, kwa hivyo hakuna aliyeongezwa — waambie timu wapakie.' },
};

const REMOVED_TEMPLATES = {
  en: '🗑 Removed *{school}* from your list. Its teachers are no longer yours to observe.',
  ur: '🗑 *{school}* آپ کی فہرست سے ہٹا دیا۔ اب اس کے ٹیچرز آپ کی فہرست میں نہیں۔',
  sw: '🗑 Nimeondoa *{school}* kwenye orodha yako. Walimu wake hawapo tena kwako.',
};

function _count(lang, n) {
  if (lang === 'ur') return `${n} ٹیچرز`;
  if (lang === 'sw') return `walimu ${n}`;
  return n === 1 ? '1 teacher' : `${n} teachers`;
}

/** What the coach reads after adding a school. Honest when the roster is empty. */
function addedSchoolAck(lang, opts = {}) {
  const l = clampLanguage(lang);
  const t = ADDED_TEMPLATES[l] || ADDED_TEMPLATES.en;
  const n = Number(opts.teachersMapped) || 0;
  const school = String(opts.schoolName || '').trim() || 'that school';
  return (n > 0 ? t.some : t.none).replace('{school}', school).replace('{count}', _count(l, n));
}

function removedSchoolAck(lang, opts = {}) {
  const l = clampLanguage(lang);
  const t = REMOVED_TEMPLATES[l] || REMOVED_TEMPLATES.en;
  return t.replace('{school}', String(opts.schoolName || '').trim() || 'that school');
}

// ── data access (thin) ─────────────────────────────────────────────────

const _db = () => require('../../config/supabase');

/**
 * Universe search — every school we know of, filtered in JS by name/EMIS.
 *
 * Built from TWO sources on purpose. The `schools` master carries emis on
 * production but NOT on staging (staging's table is id/name/region only — a
 * real schema difference, found by querying both), so selecting emis there
 * fails with 42703 and would silently return nothing. `leader_schools` always
 * carries school_ext_id + emis, so it is both the fallback and, for any school
 * already assigned to someone, the authoritative naming. Deduped by ext id.
 */
async function _universeRows() {
  const supabase = _db();
  const out = new Map();
  // Whatever `schools` can give us, without assuming its columns.
  try {
    const { data, error } = await supabase.from('schools').select('*').limit(1000);
    if (!error) {
      for (const s of data || []) {
        if (s.is_active === false) continue;
        if (s.emis == null) continue;                  // staging has no emis column
        out.set(`niete:${s.emis}`, {
          school_ext_id: `niete:${s.emis}`, school_name: s.name, emis: String(s.emis),
        });
      }
    }
  } catch (_) { /* fall through to leader_schools */ }
  // Always union the assigned schools — the only source present in both DBs.
  try {
    const { data } = await supabase
      .from('leader_schools').select('school_ext_id, school_name, emis').limit(2000);
    for (const s of data || []) {
      if (!s.school_ext_id || out.has(s.school_ext_id)) continue;
      out.set(s.school_ext_id, {
        school_ext_id: s.school_ext_id,
        school_name: s.school_name,
        emis: String(s.emis == null ? String(s.school_ext_id).split(':').pop() : s.emis),
      });
    }
  } catch (_) { /* nothing more to try */ }
  return [...out.values()];
}

async function searchUniverse(leaderUserId, term, cap = RESULT_CAP) {
  const supabase = _db();
  const all = await _universeRows();
  const { data: mine } = await supabase
    .from('leader_schools').select('school_ext_id').eq('leader_user_id', leaderUserId);
  const has = new Set((mine || []).map((r) => r.school_ext_id));
  return all
    .filter((s) => matchSchool(s, term))
    .map((s) => ({ ...s, alreadyMine: has.has(s.school_ext_id) }))
    .slice(0, cap);
}

/** The coach's own schools. */
async function listMySchools(leaderUserId) {
  const supabase = _db();
  const { data } = await supabase
    .from('leader_schools').select('school_ext_id, school_name, emis')
    .eq('leader_user_id', leaderUserId);
  return data || [];
}

/**
 * Add a school and inherit its roster, in one call. Idempotent, and it REPAIRS
 * the R41 case: a school she already owns with none of her teachers on it gets
 * its roster mapped rather than being refused as "already yours".
 */
async function addSchoolForCoach(leaderUserId, schoolExtId) {
  const supabase = _db();
  const emis = String(schoolExtId || '').split(':').pop();
  // Same schema caveat as _universeRows: `schools.emis` exists on prod, not on
  // staging. Resolve the name from whichever source actually has the school.
  let school = null;
  try {
    const { data, error } = await supabase.from('schools').select('*').eq('emis', emis).limit(1);
    if (!error && data && data[0]) school = { emis, name: data[0].name };
  } catch (_) { /* fall back below */ }
  if (!school) {
    const { data } = await supabase
      .from('leader_schools').select('school_name, emis')
      .eq('school_ext_id', schoolExtId).limit(1);
    if (data && data[0]) school = { emis: data[0].emis || emis, name: data[0].school_name };
  }
  if (!school) return { ok: false, reason: 'not_found' };

  const { data: mine } = await supabase
    .from('leader_schools').select('id').eq('leader_user_id', leaderUserId)
    .eq('school_ext_id', schoolExtId).limit(1);
  const { data: myTeachers } = await supabase
    .from('leader_teachers').select('id').eq('leader_user_id', leaderUserId)
    .eq('school_ext_id', schoolExtId).limit(1);

  if (mine && mine[0] && myTeachers && myTeachers[0]) {
    return { ok: true, alreadyMine: true, schoolName: school.name, teachersMapped: 0 };
  }

  const { data: roster } = await supabase
    .from('leader_teachers')
    .select('teacher_ext_id, teacher_name, teacher_phone_e164, teacher_phone, level')
    .eq('school_ext_id', schoolExtId);

  if (!(mine && mine[0])) {
    await supabase.from('leader_schools').insert({
      leader_user_id: leaderUserId, school_ext_id: schoolExtId,
      school_name: school.name, emis: String(school.emis), source: ROW_SOURCE,
    });
  }

  const seen = new Set();
  let mapped = 0;
  for (const t of roster || []) {
    const phone = t.teacher_phone_e164;
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    const { error } = await supabase.from('leader_teachers').insert({
      leader_user_id: leaderUserId, school_ext_id: schoolExtId,
      teacher_ext_id: t.teacher_ext_id || phone, teacher_name: t.teacher_name || null,
      teacher_phone_e164: phone, teacher_phone: t.teacher_phone || null,
      level: t.level || null, source: ROW_SOURCE,
    });
    if (!error) mapped += 1;
  }
  return { ok: true, alreadyMine: false, schoolName: school.name, teachersMapped: mapped };
}

/** Remove a school and only THIS coach's teacher rows for it. */
async function removeSchoolForCoach(leaderUserId, schoolExtId) {
  const supabase = _db();
  const { data: mine } = await supabase
    .from('leader_schools').select('school_name').eq('leader_user_id', leaderUserId)
    .eq('school_ext_id', schoolExtId).limit(1);
  if (!mine || !mine[0]) return { ok: false, reason: 'not_mine' };
  await supabase.from('leader_teachers').delete()
    .eq('leader_user_id', leaderUserId).eq('school_ext_id', schoolExtId);
  await supabase.from('leader_schools').delete()
    .eq('leader_user_id', leaderUserId).eq('school_ext_id', schoolExtId);
  return { ok: true, schoolName: mine[0].school_name };
}

module.exports = {
  matchSchool, matchTeacher, normalisePhoneTerm,
  addedSchoolAck, removedSchoolAck,
  searchUniverse, listMySchools, addSchoolForCoach, removeSchoolForCoach,
  ROW_SOURCE, RESULT_CAP,
};
