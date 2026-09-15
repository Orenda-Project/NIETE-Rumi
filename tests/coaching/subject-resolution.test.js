/**
 * Subject resolution — the pure layer.
 *
 * The FICO Section F rule (F5 MATHEMATICS / F6 SCIENCE / F7 LITERACY-LANGUAGE) is
 * subject-conditional, and until now nothing on the pipeline ever told the analyser
 * which subject the lesson was. The resolver below is the one place that decides,
 * from the signals a coaching_sessions row actually carries, and it reports a
 * CONFIDENCE rather than pretending to a certainty it does not have.
 *
 * Everything here is pure: no DB, no clock beyond an injected `now`.
 */

const {
  SUBJECT_ALIASES,
  canonicalSubject,
  parseCorpusLessonId,
  subjectGroupFor,
  resolveLessonSubject,
} = require('../../bot/shared/services/coaching/subject-resolution');

describe('canonicalSubject — every spelling measured in prod resolves', () => {
  test.each([
    ['Maths', 'maths'],
    ['Mathematics', 'maths'],
    ['Math', 'maths'],
    ['MATH', 'maths'],
    ['  maths  ', 'maths'],
    ['General Science', 'science'],
    ['general_science', 'science'],
    ['Science', 'science'],
    ['Urdu', 'urdu'],
    ['urdu', 'urdu'],
    ['Reading Hour Urdu', 'urdu'],
    ['English', 'english'],
    ['English Language', 'english'],
    ['English Language Arts', 'english'],
    ['Islamiat', 'islamiat'],
    ['Social Studies', 'social_studies'],
    ['General Knowledge', 'general_knowledge'],
  ])('%s → %s', (raw, code) => {
    expect(canonicalSubject(raw)).toBe(code);
  });

  test('Urdu-script subject names resolve (39 rows carry اردو, 11 carry اسلامیات)', () => {
    expect(canonicalSubject('اردو')).toBe('urdu');
    expect(canonicalSubject('ادب و زبان اردو')).toBe('urdu');
    expect(canonicalSubject('اسلامیات')).toBe('islamiat');
  });

  test('junk and unknown spellings resolve to null, never to a guess', () => {
    for (const junk of [null, undefined, '', '   ', 42, {}, 'Physics', 'Woodwork']) {
      expect(canonicalSubject(junk)).toBeNull();
    }
  });
});

describe('parseCorpusLessonId — the corpus key encodes grade + subject', () => {
  test.each([
    ['grade_4_urdu_ch8_seg3', { subject: 'urdu', grade: '4' }],
    ['grade_2_general_science_ch1_seg1', { subject: 'science', grade: '2' }],
    ['grade_1_english_ch12_seg2', { subject: 'english', grade: '1' }],
    ['grade_5_math_ch3_seg1', { subject: 'maths', grade: '5' }],
    ['grade_3_maths_ch3_seg1', { subject: 'maths', grade: '3' }],
  ])('%s parses', (lessonId, expected) => {
    expect(parseCorpusLessonId(lessonId)).toEqual(expected);
  });

  test('a key that does not match the corpus shape yields null, not a partial', () => {
    for (const junk of [null, '', 'lp-1', 'lessonB', 'grade_x_urdu_ch1_seg1', 'urdu_ch1', 42]) {
      expect(parseCorpusLessonId(junk)).toBeNull();
    }
  });

  test('an unknown subject token inside a well-formed key yields null', () => {
    expect(parseCorpusLessonId('grade_4_woodwork_ch1_seg1')).toBeNull();
  });
});

describe('subjectGroupFor — a GROUP, never a row id', () => {
  test('maths → math, science → science, urdu and english → literacy', () => {
    expect(subjectGroupFor('maths')).toBe('math');
    expect(subjectGroupFor('science')).toBe('science');
    // Nothing in the literacy descriptors is language-specific — phonics, fluency,
    // vocabulary, comprehension, writing — so Urdu is a literacy lesson.
    expect(subjectGroupFor('urdu')).toBe('literacy');
    expect(subjectGroupFor('english')).toBe('literacy');
  });

  test('islamiat, social_studies, general_knowledge belong to NO group — a rubric gap, stated not papered over', () => {
    expect(subjectGroupFor('islamiat')).toBeNull();
    expect(subjectGroupFor('social_studies')).toBeNull();
    expect(subjectGroupFor('general_knowledge')).toBeNull();
    expect(subjectGroupFor(null)).toBeNull();
  });

  test('it names no indicator id at all — that is the framework\'s to decide', () => {
    // A subject→row table here would be correct for one rubric revision and would,
    // for the next, point an Urdu lesson at a SCIENCE indicator. The row set is
    // derived from the rubric in fico-framework.subjectTaggedRows.
    const src = require('fs').readFileSync(
      require.resolve('../../bot/shared/services/coaching/subject-resolution'), 'utf8',
    );
    expect(src).not.toMatch(/'F\d+'/);
  });
});

describe('resolveLessonSubject — the tiered chain, first match wins', () => {
  const NOW = new Date('2026-09-15T10:00:00.000Z');

  test('HIGH: the teacher\'s own extracted lesson plan names the subject', () => {
    const r = resolveLessonSubject(
      { lesson_plan_structured: { subject: 'Urdu', grade_level: '1' } },
      { now: NOW },
    );
    expect(r.confidence).toBe('high');
    expect(r.code).toBe('urdu');
    expect(r.grade).toBe('1');
    expect(r.group).toBe('literacy');
    expect(r.source).toBe('lesson_plan_structured');
  });

  test('MEDIUM: the corpus key of the plan she selected for this lesson', () => {
    const r = resolveLessonSubject(
      { lesson_plan_structured: { _fidelity_ref: { lesson_id: 'grade_4_urdu_ch8_seg3' } } },
      { now: NOW },
    );
    expect(r.confidence).toBe('medium');
    expect(r.code).toBe('urdu');
    expect(r.grade).toBe('4');
    expect(r.group).toBe('literacy');
    expect(r.source).toBe('corpus_lesson_id');
  });

  test('MEDIUM: a _fidelity_ref that already carries subject is used directly', () => {
    const r = resolveLessonSubject(
      { lesson_plan_structured: { _fidelity_ref: { lesson_id: 'x', subject: 'general_science', grade: 2 } } },
      { now: NOW },
    );
    expect(r.confidence).toBe('medium');
    expect(r.code).toBe('science');
    expect(r.grade).toBe('2');
    expect(r.source).toBe('corpus_fidelity_ref');
  });

  test('MEDIUM: exactly one distinct subject downloaded inside the window', () => {
    const r = resolveLessonSubject(
      { lesson_plan_structured: null },
      {
        now: NOW,
        downloads: [
          { subject: 'Maths', grade: 3, created_at: '2026-09-15T08:00:00.000Z' },
          { subject: 'maths', grade: 3, created_at: '2026-09-15T07:10:00.000Z' },
        ],
      },
    );
    expect(r.confidence).toBe('medium');
    expect(r.code).toBe('maths');
    expect(r.group).toBe('math');
    expect(r.source).toBe('recent_download');
  });

  test('NONE: two different subjects downloaded in the window — we do not pick one', () => {
    const r = resolveLessonSubject(
      { lesson_plan_structured: null },
      {
        now: NOW,
        downloads: [
          { subject: 'Maths', created_at: '2026-09-15T08:00:00.000Z' },
          { subject: 'Urdu', created_at: '2026-09-15T07:00:00.000Z' },
        ],
      },
    );
    expect(r.confidence).toBe('none');
    expect(r.code).toBeNull();
    expect(r.source).toBe('ambiguous_downloads');
  });

  test('NONE: a download outside the window does not count', () => {
    const r = resolveLessonSubject(
      { lesson_plan_structured: null },
      { now: NOW, downloads: [{ subject: 'Maths', created_at: '2026-09-14T10:00:00.000Z' }] },
    );
    expect(r.confidence).toBe('none');
    expect(r.code).toBeNull();
  });

  test('DEMOTED to NONE: the grader says the linked plan is not this lesson', () => {
    const r = resolveLessonSubject(
      {
        lesson_plan_structured: { subject: 'Urdu' },
        analysis_data: { lp_fidelity: { moderators: { note: 'lesson_mismatch' } } },
      },
      { now: NOW },
    );
    expect(r.confidence).toBe('none');
    expect(r.code).toBeNull();
    expect(r.source).toBe('lesson_mismatch');
  });

  test('a subject in no group resolves at its tier but carries group null', () => {
    const r = resolveLessonSubject(
      { lesson_plan_structured: { subject: 'Islamiat' } },
      { now: NOW },
    );
    expect(r.confidence).toBe('high');
    expect(r.code).toBe('islamiat');
    expect(r.group).toBeNull();
  });

  test('NONE: nothing on the row — the safe default, and the report must say so', () => {
    const r = resolveLessonSubject({}, { now: NOW });
    expect(r).toEqual({
      code: null, grade: null, confidence: 'none', source: 'no_signal', group: null,
    });
    expect(resolveLessonSubject(null, { now: NOW }).confidence).toBe('none');
  });

  test('an unparseable subject string is not a signal', () => {
    const r = resolveLessonSubject({ lesson_plan_structured: { subject: 'Woodwork' } }, { now: NOW });
    expect(r.confidence).toBe('none');
    expect(r.source).toBe('no_signal');
  });
});

describe('the alias map does not drift from the subjects table it mirrors', () => {
  // The DB `subjects` table is the registry (V1.1.3 seed + V1.2.6 islamiat). The map
  // here is a static mirror so the critical coaching path stays synchronous and pure;
  // this test is the anti-drift mechanism — every seeded code must be present here.
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..', '..', 'infrastructure', 'supabase');

  test('every code seeded into `subjects` exists in SUBJECT_ALIASES', () => {
    const sql = [
      fs.readFileSync(path.join(ROOT, '02_seed-data.sql'), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'migrations', 'V1.2.6__assessment_generator.sql'), 'utf8'),
    ].join('\n');
    const codes = new Set();
    for (const m of sql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*(?:\d+\s*,\s*)?ARRAY\[/g)) codes.add(m[1]);
    for (const m of sql.matchAll(/VALUES\s*\(\s*'([a-z_]+)'\s*,\s*ARRAY\[/g)) codes.add(m[1]);
    expect(codes.size).toBeGreaterThanOrEqual(7);
    for (const code of codes) {
      expect(Object.keys(SUBJECT_ALIASES)).toContain(code);
    }
  });

  test('every DB alias also resolves through the static map', () => {
    const sql = fs.readFileSync(path.join(ROOT, '02_seed-data.sql'), 'utf8');
    const block = sql.slice(sql.indexOf('INSERT INTO subjects'));
    const rows = block.slice(0, block.indexOf('ON CONFLICT'));
    for (const m of rows.matchAll(/\(\s*'([a-z_]+)'\s*,\s*\d+\s*,\s*ARRAY\[([^\]]+)\]/g)) {
      const code = m[1];
      for (const raw of m[2].split(',')) {
        const alias = raw.trim().replace(/^'|'$/g, '');
        expect(canonicalSubject(alias)).toBe(code);
      }
    }
  });
});
