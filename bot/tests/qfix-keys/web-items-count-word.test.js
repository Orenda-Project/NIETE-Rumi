'use strict';
/**
 * An order (or match) web item whose stem names how many things there are must have that many cards.
 *
 * In production an Urdu order item asked a child to put «the four steps» of finding an answer in order and gave three
 * cards: the lesson's four steps with one missing. A child who knew the lesson looked for a card that was not there.
 * The web item is now not built when its stem states a count (a number WORD next to a counted noun: "four steps",
 * «چار قدموں») that differs from the number of cards; the stored MCQ plays instead, as for any web item that fails a
 * check. Digits are never counted: they are the maths in the stem ("13.75 × 5.5").
 *
 * Runs the real attachWebItems (and every first-party gate in normaliseItem); only the model call is mocked.
 * Invented fixtures.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const W = require('../../shared/services/quiz/web-quiz-items');

/** The rule's own module; required inside the tests so a missing module fails those tests, not the file. */
const Count = () => require('../../shared/services/quiz/quiz-stem-count');

// ── an Urdu lesson-plan item (the production shape: the lesson's four steps, three cards) ──
const UR_LP = [
  '## THE KEY FACT THE LESSON TURNS ON',
  'چار قدم: سوال پڑھیں، سطر ڈھونڈیں، جواب چنیں، سطر دکھائیں۔',
  '## We Do',
  'بچے جوڑوں میں ایک سوال پڑھ کر اس کی سطر ڈھونڈتے ہیں۔',
].join('\n');
const UR_ROW = {
  question_text: 'سوال کا جواب ڈھونڈنے کے چار قدموں میں سے پہلا قدم کون سا ہے؟',
  option_a: 'سطر ڈھونڈیں', option_b: 'سوال پڑھیں', option_c: 'جواب چنیں', correct_option: 'B',
  explanation: 'سبق میں سکھائے گئے چار قدموں میں سے پہلا قدم سوال پڑھنا ہے۔',
  option_feedback: { correct: 'صحیح جواب! پہلا قدم سوال کو غور سے پڑھنا ہے۔', wrong: { 0: 'سطر ڈھونڈنا دوسرا قدم ہے۔', 2: 'جواب چننا تیسرا قدم ہے۔' } },
  media: {}, render_pattern: 'P1', external_id: 'tq:q:S2:5',
};
const UR_FOUR_STEPS_STEM = 'سوال کا جواب ڈھونڈنے کے چار قدموں کو صحیح ترتیب میں لگائیں۔';
const UR_ORDER = {
  q: 1, type: 'order', stem: UR_FOUR_STEPS_STEM,
  options: [{ text: 'جواب چنیں' }, { text: 'سوال پڑھیں' }, { text: 'سطر ڈھونڈیں' }], key: 'B,C,A',
  why: 'سبق میں سکھائے گئے قدموں کی صحیح ترتیب ہے: سوال پڑھیں، سطر ڈھونڈیں، جواب چنیں۔',
  source_quote: 'چار قدم: سوال پڑھیں، سطر ڈھونڈیں، جواب چنیں، سطر دکھائیں۔',
};
const UR_CTX = { language: 'ur', source: { kind: 'lesson_plan', text: UR_LP }, gradeBand: '3-5', subject: 'urdu', quizId: 'q-ur' };

// ── English transcript items ──
const TRANSCRIPT = [
  '[00:10] Teacher: Today we will learn how a plant grows.',
  '[07:05] Teacher: First the seed is planted, then it grows roots, then a shoot comes out, and at last we get leaves.',
  '[11:00] Teacher: To multiply 13.75 by 5.5, first ignore the decimal points, then multiply the numbers, then count the decimal places, then put the point back.',
].join('\n');
const row = (over = {}) => ({
  question_text: 'What comes first when a plant grows?', option_a: 'leaves come', option_b: 'seed is planted', option_c: 'roots grow',
  correct_option: 'B', explanation: 'The seed is planted first.',
  option_feedback: { correct: 'Yes, the seed comes first.', wrong: { 0: 'Leaves come last.', 2: 'Roots come after the seed.' } },
  media: {}, render_pattern: 'P1', external_id: 'tq:q:S1:2', ...over,
});
const PLANT = {
  type: 'order', options: [{ text: 'leaves come' }, { text: 'seed is planted' }, { text: 'roots grow' }, { text: 'a shoot comes out' }],
  key: 'B,C,D,A', why: 'A plant grows from the seed up: roots first, leaves last.',
  source_quote: 'First the seed is planted, then it grows roots, then a shoot comes out',
};
const MATHS = {
  type: 'order', stem: 'Put the steps in order for 13.75 × 5.5',
  options: [{ text: 'count the decimal places' }, { text: 'ignore the decimal points' }, { text: 'multiply the numbers' }, { text: 'put the point back' }],
  key: 'B,C,A,D', why: 'You multiply as whole numbers first, then put back as many decimal places as the numbers had.',
  source_quote: 'first ignore the decimal points, then multiply the numbers, then count the decimal places, then put the point back',
};
const EN_CTX = { language: 'en', source: { kind: 'transcript', text: TRANSCRIPT }, gradeBand: '3-5', subject: 'Science', quizId: 'q-en' };

/** attachWebItems with only the model's reply mocked. Question 1 (index 0) is never a new type, so the item is q:1. */
async function attach(rows, items, ctx) {
  const complete = jest.fn(async () => ({ json: { items }, costUsd: 0.001, latencyMs: 10, model: 'stub' }));
  return W.attachWebItems(rows, ctx, { complete });
}

describe('attachWebItems: an order item whose stem names a count its cards do not have is not attached', () => {
  test('Urdu: «…کے چار قدموں کو صحیح ترتیب میں لگائیں۔» with 3 cards is not attached; the row plays as its MCQ', async () => {
    const rows = [row(), UR_ROW];
    const out = await attach(rows, [UR_ORDER], UR_CTX);
    expect(out.rows[1].media.web).toBeUndefined();
    expect(out.rows[1]).toEqual(UR_ROW);
    expect(out.stats).toMatchObject({ attached: 0, dropped: { no_reply: 1, count_word: 1 } });
  });

  test('the same Urdu item with a fourth card (the count is right) is attached', async () => {
    const four = { ...UR_ORDER, options: [...UR_ORDER.options, { text: 'سطر دکھائیں' }], key: 'B,C,A,D' };
    const out = await attach([row(), UR_ROW], [four], UR_CTX);
    expect(out.rows[1].media.web).toMatchObject({ type: 'order', key: 'B,C,A,D' });
  });

  test('"Put these four steps in order" with 4 cards is attached', async () => {
    const out = await attach([row(), row()], [{ ...PLANT, q: 1, stem: 'Put these four steps in order.' }], EN_CTX);
    expect(out.rows[1].media.web).toMatchObject({ type: 'order', key: 'B,C,D,A', stem: 'Put these four steps in order.' });
  });

  test('"Put these three steps in order" with 4 cards is not attached', async () => {
    const out = await attach([row(), row()], [{ ...PLANT, q: 1, stem: 'Put these three steps in order.' }], EN_CTX);
    expect(out.rows[1].media.web).toBeUndefined();
    expect(out.stats.dropped).toEqual({ no_reply: 1, count_word: 1 }); // question 1 gets no reply: it plays as its row
  });

  test('a stem with no count word is attached', async () => {
    const out = await attach([row(), row()], [{ ...PLANT, q: 1, stem: 'Put the plant\'s growth in order.' }], EN_CTX);
    expect(out.rows[1].media.web).toMatchObject({ type: 'order', key: 'B,C,D,A' });
  });

  test('digits are never counted: "Put the steps in order for 13.75 × 5.5" is attached', async () => {
    const out = await attach([row(), row({ question_text: 'What do you do first to multiply 13.75 by 5.5?', option_a: 'count the decimal places', option_b: 'ignore the decimal points', option_c: 'put the point back', explanation: 'You ignore the decimal points first.' })],
      [{ ...MATHS, q: 1 }], EN_CTX);
    expect(out.rows[1].media.web).toMatchObject({ type: 'order', key: 'B,C,A,D', stem: MATHS.stem });
  });

  test('a match item whose stem names a count its pairs do not have is not attached; with the right count it is', async () => {
    const match = {
      q: 1, type: 'match', left: [{ text: 'seed' }, { text: 'roots' }, { text: 'leaves' }],
      options: [{ text: 'last' }, { text: 'first' }, { text: 'second' }], key: 'B,C,A',
      why: 'The seed is planted first, the roots grow next and the leaves come last.',
      source_quote: 'First the seed is planted, then it grows roots, then a shoot comes out',
    };
    const bad = await attach([row(), row()], [{ ...match, stem: 'Match the four parts of the plant to when they come.' }], EN_CTX);
    expect(bad.rows[1].media.web).toBeUndefined();
    expect(bad.stats.dropped).toEqual({ no_reply: 1, count_word: 1 });
    const good = await attach([row(), row()], [{ ...match, stem: 'Match the three parts of the plant to when they come.' }], EN_CTX);
    expect(good.rows[1].media.web).toMatchObject({ type: 'match', key: 'B,C,A' });
  });
});

describe('statedCount: a number word next to a counted noun, at most one word between', () => {
  test.each([
    ['Put these four steps in order.', 4],
    ['Put the five main events in order.', 5],
    ['Arrange the THREE sentences.', 3],
    ['Order the two cards', 2],
    ['Put the six stages of the water cycle in order.', 6],
    ['Match the seven words to their meanings.', 7],
    ['Put the steps in order.', null],
    ['Put the steps in order for 13.75 × 5.5', null],
    ['Put these 4 steps in order.', null],
    ['Put the four very short steps in order.', null],   // two words between: not a stated count
    ['Four friends shared the steps.', null],            // "four" counts friends, not a counted noun after it
    ['Order the items: two, three, four.', null],
    ['', null],
    [null, null],
  ])('%j -> %j', (stem, n) => {
    expect(Count().statedCount(stem)).toBe(n);
  });

  test.each([
    ['سوال کا جواب ڈھونڈنے کے چار قدموں کو صحیح ترتیب میں لگائیں۔', 4],
    ['ان تین جملوں کو ترتیب دیں۔', 3],
    ['کہانی کے پانچ اہم واقعات کو ترتیب میں لگائیں۔', 5],
    ['دو الفاظ کو ملائیں۔', 2],
    ['پودے کے اگنے کے مراحل کو ترتیب دیں۔', null],
    ['۴ قدموں کو ترتیب دیں۔', null],
    ['چھوٹے قدموں کو ترتیب دیں۔', null],                 // چھوٹے is not چھ
  ])('%j -> %j', (stem, n) => {
    expect(Count().statedCount(stem)).toBe(n);
  });

  test('mismatch: only a stated count that differs from the cards', () => {
    expect(Count().mismatch('Put these four steps in order.', 3)).toBe(true);
    expect(Count().mismatch('Put these four steps in order.', 4)).toBe(false);
    expect(Count().mismatch('Put the steps in order.', 3)).toBe(false);
    expect(Count().mismatch('Put the steps in order for 13.75 × 5.5', 4)).toBe(false);
  });
});
