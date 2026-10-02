'use strict';
/** scoreStrip with only OpenRouter mocked (the openai SDK). */
const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } })));
const { scoreStrip } = require('../../../bot/shared/services/child-test/scoring/maths-photo');

const spec = {
  written: [{ id: 'm5A-w1', prompt: '345 + 278', answer: 623 }, { id: 'm5A-w2', prompt: '702 - 356', answer: 346 }],
  word_problem: { id: 'm5A-wp', prompt_en: 'How many?', answer: 9 },
};
const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { cost: 0.02 } });

beforeEach(() => { mockCreate.mockReset(); process.env.OPENROUTER_API_KEY = 'k'; });

describe('maths strip photo', () => {
  test('items the model returns without (or with mangled) ids are matched by position', async () => {
    mockCreate.mockResolvedValue(reply({ form_code: 'G5-A', items: [
      { id: '1', read: '623', status: 'written', confidence: 0.9 },
      { read: '340', status: 'written', confidence: 0.8 },
      { id: 'wp', read: '9', status: 'written', confidence: 0.9 }] }));
    const r = await scoreStrip({ spec, grade: 5, form: 'A', image: Buffer.from('x'), calls: [] });
    expect(r.part.written.map((w) => [w.id, w.read_answer, w.verdict])).toEqual([['m5A-w1', '623', 'correct'], ['m5A-w2', '340', 'wrong']]);
    expect(r.part.word_problem).toMatchObject({ verdict: 'correct', read_answer: '9' });
    expect(r.formCodeOk).toBe(true);
  });

  test('a strip with another form code caps every confidence (wrong strip photographed)', async () => {
    mockCreate.mockResolvedValue(reply({ form_code: 'G3-B', items: [
      { id: 'm5A-w1', read: '623', status: 'written', confidence: 0.95 }, { id: 'm5A-w2', read: '346', status: 'written', confidence: 0.95 }] }));
    const r = await scoreStrip({ spec, grade: 5, form: 'A', image: Buffer.from('x'), calls: [] });
    expect(r.formCodeOk).toBe(false);
    expect(r.part.written.every((w) => w.confidence <= 0.2)).toBe(true);
  });

  test('crossed-out / illegible is unreadable, an empty box is blank — never "wrong"', async () => {
    mockCreate.mockResolvedValue(reply({ form_code: 'G5-A', items: [
      { id: 'm5A-w1', read: '', status: 'unreadable', confidence: 0.4 }, { id: 'm5A-w2', read: '', status: 'blank', confidence: 0.9 }] }));
    const r = await scoreStrip({ spec, grade: 5, form: 'A', image: Buffer.from('x'), calls: [] });
    expect(r.part.written.map((w) => w.verdict)).toEqual(['unreadable', 'blank']);
  });
});
