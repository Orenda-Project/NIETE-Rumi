'use strict';
/**
 * bd-2339 — a child passes the quiz to a friend, and hears how they did.
 *
 * This is the one place in the feature where two CHILDREN exchange information,
 * so the boundary is the thing under test. Operator decision (2026-07-28):
 * first name and score cross, nothing else. Not their class, not their phone,
 * not which questions they missed.
 *
 * The structural choice worth guarding: a child arriving through an invite is
 * recorded against the TEACHER's share code, not the invite. That is what keeps
 * her class report correct without the report knowing invites exist.
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
const Binge = require('../../shared/services/quiz/video-quiz-binge.service');
const invite = require('../../shared/services/quiz/video-quiz-invite.service');

beforeEach(() => jest.clearAllMocks());

describe('bd-2339 — what crosses between two children', () => {
  const friend = {
    student_name: 'Bilal Ahmed', student_class: '3-B',
    correct_answers: 11, total_questions_answered: 15, mastery_percentage: 73,
    parent_phone: '923009998888',
  };
  const inviter = { student_name: 'Hooria Khan', correct_answers: 13,
                    total_questions_answered: 15, mastery_percentage: 87 };

  test('the friend is named by first name only', () => {
    const msg = invite.buildComparison({ inviter, friend, topic: 'A Balanced Diet' });
    expect(msg).toContain('Bilal');
    expect(msg).not.toContain('Ahmed');        // no family name
  });

  test('nothing beyond a name and a score crosses', () => {
    const msg = invite.buildComparison({ inviter, friend, topic: 'A Balanced Diet' });
    expect(msg).not.toContain('3-B');            // not their class
    expect(msg).not.toContain('923009998888');   // not their number
    expect(msg).not.toMatch(/question/i);        // not which ones they missed
  });

  test('both scores are shown so it reads as a comparison', () => {
    const msg = invite.buildComparison({ inviter, friend, topic: 'A Balanced Diet' });
    expect(msg).toMatch(/11/);      // friend's score
    expect(msg).toMatch(/13/);      // the inviter's own
  });

  test('a friend who did better is not framed as a defeat', () => {
    const msg = invite.buildComparison({
      inviter: { ...inviter, correct_answers: 8, mastery_percentage: 53 },
      friend, topic: 'A Balanced Diet',
    });
    // Children show these to each other. No "you lost", no "beat you".
    expect(msg).not.toMatch(/\b(lost|beat|worse|failed|loser)\b/i);
  });
});

describe('bd-2339 — an invite does not disturb the teacher', () => {
  test('a session from an invite is recorded against the teacher code', async () => {
    const captured = {};
    const supabase = require('../../shared/config/supabase');
    supabase.from.mockImplementation(() => {
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({
          data: {
            id: 'inv-1', code: 'F3K9M2', quiz_id: 'q1', video_id: 'v1',
            teacher_name: 'Miss Ayesha', topic: 'A Balanced Diet', language: 'en',
            active: true, expires_at: null,
            invited_by_student_id: 'stu-inviter',
            parent_share_code_id: 'sc-teacher',
          },
        }),
        insert: (p) => { Object.assign(captured, p); return chain; },
      };
      return chain;
    });

    const resolved = await invite.resolveInvite('F3K9M2');
    // The child counts toward the TEACHER's report...
    expect(resolved.shareCodeId).toBe('sc-teacher');
    // ...and separately, the friend who sent them is remembered.
    expect(resolved.invitedByStudentId).toBe('stu-inviter');
  });

  test('a teacher-minted code resolves to itself with no inviter', async () => {
    const supabase = require('../../shared/config/supabase');
    supabase.from.mockImplementation(() => {
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({
          data: {
            id: 'sc-teacher', code: 'K7RM2', quiz_id: 'q1', video_id: 'v1',
            active: true, expires_at: null,
            invited_by_student_id: null, parent_share_code_id: null,
          },
        }),
      };
      return chain;
    });
    const resolved = await invite.resolveInvite('K7RM2');
    expect(resolved.shareCodeId).toBe('sc-teacher');
    expect(resolved.invitedByStudentId).toBeNull();
  });
});

describe('bd-2339 — the offer', () => {
  test('a child who finished is offered it with two choices', async () => {
    await invite.offerInvite({
      phone: '923001234567', studentId: 'stu-1', shareCodeId: 'sc-1',
    });
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalled();
    const [, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(opts.buttons).toHaveLength(2);
    for (const b of opts.buttons) expect(b.title.length).toBeLessThanOrEqual(20);
  });

  test('a child we could not identify is not offered it', async () => {
    // Without a student id there is nobody to send the comparison back to, so
    // the offer would be a promise we cannot keep.
    await invite.offerInvite({ phone: '923001234567', studentId: null, shareCodeId: 'sc-1' });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });
});

// bd-2475 — declining the friend-invite chains into the watch-more offer.
describe('handleInviteButton', () => {
  const redisService = require('../../shared/services/cache/railway-redis.service');

  beforeEach(() => {
    jest.clearAllMocks();
    redisService.get.mockResolvedValue({ studentId: 'stu-1', shareCodeId: 'sc-1', language: 'en' });
  });

  test('returns false for a button id it does not own', async () => {
    expect(await invite.handleInviteButton('vq_more_yes', '923001234567')).toBe(false);
    expect(Binge.offerMore).not.toHaveBeenCalled();
  });

  test('an expired offer is a no-op — no binge offer either, nothing to attribute it to', async () => {
    redisService.get.mockResolvedValue(null);
    expect(await invite.handleInviteButton(invite.INVITE_NO, '923001234567')).toBe(true);
    expect(Binge.offerMore).not.toHaveBeenCalled();
  });

  test('on decline: chains into the watch-more offer with the SAME student/share-code/language', async () => {
    expect(await invite.handleInviteButton(invite.INVITE_NO, '923001234567')).toBe(true);
    expect(Binge.offerMore).toHaveBeenCalledWith({
      phone: '923001234567', studentId: 'stu-1', shareCodeId: 'sc-1', language: 'en',
      sessionId: null, quizId: null,
    });
  });

  // bd-2yyry.8 — operator, 14 Sep 2026: "whether you've invited a friend or
  // not, you get invited to try out /video". Prod 6–14 Sep: the videos offer
  // was shown 2,140 times against 6,674 invites — only after a NO. The 1,521
  // who said YES and the 3,013 who never answered never saw it.
  test('on accept: sends the friend link AND THEN the watch-more offer, same student/share-code', async () => {
    supabase.from.mockImplementation((table) => {
      const chain = {
        select: () => chain, eq: () => chain, insert: () => chain,
        maybeSingle: async () => (table === 'quiz_share_codes'
          ? { data: { id: 'sc-1', quiz_id: 'q1', video_id: 'v1', teacher_user_id: 't1',
                      teacher_name: 'Miss Ayesha', topic: 'A Balanced Diet', language: 'en' } }
          : { data: { student_name: 'Hooria Khan' } }),
        single: async () => ({ data: { id: 'sc-child', code: 'ZX7Q2P' } }),
      };
      return chain;
    });
    expect(await invite.handleInviteButton(invite.INVITE_YES, '923001234567')).toBe(true);
    const sent = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(sent).toContain('QUIZ-ZX7Q2P');                 // the friend link went out first
    expect(Binge.offerMore).toHaveBeenCalledWith({
      phone: '923001234567', studentId: 'stu-1', shareCodeId: 'sc-1', language: 'en',
      sessionId: null, quizId: null,
    });
    // Order: the forwardable message before the offer, never interleaved.
    const linkAt = WhatsAppService.sendMessage.mock.invocationCallOrder.slice(-1)[0];
    const offerAt = Binge.offerMore.mock.invocationCallOrder[0];
    expect(offerAt).toBeGreaterThan(linkAt);
  });

  test('on accept when the link cannot be minted: the child is still offered videos', async () => {
    supabase.from.mockImplementation(() => {
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: null }),   // no parent share code
      };
      return chain;
    });
    expect(await invite.handleInviteButton(invite.INVITE_YES, '923001234567')).toBe(true);
    expect(Binge.offerMore).toHaveBeenCalledTimes(1);
  });
});

// bd-2yyry.8 — the child who never answers the invite (3,013 of 6,674 in the
// first week) gets the videos offer anyway, ten minutes later, by a delayed
// quiz-queue job that fires only if the invite is STILL unanswered.
describe('bd-2yyry.8 — the ignored invite', () => {
  const redisService = require('../../shared/services/cache/railway-redis.service');
  const SQS = require('../../shared/services/queue/sqs-queue.service');
  const PHONE = '923001234567';

  beforeEach(() => jest.clearAllMocks());

  test('offering the invite queues one delayed videos-offer job on the quiz queue', async () => {
    await invite.offerInvite({ phone: PHONE, studentId: 'stu-1', shareCodeId: 'sc-1',
                               language: 'ur', sessionId: 'sess-1', quizId: 'q1' });
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
    const [groupId, jobType, payload, opts] = SQS.queueJob.mock.calls[0];
    expect(jobType).toBe('quiz_child_videos_offer');         // quiz_* → the STANDARD queue, delays honoured
    expect(groupId).toBe('sc-1');
    expect(payload).toEqual({ phone: PHONE, shareCodeId: 'sc-1' });
    expect(opts.delaySeconds).toBe(600);
    expect(opts.deduplicationId).toMatch(/^sc-1-quiz_child_videos_offer-923001234567/);
  });

  test('the delayed job offers videos when the invite is still unanswered, and consumes the offer', async () => {
    redisService.get.mockResolvedValue({ studentId: 'stu-1', shareCodeId: 'sc-1', language: 'ur',
                                         sessionId: 'sess-1', quizId: 'q1' });
    expect(await invite.offerVideosIfUnanswered(PHONE)).toBe(true);
    expect(redisService.delete).toHaveBeenCalledWith(invite.INVITE_KEY(PHONE));
    expect(Binge.offerMore).toHaveBeenCalledWith({
      phone: PHONE, studentId: 'stu-1', shareCodeId: 'sc-1', language: 'ur',
      sessionId: 'sess-1', quizId: 'q1',
    });
  });

  test('the delayed job is a no-op once the invite was answered (the tap already offered videos)', async () => {
    redisService.get.mockResolvedValue(null);
    expect(await invite.offerVideosIfUnanswered(PHONE)).toBe(false);
    expect(Binge.offerMore).not.toHaveBeenCalled();
  });

  test('the worker consumes quiz_child_videos_offer and requires a module that exports the handler', () => {
    const fs = require('fs');
    const path = require('path');
    const workerPath = path.join(__dirname, '../../workers/sqs-worker.js');
    const src = fs.readFileSync(workerPath, 'utf8');
    expect(src).toMatch(/case 'quiz_child_videos_offer':/);
    const block = src.slice(src.indexOf("case 'quiz_child_videos_offer':"));
    const m = /require\('([^']+)'\)/.exec(block);
    expect(m).toBeTruthy();
    // Execute the require the worker will execute, from the worker's own directory.
    const mod = require(path.resolve(path.dirname(workerPath), m[1]));
    expect(typeof mod.offerVideosIfUnanswered).toBe('function');
  });
});
