'use strict';
/**
 * PLAN_R5 D4 — a question with more than one right answer.
 *
 * The operator, after his own staging run: "In questions where one can select
 * multiple options, there can be a flow that pops up that asks the students to
 * select all options that apply? ... This is true for all types of questions,
 * picture or no picture."
 *
 * Nothing authored, stored, rendered or scored a set before this. These tests
 * cover the four seams where a set can silently collapse back to a single
 * answer: the validator, the row, the message the child receives, and the
 * teacher's own copy of the answer key.
 *
 * Every fixture here is invented — the repo is public and no real transcript
 * text, name or number appears in a test.
 */

const Multi = require('../../bot/shared/services/quiz/transcript-quiz-multi');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { toRows } = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const render = require('../../bot/shared/services/quiz/video-quiz-render.service');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');

const DIGEST = {
  subject: 'science',
  slos: [
    { id: 'S1', taught_level: 'recall', evidence_quote: '' },
    { id: 'S2', taught_level: 'understand', evidence_quote: '' },
  ],
};

/** An ordinary one-answer question, exactly the shape the author returns today. */
function single(i, over = {}) {
  return {
    slo_id: i === 0 ? 'S1' : 'S2',
    level: 'recall',
    question: `What did we call shape number ${i}?`,
    options: [`Square ${i}`, `Circle ${i}`, `Triangle ${i}`],
    correct_index: 0,
    explanation: 'A square has four equal sides.',
    selected_because: 'the shapes drawn on the board',
    distractor_misconceptions: { 1: 'counts curves as sides', 2: 'counts three sides' },
    option_feedback: {
      correct: 'Yes — four equal sides makes a square.',
      wrong: { 1: 'A circle has no sides at all.', 2: 'A triangle has three, not four.' },
    },
    figure: null,
    figure_role: null,
    ...over,
  };
}

/** A "select all that apply" question. */
function multi(over = {}) {
  return {
    slo_id: 'S2',
    level: 'understand',
    question: 'Which of these shapes have four sides?',
    options: ['Square', 'Circle', 'Rectangle', 'Triangle'],
    answer_mode: 'multi',
    correct_indices: [0, 2],
    explanation: 'A square and a rectangle both have four sides.',
    selected_because: 'the paper shapes held up one by one',
    distractor_misconceptions: { 1: 'thinks a curve counts as a side', 3: 'counts three sides as four' },
    option_feedback: {
      correct: 'Both of those have four sides.',
      wrong: { 1: 'A circle has no straight sides.', 3: 'A triangle has three sides.' },
    },
    figure: null,
    figure_role: null,
    ...over,
  };
}

/** Six questions, the second of which is the multi one (question 1 never is). */
function quizWithMulti(over = {}) {
  // Three of the six are tagged "understand": PEDAGOGY_LEVEL_MIX asks for at
  // least half the set above bare recall, so a fixture that stands for a valid
  // quiz has to be one. Both carry slo_id S2, which the digest above says was
  // taught at "understand", so the 60%-at-or-below rule is untouched.
  const qs = [single(0), multi(over), single(2), single(3),
    single(4, { level: 'understand' }), single(5, { level: 'understand' })];
  return qs;
}

const CTX = { language: 'en', subject: 'science', digest: DIGEST, nExpected: 6, lessonSummary: 'Today you taught the four-sided shapes with paper cut-outs, then compared them to a circle and a triangle.' };

describe('the validator understands a set answer', () => {
  test('a well-formed multi question passes', () => {
    const v = validate(quizWithMulti(), CTX);
    expect(v.errors.filter((e) => /^q1:/.test(e))).toEqual([]);
    expect(v.ok).toBe(true);
  });

  test('one correct option is not a set', () => {
    const v = validate(quizWithMulti({ correct_indices: [0], option_feedback: { correct: 'x', wrong: { 1: 'a', 2: 'b', 3: 'c' } } }), CTX);
    expect(v.errors.join('\n')).toMatch(/q1: MULTI_TOO_FEW_CORRECT/);
    expect(v.ok).toBe(false);
  });

  test('every option correct is not a question', () => {
    const v = validate(quizWithMulti({ correct_indices: [0, 1, 2, 3], option_feedback: { correct: 'x', wrong: {} } }), CTX);
    expect(v.errors.join('\n')).toMatch(/q1: MULTI_ALL_CORRECT/);
  });

  test('a checkbox label longer than the Meta cap is rejected, not truncated', () => {
    const long = 'A shape with four straight sides of the same length';
    const v = validate(quizWithMulti({ options: ['Square', 'Circle', long, 'Triangle'], correct_indices: [0, 2] }), CTX);
    expect(v.errors.join('\n')).toMatch(/q1: MULTI_OPTION_LONG/);
  });

  test('the model may not write its own "select all that apply" cue', () => {
    const v = validate(quizWithMulti({ question: 'Which shapes have four sides? Select all that apply.' }), CTX);
    expect(v.errors.join('\n')).toMatch(/q1: MULTI_STEM_CUE/);
  });

  test('wrong-feedback keys must be exactly the wrong options', () => {
    const v = validate(quizWithMulti({ option_feedback: { correct: 'x', wrong: { 1: 'a' } } }), CTX);
    expect(v.errors.join('\n')).toMatch(/q1: MULTI_FEEDBACK_KEYS/);
  });

  test('question 1 is never a set question', () => {
    const qs = [multi(), single(1), single(2), single(3), single(4), single(5)];
    const v = validate(qs, { ...CTX });
    expect(v.errors.join('\n')).toMatch(/MULTI_FIRST/);
  });

  test('at most two set questions in a quiz', () => {
    const qs = [single(0), multi(), multi(), multi(), single(4), single(5)];
    const v = validate(qs, CTX);
    expect(v.errors.join('\n')).toMatch(/MULTI_SHARE/);
  });

  test('an answer_mode we do not serve is rejected rather than stored as single', () => {
    const v = validate(quizWithMulti({ answer_mode: 'ranked' }), CTX);
    expect(v.errors.join('\n')).toMatch(/q1: MULTI_MODE/);
  });

  test('a single-answer quiz is validated exactly as before', () => {
    // Same level mix as quizWithMulti() above, for the same reason.
    const qs = [single(0), single(1, { level: 'understand' }), single(2), single(3),
      single(4, { level: 'understand' }), single(5, { level: 'understand' })];
    const v = validate(qs, CTX);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });
});

describe('the row carries the set', () => {
  const seq = () => { let k = 0; const vals = [0, 0, 0, 0]; return () => vals[k++ % vals.length]; };

  test('a four-option set question stores option_d, a joined answer key and the mode', () => {
    const rows = toRows('quiz-1', quizWithMulti(), { rng: seq() });
    const row = rows[1];
    expect(row.option_d).toBeTruthy();
    expect([row.option_a, row.option_b, row.option_c, row.option_d].sort())
      .toEqual(['Circle', 'Rectangle', 'Square', 'Triangle']);
    expect(row.correct_option.split(',')).toHaveLength(2);
    expect(row.media.answer_mode).toBe('multi');
    // The stored letters name the SHUFFLED positions of the authored correct
    // options — the shuffle must not be able to move the answer key.
    const stored = [row.option_a, row.option_b, row.option_c, row.option_d];
    const namedCorrect = Multi.indicesFor(row.correct_option).map((i) => stored[i]).sort();
    expect(namedCorrect).toEqual(['Rectangle', 'Square']);
  });

  test('a single-answer row is unchanged: three options, one letter, no answer_mode', () => {
    const rows = toRows('quiz-1', quizWithMulti(), { rng: seq() });
    const row = rows[0];
    expect(row.option_d == null).toBe(true);
    expect(row.correct_option).toMatch(/^[ABC]$/);
    expect(row.media && row.media.answer_mode).toBeUndefined();
  });

  test('per-option feedback and misconceptions follow the shuffle on a set question', () => {
    const rows = toRows('quiz-1', quizWithMulti(), { rng: seq() });
    const row = rows[1];
    const stored = [row.option_a, row.option_b, row.option_c, row.option_d];
    const correct = new Set(Multi.indicesFor(row.correct_option));
    Object.entries(row.option_feedback.wrong).forEach(([k, text]) => {
      const i = Number(k);
      expect(correct.has(i)).toBe(false);
      if (stored[i] === 'Circle') expect(text).toMatch(/no straight sides/);
      if (stored[i] === 'Triangle') expect(text).toMatch(/three sides/);
    });
    expect(Object.keys(row.option_feedback.wrong)).toHaveLength(2);
  });
});

describe('what the child is sent', () => {
  function row(over = {}) {
    return {
      id: 'q-multi', external_id: 'tq:z1:S2:2',
      question_text: 'Which of these shapes have four sides?',
      option_a: 'Square', option_b: 'Circle', option_c: 'Rectangle', option_d: 'Triangle',
      correct_option: 'A,C',
      explanation: 'A square and a rectangle both have four sides.',
      option_feedback: { correct: 'Both of those have four sides.', wrong: { 1: 'A circle has no straight sides.', 3: 'A triangle has three sides.' } },
      media: { answer_mode: 'multi', language: 'en' },
      render_pattern: 'P1',
      ...over,
    };
  }

  test('render.build emits ONE flow message, not a single-select picker', () => {
    const msgs = render.build(row());
    const kinds = msgs.map((m) => m.kind);
    expect(kinds).toContain('multiflow');
    expect(kinds).not.toContain('buttons');
    expect(kinds).not.toContain('list');
    const ask = msgs.find((m) => m.kind === 'multiflow');
    expect(ask.phase).toBe('interaction');
    expect(ask.role).toBe('ask');
    expect(ask.options).toHaveLength(4);
    expect(ask.optionIndices.slice().sort()).toEqual([0, 1, 2, 3]);
  });

  test('the "select all that apply" cue is added by us, in the quiz language', () => {
    const en = render.build(row()).find((m) => m.kind === 'multiflow');
    expect(en.body).toContain('Select all that apply.');
    const ur = render.build(row({ media: { answer_mode: 'multi', language: 'ur' } })).find((m) => m.kind === 'multiflow');
    expect(ur.body).toContain('سب درست جواب چنیں۔');
    expect(ur.body).not.toContain('Select all that apply');
  });

  test('the persisted display order wins over the seeded shuffle (D1)', () => {
    const msgs = render.build(row({ media: { answer_mode: 'multi', language: 'en', display_order: [3, 0, 2, 1] } }));
    const ask = msgs.find((m) => m.kind === 'multiflow');
    expect(ask.optionIndices).toEqual([3, 0, 2, 1]);
    expect(ask.options).toEqual(['Triangle', 'Square', 'Rectangle', 'Circle']);
  });

  test('the picture rides on the Flow, and is not also sent as its own message', () => {
    const msgs = render.build(row({ media: { answer_mode: 'multi', language: 'en', question_card: 'https://example.test/card.png' } }));
    expect(msgs.filter((m) => m.kind === 'image')).toHaveLength(0);
    expect(msgs.find((m) => m.kind === 'multiflow').headerImage).toBe('https://example.test/card.png');
  });

  test('the Flow payload never tells the child how many answers are right', () => {
    const ask = render.build(row()).find((m) => m.kind === 'multiflow');
    const p = Multi.flowPayload(ask, { sessionId: 's1', questionId: 'q-multi', language: 'en' });
    // Nothing in the payload counts the answer key, and nothing constrains how
    // many boxes may be ticked — a maximum equal to the key's size would be the
    // question's answer, and Meta prints an untranslatable English helper line
    // from one anyway.
    expect(p.screenData).not.toHaveProperty('max_selected');
    expect(JSON.stringify(p.screenData)).not.toContain('correct');
    // Only the fields the PICK screen declares; an undeclared key is a rejected
    // send, not an ignored one.
    const declared = Object.keys(require('../../docs/flows/quiz-multi-select-flow.json').screens[0].data);
    expect(Object.keys(p.screenData).sort()).toEqual(declared.sort());
    expect(p.screenData.options.map((o) => o.id)).toEqual(ask.optionIndices.map(String));
    expect(p.flowToken).toBe('vqm:s1:q-multi');
    expect(p.screenData.answer_token).toBe('vqm:s1:q-multi');
  });

  test('an ordinary question is still built exactly as before', () => {
    const plain = row({ media: { language: 'en' }, correct_option: 'A', option_d: null });
    const msgs = render.build(plain);
    expect(msgs.map((m) => m.kind)).not.toContain('multiflow');
    expect(msgs.some((m) => m.role === 'ask')).toBe(true);
  });
});

describe('reading the reply and scoring it', () => {
  const KEY = [0, 2];

  test('exact set is right; partial and superset are not', () => {
    expect(Multi.scoreSet([0, 2], KEY).isCorrect).toBe(true);
    expect(Multi.scoreSet([2, 0], KEY).isCorrect).toBe(true);
    expect(Multi.scoreSet([0], KEY)).toMatchObject({ isCorrect: false, missed: [2], extra: [] });
    expect(Multi.scoreSet([0, 1, 2], KEY)).toMatchObject({ isCorrect: false, missed: [], extra: [1] });
    expect(Multi.scoreSet([1, 3], KEY)).toMatchObject({ isCorrect: false, missed: [0, 2], extra: [1, 3] });
  });

  test('the reply parses from the token, from the payload token, and from a stringified array', () => {
    expect(Multi.parseFlowReply('vqm:s1:q9', { picks: ['0', '2'] }))
      .toEqual({ sessionId: 's1', questionId: 'q9', indices: [0, 2] });
    expect(Multi.parseFlowReply('', { answer_token: 'vqm:s1:q9', picks: '["2","0"]' }))
      .toEqual({ sessionId: 's1', questionId: 'q9', indices: [0, 2] });
    expect(Multi.parseFlowReply('vqm:s1:q9', { picks: '0,2' }))
      .toEqual({ sessionId: 's1', questionId: 'q9', indices: [0, 2] });
  });

  test('a reply that is not ours is left alone', () => {
    expect(Multi.parseFlowReply('vq:s1:q9', { picks: ['0'] })).toBeNull();
    expect(Multi.parseFlowReply('coach-1', { absent_students: [] })).toBeNull();
  });

  test('the verdict names what was missed and what did not belong, in both languages', () => {
    const q = {
      correct_option: 'A,C', option_a: 'Square', option_b: 'Circle', option_c: 'Rectangle', option_d: 'Triangle',
      option_feedback: { correct: 'Both of those have four sides.', wrong: { 1: 'A circle has no straight sides.' } },
      explanation: 'Four sides makes it a quadrilateral.',
    };
    const labels = ['Square', 'Circle', 'Rectangle', 'Triangle'];
    const right = Multi.verdictText(q, { selectedIndices: [0, 2], labels, language: 'en' });
    expect(right.isCorrect).toBe(true);
    expect(right.text).toContain('Both of those have four sides.');

    const partial = Multi.verdictText(q, { selectedIndices: [0], labels, language: 'en' });
    expect(partial.isCorrect).toBe(false);
    expect(partial.text).toContain('Rectangle');            // names what was missed
    expect(partial.text).toContain('You missed');

    const superset = Multi.verdictText(q, { selectedIndices: [0, 1, 2], labels, language: 'en' });
    expect(superset.isCorrect).toBe(false);
    expect(superset.text).toContain('A circle has no straight sides.');

    const ur = Multi.verdictText({ ...q, option_feedback: { correct: '', wrong: {} } },
      { selectedIndices: [0], labels, language: 'ur' });
    expect(/[؀-ۿ]/.test(ur.text)).toBe(true);
    expect(ur.text).not.toMatch(/Not quite|You missed/);
  });

  /**
   * D2's ✅/❌ has exactly one implementation — video-quiz-render's
   * withVerdictMark, which also decides when an RTL mark is needed after the
   * emoji. This module must not grow a second one: two would double the marker.
   */
  test('the multi module never prepends a marker itself', () => {
    const q = {
      correct_option: 'A,C', option_a: 'Square', option_b: 'Circle', option_c: 'Rectangle', option_d: 'Triangle',
      option_feedback: { correct: '', wrong: {} }, explanation: '',
    };
    const labels = ['Square', 'Circle', 'Rectangle', 'Triangle'];
    for (const language of ['en', 'ur']) {
      for (const picked of [[0, 2], [0], [0, 1, 2]]) {
        const v = Multi.verdictText(q, { selectedIndices: picked, labels, language });
        expect(v.text).not.toMatch(/[\u2705\u274C]/);
      }
    }
    expect(Multi.withMarker).toBeUndefined();
  });
});

describe('the author is only asked for what we can deliver', () => {
  test('no multi contract in the prompt when the Flow is not configured', () => {
    const p = buildAuthorPrompt({ digest: DIGEST, excerpts: '', language: 'en', n: 8, allowMulti: false });
    expect(p).not.toMatch(/answer_mode/);
  });

  test('the contract appears, with its caps, when the Flow is configured', () => {
    const p = buildAuthorPrompt({ digest: DIGEST, excerpts: '', language: 'en', n: 8, allowMulti: true });
    expect(p).toMatch(/"answer_mode": "multi"/);
    expect(p).toMatch(/correct_indices/);
    expect(p).toMatch(/at most 30 characters/);
    expect(p).toMatch(/question 1 never may/);
  });
});

describe('the question card knows it is a set question', () => {
  const Card = require('../../bot/shared/services/quiz/transcript-quiz-card');
  const { renderCards } = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

  test('renderCards tells the card its answer mode, and passes the persisted order', async () => {
    const seen = [];
    jest.spyOn(Card, 'renderQuestionCardPng').mockImplementation(async (d) => { seen.push(d); return Buffer.from('png'); });
    jest.spyOn(Card, 'uploadCard').mockResolvedValue('https://example.test/card.png');
    jest.spyOn(Card, 'needsQuestionCard').mockReturnValue(true);
    const rows = [
      {
        question_text: 'Which have four sides?',
        option_a: 'Square', option_b: 'Circle', option_c: 'Rectangle', option_d: 'Triangle',
        correct_option: 'A,C', external_id: 'tq:z:S2:1',
        media: { answer_mode: 'multi', display_order: [2, 0, 3, 1] },
      },
      {
        question_text: 'What is a square?',
        option_a: 'Four sides', option_b: 'Three sides', option_c: 'No sides',
        correct_option: 'A', external_id: 'tq:z:S1:2', media: {},
      },
    ];
    await renderCards({ rows, questions: [{}, {}], language: 'en', teacherId: 't1', quizId: 'z1' });
    const multiCard = seen.find((d) => d.stem === 'Which have four sides?');
    expect(multiCard.answerMode).toBe('multi');
    expect(multiCard.displayOrder).toEqual([2, 0, 3, 1]);
    const singleCard = seen.find((d) => d.stem === 'What is a square?');
    expect(singleCard.answerMode).toBe('single');
    jest.restoreAllMocks();
  });
});
