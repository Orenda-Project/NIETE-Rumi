'use strict';
/**
 * R8 lane D task 3.2b — the DIGEST of a lesson that was planned, not recorded.
 *
 * The transcript digest reads what a teacher actually said. This one reads the
 * slide script of the exact lesson version the teacher was served, and must
 * hand the author pass the SAME shape, because everything after it — the
 * author prompt, the validator, the teacher PDF, the class report's objectives
 * — reads that shape and nothing else.
 *
 * Three things it must NOT do, each one a red-team finding:
 *   · forward `wrap.exitOptions` (PLAN_R8 §8 row 27): the lesson's own exit MCQ
 *     is the one question the class has already been asked and answered, so a
 *     quiz that reuses it tests nothing;
 *   · forward the plan's gendered prose — a served CFU says "She says…", and the
 *     teacher's gender is not a fact this system holds;
 *   · forward `meta.teacherGender`, which the renderer stores and which is a
 *     guess about a person, not a property of the lesson.
 */

jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const { normaliseDigest } = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');

/**
 * A synthetic slide script in the shape `niete-nbpro/src/generate.js` writes
 * (`<render dir>/<lesson_id>/_slide_script.json`). Invented lesson, invented
 * names — this file ships in a public repo.
 */
const SLIDE_SCRIPT = {
  meta: {
    lessonId: 'grade_2_math_ch9_seg3',
    grade: 2,
    subject: 'math',
    topic: 'Add a 3-digit number and a 2-digit number',
    day: 3,
    total: 8,
    chapterTitle: 'Textbook p.101',
    materials: ['chalk', 'counters'],
    durationMin: 30,
    minutes: 30,
    sloDescriptions: ['I can add a 3-digit number and a 2-digit number.'],
    // A guess about a person, stored by the renderer. It must never travel.
    teacherGender: 'woman',
  },
  goal: 'Add a 3-digit number and a 2-digit number using the column method, carrying where a column fills up.',
  sloFull: 'By the end of the lesson, students will add a 3-digit number and a 2-digit number, carrying a ten into the tens column when the ones column reaches ten.',
  sloCode: 'M-02-AD-04',
  bloom: 'apply',
  totalMinutes: 30,
  hook: {
    story: 'Yesterday we counted the chairs. Today: the cups.',
    keyWords: [{ term: 'carry', urdu: 'ہندسہ آگے لے جانا', def: 'To move a ten into the next column.' }],
  },
  iDo: {
    minutes: 5,
    keyFact: 'A column carries only when its own total reaches ten or more.',
    worked: {
      problem: '146 + 27',
      work: ['Ones: 6 + 7 = 13, write 3 carry 1', 'Tens: 4 + 2 + 1 = 7', 'Hundreds: 1'],
      answer: 'Answer: 173',
      diagram: 'COLUMN SUM\n| | H | T | O\n▲ | | 1 | 4 | 6',
    },
    // The served plan says "She says" here. This is the string the scrub exists for.
    cfu: 'Why did the ones column carry but the tens column did not?',
    cfuPassSignal: 'She says the ones column reached thirteen, so one ten moved across; the tens column stayed under ten.',
    ifStruggle: 'Point at the ones column only and ask her whether six and seven reach ten.',
    misconception: {
      slip: 'Children carry out of every column once they have carried out of one.',
      why: 'Carrying feels like a rule about the whole sum rather than about one column.',
      // A CARRIED field that addresses the teacher by gender — the scrub's real target.
      fix: 'She models asking "does THIS column reach ten?" before every carry, and asks her class to say it back.',
    },
  },
  weDo: {
    minutes: 9,
    action: 'Guided practice: solve 318 + 45 together at the board.',
    cfu: 'How is 318 + 45 different from 146 + 27?',
  },
  youDo: {
    minutes: 10,
    problems: [
      { n: 1, prompt: 'Add 254 and 38 using the place-value chart. What is the total?', answer: '292', ref: 'p.101 Practice' },
      { n: 2, prompt: 'Add 463 and 19. Say which column carries.', answer: '482', ref: 'p.101 Practice' },
    ],
    wordProblem: { prompt: 'A shop has 236 cups and 47 more arrive. How many cups now?', answer: '283 cups' },
  },
  wrap: {
    // NEVER forwarded — the class has already been asked this one.
    exitOptions: [
      {
        form: 'mcq',
        prompt: '327 + 48 = ?',
        choices: ['375', '365', '3715', '371'],
        correct: 'A',
        answer: 'A — 375',
        howToRun: 'Whole class in copies; show fingers for A/B/C/D.',
      },
    ],
    keyFacts: [
      'Add the ones column first, then the tens, then the hundreds.',
      'A carry happens only when a column reaches ten.',
    ],
    homework: ['Solve 518 + 36. Show which column carries.'],
  },
};

const MODEL_JSON = {
  topic: 'Adding a 3-digit and a 2-digit number',
  topic_as_taught: 'Adding a 3-digit and a 2-digit number',
  subject: 'maths',
  grade_band: '1-2',
  language_of_instruction: 'en',
  confidence: 0.9,
  slos: [
    {
      id: 'S1',
      statement: 'Add a 3-digit number and a 2-digit number using the column method.',
      statement_en: 'Add a 3-digit number and a 2-digit number using the column method.',
      statement_ur: 'کالمی طریقے سے تین ہندسوں اور دو ہندسوں والے عدد جمع کرنا۔',
      evidence_quote: 'Add a 3-digit number and a 2-digit number using the column method',
      taught_level: 'apply',
    },
    {
      id: 'S2',
      statement: 'Decide which column carries.',
      statement_en: 'Decide which column carries.',
      statement_ur: 'فیصلہ کرنا کہ کون سا کالم آگے لے جاتا ہے۔',
      evidence_quote: 'A column carries only when its own total reaches ten or more',
      taught_level: 'understand',
    },
  ],
  key_terms: [{ term: 'carry', as_spoken: 'carry' }],
  examples_used: ['146 + 27', '318 + 45'],
  misconceptions_surfaced: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  completeJson.mockResolvedValue({
    json: MODEL_JSON, model: 'test-model', costUsd: 0.004, latencyMs: 900,
  });
});

/** Every string the digest actually sends to the model. */
async function promptFor(args = {}) {
  await LpDigest.run({
    slideScript: SLIDE_SCRIPT, language: 'en', grade: 2, subject: 'math', ...args,
  });
  expect(completeJson).toHaveBeenCalledTimes(1);
  return completeJson.mock.calls[0][0].prompt;
}

describe('the LLM input', () => {
  test('carries the planned lesson: goal, SLO, code, bloom, key fact, worked example, misconception, practice prompts and key facts', async () => {
    const prompt = await promptFor();
    expect(prompt).toContain(SLIDE_SCRIPT.goal);
    expect(prompt).toContain(SLIDE_SCRIPT.sloFull);
    expect(prompt).toContain('M-02-AD-04');
    expect(prompt).toContain('apply');
    expect(prompt).toContain(SLIDE_SCRIPT.iDo.keyFact);
    expect(prompt).toContain('146 + 27');
    expect(prompt).toContain('Ones: 6 + 7 = 13, write 3 carry 1');
    expect(prompt).toContain(SLIDE_SCRIPT.iDo.misconception.slip);
    expect(prompt).toContain(SLIDE_SCRIPT.iDo.misconception.why);
    expect(prompt).toContain('Add 254 and 38 using the place-value chart. What is the total?');
    expect(prompt).toContain('A carry happens only when a column reaches ten.');
    expect(prompt).toContain('Textbook p.101');
  });

  test('NEVER carries the lesson’s own exit MCQ — prompt, choices or answer (PLAN_R8 §8 row 27)', async () => {
    const prompt = await promptFor();
    expect(prompt).not.toContain('327 + 48');
    expect(prompt).not.toContain('3715');
    expect(prompt).not.toContain('A — 375');
    expect(prompt).not.toContain('show fingers for A/B/C/D');
    expect(prompt.toLowerCase()).not.toContain('exitoption');
  });

  test('never carries the renderer’s guess at the teacher’s gender', async () => {
    const prompt = await promptFor();
    expect(prompt).not.toMatch(/teacherGender/i);
    expect(prompt).not.toMatch(/\bwoman\b/i);
  });

  test('scrubs he/she out of the plan’s own prose before the model ever sees it', async () => {
    const prompt = await promptFor();
    // The prompt's RULES name the pronouns in order to forbid them, so the scan
    // is over the lesson block the plan itself contributes.
    const plan = prompt.slice(prompt.indexOf('THE LESSON PLAN:'));
    expect(SLIDE_SCRIPT.iDo.misconception.fix).toMatch(/\bShe\b/);
    expect(plan).toContain('The teacher models asking');
    expect(plan).toContain('asks their class');
    expect(plan).not.toMatch(/\b(she|her|hers|herself|he|him|his|himself)\b/i);
    // cfuPassSignal / ifStruggle are not carried at all.
    expect(plan).not.toContain('thirteen, so one ten moved across');
  });

  test('tells the model the practice prompts are shape, not questions to copy', async () => {
    const prompt = await promptFor();
    expect(prompt.toLowerCase()).toMatch(/never copy|do not copy|not to copy/);
  });

  test('asks for both statement languages, so one document reads in one language', async () => {
    const prompt = await promptFor();
    expect(prompt).toContain('statement_en');
    expect(prompt).toContain('statement_ur');
  });
});

describe('the digest it returns', () => {
  test('is the SAME shape the transcript digest produces — key for key', async () => {
    const { digest } = await LpDigest.run({ slideScript: SLIDE_SCRIPT, language: 'en', grade: 2, subject: 'math' });
    const fromTranscript = normaliseDigest(MODEL_JSON, { storedSubject: 'maths' });
    // Extra keys are allowed (taught_level is one), missing keys are not: every
    // consumer downstream reads the transcript digest's own field names.
    Object.keys(fromTranscript).forEach((k) => {
      if (fromTranscript[k] === undefined) return;
      expect(Object.prototype.hasOwnProperty.call(digest, k)).toBe(true);
    });
    expect(digest.slos).toHaveLength(2);
    expect(digest.slos[0]).toEqual(expect.objectContaining({
      id: 'S1', statement_en: expect.any(String), statement_ur: expect.any(String), taught_level: 'apply',
    }));
    expect(digest.slos[0].statement_ur).not.toBe(digest.slos[0].statement_en);
    expect(digest.subject).toBe('maths');
  });

  test('carries taught_level from the plan’s bloom verb', async () => {
    const { digest } = await LpDigest.run({ slideScript: SLIDE_SCRIPT, language: 'en', grade: 2, subject: 'math' });
    expect(digest.taught_level).toBe('apply');
    const remembered = await LpDigest.run({
      slideScript: { ...SLIDE_SCRIPT, bloom: 'remember' }, language: 'en', grade: 2, subject: 'math',
    });
    expect(remembered.digest.taught_level).toBe('recall');
  });

  test('seeds the misconceptions from the plan even when the model returns none', async () => {
    const { digest } = await LpDigest.run({ slideScript: SLIDE_SCRIPT, language: 'en', grade: 2, subject: 'math' });
    expect(MODEL_JSON.misconceptions_surfaced).toEqual([]);
    expect(digest.misconceptions_surfaced.join(' ')).toContain('carry out of every column');
    expect(digest.misconceptions_surfaced.join(' ')).toContain('rule about the whole sum');
  });

  test('takes the grade from the catalog, not from the model’s guess', async () => {
    const r = await LpDigest.run({ slideScript: SLIDE_SCRIPT, language: 'en', grade: 5, subject: 'math' });
    expect(r.grade).toBe('5');
    expect(r.gradeSource).toBe('catalog');
  });

  test('records the model and the cost the way the transcript digest does', async () => {
    const r = await LpDigest.run({ slideScript: SLIDE_SCRIPT, language: 'en', grade: 2, subject: 'math' });
    expect(r.model).toBe('test-model');
    expect(r.costUsd).toBe(0.004);
    expect(r.lpHint).toBeNull();
    const [event, payload] = logEvent.mock.calls.find((c) => /digest_done/.test(c[0]));
    expect(event).toBe('transcript_quiz.digest_done');
    // Every event on the shared path carries the source (PLAN_R8 §2.3).
    expect(payload.quiz_source).toBe('lp_v8');
    expect(payload.costUsd).toBe(0.004);
    expect(payload.model).toBe('test-model');
  });

  test('a slide script with nothing in it fails loudly rather than digesting air', async () => {
    await expect(LpDigest.run({ slideScript: null, language: 'en', grade: 2, subject: 'math' }))
      .rejects.toThrow(/slide script/i);
    expect(completeJson).not.toHaveBeenCalled();
  });
});

describe('lessonExcerpts — what the AUTHOR pass reads in place of the transcript', () => {
  test('is the planned lesson, without the exit MCQ and without he/she', () => {
    const excerpts = LpDigest.lessonExcerpts(SLIDE_SCRIPT);
    expect(excerpts).toContain('146 + 27');
    expect(excerpts).toContain(SLIDE_SCRIPT.iDo.keyFact);
    expect(excerpts).toContain('A carry happens only when a column reaches ten.');
    expect(excerpts).not.toContain('327 + 48');
    expect(excerpts).not.toContain('3715');
    expect(excerpts).not.toMatch(/\b(she|her|hers|herself|he|him|his|himself)\b/i);
    expect(excerpts).not.toMatch(/teacherGender/i);
  });

  test('never returns an empty block for a real plan, and never throws on a broken one', () => {
    expect(LpDigest.lessonExcerpts(SLIDE_SCRIPT).length).toBeGreaterThan(200);
    expect(() => LpDigest.lessonExcerpts(null)).not.toThrow();
    expect(() => LpDigest.lessonExcerpts({})).not.toThrow();
  });
});
