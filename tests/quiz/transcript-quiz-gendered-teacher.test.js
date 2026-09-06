'use strict';
/**
 * PEDAGOGY_GENDERED_TEACHER — the teacher has no gender anywhere in a quiz.
 *
 * The operator read the round-5 pre-send PDF and wrote: "we agreed to gender
 * neutrality but I can see that here you used 'she' quite a lot of times,
 * please don't do it anywhere". The prompts were the source — they asked the
 * model for "what SHE taught, in the order SHE taught it" — and nothing
 * checked the output, so the sentence went onto a teacher's document.
 *
 * PLAN_R6 D5: the prompts address the teacher as "you" in the lesson summary
 * and name "the teacher" elsewhere, and a deterministic post-check fails the
 * quiz when a gendered reference survives (root rule 24c — a prompt's contract
 * is asserted in code, because a model complies most of the time and
 * freestyles the rest).
 *
 * Every fixture here is SYNTHETIC. No transcript text enters this repo.
 */
const P = require('../../bot/shared/services/quiz/transcript-quiz-pedagogy');
const V = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { buildDigestPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const Contract = require('../../bot/shared/services/quiz/transcript-quiz-contract');
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');

const DIGEST = {
  topic: 'Parts of a plant', topic_as_taught: 'Parts of a plant', subject: 'science',
  grade_band: '3-5',
  slos: [
    { id: 'S1', statement: 'name the parts of a plant', taught_level: 'recall' },
    { id: 'S2', statement: 'explain what roots do', taught_level: 'understand' },
  ],
  key_terms: ['root', 'stem'], examples_used: ['the money plant on the window sill'],
};

const NEUTRAL_SUMMARY = 'Today you taught the parts of a plant, starting with the money plant '
  + 'on the window sill. You then asked the class what the roots do before comparing a root '
  + 'with a stem on the board.';

function q(overrides = {}) {
  return {
    slo_id: 'S1', level: 'recall',
    question: 'Which part of the plant is under the soil?',
    options: ['root', 'leaf', 'flower'], correct_index: 0,
    explanation: 'The root grows down into the soil.',
    selected_because: 'the moment the class was shown the money plant',
    distractor_misconceptions: { 1: 'takes a leaf for a root', 2: 'takes a flower for a root' },
    option_feedback: {
      correct: 'Yes — the root is under the soil, holding the plant and drinking water.',
      wrong: {
        1: 'Leaves are up in the air making food; the part under the soil is the root.',
        2: 'Flowers make seeds at the top; the part under the soil is the root.',
      },
    },
    ...overrides,
  };
}

function eightGood() {
  return [
    q(), q({ slo_id: 'S2', level: 'understand', question: 'What do roots do?', options: ['drink water', 'make seeds', 'catch light'] }),
    q({ question: 'q3', options: ['a', 'b', 'c'] }), q({ slo_id: 'S2', level: 'understand', question: 'q4', options: ['d', 'e', 'f'] }),
    q({ question: 'q5', options: ['g', 'h', 'i'] }), q({ slo_id: 'S2', level: 'understand', question: 'q6', options: ['j', 'k', 'l'] }),
    q({ question: 'q7', options: ['m', 'n', 'o'] }), q({ slo_id: 'S2', level: 'apply', question: 'q8', options: ['p', 'r', 's'] }),
  ];
}

const codes = (defects) => defects.map((d) => d.code);
const defectsFor = (questions, ctx = {}) => P.pedagogyDefects(questions, { language: 'en', digest: DIGEST, ...ctx });

// ── the English pronouns ────────────────────────────────────────────────────
describe('English — a gendered pronoun for the teacher', () => {
  test('the operator\'s own sentence, in lesson_summary, is a quiz-level defect', () => {
    const d = defectsFor(eightGood(), {
      lessonSummary: 'The teacher reviewed "Before" and "After" with the class. She then '
        + 'introduced the new topic with the money plant on the window sill.',
    });
    expect(codes(d)).toContain('PEDAGOGY_GENDERED_TEACHER');
    const hit = d.find((x) => x.code === 'PEDAGOGY_GENDERED_TEACHER');
    expect(hit.index).toBeNull();                       // quiz-level, so no q prefix
    expect(hit.message).toMatch(/lesson_summary/);
    expect(hit.message).toMatch(/^PEDAGOGY_GENDERED_TEACHER/);
  });

  test('"her example" in a selected_because is a per-question defect', () => {
    const qs = eightGood();
    qs[3].selected_because = 'her example of the money plant on the window sill';
    const d = defectsFor(qs, { lessonSummary: NEUTRAL_SUMMARY });
    const hit = d.find((x) => x.code === 'PEDAGOGY_GENDERED_TEACHER');
    expect(hit.index).toBe(3);
    expect(hit.message).toMatch(/^q3: PEDAGOGY_GENDERED_TEACHER/);
    expect(hit.message).toMatch(/selected_because/);
  });

  test('every teacher-facing and child-facing field is covered', () => {
    const fields = [
      ['question', { question: 'What did she call the part under the soil?' }],
      ['options', { options: ['his root', 'leaf', 'flower'] }],
      ['explanation', { explanation: 'She showed that the root grows down into the soil.' }],
      ['option_feedback.correct', { option_feedback: { ...q().option_feedback, correct: 'Yes — the root she dug up was under the soil.' } }],
      ['option_feedback.wrong', { option_feedback: { correct: 'Yes — the root is under the soil.', wrong: { 1: 'Her leaf was up in the air; the part under the soil is the root.', 2: 'Flowers make seeds; the root is under the soil.' } } }],
      ['distractor_misconceptions', { distractor_misconceptions: { 1: 'takes her leaf for a root', 2: 'takes a flower for a root' } }],
    ];
    fields.forEach(([label, over]) => {
      const qs = eightGood();
      qs[2] = q(over);
      const d = defectsFor(qs, { lessonSummary: NEUTRAL_SUMMARY })
        .filter((x) => x.code === 'PEDAGOGY_GENDERED_TEACHER');
      expect(d.length).toBeGreaterThan(0);
      expect(d[0].message).toContain(label);
    });
  });

  test('one defect per question however many fields are gendered', () => {
    const qs = eightGood();
    qs[0] = q({ explanation: 'She dug it up.', selected_because: 'her own example' });
    const d = defectsFor(qs, { lessonSummary: NEUTRAL_SUMMARY })
      .filter((x) => x.code === 'PEDAGOGY_GENDERED_TEACHER');
    expect(d).toHaveLength(1);
    expect(d[0].message).toMatch(/explanation/);
    expect(d[0].message).toMatch(/selected_because/);
  });

  test('a clean quiz raises nothing', () => {
    expect(codes(defectsFor(eightGood(), { lessonSummary: NEUTRAL_SUMMARY })))
      .not.toContain('PEDAGOGY_GENDERED_TEACHER');
  });
});

// ── the words that must NOT match ───────────────────────────────────────────
describe('English — whole words only', () => {
  const clean = [
    'the sheet of paper the class shared',
    'helium is lighter than air',
    'the shell of the atom',
    'a hen, a shed and a sheep',
    'This is the history of the region.',
    'Ali held the thermometer.',
  ];
  clean.forEach((text) => {
    test(`does not flag "${text}"`, () => {
      const qs = eightGood();
      qs[1] = q({ slo_id: 'S2', level: 'understand', explanation: text });
      expect(codes(defectsFor(qs, { lessonSummary: NEUTRAL_SUMMARY })))
        .not.toContain('PEDAGOGY_GENDERED_TEACHER');
    });
  });

  test('the chemical symbol He mid-sentence is not a pronoun', () => {
    const qs = eightGood();
    qs[1] = q({ slo_id: 'S2', level: 'understand', explanation: 'A balloon filled with He floats because He is lighter than air.' });
    expect(codes(defectsFor(qs, { lessonSummary: NEUTRAL_SUMMARY })))
      .not.toContain('PEDAGOGY_GENDERED_TEACHER');
  });

  test('but a sentence that OPENS with "He" about the teacher is a hit', () => {
    const qs = eightGood();
    qs[1] = q({ slo_id: 'S2', level: 'understand', explanation: 'He then introduced the new topic.' });
    expect(codes(defectsFor(qs, { lessonSummary: NEUTRAL_SUMMARY })))
      .toContain('PEDAGOGY_GENDERED_TEACHER');
  });
});

// ── Urdu ────────────────────────────────────────────────────────────────────
describe('Urdu — a gendered teacher', () => {
  const hits = [
    ['استانی', 'استانی نے بورڈ پر جڑ کی تصویر بنائی'],
    ['معلمہ', 'معلمہ نے کلاس کو پودے کے حصے بتائے'],
    ['استاد صاحبہ', 'استاد صاحبہ نے پودے کی جڑ دکھائی'],
    ['باجی', 'باجی نے کلاس کو پودا دکھایا'],
    ['feminine agreement on the teacher', 'استاد یہ سبق ہر سال پڑھاتی ہیں'],
    ['masculine agreement on the teacher', 'ٹیچر یہ بات روز بتاتے ہیں'],
    ['feminine continuous', 'استاد بورڈ پر جڑ بنا رہی تھیں'],
    ['a feminine future about the teacher', 'استاد کل یہ دوبارہ پڑھائیں گی'],
  ];
  hits.forEach(([label, text]) => {
    test(`flags ${label}`, () => {
      const qs = eightGood();
      qs[1] = q({ slo_id: 'S2', level: 'understand', explanation: text });
      expect(codes(defectsFor(qs, { language: 'ur', lessonSummary: 'آج آپ نے پودے کے حصے پڑھائے۔' })))
        .toContain('PEDAGOGY_GENDERED_TEACHER');
    });
  });

  const clean = [
    // Urdu marks the subject of a past transitive verb with نے and the VERB
    // then agrees with the OBJECT, not with the teacher — so none of these
    // says anything about the teacher's gender.
    ['object agreement, feminine object', 'استاد نے جڑ کی وضاحت دہرائی'],
    ['object agreement, masculine object', 'استاد نے سبق پڑھایا'],
    ['ٹیچر نے … بتائی (the object is feminine)', 'ٹیچر نے پودے کی جڑ بتائی'],
    ['a genitive teacher and an agreeing noun', 'استاد کی کتاب میز پر رکھی تھی'],
    ['آپ with an object-agreeing perfect', 'آج آپ نے پودے کے حصے پڑھائے'],
    ['children in the respectful plural', 'بچے جڑ کو غور سے دیکھتے ہیں'],
    ['an imperative to the child', 'جڑ کو غور سے دیکھیں اور بتائیں'],
  ];
  clean.forEach(([label, text]) => {
    test(`does not flag ${label}`, () => {
      const qs = eightGood();
      qs[1] = q({ slo_id: 'S2', level: 'understand', explanation: text });
      expect(codes(defectsFor(qs, { language: 'ur', lessonSummary: 'آج آپ نے پودے کے حصے پڑھائے۔' })))
        .not.toContain('PEDAGOGY_GENDERED_TEACHER');
    });
  });

  test('an Urdu quiz still catches a Latin-script "she"', () => {
    const qs = eightGood();
    qs[1] = q({ slo_id: 'S2', level: 'understand', selected_because: 'the root she dug up' });
    expect(codes(defectsFor(qs, { language: 'ur', lessonSummary: 'آج آپ نے پودے کے حصے پڑھائے۔' })))
      .toContain('PEDAGOGY_GENDERED_TEACHER');
  });
});

// ── through the real validator ──────────────────────────────────────────────
describe('the validator rejects a gendered quiz', () => {
  const base = { language: 'en', subject: 'science', digest: DIGEST, nExpected: 8, quizId: 'quiz-1' };

  test('a gendered lesson_summary fails the quiz, quiz-level', () => {
    const r = V.validate(eightGood(), {
      ...base,
      lessonSummary: 'She taught the parts of a plant and then she asked what the roots do, using the money plant.',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /^PEDAGOGY_GENDERED_TEACHER/.test(e))).toBe(true);
  });

  test('a gendered explanation fails the quiz with a q prefix', () => {
    const qs = eightGood();
    qs[5].explanation = 'She showed the class that roots drink water.';
    const r = V.validate(qs, { ...base, lessonSummary: NEUTRAL_SUMMARY });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /^q5: PEDAGOGY_GENDERED_TEACHER/.test(e))).toBe(true);
  });

  test('the neutral quiz passes', () => {
    const r = V.validate(eightGood(), { ...base, lessonSummary: NEUTRAL_SUMMARY });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

// ── the prompts ─────────────────────────────────────────────────────────────
describe('the prompts no longer gender the teacher', () => {
  const strip = (s) => String(s).replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  const GENDERED = /\b(she|her|hers|his|him|herself|himself)\b/i;
  // The one place a prompt is ALLOWED to spell the banned words is the rule that
  // bans them: "be gender-neutral" without them was already in the digest prompt
  // and the model wrote "her document" anyway. So the rule's own text is removed
  // before the sweep, and asserted separately.
  const body = (prompt) => strip(String(prompt)
    .split(Contract.GENDER_NEUTRAL_RULE).join('')
    .replace(/- THE TEACHER HAS NO GENDER\.[^\n]*/g, ''));

  test('the rule itself names the words it bans', () => {
    expect(Contract.GENDER_NEUTRAL_RULE).toMatch(/"she"/);
    expect(Contract.GENDER_NEUTRAL_RULE).toMatch(/"his"/);
    expect(Contract.GENDER_NEUTRAL_RULE).toMatch(/استانی/);
  });

  test('the author prompt', () => {
    const p = body(buildAuthorPrompt({ digest: DIGEST, excerpts: 'x', language: 'en', n: 8, gradeBand: '3-5' }));
    expect(p).not.toMatch(GENDERED);
  });

  test('the author prompt asks for the summary in the second person', () => {
    const p = buildAuthorPrompt({ digest: DIGEST, excerpts: 'x', language: 'en', n: 8, gradeBand: '3-5' });
    expect(p).toMatch(/what you taught/i);
  });

  test('the digest prompt', () => {
    const p = body(buildDigestPrompt({ transcript: 'x', transcriptLanguage: 'ur', storedTopic: 't', storedSubject: 'science', hints: {}, lpHint: { grade: '4', subject: 'science', chapter_title: 'Plants' } }));
    expect(p).not.toMatch(GENDERED);
    expect(p).toMatch(/the teacher downloaded that day/);
  });

  test('the shared contract', () => {
    expect(strip(Contract.languageRule('en'))).not.toMatch(GENDERED);
    expect(strip(Contract.languageRule('ur'))).not.toMatch(GENDERED);
    expect(strip(Contract.questionContract({ gradeBand: '3-5' }))).not.toMatch(GENDERED);
    expect(strip(Contract.SELECTED_BECAUSE_RULE)).not.toMatch(GENDERED);
  });

  test('the contract states the no-gendered-teacher rule once, and the author and rewrite prompts both carry it', () => {
    expect(Contract.GENDER_NEUTRAL_RULE).toMatch(/never refer to the teacher/i);
    const author = buildAuthorPrompt({ digest: DIGEST, excerpts: 'x', language: 'en', n: 8, gradeBand: '3-5' });
    expect(author).toContain(Contract.GENDER_NEUTRAL_RULE);
    const rw = Rewrite.buildRewritePrompt({
      digest: DIGEST, language: 'en', questions: eightGood(),
      targets: { indices: [0], byIndex: { 0: ['q0: PEDAGOGY_COUNT_RECALL — …'] }, summary: [] },
    });
    expect(rw).toContain(Contract.GENDER_NEUTRAL_RULE);
    expect(body(rw)).not.toMatch(GENDERED);
  });
});

// ── the targeted rewrite, extended to the quiz-level summary ────────────────
describe('the targeted rewrite repairs the lesson summary', () => {
  const SUMMARY_ERR = 'PEDAGOGY_GENDERED_TEACHER — "lesson_summary" refers to the teacher as "She"; '
    + 'write it TO the teacher as "you"';

  test('a quiz-level gendered summary is a repairable target on its own', () => {
    const t = Rewrite.rewriteTargets([SUMMARY_ERR]);
    expect(t.summary).toEqual([SUMMARY_ERR]);
    expect(t.indices).toEqual([]);
  });

  test('a summary complaint alongside two question complaints is all repairable', () => {
    const t = Rewrite.rewriteTargets([
      SUMMARY_ERR,
      'q0: PEDAGOGY_COUNT_RECALL — …',
      'q4: PEDAGOGY_GENDERED_TEACHER — "explanation" …',
    ]);
    expect(t.indices).toEqual([0, 4]);
    expect(t.summary).toEqual([SUMMARY_ERR]);
  });

  test('an unrelated quiz-level complaint still disqualifies the whole set', () => {
    expect(Rewrite.rewriteTargets(['SLOs uncovered: S2']).indices).toEqual([]);
    expect(Rewrite.rewriteTargets(['SLOs uncovered: S2']).summary).toEqual([]);
  });

  test('the prompt asks for a replacement lesson_summary in the second person', () => {
    const p = Rewrite.buildRewritePrompt({
      digest: DIGEST, language: 'en', questions: eightGood(),
      targets: { indices: [], byIndex: {}, summary: [SUMMARY_ERR] },
    });
    expect(p).toContain('lesson_summary');
    expect(p).toContain(SUMMARY_ERR);
    expect(p).toContain(Contract.GENDER_NEUTRAL_RULE);
  });

  test('the merge takes the replacement summary and leaves the questions alone', () => {
    const qs = eightGood();
    const m = Rewrite.mergeReplacements(qs, { lesson_summary: NEUTRAL_SUMMARY }, { indices: [], byIndex: {}, summary: [SUMMARY_ERR] });
    expect(m.lessonSummary).toBe(NEUTRAL_SUMMARY);
    expect(m.replaced).toEqual([]);
    expect(m.questions).toEqual(qs);
  });

  test('a summary the model returned unchanged (still gendered) is still merged — the validator judges it, not the merge', () => {
    const m = Rewrite.mergeReplacements(eightGood(), { lesson_summary: 'She taught it.' }, { indices: [], byIndex: {}, summary: [SUMMARY_ERR] });
    expect(m.lessonSummary).toBe('She taught it.');
  });

  test('no summary target means no summary is taken, even if the model volunteers one', () => {
    const m = Rewrite.mergeReplacements(eightGood(), { lesson_summary: NEUTRAL_SUMMARY, questions: [{ index: 0, question: 'Which of these is a root?', options: ['a', 'b', 'c'], correct_index: 0 }] }, { indices: [0], byIndex: { 0: ['x'] }, summary: [] });
    expect(m.lessonSummary).toBeNull();
    expect(m.replaced).toEqual([0]);
  });
});
