'use strict';

/**
 * Class lists for TEST schools: the planner (pure, no database). The CLI is seed-test-class-lists.js.
 *
 * A coach's Learning assessment (EGRA/EGMA) draws children from a school's class lists for the current session
 * (classes + class_enrollments + students, read by bot/shared/services/child-test/store.js); a teacher's own class
 * list reads the same rows plus class_teachers. A sandbox test school has none of them, so the coach sees "no class
 * list for this grade yet". This plans realistic lists for one test school:
 *
 *   grades     1-5 (what the assessment offers) plus any grade 6-12 a teacher there teaches or a class already exists for
 *   sections   A; a second teacher of a grade (or spare teachers) opens B, up to maxSections
 *   teachers   one class teacher per class, from the school's own teachers: role teacher, not deleted, and never a number
 *              that can reach a real phone. A teacher's grades_taught is honoured first; the rest are dealt in order.
 *              A grade nobody teaches gets a list with no class teacher (as when a coach photographs a register).
 *   children   20-35 per class, roll numbers 1..N, invented "<Name> Testwala" names and fathers, no phone, no date of
 *              birth. A girls' school gets girls; other schools a mix. The schema has no gender column: the name
 *              carries it, and the plan says which (for the dry run and the tests only; it is never written).
 *   untouched  a class that already has children: nothing is added to it or changed.
 *
 * Deterministic: the same school plans the same lists on every run (a hash of the school, grade and section seeds
 * every choice), so a re-run adds nothing and the import's run id makes the write itself idempotent.
 */

const crypto = require('crypto');

const PROD_REFS = ['ihzciabopbttygxxgrkm', 'jlpenspfdcwxkopaidys'];
const SANDBOX_REF = 'olvritwoqujtjvwfulbh';
const RUN_PREFIX = 'seed-test-class-lists';
const ASSESSMENT_GRADES = [1, 2, 3, 4, 5];
const SECTIONS = 'ABCDEFGHIJKLMNO'.split('');

const GIRLS = ['Ayesha', 'Fatima', 'Zainab', 'Maryam', 'Hira', 'Iqra', 'Sana', 'Amna', 'Rabia', 'Mahnoor', 'Areeba', 'Aliza',
  'Anaya', 'Hafsa', 'Khadija', 'Laiba', 'Eman', 'Noor', 'Zoya', 'Minahil', 'Alishba', 'Hoorain', 'Aiza', 'Arooj', 'Bushra',
  'Dua', 'Esha', 'Fiza', 'Hania', 'Javeria', 'Kinza', 'Mehak', 'Muskan', 'Nimra', 'Rida', 'Saba', 'Sidra', 'Tooba',
  'Umme Hani', 'Wajiha', 'Zara', 'Anum', 'Rimsha', 'Maham', 'Sundas', 'Hareem', 'Shiza', 'Inaya', 'Ammara', 'Mishal'];
const BOYS = ['Ali', 'Ahmed', 'Hamza', 'Usman', 'Bilal', 'Hassan', 'Hussain', 'Abdullah', 'Ibrahim', 'Muhammad', 'Umar',
  'Zain', 'Saad', 'Talha', 'Hammad', 'Faizan', 'Arham', 'Ayaan', 'Rayyan', 'Shayan', 'Danish', 'Fahad', 'Haris', 'Junaid',
  'Kashif', 'Moiz', 'Noman', 'Owais', 'Qasim', 'Rehan', 'Sameer', 'Taimoor', 'Uzair', 'Waleed', 'Yasir', 'Zohaib', 'Arslan',
  'Basit', 'Daniyal', 'Ehsan', 'Farhan', 'Ghulam Abbas', 'Huzaifa', 'Imran', 'Jawad', 'Luqman', 'Mustafa', 'Nabeel',
  'Obaid', 'Shahzaib'];
const FATHERS = ['Tariq', 'Khalid', 'Javed', 'Naveed', 'Asif', 'Shahid', 'Pervaiz', 'Rashid', 'Zahid', 'Abid', 'Sajid',
  'Nadeem', 'Waseem', 'Aslam', 'Akram', 'Rafiq', 'Saleem', 'Majid', 'Amjad', 'Iftikhar', 'Mushtaq', 'Tanveer', 'Zulfiqar',
  'Mehmood', 'Riaz', 'Shafiq', 'Arshad', 'Liaqat', 'Babar', 'Imtiaz', 'Irfan', 'Kamran', 'Adnan', 'Faisal', 'Zubair'];
const SURNAME = 'Testwala';

/** The database the CLI may write to: the sandbox project, or a local stack. Anything else is refused. */
function assertTarget(env = {}) {
  const url = String(env.SUPABASE_URL || '');
  const db = String(env.DATABASE_URL || '');
  if (!url) throw new Error('refusing: SUPABASE_URL is not set');
  for (const ref of PROD_REFS) {
    if (url.includes(ref) || db.includes(ref)) throw new Error(`refusing: ${ref} is a PRODUCTION project`);
  }
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url)) return { ref: 'local' };
  const m = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/);
  if (!m || m[1] !== SANDBOX_REF) throw new Error(`refusing: ${m ? m[1] : url} is not the sandbox project (${SANDBOX_REF}) or a local database`);
  return { ref: m[1] };
}

/** A number that can reach a real Pakistani mobile (03xx-04xx operators and 0355). Test ranges (0399…, 9299…, 9992…) are not. */
function isRealPhone(phone) {
  return /^92(3[0-4]\d|355)\d{7}$/.test(String(phone || ''));
}

function schoolGender(name) {
  const n = String(name || '');
  if (/\bIM[SC]G\b|\bgirls?\b/i.test(n)) return 'girls';
  if (/\bIM[SC]B\b|\bboys?\b/i.test(n)) return 'boys';
  return 'mixed';
}

/** grades_taught as stored (a JSON string, an array or null) → grade numbers 1-12. */
function gradesOf(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch (_) { list = raw.split(','); }
  }
  if (!Array.isArray(list)) return [];
  const out = list.map((g) => /^grade_(\d{1,2})$/.exec(String(g).trim())).filter(Boolean).map((m) => Number(m[1]))
    .filter((g) => g >= 1 && g <= 12);
  return [...new Set(out)].sort((a, b) => a - b);
}

/** A seeded generator (mulberry32 over a sha256 of the key): the same key, the same numbers. */
function rngFor(key) {
  let a = crypto.createHash('sha256').update(key).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rnd) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function makeChildren(key, gender, minSize, maxSize) {
  const rnd = rngFor(key);
  const size = minSize + Math.floor(rnd() * (maxSize - minSize + 1));
  const pools = { girl: shuffled(GIRLS, rnd), boy: shuffled(BOYS, rnd) };
  const children = [];
  for (let i = 0; i < size; i += 1) {
    let g = gender === 'girls' ? 'girl' : gender === 'boys' ? 'boy' : (rnd() < 0.5 ? 'girl' : 'boy');
    if (!pools[g].length) g = g === 'girl' ? 'boy' : 'girl';
    children.push({
      roll_number: i + 1,
      student_name: `${pools[g].shift()} ${SURNAME}`,
      father_name: `${FATHERS[Math.floor(rnd() * FATHERS.length)]} ${SURNAME}`,
      gender: g,
    });
  }
  return children;
}

const byNameThenId = (a, b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a.id).localeCompare(String(b.id));
const bySlot = (a, b) => a.grade - b.grade || String(a.section || '').localeCompare(String(b.section || ''));

/**
 * @param {object} p
 * @param {{id, name, emis, is_probable_test}} p.school
 * @param {Array<{id, name, role, phone_number, grades_taught, deleted_at}>} p.teachers   the school's users
 * @param {Array<{id, grade_code, section, shift_code, session_code, is_active, enrolled, classTeacherId}>} p.classes
 * @param {string} p.sessionCode  e.g. 2026-2027
 */
function planSchool({ school, teachers = [], classes = [], sessionCode, grades = ASSESSMENT_GRADES, minSize = 20, maxSize = 35, maxSections = 2 } = {}) {
  if (!school || school.is_probable_test !== true) {
    throw new Error(`${(school && (school.emis || school.id)) || '?'}: not a test school (is_probable_test is not true), refusing`);
  }
  if (!sessionCode) throw new Error('planSchool: sessionCode is required');
  if (!(minSize >= 1 && maxSize >= minSize)) throw new Error('planSchool: bad class size range');
  const tag = school.emis || school.id;
  const gender = schoolGender(school.name);

  const skippedTeachers = [];
  const eligible = [];
  for (const t of [...teachers].sort(byNameThenId)) {
    if (t.deleted_at || t.role !== 'teacher') continue;
    if (isRealPhone(t.phone_number)) { skippedTeachers.push({ id: t.id, name: t.name, reason: 'real_phone' }); continue; }
    eligible.push({ id: t.id, name: t.name, grades: gradesOf(t.grades_taught) });
  }

  const slots = [];
  for (const c of classes) {
    const m = /^grade_(\d{1,2})$/.exec(String(c.grade_code || ''));
    if (!m || !c.is_active || c.session_code !== sessionCode || (c.shift_code || 'morning') !== 'morning') continue;
    slots.push({ grade: Number(m[1]), section: c.section || null, existingClassId: c.id, enrolled: Number(c.enrolled) || 0, teacherId: c.classTeacherId || null });
  }
  const gradeSet = new Set(grades);
  for (const t of eligible) for (const g of t.grades) gradeSet.add(g);
  for (const s of slots) gradeSet.add(s.grade);
  const allGrades = [...gradeSet].sort((a, b) => a - b);

  const slotsOf = (g) => slots.filter((s) => s.grade === g);
  const nextSection = (g) => SECTIONS.find((x) => !slotsOf(g).some((s) => s.section === x));
  const addSlot = (g) => { const s = { grade: g, section: nextSection(g), existingClassId: null, enrolled: 0, teacherId: null }; slots.push(s); return s; };
  for (const g of allGrades) if (!slotsOf(g).length) addSlot(g);

  const busy = new Set(slots.map((s) => s.teacherId).filter(Boolean));
  const names = new Map(teachers.map((t) => [t.id, t.name]));
  const open = (s) => !s.teacherId && s.enrolled === 0;
  const take = (s, t) => { s.teacherId = t.id; busy.add(t.id); };

  // A teacher's own grades first: the class of that grade still without a teacher, or a new section of it.
  for (const t of eligible.filter((x) => x.grades.length && !busy.has(x.id))) {
    for (const g of t.grades) {
      const free = slotsOf(g).sort(bySlot).find(open);
      if (free) { take(free, t); break; }
      if (slotsOf(g).length < maxSections) { take(addSlot(g), t); break; }
    }
  }
  // Then everyone else, in order: classes still without a teacher, then a further section of each assessment grade.
  const spare = eligible.filter((x) => !x.grades.length && !busy.has(x.id));
  for (const s of [...slots].sort(bySlot)) if (open(s) && spare.length) take(s, spare.shift());
  let grew = true;
  while (spare.length && grew) {
    grew = false;
    for (const g of grades) {
      if (!spare.length) break;
      if (slotsOf(g).length < maxSections) { take(addSlot(g), spare.shift()); grew = true; }
    }
  }

  const planned = [...slots].sort(bySlot).map((s) => {
    const gradeCode = `grade_${s.grade}`;
    const base = {
      grade: s.grade,
      gradeCode,
      section: s.section,
      shiftCode: 'morning',
      existingClassId: s.existingClassId,
      classTeacher: s.teacherId ? { id: s.teacherId, name: names.get(s.teacherId) || null } : null,
      runId: `${RUN_PREFIX}:${tag}:${gradeCode}:${s.section || '-'}:${sessionCode}`,
    };
    if (s.enrolled > 0) return { ...base, classTeacher: s.existingClassId && s.teacherId ? base.classTeacher : null, students: null, skip: 'has_children' };
    return { ...base, students: makeChildren(`${tag}|${gradeCode}|${s.section}|${sessionCode}`, gender, minSize, maxSize) };
  });

  return {
    school: { id: school.id, name: school.name, emis: school.emis || null },
    gender,
    sessionCode,
    classes: planned,
    unassignedTeachers: eligible.filter((t) => !busy.has(t.id)).map((t) => ({ id: t.id, name: t.name })),
    skippedTeachers,
  };
}

module.exports = { assertTarget, isRealPhone, schoolGender, gradesOf, planSchool, RUN_PREFIX, SANDBOX_REF, PROD_REFS };
