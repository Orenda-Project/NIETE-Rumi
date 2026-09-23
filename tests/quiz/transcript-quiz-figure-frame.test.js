'use strict';
/**
 * A picture question looks like every other question in the quiz.
 *
 * Render QA of the sandbox quizzes: a figure that does not need a whole
 * question CARD rides as the header of its answer buttons — and it arrived as a
 * bare 1080x565 white canvas with a small fraction bar in the middle. No
 * "Question n of 8", no NIETE mark: the one question in the quiz that did not
 * look like the quiz.
 *
 * Now the figure canvas carries the same chrome the question card does — the
 * counter at the start edge and the NIETE mark at the end, over the brand
 * lattice — inside the SAME 1080x565 frame (WhatsApp crops an image header to
 * about 1.91:1, and a canvas of exactly that shape is never cropped). The band
 * sits in what used to be padding, and the label-size gate measures the box the
 * drawing is actually given, from the same numbers.
 *
 * Because the picture now paints the counter, the body under it must not print
 * it again (the rule the question card already follows) — but only for a
 * picture that was drawn with one. A quiz stored before this change keeps its
 * text counter.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendImageWithButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendImageFromUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true), delete: jest.fn(),
  incr: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(true),
}));

const { htmlToImage } = require('../../bot/shared/utils/html-to-pdf');
const { uploadBuffer } = require('../../bot/shared/storage/r2');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const Gates = require('../../bot/shared/services/quiz/transcript-quiz-figure-gates');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const render = require('../../bot/shared/services/quiz/video-quiz-render.service');
const sender = require('../../bot/shared/services/quiz/video-quiz-sender.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const FRACTION = { type: 'fraction_bar', parts: 4, shaded: 3 };
const SVG = Figure.renderFigureSvg(FRACTION, 'en');
const plainCounter = (i, n, language) => resolveUx('vqQuestionOf', { language, params: { i, n } }).replace(/\*/g, '');

const q = (i, extra = {}) => ({
  slo_id: `S${i + 1}`, level: 'understand', question: `How much of the bar is shaded ${i}?`,
  options: ['3/4', '1/4', '4/3'], correct_index: 0, explanation: 'Three of four parts.',
  option_feedback: { correct: 'Yes.', wrong: { 1: 'No.', 2: 'No.' } }, ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  htmlToImage.mockResolvedValue(Buffer.from('png'));
  uploadBuffer.mockImplementation(async (_png, key) => `https://r2/${key}`);
});

describe('the figure canvas carries the quiz chrome', () => {
  test('English: the counter and the NIETE mark are painted, on the same 1080x565 canvas', () => {
    const html = Figure.figureHtml(SVG, 'en', { questionNumber: 6, total: 8 });
    const css = html.match(/\.fig\{([^}]*)\}/)[1];
    expect(css).toMatch(/width:1080px/);
    expect(css).toMatch(/height:565px/);
    expect(html).toContain(`<div class="counter">${plainCounter(6, 8, 'en')}</div>`);
    expect(html).toMatch(/<div class="mark"><img src="data:image\/png;base64,[A-Za-z0-9+/=]+"><\/div>/);
    expect(html).toContain('class="lattice"');
  });

  test('Urdu: the counter reads in Urdu and the band runs right-to-left (counter right, mark left)', () => {
    const html = Figure.figureHtml(SVG, 'ur', { questionNumber: 6, total: 8 });
    expect(html).toContain(`<div class="counter">${plainCounter(6, 8, 'ur')}</div>`);
    expect(html).toMatch(/<div class="top" dir="rtl">/);
    // The drawing itself stays left-to-right: a fraction bar is not mirrored.
    expect(html.match(/\.fig\{([^}]*)\}/)[1]).toMatch(/direction:ltr/);
  });

  test('the painted counter is the chat counter without its bold marks — one string, one number', () => {
    const html = Figure.figureHtml(SVG, 'en', { questionNumber: 3, total: 8 });
    expect(html).toContain('>Question 3 of 8<');
  });

  test('the drawing\'s box is the box the label gate measures', () => {
    expect(Gates.BOX_W).toBe(Figure.FIG_BOX.w);
    expect(Gates.BOX_H).toBe(Figure.FIG_BOX.h);
    const html = Figure.figureHtml(SVG, 'en', { questionNumber: 1, total: 8 });
    const box = html.match(/\.box\{([^}]*)\}/)[1];
    expect(box).toMatch(new RegExp(`width:${Figure.FIG_BOX.w}px`));
    expect(box).toMatch(new RegExp(`height:${Figure.FIG_BOX.h}px`));
    // The band costs the drawing no more than a sliver of its old 1016x493.
    expect(Figure.FIG_BOX.w).toBe(1016);
    expect(Figure.FIG_BOX.h).toBeGreaterThanOrEqual(480);
  });
});

describe('the generator draws every figure with its own number', () => {
  test('renderFigures hands the page its question number and the quiz total', async () => {
    const questions = [q(0), q(1, { figure: FRACTION }), q(2)];
    const urls = await Gen.renderFigures({ questions, language: 'en', teacherId: 't-1', quizId: 'quiz-1' });
    expect(Object.keys(urls)).toEqual(['1']);
    expect(htmlToImage).toHaveBeenCalledTimes(1);
    expect(htmlToImage.mock.calls[0][0]).toContain(`<div class="counter">${plainCounter(2, 3, 'en')}</div>`);
  });

  test('applyMedia records that the stored picture paints its own counter', () => {
    const questions = [q(0, { figure: FRACTION }), q(1)];
    const rows = Gen.applyMedia(Gen.toRows('quiz-1', questions, { rng: () => 0 }), questions, {
      figureUrls: { 0: 'https://r2/q0.png' }, language: 'en',
    });
    expect(rows[0].render_pattern).toBe('P3');
    expect(rows[0].media.question_image_paints_counter).toBe(true);
    expect(rows[1].media.question_image_paints_counter).toBeUndefined();
  });
});

describe('the child sees one number per question', () => {
  const row = (media) => ({
    id: 'q8', external_id: 'tq:quiz-1:S8:8', question_text: 'How much of the bar is shaded?',
    option_a: '3/4', option_b: '1/4', option_c: '4/3', correct_option: 'A',
    render_pattern: 'P3', media: { display_order: [0, 1, 2], language: 'en', ...media },
  });
  const ctx = { questionId: 'q8', sessionId: 's-1', language: 'en' };

  test('a framed picture: the button body is the stem alone, no second "Question 8 of 8"', async () => {
    const msgs = render.build(row({ question_image: 'https://r2/q7.png', question_image_paints_counter: true }),
      { questionNumber: 8, totalQuestions: 8 });
    const ask = msgs.find((m) => m.role === 'ask');
    expect(ask.paintsOwnCounter).toBe(true);
    expect(ask.counter).toBeUndefined();

    await sender.sendPhase('923001234567', msgs, 'interaction', ctx);
    const [, image, body] = WhatsAppService.sendImageWithButtons.mock.calls[0];
    expect(image).toBe('https://r2/q7.png');
    expect(body).toBe('How much of the bar is shaded?');
  });

  test('a "select all that apply" question with a framed picture: the Flow bubble does not repeat the number', () => {
    const multi = {
      ...row({ question_image: 'https://r2/q7.png', question_image_paints_counter: true, answer_mode: 'multi' }),
      option_d: '2/4', correct_option: 'A,D', render_pattern: 'P3',
    };
    multi.media.display_order = [0, 1, 2, 3];
    const ask = render.build(multi, { questionNumber: 8, totalQuestions: 8 }).find((m) => m.role === 'ask');
    expect(ask.kind).toBe('multiflow');
    expect(ask.headerImage).toBe('https://r2/q7.png');
    expect(ask.paintsOwnCounter).toBe(true);
    expect(ask.counter).toBeUndefined();
  });

  test('a "select all that apply" question with an older, unframed picture keeps its counter', () => {
    const multi = {
      ...row({ question_image: 'https://r2/q7.png', answer_mode: 'multi' }),
      option_d: '2/4', correct_option: 'A,D', render_pattern: 'P3',
    };
    multi.media.display_order = [0, 1, 2, 3];
    const ask = render.build(multi, { questionNumber: 8, totalQuestions: 8 }).find((m) => m.role === 'ask');
    expect(ask.counter).toEqual({ i: 8, n: 8 });
  });

  test('a picture stored before the frame existed still gets its counter in the body', async () => {
    const msgs = render.build(row({ question_image: 'https://r2/q7.png' }), { questionNumber: 8, totalQuestions: 8 });
    const ask = msgs.find((m) => m.role === 'ask');
    expect(ask.counter).toEqual({ i: 8, n: 8 });
    await sender.sendPhase('923001234567', msgs, 'interaction', ctx);
    const [, , body] = WhatsAppService.sendImageWithButtons.mock.calls[0];
    expect(body).toBe('*Question 8 of 8*\n\nHow much of the bar is shaded?');
  });
});
