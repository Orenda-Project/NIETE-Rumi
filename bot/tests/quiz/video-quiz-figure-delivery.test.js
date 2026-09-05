'use strict';
/**
 * What a child receives for a PICTURE question, end to end.
 *
 * The operator's requirement is one sentence: image → stem → options, in ONE
 * message, nothing inverted. A transcript quiz stores a figure question as a
 * P3 row with media.question_image, so this asserts the render contract for
 * exactly that row shape, and then that the sender turns it into a single
 * sendImageWithButtons call.
 */
const render = require('../../shared/services/quiz/video-quiz-render.service');

const FIG = 'https://acct.r2.cloudflarestorage.com/bucket/transcript_quizzes/u-1/q-1/q0.png';

/** A transcript-quiz picture question, exactly as toRows writes it. */
function figureRow(over = {}) {
  return {
    id: 'q1',
    question_text: 'What fraction of the bar is shaded?',
    option_a: 'one half', option_b: 'three quarters', option_c: 'two thirds', option_d: null,
    correct_option: 'B',
    explanation: 'Three of the four equal parts are shaded.',
    option_feedback: { correct: 'Yes — three of four parts.', wrong: { 0: 'That is two parts.', 2: 'That is a third.' } },
    media: { question_image: FIG, figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] } },
    render_pattern: 'P3',
    ...over,
  };
}

describe('render.build for a P3 figure row', () => {
  const msgs = render.build(figureRow());
  const question = msgs.filter((m) => m.phase === 'question');
  const interaction = msgs.filter((m) => m.phase === 'interaction');

  test('the picture is the header of the interactive message, not a message of its own', () => {
    expect(question).toHaveLength(0);
    expect(interaction).toHaveLength(1);
    expect([interaction[0].phase, interaction[0].kind]).toEqual(['interaction', 'buttons']);
    expect(interaction[0].headerImage).toBe(FIG);
  });

  test('the stem is the body, so the child reads the question under the picture', () => {
    expect(interaction[0].body).toBe('What fraction of the bar is shaded?');
  });

  test('the three options ride on the same message as reply buttons', () => {
    expect(interaction[0].options).toHaveLength(3);
    expect(interaction[0].options.sort()).toEqual(['one half', 'three quarters', 'two thirds']);
  });

  test('nothing is inverted: no image message is emitted before the picker', () => {
    const beforePicker = msgs.slice(0, msgs.findIndex((m) => m.role === 'ask'));
    expect(beforePicker.filter((m) => m.kind === 'image')).toHaveLength(0);
  });

  test('a plain P1 question is untouched — no header image, no picture', () => {
    const plain = render.build(figureRow({ render_pattern: 'P1', media: {} }));
    const picker = plain.find((m) => m.role === 'ask');
    expect(picker.headerImage).toBeUndefined();
    expect(plain.filter((m) => m.kind === 'image')).toHaveLength(0);
  });
});

describe('the sender turns that one message into one image-with-buttons send', () => {
  jest.resetModules();
  jest.doMock('../../shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendImageWithButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
    sendImageFromUrl: jest.fn().mockResolvedValue(true),
    sendAudioFromUrlReturningId: jest.fn().mockResolvedValue('mid'),
    sendTextReturningId: jest.fn().mockResolvedValue('mid'),
  }));
  jest.doMock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
    throttle: jest.fn().mockResolvedValue(undefined),
  }));
  // eslint-disable-next-line global-require
  const WhatsAppService = require('../../shared/services/whatsapp.service');
  // eslint-disable-next-line global-require
  const sender = require('../../shared/services/quiz/video-quiz-sender.service');

  test('image header + stem body + three buttons, in a single call', async () => {
    await sender.sendPhase('923001234567', render.build(figureRow()), 'question', { questionId: 'q1', language: 'en' });
    await sender.sendPhase('923001234567', render.build(figureRow()), 'interaction', { questionId: 'q1', language: 'en' });

    expect(WhatsAppService.sendImageFromUrl).not.toHaveBeenCalled();
    expect(WhatsAppService.sendImageWithButtons).toHaveBeenCalledTimes(1);
    const [phone, url, body, buttons] = WhatsAppService.sendImageWithButtons.mock.calls[0];
    expect(phone).toBe('923001234567');
    expect(url).toBe(FIG);
    expect(body).toBe('What fraction of the bar is shaded?');
    expect(buttons).toHaveLength(3);
    buttons.forEach((b) => expect(b.title.length).toBeLessThanOrEqual(20));
  });
});
