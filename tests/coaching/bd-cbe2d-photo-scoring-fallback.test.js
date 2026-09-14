/**
 * bd-cbe2d — classroom photos must never fail a teacher's coaching session.
 *
 * With COACHING_PHOTO_MODE=image|both the scoring call carries the photos as image parts. If the
 * provider rejects that request (moderation on a photo of children, a bad encode, an image-size
 * limit), analyzePedagogy used to rethrow, the processor marked the session failed and sent the
 * error message, and SQS redelivered the same images. Now the call is retried ONCE without the
 * images, using the text-channel prompt, and metadata.photo.mode records the downgrade so the
 * persisted photo_mode stays honest (the processor passes this same metadata object and saves
 * metadata.photo.mode after the call).
 *
 * Executes the real GPT5MiniService.analyzePedagogy with the real FICO module; the only mock is the
 * model client (network boundary).
 *
 *   F1  both mode, image call rejected → one text-only retry succeeds; prompt keeps the descriptions,
 *       drops "attached"; metadata.photo.mode = 'text', images cleared
 *   F2  image mode with no description → retry prompt has no photo rule; mode = 'off'
 *   F3  no images (note mode) and the call rejects → rethrows after ONE call (unchanged)
 *   F4  image call AND the text retry both reject → rethrows the retry's error after exactly two calls
 *   F5  report generation keeps photo_mode / photo_count_analysed (preserve step)
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const CANNED = JSON.stringify({ executive_summary: 'ok', domains: {} });
const OK = { choices: [{ message: { content: CANNED }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
const IMG = (n) => ({ mime: 'image/jpeg', base64: Buffer.from(`img-${n}`).toString('base64'), bytes: 5 });
const DESC = 'Classroom photo 1 (submitted by the teacher): The whiteboard shows the five rules of visiting the sick.';

function stub(behaviour) {
  const calls = [];
  GPT5MiniService.openai = { chat: { completions: { create: async (req) => { calls.push(req); return behaviour(req, calls.length); } } } };
  return calls;
}
const userOf = (req) => req.messages.find((m) => m.role === 'user').content;
const rejectImages = (req) => {
  if (Array.isArray(userOf(req))) { const e = new Error('400 invalid image content'); e.status = 400; throw e; }
  return OK;
};

describe('bd-cbe2d — a rejected image scoring call degrades to text instead of failing the session', () => {
  const real = GPT5MiniService.openai;
  afterAll(() => { GPT5MiniService.openai = real; });

  test('F1: both mode, image call rejected → one text-only retry; descriptions kept; mode recorded as text', async () => {
    const calls = stub(rejectImages);
    const metadata = { language: 'ur', photoAnalysis: DESC, photo: { mode: 'both', text: DESC, count: 3, images: [IMG(1), IMG(2), IMG(3)] } };
    const out = await GPT5MiniService.analyzePedagogy('transcript', metadata, null, fico);

    expect(out.analysis).toBeTruthy();
    expect(calls).toHaveLength(2);
    expect(Array.isArray(userOf(calls[0]))).toBe(true);
    const retry = userOf(calls[1]);
    expect(typeof retry).toBe('string');
    expect(retry).toContain('The whiteboard shows the five rules of visiting the sick.');
    expect(retry).not.toMatch(/attached to this message/);
    expect(metadata.photo.mode).toBe('text');
    expect(metadata.photo.images).toEqual([]);
    expect(metadata.photo.count).toBe(3);
  });

  test('F2: image mode with no description → retry prompt has no photo rule; mode recorded as off', async () => {
    const calls = stub(rejectImages);
    const metadata = { language: 'en', photoAnalysis: null, photo: { mode: 'image', text: null, count: 2, images: [IMG(1), IMG(2)] } };
    await GPT5MiniService.analyzePedagogy('transcript', metadata, null, fico);

    expect(calls).toHaveLength(2);
    const retry = userOf(calls[1]);
    expect(typeof retry).toBe('string');
    expect(retry).not.toMatch(/CLASSROOM PHOTO/);
    expect(metadata.photo.mode).toBe('off');
  });

  test('F3: no images attached and the call rejects → rethrows after a single call (unchanged)', async () => {
    const calls = stub(() => { throw new Error('503 upstream'); });
    await expect(GPT5MiniService.analyzePedagogy('transcript', { photoAnalysis: DESC }, null, fico)).rejects.toThrow('503 upstream');
    expect(calls).toHaveLength(1);
  });

  test('F4: image call and text retry both reject → rethrows the retry error after exactly two calls', async () => {
    const calls = stub((req, n) => { throw new Error(n === 1 ? '400 invalid image content' : '500 retry failed'); });
    const metadata = { photoAnalysis: DESC, photo: { mode: 'both', text: DESC, count: 1, images: [IMG(1)] } };
    await expect(GPT5MiniService.analyzePedagogy('transcript', metadata, null, fico)).rejects.toThrow('500 retry failed');
    expect(calls).toHaveLength(2);
  });
});

describe('bd-cbe2d — the photo provenance survives report generation', () => {
  test('F5: _preserveFrameworkShape keeps photo_mode and photo_count_analysed from the first pass', () => {
    const first = { framework: 'fico', domains: { A: {} }, scores: { overall_percentage: 65 }, photo_analysis: DESC, photo_mode: 'both', photo_count_analysed: 3 };
    const enhanced = { executive_summary: 'rewritten by the enhance pass' };
    GPT5MiniService._preserveFrameworkShape(enhanced, first);
    expect(enhanced.photo_mode).toBe('both');
    expect(enhanced.photo_count_analysed).toBe(3);
    expect(enhanced.photo_analysis).toBe(DESC);
  });
});
