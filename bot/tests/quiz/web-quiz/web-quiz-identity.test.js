'use strict';
/**
 * Identity v2 core — the pure pieces behind "who is this child?":
 *   canon / smartFirst  : a typed name and a roster name become comparable (Urdu or Latin)
 *   dedupe              : duplicate roster rows (same child pasted twice) collapse to one canonical child
 *   match               : the typed name inside ONE class → none | one | ask-for-more (never two candidates)
 *   gradeBand/pickClass : which class a quiz is for, band-aware ("3-5" ∋ 3,4,5), one-class mismatch asks
 *   resolveQuizClass    : the DB-backed resolver (share code → quiz list → teacher's classes)
 * Supabase is the only faked boundary (fake-supabase applies the filters it is given).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Id = require('../../../shared/services/quiz/web-quiz-identity');

const kid = (n, over = {}) => ({
  id: `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  student_name: 'Child Testwala', father_name: null, roll_number: n, created_at: `2026-09-0${(n % 9) + 1}T00:00:00Z`, enrolled: true, ...over,
});

describe('canon + smartFirst: one spelling for a name typed in either script', () => {
  test('case, punctuation, NFKC and spacing do not matter', () => {
    expect(Id.canon('  Ayesha  ')).toBe('ayesha');
    expect(Id.canon('M. Bilal')).toBe('muhammadbilal'); // "M." is Muhammad
    expect(Id.tokens('  Muhammad   Ali-Raza ')).toEqual(['muhammad', 'ali', 'raza']);
  });
  test('an Urdu first name maps to its Latin spelling through the first-name map', () => {
    expect(Id.canon('عائشہ')).toBe('ayesha');
    expect(Id.canon('علی')).toBe('ali');
    expect(Id.canon('محمد بلال')).toBe('muhammadbilal');
    expect(Id.tokens('محمد بلال')).toEqual(['muhammad', 'bilal']);
  });
  test('a map key spelled with a combining mark (یحییٰ, U+0670) still hits — keys are normalised like typed tokens', () => {
    expect(Id.canon('یحییٰ')).toBe('yahya');
    expect(Id.canon('مصطفیٰ')).toBe('mustafa');
    expect(Id.tokens('ماہ نور')).toEqual(['mahnoor']);
  });
  test('an Urdu name the map does not know stays Urdu (never a wrong Latin guess)', () => {
    expect(Id.canon('زڑقمپ')).toBe('زڑقمپ');
  });
  test('smartFirst keeps "Muhammad X" together and normalises the variants', () => {
    expect(Id.smartFirst('Muhammad Ali Khan')).toBe('muhammad ali');
    expect(Id.smartFirst('Mohd. Ali')).toBe('muhammad ali');
    expect(Id.smartFirst('M Ali')).toBe('muhammad ali');
    expect(Id.smartFirst('Muhammad')).toBe('muhammad');
    expect(Id.smartFirst('Ayesha Bibi')).toBe('ayesha');
    expect(Id.smartFirst('محمد علی')).toBe('muhammad ali');
  });
  test('nearName: one typo apart is the same name, a different name is not; Urdu vs Latin compares after the map', () => {
    expect(Id.nearName('Aysha', 'Ayesha')).toBe(true);
    expect(Id.nearName('Ali', 'Ayesha')).toBe(false);
    expect(Id.nearName('علی', 'Ali')).toBe(true);
    expect(Id.nearName('Ali', 'Alia')).toBe(false); // 3-letter names: exact only
  });
});

describe('dedupe: a child pasted twice is ONE child', () => {
  test('a stray un-enrolled row with the same name folds into the enrolled child (bd-zyo3m); two ENROLLED same-name rows with nothing to tell them apart stay two', () => {
    const rows = [
      kid(1, { student_name: 'Ayesha Testwala', created_at: '2026-09-02T00:00:00Z' }),
      kid(2, { student_name: 'ayesha  testwala', created_at: '2026-09-01T00:00:00Z', enrolled: false }),
      kid(3, { student_name: 'Ayesha Testwala', created_at: '2026-09-03T00:00:00Z' }),
      kid(4, { student_name: 'Bilal Testwala' }),
    ];
    const out = Id.dedupe(rows);
    expect(out.map((k) => k.id)).toEqual([kid(1).id, kid(3).id, kid(4).id]);
    expect(out[0].aliases).toEqual([kid(2).id]);
    expect(Id.canonicalIdOf(out, kid(2).id)).toBe(kid(1).id);
    expect(Id.canonicalIdOf(out, kid(3).id)).toBe(kid(3).id);
  });
  test('the same name AND the same known father, both enrolled (the double import of 31 Aug) → one child', () => {
    const out = Id.dedupe([kid(1, { student_name: 'Ayesha Testwala', father_name: 'Akbar Testwala' }), kid(2, { student_name: 'Ayesha Testwala', father_name: 'Akbar Testwala' })]);
    expect(out).toHaveLength(1);
    expect(out[0].aliases).toEqual([kid(2).id]);
  });
  test('two children who share a first name but not a full name stay two', () => {
    const out = Id.dedupe([kid(1, { student_name: 'Ali Raza Testwala' }), kid(2, { student_name: 'Ali Hamza Testwala' })]);
    expect(out).toHaveLength(2);
  });
});

describe('match: the typed name inside one class', () => {
  const CLASS = Id.dedupe([
    kid(1, { student_name: 'Ayesha Testwala' }),
    kid(2, { student_name: 'Bilal Testwala' }),
    kid(3, { student_name: 'Ali Raza Testwala', father_name: 'Akbar Testwala' }),
    kid(4, { student_name: 'Ali Hamza Testwala', father_name: 'Bashir Testwala' }),
    kid(5, { student_name: 'Sana Testwala', father_name: 'Dawood Testwala' }),
    kid(6, { student_name: 'Sana Testwala', father_name: 'Ehsan Testwala' }),
    kid(7, { student_name: 'Muhammad Umar Testwala' }),
    kid(8, { student_name: 'Muhammad Usman Testwala' }),
    kid(9, { student_name: 'Hina Testwala', roll_number: 9 }),
    kid(10, { student_name: 'Hina Testwala', roll_number: 10 }),
  ]);
  test('a unique first name → exactly one child, no question', () => {
    const r = Id.match(CLASS, 'ayesha');
    expect(r.outcome).toBe('one');
    expect(r.kid.id).toBe(kid(1).id);
  });
  test('a typo still finds the child; a name the class has not got is none', () => {
    expect(Id.match(CLASS, 'Aysha').outcome).toBe('one');
    expect(Id.match(CLASS, 'Zara').outcome).toBe('none');
  });
  test('two Alis with different full names → ask for the full name; the answer resolves to ONE', () => {
    const r = Id.match(CLASS, 'Ali');
    expect(r).toMatchObject({ outcome: 'ask', need: 'full_name' });
    expect(r.hits).toHaveLength(2);
    const r2 = Id.match(CLASS, 'Ali', { full_name: 'Ali Hamza' });
    expect(r2.outcome).toBe('one');
    expect(r2.kid.id).toBe(kid(4).id);
  });
  test('a full name typed up front skips the question', () => {
    const r = Id.match(CLASS, 'ali raza');
    expect(r.outcome).toBe('one');
    expect(r.kid.id).toBe(kid(3).id);
  });
  test('two Sanas with the SAME full name and different fathers → ask the father; "I don\'t know" falls to the list number', () => {
    expect(Id.match(CLASS, 'Sana')).toMatchObject({ outcome: 'ask', need: 'father' });
    expect(Id.match(CLASS, 'Sana', { father: 'Ehsan' })).toMatchObject({ outcome: 'one', kid: { id: kid(6).id } });
    expect(Id.match(CLASS, 'Sana', { father: null })).toMatchObject({ outcome: 'ask', need: 'number' });
    expect(Id.match(CLASS, 'Sana', { father: null, number: 6 })).toMatchObject({ outcome: 'one', kid: { id: kid(6).id } });
  });
  test('two Hinas with the same full name, no fathers → the list number is the only question; unknown → none (provisional)', () => {
    expect(Id.match(CLASS, 'Hina')).toMatchObject({ outcome: 'ask', need: 'number' });
    expect(Id.match(CLASS, 'Hina', { number: 10 })).toMatchObject({ outcome: 'one', kid: { id: kid(10).id } });
    expect(Id.match(CLASS, 'Hina', { number: null })).toMatchObject({ outcome: 'none' });
    expect(Id.match(CLASS, 'Hina', { number: 42 })).toMatchObject({ outcome: 'none' });
  });
  test('"Muhammad" alone is a collision of all the Muhammads; "Muhammad Umar" is one child; «محمد عمر» too', () => {
    expect(Id.match(CLASS, 'Muhammad')).toMatchObject({ outcome: 'ask', need: 'full_name' });
    expect(Id.match(CLASS, 'Muhammad Umar')).toMatchObject({ outcome: 'one', kid: { id: kid(7).id } });
    expect(Id.match(CLASS, 'محمد عمر')).toMatchObject({ outcome: 'one', kid: { id: kid(7).id } });
    expect(Id.match(CLASS, 'Umar')).toMatchObject({ outcome: 'one', kid: { id: kid(7).id } });
  });
  test('an Urdu-typed name finds the Latin roster child', () => {
    expect(Id.match(CLASS, 'عائشہ')).toMatchObject({ outcome: 'one', kid: { id: kid(1).id } });
  });
  test('a wrong tiebreaker answer never widens to another child: it is none', () => {
    expect(Id.match(CLASS, 'Ali', { full_name: 'Ali Zafar' })).toMatchObject({ outcome: 'none' });
  });
  test('an empty class or an empty name is none', () => {
    expect(Id.match([], 'Ayesha').outcome).toBe('none');
    expect(Id.match(CLASS, '').outcome).toBe('none');
  });
});

describe('gradeBand + pickClass: which class is this quiz for', () => {
  const C = (id, grade, section) => ({ id, grade, section, label: section ? `${grade}-${section}` : String(grade) });
  test('bands and codes read as sets of grades', () => {
    expect([...Id.gradeBand('3-5')]).toEqual([3, 4, 5]);
    expect([...Id.gradeBand('1-2')]).toEqual([1, 2]);
    expect([...Id.gradeBand('grade_4')]).toEqual([4]);
    expect([...Id.gradeBand('Class 4')]).toEqual([4]);
    expect([...Id.gradeBand('early_years')]).toEqual([0]);
    expect([...Id.gradeBand(null)]).toEqual([]);
    expect(Id.gradeOrdinal('grade_3')).toBe(3);
    expect(Id.gradeOrdinal('early_years')).toBe(0);
  });
  test('no class → none; one class in band → known; one class out of band → ambiguous with that class offered', () => {
    expect(Id.pickClass([], { grade: '3' })).toMatchObject({ state: 'none', class: null });
    expect(Id.pickClass([C('a', 3, 'B')], { grade: '3-5' })).toMatchObject({ state: 'known', class: { id: 'a' } });
    expect(Id.pickClass([C('a', 3, 'B')], { grade: null })).toMatchObject({ state: 'known', class: { id: 'a' } });
    const mis = Id.pickClass([C('a', 3, 'B')], { grade: '5' });
    expect(mis.state).toBe('ambiguous');
    expect(mis.classes.map((c) => c.id)).toEqual(['a']);
  });
  test('two classes: the band picks one; two in band → ambiguous with only those; none in band → ambiguous with all', () => {
    const two = [C('a', 3, 'A'), C('b', 5, 'A')];
    expect(Id.pickClass(two, { grade: '5' })).toMatchObject({ state: 'known', class: { id: 'b' } });
    expect(Id.pickClass(two, { grade: '3-5' })).toMatchObject({ state: 'ambiguous' });
    expect(Id.pickClass(two, { grade: '3-5' }).classes.map((c) => c.id)).toEqual(['a', 'b']);
    expect(Id.pickClass(two, { grade: '1' }).classes.map((c) => c.id)).toEqual(['a', 'b']);
    const secs = [C('a', 4, 'A'), C('b', 4, 'B'), C('c', 5, 'A')];
    expect(Id.pickClass(secs, { grade: '4' }).classes.map((c) => c.id)).toEqual(['a', 'b']);
  });
  test('a SOFT grade (a coaching digest\'s guess) never excludes a one-class teacher: known; with 2+ classes it narrows but never to none', () => {
    const one = [C('a', 3, 'B')];
    expect(Id.pickClass(one, { grade: '5', gradeSoft: true })).toMatchObject({ state: 'known', class: { id: 'a' }, bound: 'single', gradeSoft: true });
    expect(Id.pickClass(one, { grade: '5', gradeSoft: false })).toMatchObject({ state: 'ambiguous' });
    const two = [C('a', 3, 'A'), C('b', 5, 'A')];
    expect(Id.pickClass(two, { grade: '5', gradeSoft: true })).toMatchObject({ state: 'known', class: { id: 'b' } });
    expect(Id.pickClass(two, { grade: '1', gradeSoft: true }).classes.map((c) => c.id)).toEqual(['a', 'b']);
  });
  test('labels: grade-section, grade alone, and the shift only when both shifts of one class exist', () => {
    expect(Id.labelOf({ grade: 4, section: 'A', shift: 'morning' }, [])).toBe('4-A');
    expect(Id.labelOf({ grade: 4, section: null, shift: 'morning' }, [])).toBe('4');
    const both = [{ id: 1, grade: 4, section: 'A', shift: 'morning' }, { id: 2, grade: 4, section: 'A', shift: 'evening' }];
    expect(Id.labelOf(both[1], both)).toBe('4-A (evening)');
    expect(Id.labelOf({ grade: 0, section: null, shift: 'morning' }, [])).toBe('EY');
  });
});

describe('resolveQuizClass: the DB-backed order (share code → quiz list → teacher classes)', () => {
  const T = '11111111-1111-4111-8111-111111111111';
  const QUIZ = '22222222-2222-4222-8222-222222222222';
  const SC = '33333333-3333-4333-8333-333333333333';
  const CLS_A = 'c0000000-0000-4000-8000-00000000000a';
  const CLS_B = 'c0000000-0000-4000-8000-00000000000b';
  const LIST_B = 'a0000000-0000-4000-8000-00000000000b';
  let fake;
  function seed({ codeClass = null, quizList = null, grade = '4', classes = 'two' } = {}) {
    const cls = [{ id: CLS_A, grade_code: 'grade_4', section: 'A', shift_code: 'morning', is_active: true }];
    const ct = [{ class_id: CLS_A, teacher_user_id: T, is_active: true, is_class_teacher: true }];
    if (classes === 'two') {
      cls.push({ id: CLS_B, grade_code: 'grade_4', section: 'B', shift_code: 'morning', is_active: true });
      ct.push({ class_id: CLS_B, teacher_user_id: T, is_active: true, is_class_teacher: false });
    }
    fake = makeFake({
      quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: T, class_id: codeClass }],
      quizzes: [{ id: QUIZ, grade, list_id: quizList }],
      student_lists: [{ id: LIST_B, user_id: T, class_name: 'Grade 4 - B', section: 'B', class_id: CLS_B, is_active: true }],
      classes: cls, class_teachers: classes === 'none' ? [] : ct,
    });
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  }
  test('two sections of grade 4, a grade-4 quiz, nothing bound → ambiguous with both, labels only', async () => {
    seed();
    const r = await Id.resolveQuizClass({ teacherUserId: T, quizId: QUIZ, shareCodeId: SC });
    expect(r.state).toBe('ambiguous');
    expect(r.classes.map((c) => c.label)).toEqual(['4-A', '4-B']);
    expect(r.classes[0]).not.toHaveProperty('student_name');
  });
  test('the share code bound to 4-B wins', async () => {
    seed({ codeClass: CLS_B });
    const r = await Id.resolveQuizClass({ teacherUserId: T, quizId: QUIZ, shareCodeId: SC });
    expect(r).toMatchObject({ state: 'known', class: { id: CLS_B, label: '4-B', listId: LIST_B }, bound: 'code' });
  });
  test('else the quiz\'s list (its mirror class) wins', async () => {
    seed({ quizList: LIST_B });
    const r = await Id.resolveQuizClass({ teacherUserId: T, quizId: QUIZ, shareCodeId: SC });
    expect(r).toMatchObject({ state: 'known', class: { id: CLS_B }, bound: 'quiz' });
  });
  test('a one-class teacher and a coaching quiz whose grade came from the DIGEST (meta.grade_source) → known: the class beats the guess', async () => {
    seed({ classes: 'one', grade: '5' });
    await fake.from('quizzes').update({ meta: { grade_source: 'digest' } }).eq('id', QUIZ);
    const r = await Id.resolveQuizClass({ teacherUserId: T, quizId: QUIZ, shareCodeId: SC });
    expect(r).toMatchObject({ state: 'known', class: { id: CLS_A }, bound: 'single', gradeSoft: true });
  });
  test('a one-class teacher and a quiz of another grade → ambiguous (asks), not a silent bind', async () => {
    seed({ classes: 'one', grade: '5' });
    const r = await Id.resolveQuizClass({ teacherUserId: T, quizId: QUIZ, shareCodeId: SC });
    expect(r.state).toBe('ambiguous');
    expect(r.classes.map((c) => c.id)).toEqual([CLS_A]);
  });
  test('a one-class teacher and a coaching quiz with no grade → known, bound by the single class', async () => {
    seed({ classes: 'one', grade: null });
    const r = await Id.resolveQuizClass({ teacherUserId: T, quizId: QUIZ, shareCodeId: SC });
    expect(r).toMatchObject({ state: 'known', class: { id: CLS_A }, bound: 'single' });
  });
  test('no class at all → none', async () => {
    seed({ classes: 'none' });
    expect(await Id.resolveQuizClass({ teacherUserId: T, quizId: QUIZ, shareCodeId: SC })).toMatchObject({ state: 'none', class: null, classes: [] });
  });
  test('grade-only evaluation (before a quiz row exists) runs steps 3–4', async () => {
    seed();
    const r = await Id.resolveQuizClass({ teacherUserId: T, grade: '3-5' });
    expect(r.state).toBe('ambiguous');
    expect(r.classes).toHaveLength(2);
  });
  test('the share-code column missing on an environment (42703) falls through to the other steps, once, loudly', async () => {
    seed({ quizList: LIST_B });
    const realFrom = fake.from;
    supabase.from = (t) => (t === 'quiz_share_codes'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42703', message: 'column quiz_share_codes.class_id does not exist' } }) }) }) }
      : realFrom(t));
    const r = await Id.resolveQuizClass({ teacherUserId: T, quizId: QUIZ, shareCodeId: SC });
    expect(r).toMatchObject({ state: 'known', class: { id: CLS_B }, bound: 'quiz' });
  });
});
