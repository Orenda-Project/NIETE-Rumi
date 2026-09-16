/**
 * The Section F subject rule changes shape with the CONFIDENCE of the subject.
 *
 * Today the rule is one-directional: "if you cannot tell the subject, mark all three
 * the subject-tagged rows non-applicable". That is right when we know nothing — and it
 * is what produced HITL 181, where a Grade-1 Urdu lesson was told it was not a literacy
 * lesson while the subject sat on the row, correctly extracted, unread.
 *
 * With a resolved subject the rule inverts: the tagged row(s) for that subject apply —
 * and they ARE scored. Urdu maps to the LITERACY rows: nothing in their descriptors
 * is language-specific (phonics, fluency, vocabulary, comprehension, writing).
 *
 * The three prompts must be materially different, and the no-subject prompt must be
 * byte-identical to today's — that last assertion is the regression guard.
 */
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const { subjectGroupFor } = require('../../bot/shared/services/coaching/subject-resolution');

// Every expectation below is derived from the rubric, never typed as a row id. The two
// live rubric revisions number the subject-tagged rows differently — F5/F6/F7 here,
// F4-F5/F6-F7/F8-F10 on the unstable branch — so a test that spells "F7" is a test that
// passes on one branch and lies on the other.
const ROWS = fico.subjectTaggedRows();
const ALL = [...ROWS.math, ...ROWS.science, ...ROWS.literacy];
const listOf = (ids) => (ids.length > 1 ? `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}` : ids[0]);
const appliesRe = (ids) => new RegExp(`exactly ${ids.length > 1 ? 'these apply' : 'one applies'}: ${listOf(ids)}`);

const TRANSCRIPT = 'Teacher: aaj hum parhenge...';
const BASE = { teacherFirstName: 'Ayesha', duration: 960, language: 'ur' };

const build = (extra) => fico.buildAnalysisPrompt(TRANSCRIPT, { ...BASE, ...extra }, null, null);

describe('a resolved subject inverts the rule', () => {
  test('HIGH: the subject is stated and exactly the matching row is named as scored', () => {
    const p = build({ subject: 'urdu', grade: '1', subjectConfidence: 'high' });
    expect(p).toContain('- Subject: urdu');
    expect(p).toContain('- Grade: 1');
    expect(p).toMatch(appliesRe(ROWS.literacy));
    const others = ALL.filter((r) => !ROWS.literacy.includes(r));
    expect(p).toContain(`${listOf(others)} ${others.length > 1 ? 'are' : 'is'} "applicable": false`);
  });

  test('HIGH maths → the maths row(s) are scored, science → the science row(s)', () => {
    expect(build({ subject: 'maths', subjectConfidence: 'high' })).toMatch(appliesRe(ROWS.math));
    expect(build({ subject: 'science', subjectConfidence: 'high' })).toMatch(appliesRe(ROWS.science));
  });

  test('the row set is READ OFF the rubric, so it survives a renumbering', () => {
    const tagged = Object.values(fico.getScoringConstants().domains)
      .flatMap((d) => d.indicators || [])
      .filter((i) => {
        const g = String(i.subjectGroup || i.subject || '').toLowerCase();
        return g && g !== 'general';
      })
      .map((i) => i.id);
    expect(ALL.slice().sort()).toEqual(tagged.slice().sort());
    // Every group the rubric tags is non-empty, and no row is claimed by two groups.
    expect(new Set(ALL).size).toBe(ALL.length);
    for (const g of ['math', 'science', 'literacy']) expect(ROWS[g].length).toBeGreaterThan(0);
  });

  test('MEDIUM carries the same row rule but says the subject is not confirmed', () => {
    const med = build({ subject: 'urdu', grade: '4', subjectConfidence: 'medium' });
    expect(med).toContain('- Subject: urdu');
    expect(med).toMatch(/not confirmed/i);
    expect(med).toMatch(appliesRe(ROWS.literacy));
  });

  test('the HIGH and MEDIUM prompts differ — confidence is not cosmetic', () => {
    const high = build({ subject: 'urdu', subjectConfidence: 'high' });
    const med = build({ subject: 'urdu', subjectConfidence: 'medium' });
    expect(high).not.toBe(med);
  });

  test('a subject the rubric has no row for says so instead of guessing a row', () => {
    const p = build({ subject: 'islamiat', subjectConfidence: 'high' });
    expect(subjectGroupFor('islamiat')).toBeNull();
    expect(p).toContain('- Subject: islamiat');
    expect(p).toMatch(/no subject-specific row/i);
    expect(p).toContain(`ALL of ${listOf(ALL)} are "applicable": false`);
  });
});

describe('no subject — today\'s behaviour, unchanged', () => {
  test('the prompt is byte-identical to the one built with no confidence at all', () => {
    const none = build({ subjectConfidence: 'none' });
    const legacy = build({});
    expect(none).toBe(legacy);
  });

  test('it names no subject and adds no inverted rule', () => {
    const p = build({ subjectConfidence: 'none' });
    expect(p).not.toContain('- Subject:');
    expect(p).not.toMatch(/SUBJECT FOR THIS LESSON/);
  });

  test('a bare subject with NO confidence is still named, but earns no rule', () => {
    // Callers that pass a subject directly (and the two framework contract suites)
    // predate the confidence field. They keep the context line; only a RESOLVED
    // subject is allowed to promote a Section F row.
    const p = build({ subject: 'Mathematics', grade: '4' });
    expect(p).toContain('- Subject: Mathematics');
    expect(p).toContain('- Grade: 4');
    expect(p).not.toMatch(/SUBJECT FOR THIS LESSON/);
  });

  test('a grade with no subject at all still renders — unchanged', () => {
    expect(build({ grade: '4' })).toContain('- Grade: 4');
  });
});

describe('the cached system prompt still carries the unknown-subject default', () => {
  test('the subject-gating rule and its unsure-case default are intact', () => {
    const sys = fico.getSystemPrompt();
    // Asserted on BEHAVIOUR, not on the heading: the two rubric revisions title this
    // section differently ("SUBJECT-CONDITIONAL SECTION F" / "SUBJECT-GATED
    // INDICATORS") while saying the same thing, and a test pinned to the title would
    // report a missing rule that is sitting right there.
    expect(sys).toMatch(/MATHEMATICS/);
    expect(sys).toMatch(/"applicable": false/);
    expect(sys).toMatch(/LEAVES THE TOTAL ENTIRELY/);
    // The default when it cannot tell: leave the subject-tagged rows out, never guess.
    expect(sys).toMatch(/cannot tell the subject/i);
    expect(sys).toMatch(/non-?applicable/i);
  });

  test('the module header states no row-to-subject mapping for the code to contradict', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require.resolve('../../bot/shared/services/coaching/frameworks/fico-framework'), 'utf8',
    );
    const header = src.slice(0, src.indexOf('// ─── Section definitions'));
    // The header used to claim F4-F5 maths / F6-F7 science / F8-F10 literacy, rows
    // floored at 1, and a fixed denominator of 104 — every one contradicted by the code
    // beneath it. Row ids do not belong in prose at all: they are rubric data, and
    // subjectTaggedRows() is the only thing allowed to know them.
    expect(header).not.toMatch(/F\d+\s*-\s*F\d+\s+(Mathematics|Science|Literacy)/i);
    expect(header).not.toMatch(/scored 1 with/);
    expect(header).not.toMatch(/stable at 104/);
  });
});

describe('prompt budget', () => {
  // A few hundred characters against an 18,220-char cap. Expressed as a proportion so
  // it need not be re-tuned as the rubric grows — the bound has room for the longer
  // rule the other revision produces, where seven rows are tagged instead of three.
  test('the subject block stays a rounding error against the prompt', () => {
    const legacy = build({}).length;
    for (const c of ['high', 'medium']) {
      const grown = build({ subject: 'urdu', grade: '1', subjectConfidence: c }).length - legacy;
      expect(grown).toBeGreaterThan(0);
      expect(grown / legacy).toBeLessThan(0.08);
    }
  });
});

describe('HITL 181 — the stored session shape now scores F7', () => {
  // The real row: lesson_plan_structured.subject "Urdu", grade_level "1",
  // lp_fidelity.status ok with no lesson_mismatch note. The model was told nothing and
  // wrote F7 "Not applicable — not a LITERACY/LANGUAGE lesson per the rubric's subject
  // tags" while also giving it score 2 — it had the evidence and lacked permission.
  const { resolveLessonSubject } = require('../../bot/shared/services/coaching/subject-resolution');
  const ROW = {
    lesson_plan_structured: { subject: 'Urdu', grade_level: '1', topic: 'ہمارے آخری نبی صلی اللہ علیہ وسلم' },
    analysis_data: { lp_fidelity: { status: 'ok', fidelity_pct: 50, moderators: {} } },
  };

  test('the chain resolves it HIGH to urdu, in the literacy group', () => {
    const r = resolveLessonSubject(ROW, { now: new Date('2026-09-14T06:34:00.000Z') });
    expect(r).toEqual({
      code: 'urdu', grade: '1', confidence: 'high',
      source: 'lesson_plan_structured', group: 'literacy',
    });
  });

  test('the prompt built from it names the literacy row(s) as scored', () => {
    const r = resolveLessonSubject(ROW, { now: new Date('2026-09-14T06:34:00.000Z') });
    const p = build({ subject: r.code, grade: r.grade, subjectConfidence: r.confidence });
    expect(p).toContain('- Subject: urdu');
    expect(p).toMatch(appliesRe(ROWS.literacy));
    expect(p).toContain(`${ROWS.literacy.length > 1 ? 'them' : ROWS.literacy[0]} against the level descriptors`);
    expect(p).not.toMatch(/mark ALL THREE/);
  });
});
