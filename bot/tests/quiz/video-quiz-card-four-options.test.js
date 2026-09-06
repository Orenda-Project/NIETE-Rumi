'use strict';
/**
 * A CARD MUST NEVER DRAW AN OPTION THE CHILD CANNOT TAP.
 *
 * Found while looking at lane A's own renders (round 5): a four-option question
 * card paints A, B, C and D down the picture and prints "Tap A, B, C or D
 * below" in its footer — and `render.build()` hardcoded `buttons` for the card
 * branch, so `sendButtons` sliced to Meta's three-reply-button limit and D was
 * simply not sent. The child reads two contradictory instructions in one message
 * pair and one of the four answers is unreachable.
 *
 * Today the transcript author writes three options, so no live question has this
 * shape. That is a fact about the author, not a property of the renderer, and
 * the renderer is what the next feature will reuse. WhatsApp's answer to more
 * than three choices is the LIST (ten rows), which is exactly what
 * `pickerKind()` already does for every other pattern — the card branch was the
 * one place that skipped the check.
 *
 * RUN: cd bot && NODE_OPTIONS=--no-experimental-webstorage npx jest --config jest.config.js tests/quiz/video-quiz-card-four-options.test.js
 */
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendImageFromUrl: jest.fn().mockResolvedValue(true),
  sendImageWithButtons: jest.fn().mockResolvedValue(true),
  sendTextReturningId: jest.fn().mockResolvedValue('mid'),
  sendAudioFromUrlReturningId: jest.fn().mockResolvedValue('mid'),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const render = require('../../shared/services/quiz/video-quiz-render.service');
const sender = require('../../shared/services/quiz/video-quiz-sender.service');

const PHONE = '923000000000';
const ask = (msgs) => msgs.find((m) => m.role === 'ask');

function cardQuestion(nOptions) {
  const opts = ['9', '6', '4', '15'].slice(0, nOptions);
  return {
    id: 'q-sum', external_id: 'tq:quiz-1:S1:1',
    question_text: 'What is 3 + 6?',
    option_a: opts[0], option_b: opts[1], option_c: opts[2], option_d: opts[3] || null,
    correct_option: 'A',
    explanation: 'Three and six make nine.',
    option_feedback: null,
    media: { question_card: 'https://r2/card1.png' },
    render_pattern: 'P1',
  };
}

describe('a question card with more options than a reply button row can hold', () => {
  test('three options still go out as three letter buttons', async () => {
    const a = ask(render.build(cardQuestion(3)));
    expect(a.kind).toBe('buttons');
    await sender.sendPhase(PHONE, [a], 'interaction', { questionId: 'q-sum' });
    const { buttons } = WhatsAppService.sendInteractiveButtons.mock.calls[0][1];
    expect(buttons.map((b) => b.title)).toEqual(['A', 'B', 'C']);
  });

  test('four options become a LIST, so every letter the card drew is tappable', async () => {
    jest.clearAllMocks();
    const a = ask(render.build(cardQuestion(4)));
    expect(a.kind).toBe('list');
    expect(a.letterTitles).toBe(true);
    expect(a.optionIndices).toHaveLength(4);

    await sender.sendPhase(PHONE, [a], 'interaction', { questionId: 'q-sum' });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    const payload = WhatsAppService.sendInteractiveMessage.mock.calls[0][1];
    const rows = payload.action.sections[0].rows;
    expect(rows.map((r) => r.title)).toEqual(['A', 'B', 'C', 'D']);
    // The id still carries the STORED index, never the display position.
    rows.forEach((r, pos) => {
      expect(render.parseAnswer(r.id)).toEqual({ questionId: 'q-sum', index: a.optionIndices[pos] });
    });
    // The body names all four letters, exactly as the card's footer does.
    expect(payload.body.text).toBe('The question is in the picture above. Tap A, B, C or D.');
  });
});
