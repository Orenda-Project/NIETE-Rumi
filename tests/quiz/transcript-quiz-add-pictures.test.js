'use strict';
/**
 * ADD PICTURES — the one targeted rewrite that is ALLOWED to add a figure.
 *
 * Every other rewrite is text-only ("NO NEW PICTURES", and a replacement that
 * carries a figure is thrown away). A grade 1-5 maths quiz that came back with
 * too few pictures gets ONE call that adds a picture to the questions best
 * suited to one. What the model may change is asserted in code, not left to
 * the prompt: the options, their order and the key never change; only the
 * stem (to point at the picture), the figure and its role are taken.
 *
 * The call goes through the real LLM wrapper; only `llm-client` is mocked.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const Rw = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');

const DIGEST = {
  subject: 'maths', grade_band: '1-2', topic_as_taught: 'Adding within 10',
  slos: [{ id: 'S1', statement: 'add two numbers within 10', taught_level: 'understand' }],
  examples_used: ['3 + 4 with counters'],
};
const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.002 } });

function q(i, over = {}) {
  return {
    slo_id: 'S1', level: 'understand', question: `What is ${i} + 4?`,
    options: [String(i + 4), String(i + 3), String(i + 5)], correct_index: 0,
    explanation: `${i} and 4 more make ${i + 4}.`,
    distractor_misconceptions: { 1: 'counts one too few', 2: 'counts one too many' },
    option_feedback: { correct: 'Yes.', wrong: { 1: 'Count again.', 2: 'Count again.' } },
    ...over,
  };
}
const QUIZ = [
  q(1, { level: 'recall', question: 'Which of these is a number?', options: ['7', 'cat', 'red'] }),
  q(2),
  q(3, { figure: { type: 'count_objects', picto: 'counter', count: 6 }, figure_role: 'count_compare', question: 'How many counters are in the picture?', options: ['6', '5', '7'] }),
  q(4, { question: 'Which word means putting together?', options: ['add', 'take away', 'share'], level: 'recall' }),
  q(5),
  q(6, { answer_mode: 'multi', correct_indices: [0, 1], options: ['2 + 4', '3 + 3', '1 + 1'] }),
  q(7, { question: 'Subtract: $\\begin{array}{rr} & 45 \\\\ - & 13 \\\\ \\hline & \\end{array}$', options: ['32', '58', '31'] }),
  q(8),
];

beforeEach(() => { mockCreate.mockReset(); });

describe('pictureCandidates — which questions a picture helps most', () => {
  test('never a question that has a figure, a select-all question or a column sum', () => {
    const c = Rw.pictureCandidates(QUIZ);
    expect(c).not.toContain(2);
    expect(c).not.toContain(5);
    expect(c).not.toContain(6);
  });

  test('an Urdu "which is larger" question ranks above the easy first question', () => {
    const ur = [
      q(0, { level: 'recall', question: 'ان میں سے کس fraction کا denominator 5 ہے؟', options: ['$\\frac{3}{5}$', '$\\frac{5}{8}$', '$\\frac{2}{3}$'] }),
      q(1, { level: 'apply', question: 'کون سا بڑا ہے، $\\frac{2}{3}$ یا $\\frac{3}{5}$؟', options: ['$\\frac{2}{3}$', '$\\frac{3}{5}$', 'دونوں برابر ہیں'] }),
      q(2, { level: 'apply', question: 'ان تین fractions کو ترتیب میں لکھیں: $\\frac{1}{2}$، $\\frac{1}{3}$', options: ['a', 'b', 'c'] }),
    ];
    const c = Rw.pictureCandidates(ur);
    expect(c.indexOf(1)).toBeLessThan(c.indexOf(0));
    expect(c.indexOf(2)).toBeLessThan(c.indexOf(0));
  });

  test('a sum with numbers ranks above a vocabulary question', () => {
    const c = Rw.pictureCandidates(QUIZ);
    expect(c.indexOf(1)).toBeLessThan(c.indexOf(3));
    expect(c.length).toBeLessThanOrEqual(5);
  });
});

describe('mergeAddedPictures — what the model may change, asserted in code', () => {
  const figure = { type: 'count_objects', rows: [{ picto: 'counter', count: 2 }, { picto: 'counter', count: 4 }] };

  test('takes the figure, its role and a stem that points at the picture; keeps everything else', () => {
    const m = Rw.mergeAddedPictures(QUIZ, { pictures: [{ index: 1, figure, figure_role: 'model', question: 'What is 2 + 4? Use the counters.' }] }, { indices: [1, 4, 7], need: 2 });
    expect(m.added).toEqual([1]);
    expect(m.questions[1]).toMatchObject({ figure, figure_role: 'model', question: 'What is 2 + 4? Use the counters.' });
    expect(m.questions[1].options).toEqual(QUIZ[1].options);
    expect(m.questions[1].explanation).toBe(QUIZ[1].explanation);
    expect(m.questions[0]).toBe(QUIZ[0]);
  });

  test('a picture that changes the options, the key or arrives without a figure is discarded', () => {
    const m = Rw.mergeAddedPictures(QUIZ, {
      pictures: [
        { index: 1, figure, figure_role: 'model', options: ['6', '5', '8'] },
        { index: 4, figure, figure_role: 'model', correct_index: 2 },
        { index: 7, question: 'What is 8 + 4?' },
      ],
    }, { indices: [1, 4, 7], need: 3 });
    expect(m).toBeNull();
  });

  test('never more than asked for, never outside the candidates, never twice', () => {
    const m = Rw.mergeAddedPictures(QUIZ, {
      pictures: [
        { index: 0, figure, figure_role: 'model' },
        { index: 1, figure, figure_role: 'model' },
        { index: 1, figure, figure_role: 'read_off' },
        { index: 4, figure, figure_role: 'model' },
        { index: 7, figure, figure_role: 'model' },
      ],
    }, { indices: [1, 4, 7], need: 2 });
    expect(m.added).toEqual([1, 4]);
    expect(m.questions[7].figure).toBeUndefined();
  });
});

describe('addPictures — ONE call through the real LLM wrapper', () => {
  test('asks for exactly the pictures needed, on the candidates, with the lesson\'s own manipulatives', async () => {
    mockCreate.mockResolvedValueOnce(reply({ pictures: [
      { index: 1, figure: { type: 'count_objects', rows: [{ picto: 'counter', count: 2 }, { picto: 'counter', count: 4 }] }, figure_role: 'model' },
    ] }));
    const out = await Rw.addPictures({
      questions: QUIZ, digest: DIGEST, language: 'en', gradeBand: '1-2', need: 1,
      lessonDrew: 'WHAT THE LESSON DREW — …\n- counter → "picto":"counter" in count_objects',
    });
    expect(out).toMatchObject({ attempted: true, added: [1] });
    expect(out.merged[1].figure.type).toBe('count_objects');
    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/exactly 1 of/);
    expect(prompt).toMatch(/WHAT THE LESSON DREW/);
    expect(prompt).toMatch(/"figure_role":"model"/);
    expect(prompt).toMatch(/- base_ten — /);
    expect(prompt).toMatch(/must NOT contain the answer/);
    expect(prompt).toMatch(/q1 /);
    expect(prompt).not.toMatch(/q2 /);   // it already has a picture
  });

  test('an Urdu quiz is asked in its language, and a failed call is a repair that did not happen', async () => {
    mockCreate.mockRejectedValueOnce(new Error('provider down'));
    const out = await Rw.addPictures({ questions: QUIZ, digest: DIGEST, language: 'ur', gradeBand: '1-2', need: 2 });
    expect(out).toMatchObject({ attempted: true, merged: null, added: [] });
    expect(mockCreate.mock.calls[0][0].messages[0].content).toMatch(/Urdu/);
  });

  test('nothing to add, or nothing to add it to, is no call at all', async () => {
    expect(await Rw.addPictures({ questions: QUIZ, digest: DIGEST, language: 'en', gradeBand: '1-2', need: 0 })).toMatchObject({ attempted: false });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
