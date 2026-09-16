/**
 * An English teacher's reflective question came out in Roman Urdu.
 *
 * Staging, 15 Sep 2026, session 039555f2: preferred_language en, the chain was
 * given the English profile (log `[refl-q] v12 question generated`
 * language "English"), and the model returned
 *   "Mujhe ek moment par gaur se sochna pasand aaya: jab aapne cake ka example diya…"
 * Production shows the same on every sampled English-preference session, whether
 * the lesson itself was taught in Urdu or in English.
 *
 * The chain already has the right shape — validate, one retry naming the
 * violation, then a curated fallback — but its only language gates run for a
 * NON-Latin script. English is a Latin script, so nothing checked that an
 * "English" question was English, and the Roman-Urdu text went out as clean.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const { validateQuestion, buildSafeFallback } = require('../../shared/services/coaching/reflective-questions/guardrails');
const { resolveProfile } = require('../../shared/services/coaching/reflective-questions/language-profiles');

const ROMAN_URDU = "Mujhe ek moment par gaur se sochna pasand aaya: jab aapne cake ka example diya, to ek student ne apne birthday cake ki baat share ki, aur uske baad jab aapne proper fraction ka rule poocha, to ek student ne 'upar wala jo...' kaha aur aapne poora rule bata diya. In dono lamhon ke beech, students ki soch mein kya shift aaya? Aur agli baar jab aap rule poochenge, to ek chota sa kya try kar sakte hain?";
const ROMAN_URDU_2 = 'Shuru mein jab aap ne sawal poocha, to bachon ne alag alag jawab diye. In do palon mein bachon ki soch kaise badli, aur agli baar aap kya try karna chahengi?';
const ENGLISH_WITH_QUOTE = "Early on, when you asked about the cake, a student said 'upar wala jo...' and you then gave the whole rule. What do you think changed in the children's thinking between those two moments, and what is one small thing you would like to try next time?";

describe('the English profile has a language contract', () => {
  const en = resolveProfile('en');

  test('a Roman-Urdu question under the English profile is a violation', () => {
    expect(validateQuestion(ROMAN_URDU, {}, '', en)).toContain('wrong_language');
    expect(validateQuestion(ROMAN_URDU_2, {}, '', en)).toContain('wrong_language');
  });

  test('an English question that quotes the Urdu words a child said is clean', () => {
    expect(validateQuestion(ENGLISH_WITH_QUOTE, {}, '', en)).toEqual([]);
  });

  test('the curated English fallbacks are clean', () => {
    [1, 2, 3].forEach((n) => {
      expect(validateQuestion(buildSafeFallback(n, {}, en), {}, '', en)).toEqual([]);
    });
  });

  test('the gate is English-only: a Kiswahili question is not judged by it', () => {
    const sw = resolveProfile('sw');
    [1, 2, 3].forEach((n) => {
      expect(validateQuestion(buildSafeFallback(n, {}, sw), {}, '', sw)).toEqual([]);
    });
  });
});

describe('_generateReflectiveQuestionV12 enforces it', () => {
  let calls;

  function load(replies) {
    jest.resetModules();
    calls = [];
    jest.doMock('../../shared/services/coaching/reflective-questions/llm-router.service', () => ({
      callReflective: jest.fn(async (messages) => {
        calls.push(messages);
        const question = replies[Math.min(calls.length - 1, replies.length - 1)];
        return { content: JSON.stringify({ question, question_en: 'x' }), model_used: 'test-model' };
      }),
    }));
    return require('../../shared/services/gpt5-mini.service');
  }

  test('a Roman-Urdu first answer is retried, and the retry names the problem', async () => {
    const GPT = load([ROMAN_URDU, ENGLISH_WITH_QUOTE]);
    const q = await GPT._generateReflectiveQuestionV12({}, [], 1, 'en', '');

    expect(q).toBe(ENGLISH_WITH_QUOTE);
    expect(calls).toHaveLength(2);
    expect(calls[1][0].content).toMatch(/wrong_language/);
  });

  test('two Roman-Urdu answers fall back to the curated English question', async () => {
    const GPT = load([ROMAN_URDU, ROMAN_URDU_2]);
    const q = await GPT._generateReflectiveQuestionV12({}, [], 1, 'en', '');

    expect(q).toBe(buildSafeFallback(1, {}, resolveProfile('en')));
  });
});

describe('the question prompt itself tells an English question not to be Roman Urdu', () => {
  const { buildQuestionPrompt } = require('../../shared/services/coaching/reflective-questions/question-prompt');

  test('the English profile carries the instruction', () => {
    const sys = buildQuestionPrompt(1, {}, resolveProfile('en'), '');
    expect(sys).toMatch(/Roman Urdu/i);
  });

  test('the Urdu profile keeps its own script rule and does not get the English one', () => {
    const sys = buildQuestionPrompt(1, {}, resolveProfile('ur'), '');
    expect(sys).not.toMatch(/Roman Urdu/i);
    expect(sys).toMatch(/SCRIPT PURITY/);
  });
});
