/**
 * bd-8s2xb (T4) — image modes attach the photos to the SCORING call and ONLY that call.
 *
 * Executes the real `GPT5MiniService.analyzePedagogy` with the real FICO module; the only
 * mock is the model client (network boundary).
 *
 * This used to also pin the second, gpt-4o-mini whole-plan-fidelity call and assert it got a
 * plain-string user message. That call no longer happens for a framework that measures plan
 * adherence itself: its output was a near-constant estimate that nothing on the report read,
 * and while it existed the voice note quoted it instead of the measurement. One LLM call
 * fewer per lesson-plan-linked session. What T4 is actually for — images reach the SCORING
 * call and only that call — is unchanged, and now asserts that no second call exists at all.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const CANNED = JSON.stringify({ executive_summary: 'ok', domains: {} });
function stubOpenAI(calls) {
  GPT5MiniService.openai = {
    chat: { completions: { create: async (req) => {
      calls.push(req);
      return { choices: [{ message: { content: CANNED }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    } } },
  };
}
const IMG = (n) => ({ mime: 'image/jpeg', base64: Buffer.from(`img-${n}`).toString('base64'), bytes: 5 });
const LP = { subject: 'Maths', topic: 'Plurals', objectives: ['form plurals'], activities: ['a'] };

describe('bd-8s2xb — analyzePedagogy attaches images to the scoring call only', () => {
  const real = GPT5MiniService.openai;
  afterAll(() => { GPT5MiniService.openai = real; });

  test('T4: both mode, 3 images, LP linked → the one call has text + 3 image parts', async () => {
    const calls = []; stubOpenAI(calls);
    await GPT5MiniService.analyzePedagogy('transcript', {
      language: 'ur', teacherFirstName: 'Zeba',
      photoAnalysis: 'desc', photo: { mode: 'both', text: 'desc', count: 3, images: [IMG(1), IMG(2), IMG(3)] },
    }, LP, fico);

    // A framework that measures plan adherence itself makes no second call.
    expect(calls.length).toBe(1);
    const scoring = calls[0];
    expect(scoring.model).toMatch(/gpt-5-mini/);
    const user = scoring.messages.find((m) => m.role === 'user');
    expect(Array.isArray(user.content)).toBe(true);
    expect(user.content.filter((p) => p.type === 'text')).toHaveLength(1);
    const imgs = user.content.filter((p) => p.type === 'image_url');
    expect(imgs).toHaveLength(3);
    expect(imgs[0].image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(imgs[0].image_url.detail).toBe('low');
    // the text part is the real prompt, in both mode
    expect(user.content[0].text).toContain('also attached to this message');

    // and the legacy whole-plan estimate is not attached to the analysis either
    expect(calls.some((c) => c.model === 'gpt-4o-mini')).toBe(false);
  });

  test('T4b: note mode (today) → user message stays a plain string, no image parts', async () => {
    const calls = []; stubOpenAI(calls);
    await GPT5MiniService.analyzePedagogy('transcript', { photoAnalysis: 'desc' }, null, fico);
    expect(calls).toHaveLength(1);
    expect(typeof calls[0].messages[1].content).toBe('string');
  });
});
