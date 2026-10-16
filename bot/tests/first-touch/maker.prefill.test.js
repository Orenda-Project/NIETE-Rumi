'use strict';
/**
 * maker.prefill.js — "Last time: Grade 4, Maths" as a one-tap confirm on the maker page.
 *
 * One normaliser over four sources for a teacher (their own quizzes, the bank quizzes they shared, their lesson
 * plans, their classes and the subjects they teach in them). It offers a cell only when the union of everything
 * yields exactly ONE grade code and ONE subject code, no source carries a band grade, and the bank has a quiz for
 * that cell. Anything else — including any read error — is no pre-fill.
 */
jest.mock('../../shared/config/supabase', () => ({}));

const Prefill = require('../../shared/services/first-touch/maker.prefill');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');

const { normaliseGrade, normaliseSubject, decide, prefillFor, BAND } = Prefill;

describe('normaliseGrade — the table, row by row', () => {
  test.each([
    ['1', 'grade_1'], ['2', 'grade_2'], ['3', 'grade_3'], ['4', 'grade_4'], ['5', 'grade_5'],
    ['grade_1', 'grade_1'], ['grade_2', 'grade_2'], ['grade_3', 'grade_3'], ['grade_4', 'grade_4'], ['grade_5', 'grade_5'],
  ])('%p → %p', (raw, code) => expect(normaliseGrade(raw)).toBe(code));

  test.each(['3-5', '1-2', '6-8', '9-10'])('band %p → BAND (vetoes)', (raw) => {
    expect(normaliseGrade(raw)).toBe(BAND);
  });

  test.each(['NURSERY', 'KG', 'early_years', '6', '7', '8', '10', 'grade_6', 'grade_7', 'grade_10'])(
    '%p → none (outside the chips)', (raw) => expect(normaliseGrade(raw)).toBeNull());

  test.each([null, undefined, '', '  ', 'Grade Four', '0', 4.5])('%p → none', (raw) => {
    expect(normaliseGrade(raw)).toBeNull();
  });

  test('a number 4 reads as "4"', () => expect(normaliseGrade(4)).toBe('grade_4'));
  test('surrounding spaces are ignored', () => expect(normaliseGrade(' 4 ')).toBe('grade_4'));
});

describe('normaliseSubject — the table, row by row', () => {
  test.each([
    ['maths', 'maths'], ['math', 'maths'], ['Maths', 'maths'], ['Mathematics', 'maths'],
    ['english', 'english'], ['English', 'english'],
    ['urdu', 'urdu'], ['Urdu', 'urdu'],
    ['science', 'science'], ['general_science', 'science'], ['Science', 'science'],
    ['general_knowledge', 'general_knowledge'], ['genk', 'general_knowledge'], ['General Knowledge', 'general_knowledge'],
    ['Islamiyat', 'islamic_studies'], ['Islamic Studies', 'islamic_studies'],
  ])('%p → %p', (raw, code) => expect(normaliseSubject(raw)).toBe(code));

  test.each(['sst', 'social_studies', 'Computer', 'art', '', null, undefined])('%p → none', (raw) => {
    expect(normaliseSubject(raw)).toBeNull();
  });
});

describe('decide — exactly one grade, one subject, no band, a bank cell', () => {
  const yes = () => true;

  test("{'4', grade_4, maths} → grade_4|maths", () => {
    expect(decide({ grades: ['4', 'grade_4'], subjects: ['maths'], hasCell: yes })).toBe('grade_4|maths');
  });

  test('raw spellings of one subject collapse to one code', () => {
    expect(decide({ grades: ['4'], subjects: ['Maths', 'math', 'Mathematics'], hasCell: yes })).toBe('grade_4|maths');
  });

  test("{'4','5'} → none", () => {
    expect(decide({ grades: ['4', '5'], subjects: ['maths'], hasCell: yes })).toBeNull();
  });

  test("{'3-5','4'} → none (a band anywhere vetoes)", () => {
    expect(decide({ grades: ['3-5', '4'], subjects: ['maths'], hasCell: yes })).toBeNull();
  });

  test('{grade_4} alone (no subject) → none', () => {
    expect(decide({ grades: ['grade_4'], subjects: [], hasCell: yes })).toBeNull();
  });

  test('two subjects → none', () => {
    expect(decide({ grades: ['4'], subjects: ['maths', 'English'], hasCell: yes })).toBeNull();
  });

  test('values outside the chips are ignored, not counted as a second grade or subject', () => {
    expect(decide({ grades: ['4', 'KG', '6', null], subjects: ['maths', 'sst', ''], hasCell: yes })).toBe('grade_4|maths');
  });

  test('a cell with no bank quiz → none', () => {
    const hasCell = jest.fn(() => false);
    expect(decide({ grades: ['4'], subjects: ['maths'], hasCell })).toBeNull();
    expect(hasCell).toHaveBeenCalledWith('grade_4', 'maths');
  });

  test('no hasCell → none (never offer an unchecked cell)', () => {
    expect(decide({ grades: ['4'], subjects: ['maths'] })).toBeNull();
  });

  test('a throwing hasCell → none', () => {
    expect(decide({ grades: ['4'], subjects: ['maths'], hasCell: () => { throw new Error('x'); } })).toBeNull();
  });
});

describe('prefillFor — the four sources', () => {
  const UID = 'u-teacher-1';
  const OTHER = 'u-teacher-2';

  function seed(over = {}) {
    return makeFake({
      quizzes: [
        { id: 'q-own', teacher_id: UID, quiz_source: 'lesson_plan', grade: '4', subject: 'Maths' },
        { id: 'q-bank', teacher_id: null, quiz_source: 'video', grade: '4', subject: 'Maths' },
        { id: 'q-other', teacher_id: OTHER, quiz_source: 'lesson_plan', grade: '2', subject: 'Urdu' },
        { id: 'q-bank-g5', teacher_id: null, quiz_source: 'video', grade: '5', subject: 'Science' },
      ],
      quiz_share_codes: [
        { id: 'sc1', code: 'AAA111', quiz_id: 'q-bank', teacher_user_id: UID },
        { id: 'sc2', code: 'BBB222', quiz_id: 'q-bank-g5', teacher_user_id: OTHER },
      ],
      lesson_plans: [
        { id: 'lp1', user_id: UID, grade: 'grade_4', subject: 'math' },
        { id: 'lp2', user_id: OTHER, grade: '3-5', subject: 'sst' },
      ],
      class_teachers: [
        { id: 'ct1', class_id: 'c1', teacher_user_id: UID, is_active: true },
        { id: 'ct2', class_id: 'c2', teacher_user_id: OTHER, is_active: true },
        { id: 'ct3', class_id: 'c3', teacher_user_id: UID, is_active: false },
      ],
      classes: [
        { id: 'c1', grade_code: 'grade_4', is_active: true },
        { id: 'c2', grade_code: 'grade_1', is_active: true },
        { id: 'c3', grade_code: 'grade_2', is_active: true },
      ],
      class_teacher_subjects: [
        { class_teacher_id: 'ct1', class_id: 'c1', subject_code: 'maths' },
        { class_teacher_id: 'ct2', class_id: 'c2', subject_code: 'english' },
        { class_teacher_id: 'ct3', class_id: 'c3', subject_code: 'urdu' },
      ],
      ...over,
    });
  }

  const yes = jest.fn(async () => true);

  test('all four sources agree → grade_4|maths (other teachers and ended assignments ignored)', async () => {
    const fake = seed();
    await expect(prefillFor(UID, { supabase: fake, hasCell: yes })).resolves.toBe('grade_4|maths');
    const tables = new Set(fake.calls.map((c) => c.table));
    for (const t of ['quizzes', 'quiz_share_codes', 'lesson_plans', 'class_teachers', 'classes', 'class_teacher_subjects']) {
      expect(tables.has(t)).toBe(true);
    }
    expect(fake.calls.every((c) => c.op === 'select')).toBe(true);
  });

  test('each source alone feeds the union: a shared bank quiz in grade 5 makes two grades → none', async () => {
    const fake = seed();
    fake.db.quiz_share_codes.push({ id: 'sc3', code: 'CCC333', quiz_id: 'q-bank-g5', teacher_user_id: UID });
    await expect(prefillFor(UID, { supabase: fake, hasCell: yes })).resolves.toBeNull();
  });

  test('a band in a lesson plan → none', async () => {
    const fake = seed();
    fake.db.lesson_plans.push({ id: 'lp3', user_id: UID, grade: '3-5', subject: 'Maths' });
    await expect(prefillFor(UID, { supabase: fake, hasCell: yes })).resolves.toBeNull();
  });

  test('a second subject through a class assignment → none', async () => {
    const fake = seed();
    fake.db.class_teacher_subjects.push({ class_teacher_id: 'ct1', class_id: 'c1', subject_code: 'english' });
    await expect(prefillFor(UID, { supabase: fake, hasCell: yes })).resolves.toBeNull();
  });

  test('a cell with no bank quiz → none', async () => {
    const fake = seed();
    const hasCell = jest.fn(async () => false);
    await expect(prefillFor(UID, { supabase: fake, hasCell })).resolves.toBeNull();
    expect(hasCell).toHaveBeenCalledWith('grade_4', 'maths');
  });

  test('a teacher with nothing → none, and hasCell is not asked', async () => {
    const fake = seed();
    const hasCell = jest.fn(async () => true);
    await expect(prefillFor('u-nobody', { supabase: fake, hasCell })).resolves.toBeNull();
    expect(hasCell).not.toHaveBeenCalled();
  });

  test('a read error → none, never a throw', async () => {
    const fake = seed();
    const realFrom = fake.from;
    fake.from = (t) => {
      const b = realFrom(t);
      if (t === 'lesson_plans') b.then = (res, rej) => Promise.resolve({ data: null, error: { message: 'down' } }).then(res, rej);
      return b;
    };
    await expect(prefillFor(UID, { supabase: fake, hasCell: yes })).resolves.toBeNull();
  });

  test('a client that throws → none', async () => {
    const boom = { from: () => { throw new Error('no client'); } };
    await expect(prefillFor(UID, { supabase: boom, hasCell: yes })).resolves.toBeNull();
  });

  test('a rejecting hasCell → none', async () => {
    const fake = seed();
    await expect(prefillFor(UID, { supabase: fake, hasCell: async () => { throw new Error('bank down'); } })).resolves.toBeNull();
  });

  test('no uid → none, nothing read', async () => {
    const fake = seed();
    await expect(prefillFor(null, { supabase: fake, hasCell: yes })).resolves.toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  test('many shared codes are read in chunks under the .in() cap', async () => {
    const fake = seed();
    for (let i = 0; i < 900; i += 1) {
      fake.db.quizzes.push({ id: `qb${i}`, teacher_id: null, quiz_source: 'video', grade: '4', subject: 'Maths' });
      fake.db.quiz_share_codes.push({ id: `s${i}`, code: `C${i}`, quiz_id: `qb${i}`, teacher_user_id: UID });
    }
    await expect(prefillFor(UID, { supabase: fake, hasCell: yes })).resolves.toBe('grade_4|maths');
    expect(fake.calls.filter((c) => c.overflow)).toHaveLength(0);
  });
});
