'use strict';
/**
 * bd-2395 / FEAT-121 — a shared class link sends the LESSON before the quiz.
 *
 * A teacher shares a quiz with her class; a child taps the link and is asked
 * question 1 about a lesson they have never seen. The share code has always
 * known which video it belongs to — nothing read it at send time.
 *
 * EVERY ASSERTION HERE IS ABOUT ORDER, because order is the entire feature.
 * A test that only proved "a video was sent" would pass even if it landed
 * after question 5, which is exactly the bug.
 *
 * The other half of the contract is that the send is BEST-EFFORT: 14 of 884
 * R2 objects 404 and 6 rows are unmigrated, and a child who came to answer
 * questions must never be dead-ended by a missing file.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendVideoFromUrl: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({
  sendPhase: jest.fn().mockResolvedValue({ pickerFailed: false }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const VideoQuiz = require('../../shared/services/quiz/video-quiz.service');

const VIDEO = {
  id: 'vid-1', grade: '4', subject: 'Science',
  clean_title: 'Producers, Consumers and Decomposers',
  r2_url: 'https://r2.example/student-videos/4/Science/x.mp4',
  migration_status: 'done',
};

const PHONE = '923000000000';

/**
 * One supabase stub for the whole session walk. `video` is what the
 * student_videos lookup resolves to — null models a row that is not there.
 */
function stub({ video = VIDEO, questions = 3 } = {}) {
  const bank = Array.from({ length: questions }, (_, i) => ({
    id: `q-${i + 1}`, external_id: `leg:${i + 1}`, sort_order: i + 1,
    question_text: `Question ${i + 1}?`,
    option_a: 'A', option_b: 'B', option_c: 'C', option_d: null,
    correct_option: 'A', explanation: '', option_feedback: null,
    media: null, render_pattern: 'P1',
  }));

  supabase.from.mockImplementation((table) => {
    if (table === 'student_videos') {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => (video
          ? { data: video, error: null }
          : { data: null, error: { message: 'No rows found' } }),
      };
      return chain;
    }
    if (table === 'quiz_sessions') {
      return {
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'sess-1' }, error: null }) }),
        }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      };
    }
    if (table === 'quiz_questions') {
      // Two shapes off the same table: the bank listing (awaited after
      // .order()) and the single-question fetch inside sendNextQuestion.
      let byId = null;
      const chain = {
        select: () => chain,
        eq: (col, val) => { if (col === 'id') byId = val; return chain; },
        order: () => chain,
        single: async () => ({ data: bank.find((q) => q.id === byId) || bank[0], error: null }),
        then: (resolve) => resolve({ data: bank, error: null }),
      };
      return chain;
    }
    const chain = {
      select: () => chain, eq: () => chain, update: () => chain, insert: () => chain,
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return chain;
  });
}

/** Record every outbound call in order — the ORDER is the feature. */
function callLog() {
  const calls = [];
  WhatsAppService.sendMessage.mockImplementation((_p, body) => {
    calls.push(['text', body]); return Promise.resolve(true);
  });
  WhatsAppService.sendVideoFromUrl.mockImplementation((_p, url, cap) => {
    calls.push(['video', url, cap]); return Promise.resolve(true);
  });
  return calls;
}

const start = (over = {}) => VideoQuiz.startSession({
  phone: PHONE, userId: null, quizId: 'q1', videoId: 'vid-1',
  language: 'en', source: 'share_link', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  WhatsAppService.sendMessage.mockResolvedValue(true);
  WhatsAppService.sendVideoFromUrl.mockResolvedValue(true);
});

describe('bd-2395 — a shared class link sends the lesson before the quiz', () => {
  test('the video is sent BEFORE the first question', async () => {
    const calls = callLog();
    stub();
    await start();

    const vi = calls.findIndex((c) => c[0] === 'video');
    const hereWeGo = calls.findIndex((c) => /Here we go/.test(c[1] || ''));
    expect(vi).toBeGreaterThan(-1);
    expect(hereWeGo).toBeGreaterThan(-1);
    expect(vi).toBeLessThan(hereWeGo);           // lesson lands before the quiz opens
  });

  test('an ack precedes the upload so a 15s send is not dead air', async () => {
    const calls = callLog();
    stub();
    await start();

    expect(calls[0][0]).toBe('text');
    expect(calls[0][1]).toMatch(/lesson/i);
    expect(calls[1][0]).toBe('video');
  });

  test('the caption names the lesson, its grade and subject', async () => {
    const calls = callLog();
    stub();
    await start();

    const sent = calls.find((c) => c[0] === 'video');
    expect(sent).toBeDefined();
    const [, url, cap] = sent;
    expect(url).toBe(VIDEO.r2_url);
    expect(cap).toContain('Producers, Consumers and Decomposers');
    expect(cap).toContain('Grade 4');
    expect(cap).toContain('Science');
  });

  test('a teacher taking it herself gets NO video', async () => {
    const calls = callLog();
    stub();
    await start({ source: 'video_solo' });          // she just watched it

    expect(calls.some((c) => c[0] === 'video')).toBe(false);
    expect(calls.some((c) => /Here we go/.test(c[1] || ''))).toBe(true);
  });

  test('a missing R2 object does not stop the quiz', async () => {
    const calls = callLog();
    stub({ video: null });
    const st = await start({ videoId: 'gone' });

    expect(st).not.toBeNull();
    expect(calls.some((c) => c[0] === 'video')).toBe(false);
    expect(calls.some((c) => /Here we go/.test(c[1] || ''))).toBe(true);
  });

  test('an unmigrated row is skipped, quiz still starts', async () => {
    const calls = callLog();
    stub({ video: { ...VIDEO, migration_status: 'pending' } });
    await start();

    expect(calls.some((c) => c[0] === 'video')).toBe(false);
    expect(calls.some((c) => /Here we go/.test(c[1] || ''))).toBe(true);
  });

  test('a throwing upload does not throw out of startSession', async () => {
    callLog();
    stub();
    WhatsAppService.sendVideoFromUrl.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(start()).resolves.not.toBeNull();
  });

  test('Urdu gets the Urdu ack', async () => {
    const calls = callLog();
    stub();
    await start({ language: 'ur' });

    expect(calls[0][1]).toMatch(/سبق/);
  });

  test('a session with no videoId is unaffected', async () => {
    const calls = callLog();
    stub();
    await start({ videoId: null });

    expect(calls.some((c) => c[0] === 'video')).toBe(false);
    expect(calls.some((c) => /Here we go/.test(c[1] || ''))).toBe(true);
  });
});
