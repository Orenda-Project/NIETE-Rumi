'use strict';
/**
 * L20 (bd-s1oo0.38) — reading the child number off a strip photo. Only OpenRouter (the openai SDK)
 * is mocked. The quick read runs when the photo arrives, so it must be bounded in time; the full
 * strip read (L5 scoreStrip) also returns child_no as a cross-check. No names, ever, in either prompt.
 */
const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } })));
const { readChildNo, CHILD_NO_BAR } = require('../../../bot/shared/services/child-test/scoring/child-no');
const { scoreStrip } = require('../../../bot/shared/services/child-test/scoring/maths-photo');
const prompts = require('../../../bot/shared/services/child-test/scoring/prompts');
const { resolveModelForJob } = require('../../../bot/shared/config/model-registry');

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { cost: 0.002 } });
const promptOf = (call) => call[0].messages[0].content[0].text;

beforeEach(() => { mockCreate.mockReset(); process.env.OPENROUTER_API_KEY = 'k'; delete process.env.CHILD_TEST_CHILD_NO_TIMEOUT_MS; });

describe('the quick read at receipt', () => {
  test('a clear digit comes back with its confidence, from the registered model', async () => {
    mockCreate.mockResolvedValue(reply({ child_no: 3, confidence: 0.97 }));
    const r = await readChildNo({ image: Buffer.from('jpg') });
    expect(r).toMatchObject({ ok: true, childNo: 3, confidence: 0.97, model: 'google/gemini-3.8-flash' });
    expect(resolveModelForJob('childTest.childNo').model).toBe('google/gemini-3.8-flash');
    expect(mockCreate.mock.calls[0][0].model).toBe('google/gemini-3.8-flash');
    expect(mockCreate.mock.calls[0][0].messages[0].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  test('"03", a string, Urdu digits → 3; a non-number → null', async () => {
    for (const [v, want] of [['03', 3], ['۷', 7], [' 5 ', 5], ['x', null], [null, null], [0, null], [-2, null]]) {
      mockCreate.mockResolvedValueOnce(reply({ child_no: v, confidence: 0.9 }));
      expect((await readChildNo({ image: Buffer.from('j') })).childNo).toBe(want);
    }
  });

  test('a slow model is cut off: no number, timedOut, the caller falls back', async () => {
    process.env.CHILD_TEST_CHILD_NO_TIMEOUT_MS = '30';
    mockCreate.mockImplementation(() => new Promise((res) => setTimeout(() => res(reply({ child_no: 2, confidence: 1 })), 300)));
    const t = Date.now();
    const r = await readChildNo({ image: Buffer.from('j') });
    expect(Date.now() - t).toBeLessThan(250);
    expect(r).toMatchObject({ ok: false, childNo: null, timedOut: true });
  });

  test('a model error never throws', async () => {
    mockCreate.mockRejectedValue(new Error('502'));
    const r = await readChildNo({ image: Buffer.from('j') });
    expect(r).toMatchObject({ ok: false, childNo: null, confidence: 0 });
  });

  test('the prompt asks only for the box, and carries no name', () => {
    const p = prompts.CHILD_NO();
    expect(p).toMatch(/Child no\./);
    expect(p).toMatch(/child_no/);
    expect(p).not.toMatch(/name/i);
    expect(CHILD_NO_BAR).toBeGreaterThanOrEqual(0.7);
  });
});

describe('the full strip read returns child_no too', () => {
  const spec = { written: [{ id: 'm3A-w1', prompt: '34 + 28', answer: 62 }], word_problem: null };
  test('child_no and its confidence come back beside the answers; the prompt asks for the box', async () => {
    mockCreate.mockResolvedValue(reply({ form_code: 'G3-A', child_no: '4', child_no_confidence: 0.92, items: [{ id: 'm3A-w1', read: '62', status: 'written', confidence: 0.9 }] }));
    const r = await scoreStrip({ spec, grade: 3, form: 'A', image: Buffer.from('x'), calls: [] });
    expect(r).toMatchObject({ childNo: 4, childNoConfidence: 0.92 });
    expect(promptOf(mockCreate.mock.calls[0])).toMatch(/Child no\./);
    expect(promptOf(mockCreate.mock.calls[0])).toMatch(/"child_no"/);
  });
});
