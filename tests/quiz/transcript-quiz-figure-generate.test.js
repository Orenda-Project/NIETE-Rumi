'use strict';
/**
 * Picture questions through the generate step: render → upload → row.
 *
 * The two things that must never happen: a stored row whose
 * media.question_image points at an object that was never uploaded, and a
 * figure rendered twice (once to validate, once to store).
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-author.service', () => ({
  author: jest.fn(), excerptsFor: jest.fn().mockReturnValue('…'),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor', topic: 'Fractions' }),
  botNumber: jest.fn().mockReturnValue('923222482222'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
  htmlToImage: jest.fn(),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/templates/transcript-quiz-teacher.template', () => jest.fn(() => '<html></html>'));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { htmlToImage } = require('../../bot/shared/utils/html-to-pdf');
const { uploadBuffer } = require('../../bot/shared/storage/r2');
const teacherTemplate = require('../../bot/shared/templates/transcript-quiz-teacher.template');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const QID = '22222222-2222-4222-8222-222222222222';
const SID = '11111111-1111-4111-8111-111111111111';
const DIGEST = {
  topic: 'Fractions', topic_as_taught: 'Fractions', subject: 'maths', grade_band: '3-5',
  language_of_instruction: 'en', confidence: 0.9,
  slos: [{ id: 'S1', statement: 'read a fraction bar', taught_level: 'understand' }],
  key_terms: [], examples_used: [], misconceptions_surfaced: [],
};
const QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: 'Fractions', subject: 'maths',
  language: 'en', status: 'generating', meta: { digest: DIGEST, grade: '4', step: 'author' },
};
const SESSION = {
  id: SID, user_id: 'u-1', transcript_text: 'x'.repeat(3000), transcript_language: 'en',
  created_at: '2026-09-05T05:00:00Z', analysis_data: { topic: 'Fractions', subject: 'Maths' },
  users: { phone_number: '923001234567', preferred_language: 'en', first_name: 'Rifat', last_name: 'Noor' },
};
const FRACTION = { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] };

function q(i, over = {}) {
  return {
    slo_id: 'S1', level: 'understand',
    question: `Question ${i}: what fraction of the bar is shaded?`,
    options: [`one half ${i}`, `two thirds ${i}`, `three quarters ${i}`],
    correct_index: 2,
    explanation: 'Three of the four equal parts are shaded.',
    distractor_misconceptions: { 0: 'counted the unshaded parts', 1: 'counted the lines' },
    option_feedback: {
      correct: 'Yes — three of the four equal parts are shaded.',
      wrong: { 0: 'That counts the parts left over.', 1: 'That counts the dividing lines, not the parts.' },
    },
    ...over,
  };
}
/** Eight questions; the first two carry a figure (2/8 is under the half cap). */
const EIGHT = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => q(i, i < 2 ? { figure: FRACTION } : {}));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  htmlToImage.mockResolvedValue(Buffer.from('fake-png-bytes'));
  uploadBuffer.mockImplementation(async (buf, key) => `https://acct.r2.cloudflarestorage.com/bucket/${key}`);
});

function wire({ quiz = QUIZ } = {}) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    coaching_sessions: { data: [SESSION] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [SESSION.users] },
  }));
}
const insertedRows = () => supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert')[0][1];

describe('toRows', () => {
  test('a question with a figure becomes a P3 row carrying the image URL and the spec', () => {
    const rows = Gen.toRows(QID, [q(0, { figure: FRACTION }), q(1)], {
      rng: () => 0, figureUrls: { 0: 'https://r2/q0.png' },
    });
    expect(rows[0].render_pattern).toBe('P3');
    expect(rows[0].media).toEqual({ question_image: 'https://r2/q0.png', figure: FRACTION });
    expect(rows[1].render_pattern).toBe('P1');
    expect(rows[1].media).toBeUndefined();
  });

  test('with no figureUrls at all, every row is exactly what it was before', () => {
    const rows = Gen.toRows(QID, [q(0), q(1)], { rng: () => 0 });
    rows.forEach((r) => {
      expect(r.render_pattern).toBe('P1');
      expect(r.media).toBeUndefined();
    });
  });

  test('a figure with no uploaded URL never yields a row pointing at nothing', () => {
    const rows = Gen.toRows(QID, [q(0, { figure: FRACTION })], { rng: () => 0, figureUrls: {} });
    expect(rows[0].render_pattern).toBe('P1');
    expect(rows[0].media).toBeUndefined();
  });
});

describe('process — figures are rendered, uploaded, then stored', () => {
  test('one PNG and one upload per figure, and the stored rows are P3', async () => {
    Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 10 });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);

    expect(htmlToImage).toHaveBeenCalledTimes(2);
    // one object per figure (the third upload is the teacher PDF)
    expect(uploadBuffer.mock.calls.map((c) => c[1]).filter((k) => k.endsWith('.png'))).toEqual([
      `transcript_quizzes/u-1/${QID}/q0.png`,
      `transcript_quizzes/u-1/${QID}/q1.png`,
    ]);

    const rows = insertedRows();
    expect(rows.filter((x) => x.render_pattern === 'P3')).toHaveLength(2);
    expect(rows[0].media.question_image).toContain(`transcript_quizzes/u-1/${QID}/q0.png`);
    expect(rows[0].media.figure).toEqual(FRACTION);
    expect(rows[2].render_pattern).toBe('P1');
  });

  test('the SVG is rendered once — the validator\'s copy is reused, not redrawn', async () => {
    Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 10 });
    wire();
    await Gen.process(QID, {});
    // Each screenshot is handed one already-rendered SVG; the count matches the
    // number of figures, so nothing rendered a second time.
    expect(htmlToImage).toHaveBeenCalledTimes(2);
    htmlToImage.mock.calls.forEach(([html]) => expect(html).toMatch(/<svg/));
  });
});

describe('process — a figure that cannot be made fails the attempt', () => {
  test('retries once with the error text and stores no row pointing at nothing', async () => {
    htmlToImage.mockRejectedValue(new Error('browser died'));
    Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 10 });
    wire();
    const r = await Gen.process(QID, {});

    expect(r.failed).toBe(true);
    expect(Author.author).toHaveBeenCalledTimes(2);
    expect(Author.author.mock.calls[1][0].previousErrors.join(' ')).toMatch(/FIGURE_RENDER/);
    expect(supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert')).toHaveLength(0);
  });

  test('an upload failure is treated the same way', async () => {
    uploadBuffer.mockRejectedValue(new Error('R2 refused'));
    Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 10 });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.failed).toBe(true);
    expect(supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert')).toHaveLength(0);
  });
});

describe('the teacher PDF', () => {
  test('is handed the figure SVG per question, so the template can inline it', async () => {
    Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 10 });
    wire();
    await Gen.process(QID, {});
    const passed = teacherTemplate.mock.calls[0][0].questions;
    expect(passed[0].figureSvg).toMatch(/^<svg/);
    expect(passed[1].figureSvg).toMatch(/^<svg/);
    expect(passed[2].figureSvg).toBeUndefined();
  });
});

describe('process — after the last attempt, a bad PICTURE costs its question, not the whole quiz', () => {
  // Corpus round 3: on attempt 1 the validator rejected 9 of 13 figures (a stem
  // that restates the picture, a scene drawn with geometry, a leak). If attempt 2
  // trips one of those again, failing the whole quiz would send the teacher
  // "could not make it" over one picture. Drop that question when the rest
  // still make a valid quiz (>= 6, every SLO covered); fail only otherwise.
  test('a quiz whose only remaining error is one figure ships without that question', async () => {
    const leaky = { type: 'grid', rows: 3, cols: 4, shaded: 12 };
    const withLeak = EIGHT.map((x, i) => (i === 1
      ? { ...x, figure: leaky, question: 'Share 12 flowers among 3 vases. How many in each? See the picture.', options: ['4', '3', '12'], correct_index: 0,
          option_feedback: { correct: 'Yes.', wrong: { 1: 'no', 2: 'no' } } }
      : x));
    Author.author.mockResolvedValue({ questions: withLeak, model: 'm', costUsd: 0.01, latencyMs: 10 });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.failed).not.toBe(true);
    expect(Author.author).toHaveBeenCalledTimes(2);
    const rows = insertedRows();
    expect(rows).toHaveLength(7);
    expect(rows.some((row) => /flowers/.test(row.question_text))).toBe(false);
  });
});

describe('process — question cards and speed', () => {
  test('a question whose options do not fit a button is stored with a card image (rendered once, uploaded) and letters', async () => {
    const long = EIGHT.map((x, i) => (i === 3 ? { ...x, question: 'Which is water?', options: ['H2O', 'CO2', 'NaCl'], figure: undefined } : x));
    Author.author.mockResolvedValue({ questions: long, model: 'm', costUsd: 0.01, latencyMs: 10 });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rows = insertedRows();
    const card = rows.find((row) => row.media && row.media.question_card);
    expect(card).toBeDefined();
    expect(card.media.question_card).toMatch(/\/card4\.png$/);
    expect(card.media.language).toBe('en');
    expect(card.render_pattern).toBe('P1');
    expect(uploadBuffer.mock.calls.some((c) => /\/card\d+\.png$/.test(c[1]))).toBe(true);
  });
  test('figures and cards are rendered in parallel (not one after the other)', async () => {
    let inFlight = 0; let peak = 0;
    htmlToImage.mockImplementation(() => new Promise((res) => { inFlight += 1; peak = Math.max(peak, inFlight); setTimeout(() => { inFlight -= 1; res(Buffer.from('png')); }, 30); }));
    Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 10 });
    wire();
    await Gen.process(QID, {});
    expect(peak).toBeGreaterThan(1);
  });
});
