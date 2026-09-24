'use strict';
/**
 * The last English a child meets around an Urdu quiz.
 *
 *  1. The inviter's result. A child who passed a quiz to a friend is told how the
 *     friend did: "🎯 *Bilal finished your quiz!* … You: … — A dead heat". It was
 *     English whatever the quiz language, and it goes to a CHILD.
 *  2. The video quiz's class link. After a solo run of a video quiz, the taker can
 *     send it to their class. The message forwarded to the class group — read by
 *     every child — was "📚 *Quiz time!* … has sent you a quiz on …" in English,
 *     and so was every line around it.
 *
 * Both now follow the quiz's language. WhatsApp, Supabase, Redis and SQS are the
 * only things replaced in the share and invite services. The finish() test also
 * stubs the renderers finish() calls (scorecard image, report, video survey),
 * exactly as video-quiz-scorecard-wiring.test.js does, so the path under test —
 * finish() → notifyInviter → buildComparison → the send — runs for real.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
  setNX: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('m1') }));
jest.mock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined),
}));
// finish()'s other collaborators, stubbed as the existing wiring test stubs them.
jest.mock('../../shared/services/quiz/video-quiz-render.service', () => ({ build: jest.fn(() => ({})) }));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({ sendPhase: jest.fn().mockResolvedValue(true) }));
jest.mock('../../shared/services/quiz/video-quiz-report.service', () => ({
  sendLateClassCards: jest.fn().mockResolvedValue({ sent: 0 }),
  maybeSendFollowUp: jest.fn().mockResolvedValue(false),
  scheduleForShareCode: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({
  sendScorecard: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/student-video-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const vq = require('../../shared/services/quiz/video-quiz.service');
const invite = require('../../shared/services/quiz/video-quiz-invite.service');
const share = require('../../shared/services/quiz/video-quiz-share.service');

const cp = (s) => [...String(s)].length;
const RLM = '‏';
const FSI = '⁨';
const PDI = '⁩';
// Masculine/feminine verb stems that would gender a child (language-protocol).
const GENDERED = /(کرتی ہیں|چاہتی ہیں|کریں گی|رہی ہوں گی|سکتی ہیں|رہی ہوں|چاہیں گی|کرتے ہیں|چاہتے ہیں|سکتے ہیں|کریں گے|رہے ہوں گے)/;

const sentTo = (phone) => WhatsAppService.sendMessage.mock.calls.filter((c) => c[0] === phone).map((c) => c[1]);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WHATSAPP_BOT_NUMBER = '15550001111';
});

// ─── 1. the inviter's result ────────────────────────────────────────────────
describe('the child who sent the quiz hears how their friend did, in the quiz language', () => {
  const INVITER_PHONE = '923009990000';
  const FRIEND_PHONE = '923001234567';

  function stubDb() {
    supabase.from.mockImplementation((table) => {
      const chain = {
        select: () => chain, eq: () => chain, update: () => chain, insert: () => chain, in: () => chain,
        order: () => chain,
        // The inviter's own run of the same quiz.
        limit: async () => ({ data: [{ correct_answers: 6, total_questions_answered: 8, mastery_percentage: 75 }] }),
        maybeSingle: async () => {
          if (table === 'quizzes') return { data: { topic: 'واحد اور جمع', grade: '3', subject: 'urdu' } };
          if (table === 'quiz_sessions') {
            return {
              data: {
                quiz_id: 'q1', student_name: 'بلال احمد', correct_answers: 7,
                total_questions_answered: 8, mastery_percentage: 88, invited_by_student_id: 'stu-inviter',
              },
            };
          }
          if (table === 'students') return { data: { id: 'stu-inviter', student_name: 'اختر علی', phone: INVITER_PHONE } };
          return { data: null };
        },
      };
      return chain;
    });
  }

  test('an Urdu quiz: the whole message is Urdu, names the friend by first name, and is never a defeat', async () => {
    stubDb();
    await vq.sendNextQuestion(FRIEND_PHONE, {
      sessionId: 'sess-1', quizId: 'q1', videoId: 'v1', userId: null,
      language: 'ur', source: 'share_link', shareCodeId: 'sc-1', studentId: 'stu-friend',
      questionIds: ['a', 'b'], index: 2, correct: 2, answered: 2,
    });

    const [msg] = sentTo(INVITER_PHONE);
    expect(msg).toBeDefined();
    expect(msg).toContain('بلال نے آپ کا quiz مکمل کر لیا');
    expect(msg).not.toContain('احمد');                     // first name only crosses
    expect(msg).toContain('بلال: *8 میں سے 7*');
    expect(msg).toContain('آپ: *8 میں سے 6*');
    expect(msg).toContain('اس بار بلال کے نمبر زیادہ آئے');
    expect(msg).not.toMatch(/finished your quiz|You:|edged|ahead|dead heat/);
    expect(msg).not.toMatch(GENDERED);
    expect(msg).not.toMatch(/ہار|ہرا|شکست/);                // never framed as a loss
  });
});

describe('buildComparison', () => {
  const friend = { student_name: 'Bilal Ahmed', correct_answers: 11, total_questions_answered: 15 };
  const inviter = { student_name: 'Hooria Khan', correct_answers: 13, total_questions_answered: 15 };

  test('English is exactly what it was, in all three outcomes', () => {
    const head = '🎯 *Bilal finished your quiz!*\n\n';
    expect(invite.buildComparison({ inviter, friend, topic: 'T' }))
      .toBe(`${head}Bilal: *11/15*\nYou: *13/15*\n\nYou are still ahead. Nicely done.`);
    expect(invite.buildComparison({ inviter: { ...inviter, correct_answers: 8 }, friend, topic: 'T', language: 'en' }))
      .toBe(`${head}Bilal: *11/15*\nYou: *8/15*\n\nBilal edged you this time — worth another go.`);
    expect(invite.buildComparison({ inviter: { ...inviter, correct_answers: 11 }, friend, topic: 'T', language: 'en' }))
      .toBe(`${head}Bilal: *11/15*\nYou: *11/15*\n\nA dead heat — you both got the same.`);
  });

  test('Urdu, all three outcomes, and a Latin name keeps each line right to left', () => {
    const ahead = invite.buildComparison({ inviter, friend, topic: 'T', language: 'ur' });
    const behind = invite.buildComparison({ inviter: { ...inviter, correct_answers: 8 }, friend, topic: 'T', language: 'ur' });
    const tie = invite.buildComparison({ inviter: { ...inviter, correct_answers: 11 }, friend, topic: 'T', language: 'ur' });
    expect(ahead).toContain('آپ اب بھی آگے ہیں');
    // Mid-line, a Latin name is laid out correctly in a right-to-left line; only a
    // line it OPENS needs the mark and the isolate (see the next assertion).
    expect(behind).toContain('اس بار Bilal کے نمبر زیادہ آئے');
    expect(tie).toContain('دونوں کے نمبر ایک جیسے ہیں');
    // "Bilal: *15 میں سے 11*" opens its own line with a Latin name.
    expect(ahead.split('\n')).toContain(`${RLM}${FSI}Bilal${PDI}: *15 میں سے 11*`);
    for (const m of [ahead, behind, tie]) {
      expect(m).not.toMatch(/finished|You:|edged|ahead|heat/);
      expect(m).not.toMatch(GENDERED);
      expect(m).not.toContain('Ahmed');
    }
  });
});

// ─── 2. the video quiz's class link ─────────────────────────────────────────
describe('a video quiz sent to the class: the forwarded message is in the quiz language', () => {
  const PHONE = '923001112222';

  function stubMint({ mint = { id: 'sc-9', code: 'ZX7Q2P' } } = {}) {
    supabase.from.mockImplementation((table) => {
      const chain = {
        select: () => chain, eq: () => chain, insert: () => chain,
        maybeSingle: async () => {
          if (table === 'users') return { data: { name: 'Miss Ayesha' } };
          if (table === 'quizzes') return { data: { topic: 'واحد اور جمع' } };
          return { data: null };
        },
        single: async () => (mint ? { data: mint, error: null } : { data: null, error: { code: 'XX000', message: 'boom' } }),
      };
      return chain;
    });
  }

  test('Urdu: the forwarded message, and every line around it, is Urdu', async () => {
    stubMint();
    redisService.get.mockResolvedValue({ quizId: 'q1', videoId: 'v1', userId: 'u1', language: 'ur' });

    await share.handleShareButton(share.SHARE_YES, PHONE);

    const [intro, forwarded, promise] = sentTo(PHONE);
    expect(intro).toBe('یہ رہا کلاس کا پیغام — یہی پیغام class group میں forward کریں:');
    expect(forwarded.startsWith(`${RLM}📚 *Quiz کا وقت!*`)).toBe(true);
    // The teacher's Latin name opens its line; the line stays right to left.
    expect(forwarded).toContain(`${RLM}${FSI}Miss Ayesha${PDI} نے آپ کو *واحد اور جمع* پر quiz بھیجا ہے۔`);
    expect(forwarded).toContain('https://wa.me/15550001111?text=QUIZ-ZX7Q2P');
    expect(forwarded.split('\n')).toContain('https://wa.me/15550001111?text=QUIZ-ZX7Q2P');
    expect(promise).toContain('رپورٹ');
    for (const m of sentTo(PHONE)) {
      expect(m).not.toMatch(/Quiz time|has sent you|Tap here|forward THIS|You'll get|minutes/);
      expect(m).not.toMatch(GENDERED);
    }
  });

  test('English: the three messages are exactly what they were', async () => {
    stubMint();
    supabase.from.mockImplementation((table) => {
      const chain = {
        select: () => chain, eq: () => chain, insert: () => chain,
        maybeSingle: async () => (table === 'users' ? { data: { name: 'Miss Ayesha' } } : { data: { topic: 'A Balanced Diet' } }),
        single: async () => ({ data: { id: 'sc-9', code: 'ZX7Q2P' }, error: null }),
      };
      return chain;
    });
    redisService.get.mockResolvedValue({ quizId: 'q1', videoId: 'v1', userId: 'u1', language: 'en' });

    await share.handleShareButton(share.SHARE_YES, PHONE);

    expect(sentTo(PHONE)).toEqual([
      'Here is your class message — forward THIS one to your class group:',
      '📚 *Quiz time!*\n\nMiss Ayesha has sent you a quiz on *A Balanced Diet*.\n\n'
        + 'Tap here to start:\nhttps://wa.me/15550001111?text=QUIZ-ZX7Q2P\n\n'
        + "It takes about 10 minutes. You'll need to type your name and class first.",
      "You'll get a report on how your class did tomorrow morning, or as soon as everyone has finished.",
    ]);
  });

  test('Urdu: a link that could not be made is apologised for in Urdu', async () => {
    stubMint({ mint: null });
    redisService.get.mockResolvedValue({ quizId: 'q1', videoId: 'v1', userId: 'u1', language: 'ur' });
    await share.handleShareButton(share.SHARE_YES, PHONE);
    expect(sentTo(PHONE)).toEqual(['معذرت — ابھی کلاس کا link نہیں بن سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔']);
  });

  test('Urdu: "not now" is answered in Urdu', async () => {
    redisService.get.mockResolvedValue({ quizId: 'q1', videoId: 'v1', userId: 'u1', language: 'ur' });
    await share.handleShareButton(share.SHARE_NO, PHONE);
    expect(sentTo(PHONE)).toEqual(['کوئی بات نہیں — جب چاہیں، یہ یہیں ملے گا۔']);
  });

  test('the offer to send it to the class is in the quiz language, and its buttons fit', async () => {
    for (const language of ['ur', 'en']) {
      jest.clearAllMocks();
      await share.offerShare({ phone: PHONE, userId: 'u1', quizId: 'q1', videoId: 'v1', language });
      const [, body] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
      for (const b of body.buttons) expect(cp(b.title)).toBeLessThanOrEqual(20);
      if (language === 'ur') {
        expect(body.body).toContain('یہ quiz اپنی کلاس کو بھیجیں؟');
        expect(body.buttons.map((b) => b.title)).toEqual(['کلاس کو بھیجیں', 'ابھی نہیں']);
        expect(body.body).not.toMatch(/Want to send|forward\. Each|results in the morning/);
      } else {
        expect(body.body).toBe('Want to send this quiz to your class?\n\n'
          + "I'll give you one message to forward. Each child gets the quiz in their "
          + "own chat, and you'll get their results in the morning.");
        expect(body.buttons.map((b) => b.title)).toEqual(['Share with class', 'Not now']);
      }
    }
  });
});
