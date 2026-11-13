'use strict';
/**
 * bd-n3n2d — a recorded lesson's quiz is claimed (`status: generating`) BEFORE
 * its quiz_generate job is queued. When the queue throws, the row must not stay
 * `generating` for ever (every later /quiz tap would answer "still making"):
 * it is marked failed with its meta kept, the teacher is told, the funnel hears
 * generation_failed, and "making your quiz" is never sent. Same contract as the
 * lesson-plan path's queueLpQuiz.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/quiz-funnel', () => ({
  emit: jest.fn(), channelOf: jest.fn(() => 'quiz_menu'),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Queue = require('../../bot/shared/services/queue');
const Funnel = require('../../bot/shared/services/quiz/quiz-funnel');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { installFrom } = require('./helpers/supabase-chain');
const Provider = require('../../bot/shared/services/quiz/transcript-lesson-provider');

const PHONE = '923001234567';
const USER = { id: 'u-1', preferred_language: 'en' };
const SESSION = {
  id: 'sess-1', user_id: 'u-1', created_at: '2026-09-04T05:00:00Z', transcript_text: 'x'.repeat(3000),
  transcript_language: 'ur', analysis_data: { topic: 'Fractions', subject: 'Urdu' },
};
const FAILED_BEFORE = {
  id: 'q-1', status: 'failed', topic: 'Fractions', subject: 'Urdu', language: 'ur',
  coaching_session_id: 'sess-1', quiz_source: 'transcript',
  meta: { digest: { d: 1 }, error: 'model_failed', step: 'failed' },
};

const updatesTo = () => supabase.from.callsFor('quizzes')
  .flatMap((calls) => calls.filter((c) => c[0] === 'update').map((c) => c[1]));
const sentTexts = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);

beforeEach(() => {
  jest.clearAllMocks();
  Queue.queueJob.mockRejectedValue(new Error('SQS down'));
  installFrom(supabase.from, {
    coaching_sessions: { data: [SESSION] },
    quizzes: { data: [FAILED_BEFORE] },
  });
});

describe('enqueueGenerate when the queue throws', () => {
  test('marks the row failed (queue_failed), keeping its meta, and returns false', async () => {
    const ok = await Provider.enqueueGenerate('q-1', PHONE, 'en');
    expect(ok).toBe(false);
    const failed = updatesTo().find((u) => u.status === 'failed');
    expect(failed).toBeDefined();
    expect(failed.meta.error).toBe('queue_failed');
    expect(failed.meta.digest).toEqual({ d: 1 });      // what a remake reads, kept
    expect(failed.meta.previous_error || failed.meta.error_detail).toBeTruthy();
  });

  test('tells the teacher it failed, never "making your quiz"', async () => {
    await Provider.enqueueGenerate('q-1', PHONE, 'en');
    expect(sentTexts()).not.toContain(resolveUx('tqMaking', { language: 'en' }));
    expect(sentTexts()).toContain(resolveUx('tqCouldNotMakeModel', { language: 'en' }));
  });

  test('emits generation_failed, not accepted', async () => {
    await Provider.enqueueGenerate('q-1', PHONE, 'en');
    const events = Funnel.emit.mock.calls.map((c) => c[0]);
    expect(events).toContain('generation_failed');
    expect(events).not.toContain('accepted');
  });

  test('a /quiz tap on a failed lesson leaves it failed, not stuck generating', async () => {
    expect(await Provider.startTranscriptLesson(USER, 'sess-1', { phone: PHONE })).toBe(true);
    const last = updatesTo().pop();
    expect(last.status).toBe('failed');
  });

  test('the Flow door reports queue_failed, not queued', async () => {
    const out = await Provider.startTranscriptLesson(USER, 'sess-1', { phone: PHONE, quizLanguage: 'ur', via: 'flow' });
    expect(out.outcome).toBe('queue_failed');
  });
});

describe('enqueueGenerate when the queue accepts', () => {
  test('queues, says making, emits accepted, returns true', async () => {
    Queue.queueJob.mockResolvedValue('mid');
    expect(await Provider.enqueueGenerate('q-1', PHONE, 'en')).toBe(true);
    expect(sentTexts()).toContain(resolveUx('tqMaking', { language: 'en' }));
    expect(Funnel.emit.mock.calls.map((c) => c[0])).toContain('accepted');
    expect(updatesTo().find((u) => u.status === 'failed')).toBeUndefined();
  });
});
