/**
 * board/chrome.js build + makeSubject with the FDE chrome (board/fde-chrome.js): the term header for G6-7
 * school papers, the centralised Annual Examination header for G8 (BLUEPRINTS §1-§3), the legend, the
 * summary lines, and the G5-compatible mirrors (`sections`, `total_marks`, ...) that patterns/index.js reads.
 */
const C = require('../../../bot/shared/services/assessment/patterns/board/chrome');
const FDE = require('../../../bot/shared/services/assessment/patterns/board/fde-chrome');

const split = { levels: { R: 30, U: 30, A: 20, AE: 10, C: 10 }, source: 'framework', status: 'verified' };
function subject(o = {}) {
  return C.makeSubject({
    key: 'maths', source_id: 'fde-g6-mathematics-model-2023-24', medium: 'en', name_en: 'Mathematics', name_ur: 'ریاضی', status: 'ship',
    variants: [{
      total_marks: 60, total_time_min: o.time === undefined ? 180 : o.time, cognitive_split: split, scheme_style: 'holistic_bands',
      sections: [
        { id: 'A', label_en: 'SECTION-A', marks: 20, time_min: 20, answer_on: 'question_paper', slots: [{ slot: 'A.Q1', label_en: 'Q.1', type: 'mcq', printed: 20, marks_each: 1 }] },
        { id: 'B', label_en: 'SECTION-B', marks: 40, slots: [{ slot: 'B.Q2', label_en: 'Q.2', type: 'srq', printed: 14, attempt: 10, marks_each: 4 }] },
      ],
    }],
    ...o.extra,
  });
}
const build = (grade, exam_kind, subs = [subject()], pending = []) => C.build({ id: `fde_test_g${grade}`, grade, board: 'FDE', exam_kind, subjects: subs, pending });

describe('build', () => {
  test('a frozen board pattern with profile board and the registry fields', () => {
    const P = build(6, 'term');
    expect(P).toMatchObject({ id: 'fde_test_g6', grade: 6, board: 'FDE', profile: 'board', exam_kind: 'term' });
    expect(Object.isFrozen(P)).toBe(true);
    expect(Object.isFrozen(P.subjects.maths.variants[0].sections[0].slots[0])).toBe(true);
    expect(P.name).toEqual({ en: 'FDE board pattern', ur: 'FDE بورڈ pattern' });
    expect(P.files.en).toMatch(/two PDFs/);
    expect(P.wait_hint.en).toBe('~3 min');
    expect(P.you_add).toEqual({});
    expect(P.exam.name_en).toBe('Term Examination · FDE 2023-24 model pattern');
    expect(build(8, 'annual').exam.name_en).toBe('Federal Directorate of Education · Annual Examination · Class VIII');
  });

  test('pending cells are listed, never offered as subjects', () => {
    const P = build(6, 'term', [subject()], [C.pendingCell({ key: 'urdu', source_id: 'fde-g6-urdu-model-2023-24', medium: 'ur', reason: 'OCR gate' })]);
    expect(P.subjects.urdu).toBeUndefined();
    expect(P.pending.urdu).toEqual({ key: 'urdu', source_id: 'fde-g6-urdu-model-2023-24', medium: 'ur', status: 'design_pending', reason: 'OCR gate' });
    expect(() => C.pendingCell({ key: 'urdu', medium: 'ur' })).toThrow(/reason/);
  });

  test('refuses a subject key twice, a pending key that is also a subject, or an unknown board / exam kind', () => {
    expect(() => build(6, 'term', [subject(), subject()])).toThrow(/twice/);
    expect(() => build(6, 'term', [subject()], [C.pendingCell({ key: 'maths', source_id: 'x', medium: 'en', reason: 'r' })])).toThrow(/twice/);
    expect(() => C.build({ id: 'x', grade: 6, board: 'NBF', exam_kind: 'term', subjects: [subject()] })).toThrow(/board/);
    expect(() => build(6, 'midterm')).toThrow(/exam_kind/);
    expect(() => build(5, 'term')).toThrow(/grade/);
  });
});

describe('makeSubject (with FDE chrome after build)', () => {
  test('mirrors the default variant for patterns/index.js', () => {
    const S = build(6, 'term').subjects.maths;
    expect(S).toMatchObject({ key: 'maths', grade: 6, medium: 'en', total_marks: 60, total_time_en: '3 hrs', total_time_ur: '3 گھنٹے', g5_rules: false, oral: null, status: 'ship' });
    expect(S.sections).toBe(S.variants[0].sections);
    expect(S.scope).toMatchObject({ page_ranges: '', chapter_numbers: [], unit_ranges: [], label_en: 'Chosen chapters' });
    expect(S.deviations).toEqual([]);
    expect(S.derivation).toBeNull();
  });

  test('no printed time reads "as the school sets"', () => {
    const S = build(6, 'term', [subject({ time: null })]).subjects.maths;
    expect(S.total_time_en).toBe('as the school sets');
    expect(S.header.time_line_en).toBe('');
  });

  test('G6-7 term header (chrome, never the crest) and G8 annual header', () => {
    const t = build(7, 'term').subjects.maths;
    expect(t.header.title_en).toBe('Grade VII · Mathematics · Term Examination');
    expect(t.variants[0].exam_header.lines_en).toEqual(['Term Examination · FDE 2023-24 model pattern', 'Grade VII · Mathematics', 'Time Allowed: 3 hrs · Total Marks: {t:60}']);
    const a = build(8, 'annual').subjects.maths;
    expect(a.header.title_en).toBe('Class VIII · Mathematics · Annual Examination');
    expect(a.variants[0].exam_header.lines_en).toEqual(['Federal Directorate of Education', 'Annual Examination · Class VIII', 'Mathematics · Time Allowed: 3 hrs · Total Marks: {t:60}']);
    expect(a.variants[0].exam_header.lines_ur[0]).toBe('وفاقی نظامتِ تعلیمات، اسلام آباد');
    expect(a.header.total_line_en).toBe('Total Marks: {t:60}');
    expect(a.header.time_line_en).toBe('Time Allowed: 3 hrs');
    expect(a.header.school_line_en).toBe('School: ____________');
  });

  test('legend: the scheme style and the 40% pass line', () => {
    const S = build(6, 'term').subjects.maths;
    expect(S.legend.subject).toBe('maths');
    expect(S.legend.lines_en.join(' ')).toMatch(/band/i);
    expect(S.legend.lines_en.join(' ')).toMatch(/Pass = 40%/);
    const analytic = FDE.legendFor('history', 'analytic_points');
    expect(analytic.lines_en.join(' ')).toMatch(/point/i);
    expect(analytic.lines_ur.length).toBe(analytic.lines_en.length);
  });

  test('summary lines: one per section, and the choices', () => {
    const S = build(6, 'term').subjects.maths;
    expect(S.summary_lines.en.sections).toEqual(['20 min · 20 · SECTION-A', '40 · SECTION-B']);
    expect(S.summary_lines.en.choice).toBe('Q2: attempt any 10 of 14 · 4 each');
    expect(S.summary_lines.ur.sections).toHaveLength(2);
  });

  test('refuses a bad medium, a missing source id or a bad status', () => {
    expect(() => subject({ extra: { medium: 'fr' } })).toThrow(/medium/);
    expect(() => subject({ extra: { source_id: '' } })).toThrow(/source_id/);
    expect(() => subject({ extra: { status: 'maybe' } })).toThrow(/status/);
    expect(() => subject({ extra: { variants: [] } })).toThrow(/variants/);
  });

  test('a ship_derived subject must say where its shape came from', () => {
    expect(() => subject({ extra: { status: 'ship_derived' } })).toThrow(/derivation/);
    const S = subject({ extra: { status: 'ship_derived', derivation: 'from G7', deviations: ['diagram → text'] } });
    expect(S).toMatchObject({ derivation: 'from G7', deviations: ['diagram → text'] });
  });
});

describe('isolation', () => {
  test('the board chrome never loads the G5 pattern or the mid chrome (SPEC §4)', () => {
    jest.isolateModules(() => {
      jest.doMock('../../../bot/shared/services/assessment/patterns/fde-g5-2027', () => { throw new Error('G5 loaded'); });
      jest.doMock('../../../bot/shared/services/assessment/patterns/mid/chrome', () => { throw new Error('mid loaded'); });
      expect(() => require('../../../bot/shared/services/assessment/patterns/board/chrome')).not.toThrow();
    });
  });
});
