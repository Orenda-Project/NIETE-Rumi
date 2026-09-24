'use strict';
/**
 * The line that tells a teacher WHEN the class report comes must say what the
 * report service does — nothing it no longer does.
 *
 * The report is scheduled once, when the first child joins (video-quiz-report
 * scheduleForShareCode → reportTargetUtc): 12 hours later, or 07:00 PKT when
 * that lands at night. The early send "everyone who started has finished" was
 * removed (a completion never sends the teacher anything), so a promise of a
 * report "sooner if everyone finishes" was false for every quiz after it. The
 * teacher can still get it sooner by asking from /quiz — a lesson quiz only;
 * the video-lesson quiz's class link has no /quiz entry.
 *
 * Both sends run for real (the hand-off after a lesson quiz, the class link of
 * a video-lesson quiz); the schedule they are checked against is the real
 * reportTargetUtc, so a later change to the schedule reddens this suite.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
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
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { installFrom } = require('./helpers/supabase-chain');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const { reportTargetUtc } = require('../../bot/shared/services/quiz/video-quiz-report.service');
// The class link of a video-lesson quiz, for real (this file mocks the module
// for the hand-off's own mint call above).
const RealShare = jest.requireActual('../../bot/shared/services/quiz/video-quiz-share.service');

const QID = '22222222-2222-4222-8222-222222222222';
const SID = '11111111-1111-4111-8111-111111111111';
const DIGEST = {
  topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5', language_of_instruction: 'ur', confidence: 0.9,
  slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }],
};
const ROW = {
  external_id: `tq:${QID}:S1:1`, question_text: 'س', option_a: 'a', option_b: 'b', option_c: 'c',
  correct_option: 'A', explanation: null, distractor_misconceptions: null, option_feedback: { correct: 'ok', wrong: {} },
  media: null, render_pattern: 'P1', sort_order: 0,
};

/** The schedule, read off the real scheduler: hours after the first join, and the night floor's hour (PKT). */
function schedule() {
  const noonPkt = new Date('2026-09-24T07:00:00Z');          // 12:00 PKT: +12 h is 00:00 → floored
  const morningPkt = new Date('2026-09-24T03:00:00Z');       // 08:00 PKT: +12 h is 20:00, not floored
  const delayHours = Math.round((reportTargetUtc(morningPkt) - morningPkt) / 3600e3);
  const floorPktHour = (reportTargetUtc(noonPkt).getUTCHours() + 5) % 24;
  return { delayHours, floorPktHour };
}

const EARLY = {
  en: /sooner if everyone|as soon as everyone|everyone (has )?finish|when everyone|all (the )?students finish/i,
  ur: /سب کے مکمل|سب مکمل|جیسے ہی سب|سب بچوں کے مکمل/,
};
const TOMORROW = { en: /tomorrow morning/i, ur: /کل صبح/ };
const HOURS = (n) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`);

async function lessonQuizPromise(teacherLang) {
  const meta = { digest: DIGEST, cost_usd: 0.01 };
  const quiz = {
    id: QID, teacher_id: 'u-1', topic: 'کسریں', subject: 'maths', language: 'ur', grade: '4',
    status: 'ready', coaching_session_id: SID, meta,
  };
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
  });
  const out = await Handoff.sendHandoff(QID, '920000000001', {
    firstSend: true,
    prepared: {
      quiz, session: { id: SID, created_at: '2026-09-05T05:00:00Z' }, questions: null, qRows: [ROW], digest: DIGEST,
      teacherName: 'Teacher', meta, language: 'ur', teacherLang,
    },
  });
  expect(out.ok).toBe(true);
  // The promise is the LAST text of a first send: after the forward line and the forwardable message.
  const texts = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
  return texts[texts.length - 1];
}

async function classLinkPromise(language) {
  installFrom(supabase.from, {
    users: { data: [{ name: 'Teacher' }] },
    quizzes: { data: [{ topic: 'Plants' }] },
    quiz_share_codes: { data: [{ id: 'sc-9', code: 'K7RM2P' }] },
  });
  await RealShare.deliverClassLink({ quizId: QID, userId: 'u-1', videoId: 'v-1', language }, '920000000001');
  const texts = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
  return texts[texts.length - 1];
}

beforeEach(() => { jest.clearAllMocks(); WhatsAppService.sendMessage.mockResolvedValue(true); });

describe('the report promise says when the report really comes', () => {
  const { delayHours, floorPktHour } = schedule();

  test('the schedule these lines describe: 12 hours after the first join, 07:00 PKT at night', () => {
    expect(delayHours).toBe(12);
    expect(floorPktHour).toBe(7);
  });

  test.each(['en', 'ur'])('a lesson quiz (%s): 12 hours, 7 am at night, sooner only from /quiz — never "sooner if everyone finishes"', async (lang) => {
    const text = await lessonQuizPromise(lang);
    expect(text).not.toMatch(EARLY[lang]);
    expect(text).not.toMatch(TOMORROW[lang]);
    expect(text).toMatch(HOURS(delayHours));
    expect(text).toMatch(HOURS(floorPktHour));
    expect(text).toMatch(/\/quiz/);
  });

  test.each(['en', 'ur'])('a video-lesson quiz\'s class link (%s): 12 hours, 7 am at night — not "tomorrow morning", not "as soon as everyone has finished"', async (lang) => {
    const text = await classLinkPromise(lang);
    expect(text).not.toMatch(EARLY[lang]);
    expect(text).not.toMatch(TOMORROW[lang]);
    expect(text).toMatch(HOURS(delayHours));
    expect(text).toMatch(HOURS(floorPktHour));
  });
});
