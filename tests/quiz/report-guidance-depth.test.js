'use strict';
/**
 * PLAN_R5 §0 item 12 / root CLAUDE.md rule 24c — the "for tomorrow" box now
 * asks for a DETAILED 2-3 sentence reteach/stretch move (the operator's own
 * complaint: "it also needs to be more detailed... this is also an example
 * (it has to be detailed, but not more than 2-3 sentences)"). A prompt that
 * demands a shape gets a code check, not a hope: `guidanceShape()` asserts
 * required keys, the 2-3-sentence depth on the one field per mode that needs
 * it, and that the reply actually came back in the requested script — with
 * ONE retry before accepting whatever comes back (never null just because it
 * was thin).
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

// The one network boundary generateGuidance crosses. Replies are queued and
// consumed in order, so a test can script "first reply thin, retry clean".
const queue = [];
const mockCreate = jest.fn(async () => {
  const next = queue.shift();
  return { choices: [{ message: { content: JSON.stringify(next || {}) } }] };
});
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: (...args) => mockCreate(...args) } },
})));

const { logEvent } = require('../../bot/shared/utils/structured-logger');
const report = require('../../bot/shared/services/quiz/video-quiz-report.service');
const { guidanceShape } = report;

function queueReply(obj) { queue.push(obj); }

const HARDEST = [{
  question_text: 'What breaks a circuit?', wrong: 2, total: 3,
  top_wrong_text: 'the wire', correct_text: 'the open switch',
}];
const SECURE_DIGEST = { topic_as_taught: 'Electric circuits',
  slos: [{ id: 'S1', statement: 'tell an open circuit from a closed one', taught_level: 'apply' }] };

beforeEach(() => {
  jest.clearAllMocks();
  queue.length = 0;
});

describe('guidanceShape — the two script directions are not symmetrical', () => {
  // An English field is ALLOWED a Perso-Arabic word: the guidance is grounded
  // in the quiz's own examples, and an English quiz taught in Pakistan
  // legitimately names روٹی on the board. scriptOf() answers "is ANY
  // Perso-Arabic letter present", so using it in that direction flags a
  // correct sentence and spends a retry on it. English is judged on
  // proportion; Urdu is judged on presence, where the simple test is right.
  const EN = {
    muddled: 'They think a half means any small piece.',
    board: 'Draw the روٹی on the board and cut it in two. The children shade one half in their books.',
    check: 'Is this a half?',
  };
  test('an English field naming one Urdu everyday thing is NOT off-language', () => {
    expect(guidanceShape(EN, 'reteach', 'en')).toEqual({ ok: true, problems: [] });
  });
  test('an English-requested field that is actually written in Urdu IS off-language', () => {
    const shape = guidanceShape({
      muddled: 'بچے سمجھتے ہیں کہ آدھا کوئی بھی چھوٹا ٹکڑا ہے۔',
      board: 'بورڈ پر روٹی بنائیں۔ بچے آدھا حصہ رنگ کریں۔',
      check: 'کیا یہ آدھا ہے؟',
    }, 'reteach', 'en');
    expect(shape.ok).toBe(false);
    expect(shape.problems.filter((p) => p.issue === 'off_language')).toHaveLength(3);
  });
  test('an Urdu-requested field with no Perso-Arabic letter at all IS off-language', () => {
    const shape = guidanceShape(EN, 'reteach', 'ur');
    expect(shape.problems.filter((p) => p.issue === 'off_language')).toHaveLength(3);
  });
});

describe('guidanceShape — the contract a reply must meet', () => {
  test('ok when every key is present, the depth key has 2-3 sentences, and the script matches', () => {
    const shape = guidanceShape(
      { muddled: 'One line.', board: 'First move. Second move.', check: 'One question?' },
      'reteach', 'en',
    );
    expect(shape).toEqual({ ok: true, problems: [] });
  });

  test('flags a missing/empty required key', () => {
    const shape = guidanceShape({ muddled: 'a', board: '', check: 'c' }, 'reteach', 'en');
    expect(shape.ok).toBe(false);
    expect(shape.problems).toContainEqual(expect.objectContaining({ key: 'board', issue: 'missing' }));
  });

  test('flags the depth key when it has fewer than 2 sentences', () => {
    const shape = guidanceShape({ muddled: 'a.', board: 'Only one sentence.', check: 'c?' }, 'reteach', 'en');
    expect(shape.ok).toBe(false);
    expect(shape.problems).toContainEqual(expect.objectContaining({ key: 'board', issue: 'too_short' }));
  });

  test('does not flag muddled/check for being one sentence — that IS the spec for them', () => {
    const shape = guidanceShape({ muddled: 'One.', board: 'First. Second.', check: 'One?' }, 'reteach', 'en');
    expect(shape.problems).toEqual([]);
  });

  test('the secure-mode depth key is "stretch", not "board"', () => {
    const shape = guidanceShape({ secure: 'One.', stretch: 'Only one sentence.' }, 'secure', 'en');
    expect(shape.problems).toContainEqual(expect.objectContaining({ key: 'stretch', issue: 'too_short' }));
  });

  test('flags an Urdu-requested field with no Perso-Arabic letter at all', () => {
    const shape = guidanceShape(
      { secure: 'They can do it now.', stretch: 'First step. Second step, with the example.' },
      'secure', 'ur',
    );
    expect(shape.problems).toContainEqual(expect.objectContaining({ key: 'secure', issue: 'off_language' }));
    expect(shape.problems).toContainEqual(expect.objectContaining({ key: 'stretch', issue: 'off_language' }));
  });

  test('flags an English-requested field written in Urdu script', () => {
    const shape = guidanceShape(
      { secure: 'وہ اب یہ کر سکتے ہیں۔', stretch: 'First step. Second step, with the example.' },
      'secure', 'en',
    );
    expect(shape.problems).toContainEqual(expect.objectContaining({ key: 'secure', issue: 'off_language' }));
  });

  test('an unsupported language code (pa-PK) is treated as the English fallback, not flagged against itself', () => {
    const shape = guidanceShape(
      { secure: 'They can do it now.', stretch: 'First step. Second step, with the example.' },
      'secure', 'pa-PK',
    );
    expect(shape.ok).toBe(true);
  });
});

describe('generateGuidance — the shape is asserted, with one retry', () => {
  test('a 1-sentence board triggers exactly one retry, and the retry result is used', async () => {
    queueReply({ muddled: 'They think X is Y.', board: 'Only one sentence.', check: 'What is X?' });
    queueReply({ muddled: 'They think X is Y.', board: 'First move on the board. Second, what the children do.', check: 'What is X?' });

    const out = await report.generateGuidance({ topic: 'Electric circuit', hardest: HARDEST, language: 'en' });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(out.board).toBe('First move on the board. Second, what the children do.');
  });

  test('a 2-3 sentence board triggers no retry at all', async () => {
    queueReply({ muddled: 'They think X is Y.', board: 'First move. Second move.', check: 'What is X?' });

    const out = await report.generateGuidance({ topic: 'Electric circuit', hardest: HARDEST, language: 'en' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(out.board).toBe('First move. Second move.');
  });

  test('an English reply to an Urdu request is flagged off-language and retried', async () => {
    queueReply({ muddled: 'They think X is Y.', board: 'First move. Second move.', check: 'What is X?' });
    queueReply({ muddled: 'بچے سمجھتے ہیں X، Y ہے۔', board: 'پہلا قدم۔ دوسرا قدم، مثال کے ساتھ۔', check: 'X کیا ہے؟' });

    const out = await report.generateGuidance({ topic: 'x', hardest: HARDEST, language: 'ur' });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(out.muddled).toBe('بچے سمجھتے ہیں X، Y ہے۔');
  });

  test('a retry that comes back no better is still used, never null — losing the box is worse than a short one', async () => {
    queueReply({ muddled: 'They think X is Y.', board: 'Only one.', check: 'What is X?' });
    queueReply({ muddled: 'They think X is Y.', board: 'Still only one.', check: 'What is X?' });

    const out = await report.generateGuidance({ topic: 'x', hardest: HARDEST, language: 'en' });

    expect(out).not.toBeNull();
    expect(out.board).toBe('Still only one.');
  });

  test('a thin reply logs video_quiz.guidance_thin', async () => {
    queueReply({ muddled: 'They think X is Y.', board: 'Only one sentence.', check: 'What is X?' });
    queueReply({ muddled: 'They think X is Y.', board: 'First move. Second move.', check: 'What is X?' });

    await report.generateGuidance({ topic: 'x', hardest: HARDEST, language: 'en' });

    expect(logEvent).toHaveBeenCalledWith('video_quiz.guidance_thin', expect.objectContaining({ mode: 'reteach' }));
    expect(logEvent).not.toHaveBeenCalledWith('video_quiz.guidance_off_language', expect.anything());
  });

  test('an off-language reply logs the DISTINCT video_quiz.guidance_off_language event, not guidance_thin', async () => {
    queueReply({ muddled: 'They think X is Y.', board: 'First move. Second move.', check: 'What is X?' });
    queueReply({ muddled: 'بچے سمجھتے ہیں X، Y ہے۔', board: 'پہلا قدم۔ دوسرا قدم۔', check: 'کیا؟' });

    await report.generateGuidance({ topic: 'x', hardest: HARDEST, language: 'ur' });

    expect(logEvent).toHaveBeenCalledWith('video_quiz.guidance_off_language', expect.objectContaining({ mode: 'reteach' }));
    expect(logEvent).not.toHaveBeenCalledWith('video_quiz.guidance_thin', expect.anything());
  });

  test('the secure-mode stretch field is held to the same 2-3 sentence depth', async () => {
    queueReply({ secure: 'They can now read a circuit diagram.', stretch: 'Just one line.' });
    queueReply({ secure: 'They can now read a circuit diagram.', stretch: 'Give them a two-bulb loop. They predict which dims, then test it.' });

    const out = await report.generateGuidance({
      topic: 'x', average: 100, finished: 5, started: 5, hardest: [], digest: SECURE_DIGEST, language: 'en',
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(out.stretch).toBe('Give them a two-bulb loop. They predict which dims, then test it.');
  });
});

describe('prompt content — the sentence budget is stated explicitly, in all four prompts', () => {
  test('the reteach EN prompt states both budgets', () => {
    const p = report.buildGuidancePrompt({ topic: 't', hardest: HARDEST });
    expect(p).toMatch(/exactly one sentence/);
    expect(p).toMatch(/exactly 2 to 3 sentences/);
  });

  test('the secure EN prompt states both budgets', () => {
    const p = report.buildGuidancePrompt({ topic: 't', hardest: [], digest: SECURE_DIGEST });
    expect(p).toMatch(/exactly one sentence/);
    expect(p).toMatch(/exactly 2 to 3 sentences/);
  });

  test('the reteach UR prompt states both budgets', () => {
    const p = report.buildGuidancePrompt({ topic: 't', hardest: HARDEST, language: 'ur' });
    expect(p).toMatch(/exactly one sentence/);
    expect(p).toMatch(/exactly 2 to 3 sentences/);
  });

  test('the secure UR prompt states both budgets', () => {
    const p = report.buildGuidancePrompt({ topic: 't', hardest: [], digest: SECURE_DIGEST, language: 'ur' });
    expect(p).toMatch(/exactly one sentence/);
    expect(p).toMatch(/exactly 2 to 3 sentences/);
  });

  test('both Urdu prompts carry the English-terms-stay-Latin rule with concrete subject examples', () => {
    const reteachUr = report.buildGuidancePrompt({ topic: 't', hardest: HARDEST, language: 'ur' });
    const secureUr = report.buildGuidancePrompt({ topic: 't', hardest: [], digest: SECURE_DIGEST, language: 'ur' });
    [reteachUr, secureUr].forEach((p) => {
      expect(p).toMatch(/fraction/);
      expect(p).toMatch(/numerator/);
      expect(p).toMatch(/circuit/);
      expect(p).toMatch(/atom/);
      expect(p).toMatch(/photosynthesis/);
    });
  });
});
