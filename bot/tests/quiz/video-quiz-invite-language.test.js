'use strict';
/**
 * The invite-a-friend message is in the quiz language.
 *
 * After an Urdu quiz, a child who tapped "دوست کو بھیجیں" was handed two English
 * messages: "Here is the message — forward THIS one to your friend:" and a
 * forwardable "📚 *Try this quiz!* … thinks you'd like this quiz on …". The
 * second one is read by the FRIEND, who is joining an Urdu quiz, so it was the
 * friend's first contact with that quiz too.
 *
 * WhatsApp is the only thing replaced (the send boundary), plus the database
 * and queue it talks to; the invite service and the catalog run for real.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-binge.service', () => ({
  offerMore: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue('msg-1'),
}));
jest.mock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const invite = require('../../shared/services/quiz/video-quiz-invite.service');

const PHONE = '923001234567';
const ENGLISH = /Here is the message|forward THIS|Try this quiz|thinks you|Tap here|today’s lesson|Your friend|Sorry/;

function stubDb({ parent, studentName, mint = { id: 'sc-child', code: 'ZX7Q2P' } }) {
  supabase.from.mockImplementation((table) => {
    const chain = {
      select: () => chain, eq: () => chain, insert: () => chain,
      maybeSingle: async () => (table === 'quiz_share_codes'
        ? { data: parent }
        : { data: studentName === undefined ? null : { student_name: studentName } }),
      single: async () => (mint ? { data: mint, error: null } : { data: null, error: { code: 'XX000', message: 'boom' } }),
    };
    return chain;
  });
}

function parentCode(language, topic) {
  return {
    id: 'sc-1', quiz_id: 'q1', video_id: 'v1', teacher_user_id: 't1',
    teacher_name: 'Miss Ayesha', topic, language,
  };
}

const sent = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WHATSAPP_BOT_NUMBER = '15550001111';
});

describe('the invite a child forwards is in the quiz language', () => {
  test('an Urdu quiz: both messages are Urdu, and the link still goes out', async () => {
    redisService.get.mockResolvedValue({ studentId: 'stu-1', shareCodeId: 'sc-1', language: 'ur' });
    stubDb({ parent: parentCode('ur', 'واحد اور جمع'), studentName: 'اختر علی' });

    expect(await invite.handleInviteButton(invite.INVITE_YES, PHONE)).toBe(true);

    const [intro, message] = sent();
    expect(intro).toBe('یہ رہا پیغام — یہی پیغام اپنے دوست کو forward کریں:');
    expect(message).toContain('یہ quiz کر کے دیکھیں');
    expect(message).toContain('اختر');
    expect(message).not.toContain('علی');                  // first name only crosses
    expect(message).toContain('*واحد اور جمع*');
    expect(message).toContain('https://wa.me/15550001111?text=QUIZ-ZX7Q2P');
    expect(message.startsWith('‏')).toBe(true);       // laid out right-to-left
    for (const m of sent()) expect(m).not.toMatch(ENGLISH);
  });

  test('an English quiz: the copy the children read is unchanged', async () => {
    redisService.get.mockResolvedValue({ studentId: 'stu-1', shareCodeId: 'sc-1', language: 'en' });
    stubDb({ parent: parentCode('en', 'A Balanced Diet'), studentName: 'Hooria Khan' });

    await invite.handleInviteButton(invite.INVITE_YES, PHONE);

    const [intro, message] = sent();
    expect(intro).toBe('Here is the message — forward THIS one to your friend:');
    expect(message).toBe(
      "📚 *Try this quiz!*\n\nHooria thinks you'd like this quiz on *A Balanced Diet*.\n\n"
      + 'Tap here to start:\nhttps://wa.me/15550001111?text=QUIZ-ZX7Q2P',
    );
  });

  test('an in-flight invite minted before this change (no language in its context) takes the quiz language from its share code', async () => {
    redisService.get.mockResolvedValue({ studentId: 'stu-1', shareCodeId: 'sc-1' });
    stubDb({ parent: parentCode('ur', 'واحد اور جمع'), studentName: 'اختر' });

    await invite.handleInviteButton(invite.INVITE_YES, PHONE);

    for (const m of sent()) expect(m).not.toMatch(ENGLISH);
    expect(sent()[1]).toContain('یہ quiz کر کے دیکھیں');
  });

  test('no topic and no name: the fallbacks are Urdu too, in the form the sentence needs', async () => {
    redisService.get.mockResolvedValue({ studentId: 'stu-1', shareCodeId: 'sc-1', language: 'ur' });
    stubDb({ parent: parentCode('ur', null), studentName: undefined });

    await invite.handleInviteButton(invite.INVITE_YES, PHONE);

    const message = sent()[1];
    // "آپ کے دوست کے خیال میں" — the oblique form, because a postposition follows.
    expect(message).toContain('آپ کے دوست کے خیال میں');
    expect(message).toContain('*آج کا سبق*');
    expect(message).not.toMatch(ENGLISH);
  });

  test('a link that could not be made is apologised for in Urdu, and videos are still offered', async () => {
    redisService.get.mockResolvedValue({ studentId: 'stu-1', shareCodeId: 'sc-1', language: 'ur' });
    stubDb({ parent: parentCode('ur', 'واحد اور جمع'), studentName: 'اختر', mint: null });

    await invite.handleInviteButton(invite.INVITE_YES, PHONE);

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toContain('link نہیں بن سکا');
    expect(sent()[0]).not.toMatch(ENGLISH);
    const Binge = require('../../shared/services/quiz/video-quiz-binge.service');
    expect(Binge.offerMore).toHaveBeenCalledTimes(1);
  });
});
