'use strict';
/**
 * bd-2335 — the class report should tell a teacher what to reteach tomorrow,
 * with the evidence attached.
 *
 * The video-quiz corpus is unusually well placed for this: 9,150 of its
 * questions carry a written explanation for EACH wrong option, authored against
 * that question. So when a class clusters on one wrong answer we can say not
 * just "16 of 22 missed this" but WHICH wrong answer they chose and WHY that
 * particular mistake happens.
 *
 * PLAN_R4 D6 (bd-mg9c7.48) — the guidance stopped being a paragraph and
 * became a shaped object: {muddled, board, check} when something was missed,
 * {secure, stretch} when the class missed nothing (previously silent, null),
 * grounded in the quiz's lesson digest (topic_as_taught, SLOs with
 * taught_level, misconceptions_surfaced, lesson_summary) as well as the
 * missed-question evidence. This file covers both the pure prompt-building
 * (buildGuidancePrompt) and the network-boundary-mocked generation
 * (generateGuidance), plus hardestQuestions' new `explanation` field.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

// The one network boundary generateGuidance crosses. `mockCreate` is
// referenced inside the jest.mock factory below — allowed unhoisted because
// its name is allow-listed by babel-plugin-jest-hoist ("mock*" prefix).
const openaiState = { raw: null };
const mockCreate = jest.fn(async () => ({ choices: [{ message: { content: openaiState.raw } }] }));
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: (...args) => mockCreate(...args) } },
})));

const supabase = require('../../shared/config/supabase');
const report = require('../../shared/services/quiz/video-quiz-report.service');

function setOpenAiResponse(obj) { openaiState.raw = JSON.stringify(obj); }
function setOpenAiRaw(raw) { openaiState.raw = raw; }

const QUESTION = {
  id: 'q1',
  question_text: 'A leaf has veins that run parallel to each other. Which group does this clue suggest?',
  option_a: 'Dicot', option_b: 'Rose plant only', option_c: 'Monocot', option_d: null,
  correct_option: 'C',
  explanation: 'Parallel leaf veins are the reliable clue for a monocot.',
  option_feedback: {
    correct: 'Nice! Parallel leaf veins point to a monocot.',
    wrong: {
      0: 'A) Good try. You flipped the vein rule: dicots usually have non-parallel veins.',
      1: 'B) Nice try. Rose is just one example, not the group for all parallel-vein leaves.',
    },
  },
};

/** sessions -> answers -> questions, in the order the service reads them. */
function stubChain({ sessions, answers, questions }) {
  supabase.from.mockImplementation((table) => {
    const result = table === 'quiz_sessions' ? sessions
      : table === 'quiz_answers' ? answers
        : table === 'quiz_questions' ? questions : [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      is: () => chain,
      then: (resolve) => resolve({ data: result, error: null }),
    };
    return chain;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  openaiState.raw = null;
});

describe('bd-2335 — the report knows which wrong answer the class chose', () => {
  beforeEach(() => {
    stubChain({
      sessions: [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }],
      answers: [
        // Three of four picked A — a real cluster, not scatter.
        { question_id: 'q1', is_correct: false, selected_option: 'A' },
        { question_id: 'q1', is_correct: false, selected_option: 'A' },
        { question_id: 'q1', is_correct: false, selected_option: 'A' },
        { question_id: 'q1', is_correct: true, selected_option: 'C' },
      ],
      questions: [QUESTION],
    });
  });

  test('it names the distractor the class clustered on', async () => {
    const [hardest] = await report.hardestQuestions('sc-1');
    expect(hardest.wrong).toBe(3);
    expect(hardest.total).toBe(4);
    expect(hardest.top_wrong_option).toBe('A');
    expect(hardest.top_wrong_text).toBe('Dicot');
  });

  test('it carries the written reason that wrong answer happens', async () => {
    const [hardest] = await report.hardestQuestions('sc-1');
    // This sentence was authored against THIS question, for THIS wrong option.
    // It is the difference between "16 missed it" and "16 flipped the rule".
    expect(hardest.misconception).toMatch(/flipped the vein rule/i);
  });

  test('it says what the right answer was, so the teacher need not look it up', async () => {
    const [hardest] = await report.hardestQuestions('sc-1');
    expect(hardest.correct_text).toBe('Monocot');
  });

  // bd-mg9c7.48 — D5's "why THIS question was selected/right" needs the
  // authored per-question explanation, independent of which distractor the
  // class happened to cluster on.
  test('it puts the authored explanation on the row, cleaned through teacherFacing', async () => {
    const [hardest] = await report.hardestQuestions('sc-1');
    expect(hardest.explanation).toBe('Parallel leaf veins are the reliable clue for a monocot.');
  });
});

describe('bd-2335 — scattered wrong answers are not reported as a pattern', () => {
  test('no single distractor dominating means no misconception is claimed', async () => {
    stubChain({
      sessions: [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }],
      answers: [
        { question_id: 'q1', is_correct: false, selected_option: 'A' },
        { question_id: 'q1', is_correct: false, selected_option: 'B' },
        { question_id: 'q1', is_correct: true, selected_option: 'C' },
        { question_id: 'q1', is_correct: true, selected_option: 'C' },
      ],
      questions: [QUESTION],
    });
    const [hardest] = await report.hardestQuestions('sc-1');
    expect(hardest.wrong).toBe(2);
    // One A and one B is a coin toss, not a shared misunderstanding. Claiming a
    // pattern here would send the teacher to reteach the wrong thing.
    expect(hardest.top_wrong_option).toBeNull();
    expect(hardest.misconception).toBeNull();
  });
});

describe('bd-mg9c7.48 — hardestQuestions() explanation is independent of clustering', () => {
  test('a question with no authored explanation returns null, not undefined', async () => {
    stubChain({
      sessions: [{ id: 's1' }, { id: 's2' }],
      answers: [
        { question_id: 'q1', is_correct: false, selected_option: 'A' },
        { question_id: 'q1', is_correct: true, selected_option: 'C' },
      ],
      questions: [{ ...QUESTION, explanation: null }],
    });
    const [hardest] = await report.hardestQuestions('sc-1');
    expect(hardest.explanation).toBeNull();
  });
});

describe('bd-mg9c7.48 — buildGuidancePrompt reteach mode asks for JSON and carries the digest', () => {
  const HARDEST = [{
    question_text: 'A leaf has veins that run parallel to each other. Which group does this clue suggest?',
    wrong: 16, total: 22, top_wrong_text: 'Dicot', correct_text: 'Monocot',
    misconception: 'You flipped the vein rule: dicots usually have non-parallel veins.',
  }];
  const DIGEST = {
    topic_as_taught: 'Monocots and Dicots (leaf veins)',
    slos: [{ id: 'S1', statement: 'name a monocot from its leaf veins', taught_level: 'apply' }],
    misconceptions_surfaced: ['thinks vein direction does not matter'],
    lesson_summary: 'She showed a rose leaf and a grass leaf and asked which had parallel veins.',
  };

  test('asks for a JSON object with the three reteach keys, not prose', () => {
    const prompt = report.buildGuidancePrompt({ topic: 'Monocots and Dicots', hardest: HARDEST });
    expect(prompt).toMatch(/JSON object/);
    expect(prompt).toMatch(/"muddled"/);
    expect(prompt).toMatch(/"board"/);
    expect(prompt).toMatch(/"check"/);
  });

  test('carries the digest topic_as_taught, SLO statement + taught_level, and misconceptions into the prompt text', () => {
    const prompt = report.buildGuidancePrompt({ topic: 'Monocots and Dicots', hardest: HARDEST, digest: DIGEST });
    expect(prompt).toContain('Monocots and Dicots (leaf veins)');
    expect(prompt).toContain('name a monocot from its leaf veins');
    expect(prompt).toMatch(/apply/);
    expect(prompt).toContain('thinks vein direction does not matter');
    expect(prompt).toContain('She showed a rose leaf');
  });

  test('still carries the real evidence and the forbidden-opener/word rules', () => {
    const prompt = report.buildGuidancePrompt({ topic: 'Monocots and Dicots', hardest: HARDEST });
    expect(prompt).toContain('parallel to each other');   // the actual question
    expect(prompt).toContain('Dicot');                    // what they picked
    expect(prompt).toContain('flipped the vein rule');    // why that happens
    expect(prompt).toMatch(/16 of 22/);
    expect(prompt).toMatch(/In tomorrow's lesson/);        // named as forbidden
    expect(prompt).toMatch(/misconception/);               // banned as a WORD
    expect(prompt).toMatch(/various examples/);            // banned as a cop-out
    expect(prompt).toMatch(/Do not repeat any/);
  });

  test('refuses (null) with neither hardest nor digest', () => {
    expect(report.buildGuidancePrompt({ topic: 'x' })).toBeNull();
    expect(report.buildGuidancePrompt({ topic: 'x', hardest: [] })).toBeNull();
    expect(report.buildGuidancePrompt({ topic: 'x', hardest: [], digest: null })).toBeNull();
  });

  test('a digest alone (no missed questions) grounds the secure-mode prompt instead of refusing', () => {
    const prompt = report.buildGuidancePrompt({ topic: 'x', hardest: [], digest: DIGEST });
    expect(prompt).not.toBeNull();
    expect(prompt).toMatch(/"secure"/);
    expect(prompt).toMatch(/"stretch"/);
  });

  test('a digest with no usable content (empty slos, no topic_as_taught) still refuses', () => {
    expect(report.buildGuidancePrompt({
      topic: 'x', hardest: [], digest: { slos: [], misconceptions_surfaced: [] },
    })).toBeNull();
  });
});

describe('bd-mg9c7.48 — the Urdu prompt asks for Urdu script', () => {
  const UR_HARDEST = [{
    question_text: 'لفظ "آزادی" میں یے کی آواز کیا بتائی گئی؟',
    wrong: 4, total: 8,
    top_wrong_text: 'ی',
    correct_text: 'ای',
    misconception: 'بچے آخر کی آواز الجھا دیتے ہیں۔',
  }];

  test('the evidence and instructions are in Urdu; the JSON keys stay literal', () => {
    const prompt = report.buildGuidancePrompt({
      topic: 'چھوٹی یے اور بڑی یے کی آوازیں', grade: 'Prep', hardest: UR_HARDEST, language: 'ur',
    });
    expect(prompt).toContain('آزادی');
    expect(prompt).toContain('بچے آخر کی آواز الجھا دیتے ہیں۔');
    expect(prompt).toMatch(/"muddled"/);
    expect(prompt).not.toMatch(/Return ONLY a JSON object with exactly these three keys, each value a/);
  });

  test('never asks for Roman-Urdu — explicitly bans it', () => {
    const prompt = report.buildGuidancePrompt({
      topic: 'چھوٹی یے', hardest: UR_HARDEST, language: 'ur',
    });
    expect(prompt).toMatch(/رومن اردو میں ہرگز نہیں/);
  });

  test('stays gender-neutral — never asserts the teacher\'s gender', () => {
    const prompt = report.buildGuidancePrompt({
      topic: 'چھوٹی یے', hardest: UR_HARDEST, language: 'ur',
    });
    expect(prompt).not.toMatch(/سمجھتی ہوں گی|کریں گی|لکھتی ہے|پڑھتی ہے/);
  });

  // bd-2693 — NIETE is flat en/ur: an out-of-scope language value falls back
  // to the safe (English JSON) default rather than guessing Urdu.
  test('an unsupported language value (pa-PK/sd-PK) falls back to the English JSON prompt', () => {
    const pa = report.buildGuidancePrompt({ topic: 'x', hardest: UR_HARDEST, language: 'pa-PK' });
    const sd = report.buildGuidancePrompt({ topic: 'x', hardest: UR_HARDEST, language: 'sd-PK' });
    expect(pa).toMatch(/"muddled"/);
    expect(sd).toMatch(/"muddled"/);
    expect(pa).not.toMatch(/رومن اردو/);
  });

  test('no language field (default) is unchanged — still the English JSON prompt', () => {
    const prompt = report.buildGuidancePrompt({
      topic: 'Monocots and Dicots', grade: '6', hardest: [{
        question_text: 'A leaf has veins that run parallel to each other. Which group does this clue suggest?',
        wrong: 16, total: 22, top_wrong_text: 'Dicot', correct_text: 'Monocot',
        misconception: 'You flipped the vein rule.',
      }],
    });
    expect(prompt).toMatch(/"muddled"/);
  });
});

describe('bd-mg9c7.48 — generateGuidance parses the model reply into the shaped object', () => {
  const HARDEST = [{
    question_text: 'A leaf has veins that run parallel to each other.',
    wrong: 3, total: 4, top_wrong_text: 'Dicot', correct_text: 'Monocot',
    misconception: 'You flipped the vein rule.',
  }];

  test('a plain JSON reply becomes {muddled, board, check}', async () => {
    setOpenAiResponse({
      muddled: 'They think leaf veins never matter.',
      board: 'Draw the rose leaf and the grass leaf on the board.',
      check: 'Which leaf shape has parallel veins?',
    });
    const out = await report.generateGuidance({ topic: 'Monocots and Dicots', hardest: HARDEST });
    expect(out).toEqual({
      muddled: 'They think leaf veins never matter.',
      board: 'Draw the rose leaf and the grass leaf on the board.',
      check: 'Which leaf shape has parallel veins?',
    });
  });

  test('a fenced ```json reply still parses', async () => {
    setOpenAiRaw('```json\n{"muddled":"a","board":"b","check":"c"}\n```');
    const out = await report.generateGuidance({ topic: 'x', hardest: HARDEST });
    expect(out).toEqual({ muddled: 'a', board: 'b', check: 'c' });
  });

  test('markdown emphasis inside a value is stripped (bd-2611, still true for the object shape)', async () => {
    setOpenAiResponse({ muddled: 'They think **the** is any word.', board: 'b', check: 'c' });
    const out = await report.generateGuidance({ topic: 'x', hardest: HARDEST });
    expect(out.muddled).toBe('They think the is any word.');
  });

  test('any required key empty after stripping fails the whole call, not just that key', async () => {
    setOpenAiResponse({ muddled: '   ', board: 'b', check: 'c' });
    const out = await report.generateGuidance({ topic: 'x', hardest: HARDEST });
    expect(out).toBeNull();
  });

  test('a reply missing a required key returns null', async () => {
    setOpenAiResponse({ muddled: 'a', board: 'b' });
    const out = await report.generateGuidance({ topic: 'x', hardest: HARDEST });
    expect(out).toBeNull();
  });

  test('unparseable JSON returns null — the report still sends, just without the box', async () => {
    setOpenAiRaw('not json at all');
    const out = await report.generateGuidance({ topic: 'x', hardest: HARDEST });
    expect(out).toBeNull();
  });
});

describe('bd-mg9c7.48 — the zero-missed branch returns {secure, stretch}, where today it returned null', () => {
  const DIGEST = { slos: [{ id: 'S1', statement: 'name a monocot vs a dicot', taught_level: 'understand' }] };

  test('a class that missed nothing still gets a guidance object, grounded in the digest', async () => {
    setOpenAiResponse({
      secure: 'They can now name a monocot on sight.',
      stretch: 'Which grass is a monocot, and how do you know?',
    });
    const out = await report.generateGuidance({
      topic: 'Monocots and Dicots', average: 100, finished: 22, started: 22, hardest: [], digest: DIGEST,
    });
    expect(out).toEqual({
      secure: 'They can now name a monocot on sight.',
      stretch: 'Which grass is a monocot, and how do you know?',
    });
  });

  test('with no hardest AND no digest, no model call is made and the result is null', async () => {
    const out = await report.generateGuidance({
      topic: 'x', average: 100, finished: 5, started: 5, hardest: [],
    });
    expect(out).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('bd-mg9c7.48 — formatGuidanceText renders the WhatsApp text fallback', () => {
  const LABELS_EN = {
    muddledLabel: 'What they muddled', boardLabel: 'On the board', checkLabel: 'Check question',
    secureLabel: "What's solid", stretchLabel: 'Stretch question',
  };

  test('reteach shape prints three labelled parts with single-asterisk bold', () => {
    const text = report.formatGuidanceText(
      { muddled: 'a', board: 'b', check: 'c' }, LABELS_EN,
    );
    expect(text).toBe('*What they muddled:* a\n\n*On the board:* b\n\n*Check question:* c');
    expect(text).not.toMatch(/\*\*/);   // never double-asterisk — that is not bold on WhatsApp
  });

  test('zero-missed shape prints the two labelled parts', () => {
    const text = report.formatGuidanceText({ secure: 'a', stretch: 'b' }, LABELS_EN);
    expect(text).toBe("*What's solid:* a\n\n*Stretch question:* b");
  });

  test('a null guidance renders nothing', () => {
    expect(report.formatGuidanceText(null, LABELS_EN)).toBe('');
  });
});

/**
 * bd-mg9c7.48 (lane C manager pass) — the check/stretch question is the one
 * sentence in this box that a teacher READS OUT to children, so it has to
 * arrive in the same register the quiz itself uses: "آپ" with plural-
 * respectful verbs, never the tum-form. A real run on the staging
 * "Proper Fraction" digest came back with "compare کرو … بتاؤ" — gender-neutral
 * (so the broadcast rule held) but a different register from every question
 * the same children had just answered.
 */
describe('bd-mg9c7.48 — the Urdu prompts pin the child-facing register', () => {
  const REGISTER = /جمع کے احترامی افعال/;

  test('the reteach prompt asks for آپ + plural-respectful verbs in the check question', () => {
    const p = report.buildGuidancePrompt({
      topic: 'کسریں', grade: '4', language: 'ur',
      hardest: [{ question_text: 'آدھی روٹی؟', wrong: 2, total: 3 }],
    });
    expect(p).toMatch(REGISTER);
    expect(p).toMatch(/"کرو"، "بتاؤ"/);
  });

  test('the secure prompt asks for the same register in the stretch question', () => {
    const p = report.buildGuidancePrompt({
      topic: 'کسریں', grade: '4', language: 'ur', hardest: [],
      digest: { slos: [{ id: 'S1', statement: 'کسر پہچاننا', taught_level: 'recall' }] },
    });
    expect(p).toMatch(REGISTER);
  });

  test('the secure prompt carries the gender-neutrality rule the reteach prompt already had', () => {
    const p = report.buildGuidancePrompt({
      topic: 'کسریں', grade: '4', language: 'ur', hardest: [],
      digest: { slos: [{ id: 'S1', statement: 'کسر پہچاننا', taught_level: 'recall' }] },
    });
    expect(p).toMatch(/غیر جانبدار زبان/);
  });

  test('the English prompts are untouched by the Urdu register rule', () => {
    const p = report.buildGuidancePrompt({
      topic: 'Fractions', grade: '4', language: 'en',
      hardest: [{ question_text: 'Half a roti?', wrong: 2, total: 3 }],
    });
    expect(p).not.toMatch(REGISTER);
  });
});
