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
  en: { mine: '✅ *{school}* is already on your list, with {count}. Nothing to change.',
        some: '✅ Added *{school}*. {count} now in your teacher list.',
        none: '✅ Added *{school}*. It has no teacher list yet, so no teachers were added — tell the team and they will load it.' },
  ur: { mine: '✅ *{school}* پہلے ہی آپ کی فہرست میں ہے، {count} کے ساتھ۔ کچھ تبدیل کرنے کی ضرورت نہیں۔',
        some: '✅ *{school}* شامل کر دیا۔ اب آپ کی فہرست میں {count} ہیں۔',
        none: '✅ *{school}* شامل کر دیا۔ اس کی ٹیچر فہرست ابھی موجود نہیں، اس لیے کوئی ٹیچر شامل نہیں ہوا — ٹیم کو بتائیں، وہ اپ لوڈ کر دیں گے۔' },
  sw: { mine: '✅ *{school}* tayari ipo kwenye orodha yako, na {count}. Hakuna cha kubadilisha.',
        some: '✅ Nimeongeza *{school}*. Sasa una {count} kwenye orodha yako.',
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

/**
 * What the coach reads after adding a school.
 *
 * Three OUTCOMES, not two — the distinction is the bug fixed on 17 Aug. The
 * operator added IMCB I-8/3 (57 teachers), a second submission took the
 * already-mine path, and because that path reported teachersMapped:0 she was
 * told "It has no teacher list yet, so no teachers were added". All 57 were in
 * fact on her list. `teachersMapped` counts what THIS call wrote; `teacherCount`
 * is what she actually holds now, and only the latter can say "none".
 */
function addedSchoolAck(lang, opts = {}) {
  const l = clampLanguage(lang);
  const t = ADDED_TEMPLATES[l] || ADDED_TEMPLATES.en;
  const mapped = Number(opts.teachersMapped) || 0;
  const held = opts.teacherCount == null ? mapped : Number(opts.teacherCount) || 0;
  const school = String(opts.schoolName || '').trim() || 'that school';
  const body = held === 0 ? t.none : (opts.alreadyMine ? t.mine : t.some);
  return body.replace('{school}', school).replace('{count}', _count(l, held));
}

function removedSchoolAck(lang, opts = {}) {
  const l = clampLanguage(lang);
  const t = REMOVED_TEMPLATES[l] || REMOVED_TEMPLATES.en;
  return t.replace('{school}', String(opts.schoolName || '').trim() || 'that school');
}

// ── the loop ───────────────────────────────────────────────────────────

/** The choices the after-add / after-remove screen renders, in order. */
const ROSTER_NEXT = ['add', 'remove', 'menu', 'done'];

/**
 * Where a loop choice sends the coach.
 *
 * Meta's routing_model is a DAG and a screen may hold ONE Footer, so a real
 * loop cannot be expressed inside the Flow — verified against Meta, not
 * assumed: a link cannot `complete`, a second Footer is rejected, and a route
 * back to MENU is "not allowed in the routing model". So looping means closing
 * the Flow and reopening it, which is also why 'menu' reopens with NO screen:
 * MENU declares `items`, and only the endpoint can fill those in.
 */
function rosterNextTarget(next) {
  switch (next) {
    case 'add': return { reopen: true, screen: 'ADD_SEARCH' };
    case 'remove': return { reopen: true, screen: 'MANAGE_SCHOOLS' };
    case 'menu': return { reopen: true, screen: null };
    default: return { reopen: false, screen: null };   // 'done' and anything stale
  }
}

// ── data access (thin) ─────────────────────────────────────────────────

const _db = () => require('../../config/supabase');

/**
 * A school name reduced to letters and digits, upper-cased. Two spellings that
 * differ only by spacing, case or punctuation are the same school:
 * 'IMCG(VI-XII)  Herdogher' and 'IMCG(VI-XII) Herdogher' are one school, and the
 * register itself holds the double-spaced form. One letter still separates two
 * real schools, which is the whole difference between IMSB and IMSG.
 */
function canonicalSchoolName(name) {
  return String(name == null ? '' : name).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Do the coaches holding this school_ext_id disagree about which school it is?
 *
 * Two questions, in order. First, do the names disagree once spacing and case
 * are removed? If they agree we are done, which is the normal path: production
 * 2026-08-26 has 498 ext ids where holders agree and 1 where they do not.
 *
 * Second, and only when the names disagree: do the spellings share a teacher?
 * One shared teacher means one school typed two ways, and refusing there costs a
 * coach a pointless re-entry. niete:427 is exactly that, 'IMSB (I-V), MAL' and
 * 'IMSB (I-V), MALOT' over the same seven teachers. Disjoint rosters mean two
 * real schools under one number, which is the bug this guard exists for.
 *
 * Fails CLOSED throughout. A query error, or a spelling with no teachers at all,
 * counts as disagreement: refusing costs one manual step, while inheriting the
 * wrong roster hands a coach another school's teachers.
 */
async function extIdIsAmbiguous(schoolExtId) {
  const supabase = _db();
  try {
    const { data, error } = await supabase
      .from('leader_schools').select('school_name, leader_user_id').eq('school_ext_id', schoolExtId);
    if (error) return true;
    const rows = data || [];

    // Which coaches hold each spelling.
    const holdersByName = new Map();
    for (const r of rows) {
      const canon = canonicalSchoolName(r.school_name);
      if (!canon) continue;
      if (!holdersByName.has(canon)) holdersByName.set(canon, new Set());
      if (r.leader_user_id) holdersByName.get(canon).add(r.leader_user_id);
    }
    if (holdersByName.size <= 1) return false;

    // teacher_phone_e164, not teacher_phone: the raw column carries whatever the
    // roster sheet held and differs from the normalised one on 8,007 of 8,025
    // production rows, so two coaches who typed one teacher differently would
    // read as disjoint and be refused.
    //
    // Deliberately no .limit(). One ext id's roster is 20 rows on average and 160
    // at worst (production 2026-08-26), two short text columns, on an Index Scan
    // over idx_leader_teachers_leader_school — call it 6KB, reached by 1 ext id in
    // 405 and only when a human adds a school. A cap here would be worse than
    // useless: truncating the roster invents a disjoint pair and refuses a school
    // that should have inherited.
    const { data: tRows, error: tErr } = await supabase
      .from('leader_teachers').select('leader_user_id, teacher_phone_e164').eq('school_ext_id', schoolExtId);
    if (tErr) return true;

    // Phones per spelling, via the coaches that hold it.
    const phonesByName = new Map();
    for (const [canon, holders] of holdersByName) {
      const phones = new Set();
      for (const t of tRows || []) {
        if (holders.has(t.leader_user_id) && t.teacher_phone_e164) phones.add(t.teacher_phone_e164);
      }
      phonesByName.set(canon, phones);
    }

    // Ambiguous as soon as ONE pair of spellings shares nothing. An empty set
    // shares nothing with anything, which is the no-evidence case.
    const names = [...phonesByName.keys()];
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const a = phonesByName.get(names[i]);
        const b = phonesByName.get(names[j]);
        if (![...a].some((p) => b.has(p))) return true;
      }
    }
    return false;
  } catch (_) {
    return true;
  }
}

/**
 * The school this ext id names, in the MASTER — creating it there if the only
 * place it exists is the assignment table.
 *
 * Two things this fixes at once.
 *
 * `leader_schools.school_id` is a declared FK to `schools(id)` that adding a
 * school never wrote, so every join ran on the text `'niete:' || emis`. That
 * string join is the reason `extIdIsAmbiguous()` and the niete:607 / niete:628
 * guards exist in application code — two real schools were typed with the same
 * EMIS. Returning the id is what lets the assignment row carry the real key.
 *
 * And the search draws from `schools` UNION `leader_schools`, so a coach can
 * add a school that exists only in the assignment table. Since a teacher now
 * reaches a coach through `users.school_id -> schools.id`, such a school can
 * never have anyone derived into it: she adds it, it succeeds, and the list is
 * empty forever with nothing explaining why. Materialising the row closes that.
 *
 * Returns null for an ext id nobody has ever heard of — a school is created
 * from a record that already exists, never invented from a typed string.
 */
async function resolveOrCreateSchool(supabase, schoolExtId) {
  const emis = String(schoolExtId || '').split(':').pop();
  if (!emis) return null;

  // The master first. `schools.emis` exists on production but not on every
  // environment, so a failure here falls through rather than throwing.
  try {
    const { data, error } = await supabase.from('schools').select('id, name, emis').eq('emis', emis).limit(1);
    if (!error && data && data[0]) {
      return { school_id: data[0].id, name: data[0].name, emis: String(data[0].emis || emis) };
    }
  } catch (_) { /* fall through */ }

  // Only known to the assignment table — promote it.
  const { data: ls } = await supabase
    .from('leader_schools').select('school_name, emis').eq('school_ext_id', schoolExtId).limit(1);
  if (!ls || !ls[0]) return null;

  const name = ls[0].school_name;
  const { data: made, error: insErr } = await supabase.from('schools')
    .insert({ name, emis: String(ls[0].emis || emis), is_active: true })
    .select('id, name, emis').limit(1);
  if (insErr || !made || !made[0]) return null;
  return { school_id: made[0].id, name: made[0].name, emis: String(made[0].emis || emis) };
}

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
  // Resolve in the MASTER, creating the row there if that is the only gap —
  // a school with no `schools` row can never have anyone derived into it.
  const school = await resolveOrCreateSchool(supabase, schoolExtId);
  if (!school) return { ok: false, reason: 'not_found' };

  const { data: mine } = await supabase
    .from('leader_schools').select('id').eq('leader_user_id', leaderUserId)
    .eq('school_ext_id', schoolExtId).limit(1);
  const { data: myTeachers } = await supabase
    .from('leader_teachers').select('id').eq('leader_user_id', leaderUserId)
    .eq('school_ext_id', schoolExtId).limit(1);

  if (mine && mine[0] && myTeachers && myTeachers[0]) {
    return {
      ok: true, alreadyMine: true, schoolName: school.name, teachersMapped: 0,
      teacherCount: await _myTeacherCount(supabase, leaderUserId, schoolExtId),
    };
  }

  // Inheritance is keyed on school_ext_id alone, and that id is 'niete:' || an
  // EMIS typed into the roster sheet. Two rows on production carry the wrong
  // number, so niete:607 covers Sang Jani AND Shah Allah Ditta, and niete:628
  // covers a boys' and a girls' school. Copying "the teachers at this id" across
  // would pool two schools' rosters. If the coaches holding the id disagree on
  // what school it is, inherit nothing and say so.
  const ambiguousExtId = await extIdIsAmbiguous(schoolExtId);

  const { data: roster } = ambiguousExtId
    ? { data: [] }
    : await supabase
      .from('leader_teachers')
      .select('teacher_ext_id, teacher_name, teacher_phone_e164, teacher_phone, level')
      .eq('school_ext_id', schoolExtId);

  if (!(mine && mine[0])) {
    await supabase.from('leader_schools').insert({
      leader_user_id: leaderUserId, school_ext_id: schoolExtId,
      // The real key, finally. Every join used to run on the text ext id.
      school_id: school.school_id,
      school_name: school.name, emis: String(school.emis), source: ROW_SOURCE,
    });
  }

  // ONE insert for the whole roster. This used to be a per-teacher loop, and
  // at a measured ~160ms round-trip a 57-teacher school took ~10.1s against
  // Meta's ~10s data_exchange ceiling — the operator's "Couldn't load content.
  // Try again later.", which then succeeded on retry because the retry took
  // the already-mine path. The largest NIETE school (160) could never win.
  const seen = new Set();
  const rows = [];
  for (const t of roster || []) {
    const phone = t.teacher_phone_e164;
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    rows.push({
      leader_user_id: leaderUserId, school_ext_id: schoolExtId,
      teacher_ext_id: t.teacher_ext_id || phone, teacher_name: t.teacher_name || null,
      teacher_phone_e164: phone, teacher_phone: t.teacher_phone || null,
      level: t.level || null, source: ROW_SOURCE,
    });
  }
  let mapped = 0;
  let insertError = null;
  if (rows.length) {
    const { error } = await supabase.from('leader_teachers').insert(rows);
    // A silently-swallowed failure is what let "no teachers were added" be
    // printed for a school that had 57. Surface it instead.
    if (error) insertError = error.message || String(error);
    else mapped = rows.length;
  }

  return {
    ok: true, alreadyMine: false, schoolName: school.name, teachersMapped: mapped,
    teacherCount: await _myTeacherCount(supabase, leaderUserId, schoolExtId),
    insertError, ambiguousExtId,
  };
}

/** How many teachers this coach actually holds at this school, right now. */
async function _myTeacherCount(supabase, leaderUserId, schoolExtId) {
  const { count } = await supabase
    .from('leader_teachers').select('id', { count: 'exact', head: true })
    .eq('leader_user_id', leaderUserId).eq('school_ext_id', schoolExtId);
  return Number(count) || 0;
}

/** Remove a school and only THIS coach's teacher rows for it. */
async function removeSchoolForCoach(leaderUserId, schoolExtId) {
  const supabase = _db();
  const { data: mine } = await supabase
    .from('leader_schools').select('school_name').eq('leader_user_id', leaderUserId)
    .eq('school_ext_id', schoolExtId).limit(1);
  if (!mine || !mine[0]) return { ok: false, reason: 'not_mine' };
  // Check BOTH deletes. These used to be fire-and-forget with an unconditional
  // ok:true, so a blocked delete still printed "Removed *X*" — which is how a
  // removal that removed nothing stayed invisible in production.
  const { error: tErr } = await supabase.from('leader_teachers').delete()
    .eq('leader_user_id', leaderUserId).eq('school_ext_id', schoolExtId);
  const { error: sErr } = await supabase.from('leader_schools').delete()
    .eq('leader_user_id', leaderUserId).eq('school_ext_id', schoolExtId);
  if (tErr || sErr) {
    return { ok: false, reason: 'delete_failed', error: (sErr || tErr).message || String(sErr || tErr) };
  }
  return { ok: true, schoolName: mine[0].school_name };
}

module.exports = {
  resolveOrCreateSchool,
  canonicalSchoolName, extIdIsAmbiguous,
  matchSchool, matchTeacher, normalisePhoneTerm,
  addedSchoolAck, removedSchoolAck,
  searchUniverse, listMySchools, addSchoolForCoach, removeSchoolForCoach,
  rosterNextTarget, ROSTER_NEXT, ROW_SOURCE, RESULT_CAP,
};
