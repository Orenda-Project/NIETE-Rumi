'use strict';
/**
 * WHO IS THIS CHILD? — the pure core of identity v2 on the web quiz.
 *
 * Measured on production (6 Oct 2026, the read replica): every rostered class was
 * built by pasting names, so the "roll number" a class list carries is the paste
 * position — a number the teacher recognises and a child does not. Children DO
 * know their own name and their class. So the child types the name they are
 * called by, the server matches it inside the ONE class the quiz is for, and a
 * same-name collision is resolved by asking the child for more of THEIR OWN data
 * (full name → father's name → the list number), never by showing another child.
 *
 * Everything here is pure except resolveQuizClass, which reads the DB in a fixed
 * order: the hand-out's class (quiz_share_codes.class_id) → the quiz's list → the
 * teacher's classes narrowed by the quiz's grade band ("3-5" is grades 3, 4 and 5).
 *
 * Names: a typed name is compared after `canon` — NFKC, lower-case, letters only,
 * and an Urdu given name mapped to its Latin spelling through first-name-map.json
 * (98% of class lists are Latin, 48% of quizzes are Urdu). An Urdu name the map
 * does not know stays Urdu: a miss is a provisional child, never a wrong guess.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
// The map's keys are normalised exactly like a typed token (NFKC, letters only — a key spelled with a
// combining mark such as U+0670 in یحییٰ would otherwise never be hit), and its values to a-z.
const NAME_MAP = Object.freeze(Object.entries(require('./first-name-map.json')).reduce((m, [k, v]) => {
  if (k.startsWith('_')) return m;
  const key = k.split(/\s+/).map((t) => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).join(' ');
  if (key) m[key] = String(v).toLowerCase().replace(/[^a-z]/g, '');
  return m;
}, {}));

const MUHAMMAD = /^(m|md|mohd|muhammad|mohammad|mohammed|muhammed|mohamed|muhamad|mohamad|mhd)$/;
const SEP = /[\s.\-_,/]+/;
const ARABIC = /[؀-ۿ]/;

// ─── names ──────────────────────────────────────────────────────────────────

/** Letters and digits only, NFKC, lower-case; an Urdu token the map knows becomes its Latin spelling. (Digits stay so
 * two fixture children "Kid1"/"Kid2" are two children; real names carry none.) */
function canonToken(tok) {
  const s = String(tok == null ? '' : tok).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (!s) return '';
  if (ARABIC.test(s)) {
    const hit = NAME_MAP[s];
    return hit || s;
  }
  return s;
}

/** The comparable tokens of a name, in order, empty ones dropped. A two-word Urdu entry ("ماہ نور") maps as one token. */
function tokens(name) {
  const raw = String(name == null ? '' : name).normalize('NFKC').trim();
  if (!raw) return [];
  const parts = raw.split(SEP).filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const strip = (t) => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const pair = i + 1 < parts.length ? `${strip(parts[i])} ${strip(parts[i + 1])}` : null;
    if (pair && ARABIC.test(pair) && NAME_MAP[pair]) { out.push(NAME_MAP[pair]); i += 1; continue; }
    const t = canonToken(parts[i]);
    if (t) out.push(MUHAMMAD.test(t) ? 'muhammad' : t);
  }
  return out;
}

/** One comparable string for a whole name. */
const canon = (name) => tokens(name).join('');

/** The name a child is called by: the first token, or "muhammad <next>" when the first is a Muhammad variant. */
function smartFirst(name) {
  const t = tokens(name);
  if (!t.length) return '';
  if (t[0] === 'muhammad' && t.length > 1) return `muhammad ${t[1]}`;
  return t[0];
}

/** Two call names match: "muhammad X" against "muhammad Y" compares X with Y on its own threshold. */
function callNear(a, b) {
  const pa = a.startsWith('muhammad '); const pb = b.startsWith('muhammad ');
  if (pa !== pb) return false;
  return pa ? nearName(a.slice(9), b.slice(9)) : nearName(a, b);
}

/** Every short name a child might answer to: the smart first name, and the bare second name of a Muhammad. */
function callNames(name) {
  const t = tokens(name);
  if (!t.length) return [];
  const out = [smartFirst(name)];
  if (t[0] === 'muhammad' && t.length > 1) out.push(t[1]);
  return out;
}

function editDistance(a, b) {
  const m = a.length; const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/**
 * Could these be the same name? Compared after canon (so Urdu meets Latin). Exact for
 * names of up to 3 letters (Ali is not Alia), one typo for 4–6, two for 7+ ("Muhammad"/"Mohammed").
 */
function nearName(a, b) {
  const x = canon(a); const y = canon(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const min = Math.min(x.length, y.length);
  if (min <= 3) return false;
  return editDistance(x, y) <= (min >= 7 ? 2 : 1);
}

// ─── the roster of one class ────────────────────────────────────────────────

const fatherFirst = (k) => tokens(k && k.father_name)[0] || '';

/**
 * Duplicate rows (the same child pasted twice — 860 extra rows in production classes,
 * 2,667 on legacy lists) collapse to ONE canonical child. Two rows are the same child when
 * their full names and fathers' names agree AND either the father is known or at most one
 * of them is enrolled (the bd-zyo3m shape: a stray active row with no enrolment). Two
 * ENROLLED rows with the same name and nothing to tell them apart stay TWO children: the
 * child is asked for the list number and, failing that, becomes a provisional child the
 * teacher reconciles — recoverable, where a wrong merge would silently give one child the
 * other's results. `aliases` holds the ids folded into a canonical row.
 * Rows: { id, student_name, father_name?, roll_number?, created_at?, enrolled? }.
 */
function dedupe(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    if (!r || !r.id) continue;
    const key = `${canon(r.student_name)}|${fatherFirst(r)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const rank = (r) => `${r.enrolled === false ? 1 : 0}|${r.created_at || '9999'}`;
  const byRank = (p, q) => (rank(p) < rank(q) ? -1 : rank(p) > rank(q) ? 1 : 0);
  const out = [];
  for (const grp of groups.values()) {
    const sorted = [...grp].sort(byRank);
    if (fatherFirst(sorted[0])) {           // a known, shared father: one child
      out.push({ ...sorted[0], aliases: sorted.slice(1).map((r) => r.id) });
      continue;
    }
    const enrolled = sorted.filter((r) => r.enrolled !== false);
    const loose = sorted.filter((r) => r.enrolled === false);
    if (!enrolled.length) { out.push({ ...sorted[0], aliases: sorted.slice(1).map((r) => r.id) }); continue; }
    enrolled.forEach((r, i) => out.push({ ...r, aliases: i === 0 ? loose.map((l) => l.id) : [] }));
  }
  // keep the roster's order (by list number, then name) so the output is stable
  return out.sort((p, q) => ((p.roll_number || 0) - (q.roll_number || 0)) || canon(p.student_name).localeCompare(canon(q.student_name)));
}

/** The canonical child id for any roster row id (itself when it is not an alias). */
function canonicalIdOf(deduped, id) {
  for (const k of deduped || []) {
    if (k.id === id || (k.aliases || []).includes(id)) return k.id;
  }
  return id;
}

const numberOf = (k) => (k && k.roll_number != null && Number.isFinite(Number(k.roll_number)) ? Number(k.roll_number) : null);
const distinct = (xs) => new Set(xs).size === xs.length;

/** Every token the child typed must be near one of the roster name's tokens. */
function allTokensNear(typedTokens, kidName) {
  const kt = tokens(kidName);
  return typedTokens.every((t) => kt.some((k) => nearName(t, k)));
}

/**
 * The typed name inside ONE class.
 *   → { outcome: 'one',  kid, hits }                  exactly one child; the page asks "Are you <first>?"
 *   → { outcome: 'ask',  need, hits, first }          2+ children; ask the child for THEIR OWN `need`
 *   → { outcome: 'none', hits: [] }                   nobody near: provisional
 *   → { outcome: 'none', hits: [], same }             2+ share the name and the answers could not pick one: provisional
 * `answers` = { full_name?, father?, number? } — a string/number answers, `null` means "I don't know"
 * (skip that question), undefined means not asked yet. The hits never leave the server.
 */
function match(deduped, typed, answers = {}) {
  const typedTokens = tokens(typed);
  if (!deduped || !deduped.length || !typedTokens.length) return { outcome: 'none', hits: [] };
  const first = typedTokens[0] === 'muhammad' && typedTokens.length > 1 ? `muhammad ${typedTokens[1]}` : typedTokens[0];
  const rest = typedTokens[0] === 'muhammad' ? typedTokens.slice(2) : typedTokens.slice(1);

  let hits = deduped.filter((k) => {
    const names = callNames(k.student_name);
    if (first === 'muhammad') return tokens(k.student_name)[0] === 'muhammad';
    return names.some((n) => callNear(n, first));
  });
  // Extra typed tokens ("Ali Raza") narrow to the children who carry them all.
  if (rest.length && hits.length) {
    const narrowed = hits.filter((k) => allTokensNear(rest, k.student_name));
    hits = narrowed;
  }
  if (!hits.length) return { outcome: 'none', hits: [] };
  if (hits.length === 1) return { outcome: 'one', kid: hits[0], hits };
  // From here the name WAS found, more than once: a 'none' means "could not tell which", never "not found".
  const same = hits.length;
  const unsure = { outcome: 'none', hits: [], same };

  // ── tiebreakers, about the child's OWN data, in the order the roster can answer them ──
  // 1. full name
  const fullDistinct = distinct(hits.map((k) => canon(k.student_name)));
  if (answers.full_name !== undefined && answers.full_name !== null) {
    const ft = tokens(answers.full_name);
    const narrowed = hits.filter((k) => allTokensNear(ft, k.student_name));
    if (narrowed.length === 1) return { outcome: 'one', kid: narrowed[0], hits: narrowed };
    if (!narrowed.length) return unsure;
    hits = narrowed;
  } else if (fullDistinct && !rest.length && answers.full_name === undefined) {
    return { outcome: 'ask', need: 'full_name', hits, first };
  }
  // 2. father's first name
  const fathers = hits.map(fatherFirst);
  if (answers.father !== undefined && answers.father !== null) {
    const f = tokens(answers.father)[0] || '';
    const narrowed = hits.filter((k) => fatherFirst(k) && nearName(fatherFirst(k), f));
    if (narrowed.length === 1) return { outcome: 'one', kid: narrowed[0], hits: narrowed };
    if (!narrowed.length) return unsure;
    hits = narrowed;
  } else if (fathers.every(Boolean) && distinct(fathers) && answers.father === undefined) {
    return { outcome: 'ask', need: 'father', hits, first };
  }
  // 3. the list number (the teacher's paste position — the last resort)
  const numbers = hits.map(numberOf);
  if (answers.number !== undefined && answers.number !== null) {
    const n = Number(answers.number);
    const narrowed = hits.filter((k) => numberOf(k) === n);
    return narrowed.length === 1 ? { outcome: 'one', kid: narrowed[0], hits: narrowed } : unsure;
  }
  if (numbers.every((n) => n != null) && distinct(numbers) && answers.number === undefined) {
    return { outcome: 'ask', need: 'number', hits, first };
  }
  return unsure;
}

// ─── which class is this quiz for ───────────────────────────────────────────

/** A grade code or a quiz grade as the set of grade ordinals it covers. "3-5" → {3,4,5}; "early_years" → {0}. */
function gradeBand(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return new Set();
  if (/^(early|ey|kg|nursery|prep|pre)/.test(s)) return new Set([0]);
  const nums = (s.match(/\d+/g) || []).map(Number);
  if (!nums.length) return new Set();
  if (nums.length >= 2 && /\d\s*(-|–|to)\s*\d/.test(s)) {
    const [a, b] = [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
    return new Set(Array.from({ length: b - a + 1 }, (_, i) => a + i));
  }
  return new Set([nums[0]]);
}

/** A class's grade code as one ordinal (early_years = 0). */
function gradeOrdinal(code) {
  const b = [...gradeBand(code)];
  return b.length ? b[0] : null;
}

/** "4-A", "4", "EY", and the shift only when the same grade-section exists in both shifts. */
function labelOf(cls, all) {
  const g = cls.grade === 0 ? 'EY' : String(cls.grade == null ? '' : cls.grade);
  const base = cls.section ? `${g}-${cls.section}` : g;
  const twin = (all || []).some((o) => o !== cls && o.id !== cls.id && o.grade === cls.grade && (o.section || null) === (cls.section || null) && o.shift !== cls.shift);
  return twin && cls.shift ? `${base} (${cls.shift})` : base;
}

/**
 * The one class a quiz is for, from the teacher's classes and the quiz's grade band.
 *   none       no class at all
 *   known      one class in the band (or the teacher's only class and no grade on the quiz)
 *   ambiguous  two or more in the band, none in the band, or the teacher's ONLY class is outside the band
 *              (321 of 1,013 one-class hand-outs in 14 days) — `classes` are the ones to offer, labels only
 * `gradeSoft`: the grade is a model's guess (a coaching digest read the transcript — quizzes.meta.grade_source
 * 'digest'), not the teacher's or the catalogue's. A guess never overrules the one class the teacher actually
 * keeps: one class ⇒ known (gradeSoft: true on the result so the monitors can tell). With 2+ classes the
 * band still narrows; it never excludes down to none.
 */
function pickClass(classes, { grade = null, gradeSoft = false } = {}) {
  const all = (classes || []).map((c) => ({ ...c, label: c.label || labelOf(c, classes) }));
  if (!all.length) return { state: 'none', class: null, classes: [] };
  const band = gradeBand(grade);
  if (all.length === 1) {
    if (!band.size || band.has(all[0].grade)) return { state: 'known', class: all[0], classes: all, bound: 'single' };
    if (gradeSoft) return { state: 'known', class: all[0], classes: all, bound: 'single', gradeSoft: true };
    return { state: 'ambiguous', class: null, classes: all };
  }
  const inBand = band.size ? all.filter((c) => band.has(c.grade)) : [];
  if (inBand.length === 1) return { state: 'known', class: inBand[0], classes: all, bound: 'grade' };
  return { state: 'ambiguous', class: null, classes: inBand.length ? inBand : all };
}

let warnedNoColumn = false;
const isMissingColumn = (err) => Boolean(err && (err.code === '42703' || /does not exist/i.test(err.message || '')));

async function classById(classId) {
  const { data } = await supabase.from('classes').select('id, grade_code, section, shift_code, is_active').eq('id', classId).eq('is_active', true).maybeSingle();
  return data ? shape(data) : null;
}

const shape = (c) => ({ id: c.id, grade: gradeOrdinal(c.grade_code), section: c.section || null, shift: c.shift_code || null, listId: null });

async function listIdsFor(classIds) {
  if (!classIds.length) return new Map();
  const { data } = await supabase.from('student_lists').select('id, class_id').in('class_id', classIds).eq('is_active', true);
  const m = new Map();
  (data || []).forEach((l) => { if (!m.has(l.class_id)) m.set(l.class_id, l.id); });
  return m;
}

async function withList(cls) {
  if (!cls) return null;
  const m = await listIdsFor([cls.id]);
  return { ...cls, listId: m.get(cls.id) || null, label: cls.label || labelOf(cls, []) };
}

/**
 * Which class is this quiz for — the DB-backed order:
 *   1. quiz_share_codes.class_id            (the hand-out's class; the column may not exist yet: fail open)
 *   2. quizzes.list_id → student_lists.class_id (a list bound to the quiz)
 *   3. the teacher's active classes (a merged class is inactive), narrowed by the quiz grade band (pickClass);
 *      a digest-sourced grade (quizzes.meta.grade_source 'digest') is soft and never overrules a teacher's only class
 * Pass { teacherUserId, grade } alone to evaluate step 3 before a quiz row exists.
 * → { state, class: {id, grade, section, shift, label, listId} | null, classes: [...], bound: 'code'|'quiz'|'single'|'grade'|null }
 */
async function resolveQuizClass({ teacherUserId, quizId = null, shareCodeId = null, grade = null, gradeSoft = false } = {}) {
  let quizGrade = grade;
  let soft = Boolean(gradeSoft);
  // 1. the hand-out's class
  if (shareCodeId) {
    try {
      const { data, error } = await supabase.from('quiz_share_codes').select('class_id').eq('id', shareCodeId).maybeSingle();
      if (error && isMissingColumn(error)) {
        if (!warnedNoColumn) { warnedNoColumn = true; logToFile('⚠️ web quiz identity: quiz_share_codes.class_id is not on this database yet — hand-outs resolve by quiz/teacher only', {}); }
      } else if (data && data.class_id) {
        const cls = await withList(await classById(data.class_id));
        if (cls) return { state: 'known', class: cls, classes: [cls], bound: 'code' };
      }
    } catch (err) {
      logToFile('⚠️ web quiz identity: share code read failed', { error: err.message });
    }
  }
  // 2. the quiz's list
  if (quizId) {
    const { data: q } = await supabase.from('quizzes').select('grade, list_id, meta').eq('id', quizId).maybeSingle();
    if (q) {
      if (quizGrade == null) quizGrade = q.grade || null;
      // A coaching-born quiz's grade is the digest's reading of the transcript — a guess, not a fact.
      if (grade == null && q.meta && q.meta.grade_source === 'digest') soft = true;
      if (q.list_id) {
        const { data: l } = await supabase.from('student_lists').select('id, class_id, class_name, section').eq('id', q.list_id).maybeSingle();
        if (l && l.class_id) {
          const cls = await classById(l.class_id);
          if (cls) return { state: 'known', class: { ...cls, listId: l.id, label: labelOf(cls, []) }, classes: [{ ...cls, listId: l.id, label: labelOf(cls, []) }], bound: 'quiz' };
        }
      }
    }
  }
  // 3. the teacher's classes
  if (!teacherUserId) return { state: 'none', class: null, classes: [], bound: null };
  const { data: ct } = await supabase.from('class_teachers').select('class_id').eq('teacher_user_id', teacherUserId).eq('is_active', true);
  const ids = [...new Set((ct || []).map((t) => t.class_id).filter(Boolean))];
  let classes = [];
  if (ids.length) {
    const { data: rows } = await supabase.from('classes').select('id, grade_code, section, shift_code, is_active').in('id', ids).eq('is_active', true);
    const lists = await listIdsFor(ids);
    // a merged class is deactivated by the merge (is_active=false), so the filter above already drops it
    classes = (rows || []).map((c) => ({ ...shape(c), listId: lists.get(c.id) || null }));
  } else {
    // a legacy-only teacher (lists never mirrored to a class): the lists stand in for classes
    const { data: lists } = await supabase.from('student_lists').select('id, class_name, section, class_id').eq('user_id', teacherUserId).eq('is_active', true);
    classes = (lists || []).filter((l) => !l.class_id).map((l) => ({ id: null, listId: l.id, legacy: true, grade: gradeOrdinal(l.class_name), section: l.section || null, shift: null }));
  }
  classes = classes.map((c) => ({ ...c, label: labelOf(c, classes) }));
  classes.sort((a, b) => ((a.grade || 0) - (b.grade || 0)) || String(a.section || '').localeCompare(String(b.section || '')));
  const picked = pickClass(classes, { grade: quizGrade, gradeSoft: soft });
  return { ...picked, bound: picked.bound || null };
}

module.exports = {
  canon, tokens, smartFirst, callNames, callNear, nearName, dedupe, canonicalIdOf, match,
  gradeBand, gradeOrdinal, labelOf, pickClass, resolveQuizClass,
  _resetWarnings: () => { warnedNoColumn = false; },
};
