'use strict';
/**
 * NO2 — the teacher's quiz hand-off sends fewer bubbles, and says the same.
 *
 *  - The report promise ("You will get a report on how the class did about 12
 *    hours after the first student starts…") rides in the PDF's caption instead
 *    of a third message after the link. The forwardable message stays ALONE and
 *    LAST — it is what the teacher forwards to the class group.
 *  - The video-lesson quiz's class link: the promise rides on the "forward THIS
 *    one" line, the class message stays alone and last.
 *  - "Not now" on the quiz offer: a free 👍 on the teacher's own tap. The offer
 *    she declined already ends with "you can make one for any lesson anytime by
 *    sending /quiz"; the decline text said it a second time.
 *
 * Driven through the real hand-off, share and offer services; WhatsApp, the
 * queue, R2 and the PDF renderer are the stand-ins.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Teacher' }),
  botNumber: jest.fn().mockReturnValue('920000000000'),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WA = require('../../bot/shared/services/whatsapp.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { installFrom } = require('./helpers/supabase-chain');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
const RealShare = jest.requireActual('../../bot/shared/services/quiz/video-quiz-share.service');

const QID = '22222222-2222-4222-8222-222222222222';
const SID = '11111111-1111-4111-8111-111111111111';
const PHONE = '920000000001';
const DIGEST = {
  topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5', language_of_instruction: 'ur', confidence: 0.9,
  slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }],
};
const ROW = {
  external_id: `tq:${QID}:S1:1`, question_text: 'س', option_a: 'a', option_b: 'b', option_c: 'c',
  correct_option: 'A', explanation: null, distractor_misconceptions: null, option_feedback: { correct: 'ok', wrong: {} },
  media: null, render_pattern: 'P1', sort_order: 0,
};
const ux = (key, language, params) => resolveUx(key, { language, params });

async function firstSend(teacherLang, { pdf = true } = {}) {
  const meta = { digest: DIGEST, cost_usd: 0.01 };
  const quiz = {
    id: QID, teacher_id: 'u-1', topic: 'کسریں', subject: 'maths', language: 'ur', grade: '4',
    status: 'ready', coaching_session_id: SID, meta,
  };
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
  });
  if (!pdf) require('../../bot/shared/utils/html-to-pdf').htmlToPdf.mockRejectedValueOnce(new Error('render timeout'));
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  const out = await Handoff.sendHandoff(QID, PHONE, {
    firstSend: true,
    prepared: {
      quiz, session: { id: SID, created_at: '2026-09-05T05:00:00Z' }, questions: null, qRows: [ROW], digest: DIGEST,
      teacherName: 'Teacher', meta, language: 'ur', teacherLang,
    },
  });
  expect(out.ok).toBe(true);
  return out;
}

beforeEach(() => { jest.clearAllMocks(); WA.sendMessage.mockResolvedValue(true); WA.sendDocument.mockResolvedValue(true); });

describe('a lesson quiz hand-off: PDF (with the promise in its caption), then the link alone', () => {
  test.each(['en', 'ur'])('teacher reads %s: two messages, the promise closes the caption, the forwardable is last', async (lang) => {
    await firstSend(lang);

    expect(WA.sendDocument).toHaveBeenCalledTimes(1);
    const caption = WA.sendDocument.mock.calls[0][3];
    const promise = ux('tqReportPromise', lang);
    expect(caption.endsWith(`\n\n${promise}`)).toBe(true);
    expect(caption.startsWith('📝') || caption.startsWith('‏📝')).toBe(true);
    expect([...caption].length).toBeLessThanOrEqual(1024);
    // the forwardable, alone — and nothing after it
    expect(WA.sendMessage).toHaveBeenCalledTimes(1);
    expect(WA.sendMessage.mock.calls[0][1]).toMatch(/QUIZ-ABC234/);
  });

  test('no PDF could be made: the text that stands in for it carries the promise, ahead of "forward THIS"', async () => {
    await firstSend('en', { pdf: false });

    expect(WA.sendDocument).not.toHaveBeenCalled();
    const texts = WA.sendMessage.mock.calls.map((c) => c[1]);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain(ux('tqReportPromise', 'en'));
    expect(texts[0].endsWith(ux('tqForwardThis', 'en'))).toBe(true);
    expect(texts[1]).toMatch(/QUIZ-ABC234/);
  });
});

describe('a video-lesson quiz\'s class link: the promise rides on "forward THIS one"', () => {
  test.each(['en', 'ur'])('%s: two messages, the class message alone and last', async (lang) => {
    installFrom(supabase.from, {
      users: { data: [{ name: 'Teacher' }] },
      quizzes: { data: [{ topic: 'Plants' }] },
      quiz_share_codes: { data: [{ id: 'sc-9', code: 'K7RM2P' }] },
    });
    await RealShare.deliverClassLink({ quizId: QID, userId: 'u-1', videoId: 'v-1', language: lang }, PHONE);

    const texts = WA.sendMessage.mock.calls.map((c) => c[1]);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe(`${ux('vqShareReportPromise', lang)}\n\n${ux('vqShareForwardThis', lang)}`);
    expect(texts[1]).toMatch(/QUIZ-K7RM2P/);
  });
});

describe('"Not now" on the quiz offer', () => {
  function offered() {
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update')
        ? { data: [{ id: QID }] }
        : { data: [{ id: QID, teacher_id: 'u-1', status: 'offered', language: 'ur', subject: 'maths', topic: 'x', meta: {}, coaching_session_id: SID }] }),
      users: { data: [{ id: 'u-1', phone_number: PHONE, preferred_language: 'en' }] },
    });
  }

  // FX1 (bd-w2daa.22): 👌, not 👍 — the webhook's automatic 👍 is on every message.
  test('with the tap\'s message id: a 👌 on it, and no text', async () => {
    offered();
    await Offer.handleOfferButton(`tq_no_${QID}`, PHONE, { messageId: 'wamid.notnow' });
    expect(WA.sendReaction).toHaveBeenCalledWith(PHONE, 'wamid.notnow', '👌');
    expect(WA.sendMessage).not.toHaveBeenCalled();
  });

  test('the reaction could not be sent: the decline text goes, as before', async () => {
    offered();
    WA.sendReaction.mockResolvedValueOnce(false);
    await Offer.handleOfferButton(`tq_no_${QID}`, PHONE, { messageId: 'wamid.notnow' });
    expect(WA.sendMessage.mock.calls.map((c) => c[1])).toEqual([ux('tqDeclined', 'en')]);
  });

  test('no message id: the decline text, as before', async () => {
    offered();
    await Offer.handleOfferButton(`tq_no_${QID}`, PHONE);
    expect(WA.sendReaction).not.toHaveBeenCalled();
    expect(WA.sendMessage.mock.calls.map((c) => c[1])).toEqual([ux('tqDeclined', 'en')]);
  });
});
