'use strict';
/**
 * The class report's "for tomorrow" box speaks without gender, in Urdu.
 *
 * Found live on staging: the Urdu class report's next-step section — the one
 * part of the report a teacher acts on, and the one question in it a teacher
 * reads out to the class — asked «اگر آپ کے پاس 4/7 اور 3/8 ہوں تو آپ کیسے
 * سوچیں گے … آپ اپنے cross-products کو کس ترتیب سے لکھیں گے؟». Masculine
 * futures, to a class of boys and girls. The prompts asked for the "plural-
 * respectful" register («کریں، دیکھیں، سوچیں») and a model reads «آپ … سوچیں
 * گے» as exactly that.
 *
 * This suite pins:
 *   A. both Urdu prompts (reteach: muddled/board/check; secure: secure/stretch)
 *      carry the shared Urdu address rule, and no longer address the MODEL in
 *      the masculine either;
 *   B. guidanceShape() — the box's existing contract check — names a gendered
 *      verb per field, in Urdu only;
 *   C. generateGuidance() repairs it the way that surface already repairs a
 *      thin or off-language box: ONE retry with a line naming the verbs, then
 *      whatever comes back is used (never null), with its own event.
 *
 * Network mocked at `openai` (the one boundary generateGuidance crosses); the
 * prompt builders, guidanceShape and the retry run for real.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

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
const { URDU_ADDRESS_RULE } = require('../../bot/shared/config/gender-neutral-address');

const { guidanceShape } = report;
const flat = (s) => String(s).replace(/\s+/g, ' ');
const promptOf = (i) => mockCreate.mock.calls[i][0].messages[0].content;
const eventsNamed = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

const SECURE_DIGEST = {
  topic_as_taught: 'کسروں کا موازنہ',
  slos: [{ id: 'S1', statement: 'دو کسروں کا cross multiplication سے موازنہ', taught_level: 'apply' }],
};
const HARDEST = [{
  question_text: 'کون سی کسر بڑی ہے: 2/3 یا 3/5؟', wrong: 2, total: 3,
  top_wrong_text: '3/5', correct_text: '2/3',
}];

// The shapes, written the way the model wrote them.
const GENDERED_STRETCH = 'دو unlike fractions کا موازنہ کرتے ہوئے ہر cross-product اسی fraction کے نیچے لکھیں۔ '
  + 'اگر آپ کے پاس 4/7 اور 3/8 ہوں تو آپ کیسے سوچیں گے کہ کون سی fraction بڑی ہے، اور آپ cross-products کو کس ترتیب سے لکھیں گے؟';
const NEUTRAL_STRETCH = 'دو unlike fractions کا موازنہ کرتے ہوئے ہر cross-product اسی fraction کے نیچے لکھیں۔ '
  + 'اگر 4/7 اور 3/8 ہوں تو کیسے معلوم ہوگا کہ کون سی fraction بڑی ہے؟ بچے cross-products کو ترتیب سے لکھ کر وجہ بتائیں۔';
const SECURE = 'بچوں نے دو کسروں کا cross multiplication سے موازنہ کرنا اور بڑی کسر پہچاننا پکا کر لیا ہے۔';
const GENDERED_CHECK = 'اگر ایک چاک کا ڈبہ 5 برابر حصوں میں بٹا ہو اور آپ 2 حصے دکھائیں، تو آپ اسے Proper Fraction کیوں کہیں گے؟';
const NEUTRAL_CHECK = 'اگر ایک چاک کا ڈبہ 5 برابر حصوں میں بٹا ہو اور 2 حصے دکھائے جائیں، تو اسے Proper Fraction کیوں کہا جائے گا؟';
const BOARD = 'بورڈ پر 2/3 اور 3/5 لکھیں اور دونوں کے cross-products ان کے نیچے لکھیں۔ پھر بچوں سے پوچھیں کہ کون سا بڑا ہے۔';
const MUDDLED = 'بچے سمجھتے ہیں کہ جس کسر کا نیچے والا نمبر بڑا ہو وہی بڑی ہوتی ہے۔';

beforeEach(() => {
  jest.clearAllMocks();
  queue.length = 0;
});

describe('A — both Urdu prompts carry the one Urdu address rule', () => {
  const reteach = () => report.buildGuidancePrompt({ topic: 'کسریں', grade: '4', language: 'ur', hardest: HARDEST });
  const secure = () => report.buildGuidancePrompt({ topic: 'کسریں', grade: '4', language: 'ur', hardest: [], digest: SECURE_DIGEST });

  test.each([['reteach', reteach], ['secure', secure]])('%s: the shared rule, both genders named, the neutral forms offered', (_, build) => {
    const p = flat(build());
    expect(p).toContain(flat(URDU_ADDRESS_RULE));
    expect(p).toContain('آپ کیسے سوچیں؟');                // the live mistake, said the neutral way
    expect(p).not.toMatch(/جمع کے احترامی افعال/);         // "plural-respectful" is how «آپ … سوچیں گے» got in
    expect(p).toMatch(/"کرو"، "بتاؤ"/);                     // the tum-register ban stays
  });

  test.each([['reteach', reteach], ['secure', secure]])('%s: the model itself is no longer addressed in the masculine', (_, build) => {
    expect(build()).not.toMatch(/مدد کر رہے ہیں/);
  });

  test('the English prompts are unchanged by an Urdu-only rule', () => {
    const p = report.buildGuidancePrompt({ topic: 'Fractions', grade: '4', language: 'en', hardest: [], digest: SECURE_DIGEST });
    expect(p).not.toContain('آپ');
  });
});

describe('B — guidanceShape names a gendered verb per field, in Urdu only', () => {
  test('the staging stretch: flagged on "stretch", with the forms', () => {
    const shape = guidanceShape({ secure: SECURE, stretch: GENDERED_STRETCH }, 'secure', 'ur');
    const g = shape.problems.filter((p) => p.issue === 'gendered_address');
    expect(shape.ok).toBe(false);
    expect(g).toHaveLength(1);
    expect(g[0].key).toBe('stretch');
    expect(g[0].forms.join(' ')).toContain('سوچیں گے');
  });

  test('a reteach check question read to the class: flagged on "check"', () => {
    const shape = guidanceShape({ muddled: MUDDLED, board: BOARD, check: GENDERED_CHECK }, 'reteach', 'ur');
    expect(shape.problems).toEqual([expect.objectContaining({ key: 'check', issue: 'gendered_address' })]);
  });

  test('neutral Urdu passes; third-person "بچے … سمجھتے ہیں" is not the addressee', () => {
    expect(guidanceShape({ secure: SECURE, stretch: NEUTRAL_STRETCH }, 'secure', 'ur')).toEqual({ ok: true, problems: [] });
    expect(guidanceShape({ muddled: MUDDLED, board: BOARD, check: NEUTRAL_CHECK }, 'reteach', 'ur')).toEqual({ ok: true, problems: [] });
  });
});

describe('C — generateGuidance: one retry naming the verbs, then use what comes back', () => {
  const secureCtx = { shareCodeId: 'sc-1', topic: 'کسریں', grade: '4', language: 'ur', mode: 'secure', hardest: [], digest: SECURE_DIGEST };

  test('the staging reply → ONE retry whose line names the gendered verbs → the neutral retry is used', async () => {
    queue.push({ secure: SECURE, stretch: GENDERED_STRETCH }, { secure: SECURE, stretch: NEUTRAL_STRETCH });
    const out = await report.generateGuidance(secureCtx);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const retryPrompt = promptOf(1);
    expect(retryPrompt).toContain('"stretch"');
    expect(retryPrompt).toContain('سوچیں گے');
    expect(out.stretch).toBe(NEUTRAL_STRETCH);
    const ev = eventsNamed('video_quiz.guidance_gendered_address');
    expect(ev).toEqual([expect.objectContaining({ shareCodeId: 'sc-1', mode: 'secure', fields: ['stretch'], retried: true, cleared: true })]);
    expect(eventsNamed('video_quiz.guidance_thin')).toEqual([]);
  });

  test('a retry that is still gendered is used anyway — never null; the event says it did not clear', async () => {
    queue.push({ secure: SECURE, stretch: GENDERED_STRETCH }, { secure: SECURE, stretch: GENDERED_STRETCH });
    const out = await report.generateGuidance(secureCtx);
    expect(out).toEqual({ secure: SECURE, stretch: GENDERED_STRETCH });
    expect(eventsNamed('video_quiz.guidance_gendered_address')[0]).toEqual(expect.objectContaining({ retried: true, cleared: false }));
  });

  test('a reteach box whose check question is gendered is repaired the same way', async () => {
    queue.push({ muddled: MUDDLED, board: BOARD, check: GENDERED_CHECK }, { muddled: MUDDLED, board: BOARD, check: NEUTRAL_CHECK });
    const out = await report.generateGuidance({ shareCodeId: 'sc-2', topic: 'کسریں', grade: '4', language: 'ur', hardest: HARDEST });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(out.check).toBe(NEUTRAL_CHECK);
  });

  test('a neutral Urdu box costs no retry and logs nothing', async () => {
    queue.push({ secure: SECURE, stretch: NEUTRAL_STRETCH });
    await report.generateGuidance(secureCtx);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(eventsNamed('video_quiz.guidance_gendered_address')).toEqual([]);
  });

  test('thin AND gendered together are ONE retry, and the thin event keeps its own problems', async () => {
    const thinGendered = 'اگر آپ کے پاس 4/7 اور 3/8 ہوں تو آپ کیسے سوچیں گے؟';
    queue.push({ secure: SECURE, stretch: thinGendered }, { secure: SECURE, stretch: NEUTRAL_STRETCH });
    await report.generateGuidance(secureCtx);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(eventsNamed('video_quiz.guidance_thin')[0].problems).toEqual([expect.objectContaining({ key: 'stretch', issue: 'too_short' })]);
    expect(eventsNamed('video_quiz.guidance_gendered_address')).toHaveLength(1);
  });
});
