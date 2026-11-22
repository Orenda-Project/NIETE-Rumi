/**
 * bd-5jmnfj.38.35 — service wiring: a cross-leak left after the rewrite gets a follow-up and a code repair
 * (G8 Urdu a8b Q1/Q11 shape), a clean paper costs no extra call, and a converted type mix is reported.
 */
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
  modelInForce: (job, site) => site,
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const Svc = require('../../bot/shared/services/assessment/free-secondary.service');
const C = require('../../bot/shared/services/assessment/free-secondary-checks');

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: {} });
const PHRASE = 'ایک چھوٹی ڈسپنسری قائم کی';
const leakyMcq = { question: 'ایدھی نے اپنی خدمات کا آغاز کس طرح کیا؟',
  options: ['الف) ایک امدادی ادارہ خریدا', 'ب) ایک بڑا ہسپتال بنایا', 'ج) ایک رفاہی اسکول کھولا', `د) ${PHRASE}`], answer: `د) ${PHRASE}`, marks: 1, lines: 0 };
const other = (t) => ({ question: `${t} کون سا ہے؟`, options: ['الف) ایک', 'ب) دو', 'ج) تین', 'د) چار'], answer: 'ج) تین', marks: 1, lines: 0 });
const srq = { question: 'ایدھی نے خدمتِ خلق کا آغاز کس طرح کیا تھا؟', answer: `انھوں نے ${PHRASE}۔`, marks: 2, lines: 2,
  marking_points: [{ point: 'ڈسپنسری', marks: 1 }, { point: 'جمع پونجی', marks: 1 }],
  mark_bands: [{ marks: '2', descriptor: 'دونوں نکات' }, { marks: '1', descriptor: 'ایک نکتہ' }, { marks: '0', descriptor: 'غلط' }],
  accept: 'مختصر وضاحت', reject: 'مبہم جواب' };
const paper = () => ({ unseen: { objective: { MCQ: [JSON.parse(JSON.stringify(leakyMcq)), other('a'), other('b')] }, subjective: { SRQ: [JSON.parse(JSON.stringify(srq))] } } });
const ARGS = { grade: 8, subject: 'urdu', pageContent: 'p', pageReference: '1', contentSource: 'unseen', questionCount: 4, keySeed: 's',
  questionTypes: [{ id: 'mcq', count: 3, category: 'objective', name: 'MCQ' }, { id: 'srq', count: 1, category: 'subjective', name: 'SRQ' }] };
beforeEach(() => mockCreate.mockReset());

it('a rewrite that still prints the leaked phrase ends with no cross-leak on the shipped paper', async () => {
  const stillLeaks = reply({ items: [{ n: 1, question: 'آغاز کیسے ہوا؟', options: leakyMcq.options, answer: leakyMcq.answer }] });
  mockCreate.mockResolvedValueOnce(reply(paper())).mockResolvedValueOnce(reply({ items: [] }))
    .mockResolvedValueOnce(stillLeaks).mockResolvedValueOnce(stillLeaks);
  const out = await Svc.generateExam(ARGS);
  expect(C.paperIssues(out.examJson, { grade: 8 }).filter((i) => i.check === 'cross-leak')).toEqual([]);
  expect(out.droppedLeaks).toHaveLength(1);
  expect(out.questionCount).toBe(3);
});

it('reports the type mix it converted against the request', async () => {
  mockCreate.mockResolvedValueOnce(reply(paper())).mockResolvedValueOnce(reply({ items: [] }));
  const out = await Svc.generateExam({ ...ARGS, grade: 7, subject: 'general_science', questionCount: 20,
    questionTypes: [{ id: 'mcq', count: 7, category: 'objective', name: 'MCQ' }, { id: 'srq', count: 7, category: 'subjective', name: 'SRQ' }, { id: 'erq', count: 6, category: 'subjective', name: 'ERQ' }] });
  expect(out.typeShortfall.map((t) => t.id)).toEqual(['erq']);
});
