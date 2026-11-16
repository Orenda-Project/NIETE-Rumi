'use strict';
/**
 * bd-37q6ye — a recorded lesson whose quiz the offer SKIPPED as subject_not_allowed
 * (transcript-quiz-offer markSkipped) must stay held on every door that can re-make it:
 * the /quiz list tap, the Flow's "Make it in <language>", and claimForGeneration itself.
 * Before the fix, 7 such rows (6 Islamiat) were re-made and reached children.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const { installFrom } = require('./helpers/supabase-chain');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');
const Provider = require('../../bot/shared/services/quiz/transcript-lesson-provider');
const Flow = require('../../bot/shared/routes/transcript-quiz-flow-endpoint');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const PHONE = '923001234567';
const USER = { id: 'u-1', preferred_language: 'en' };
const SESSION = {
  id: 'sess-1', user_id: 'u-1', created_at: '2026-10-10T05:00:00Z', transcript_text: 'x'.repeat(3000),
  transcript_language: 'ur', analysis_data: { topic: 'Seerat', subject: 'Islamiat' },
};
const HELD = {
  id: 'q-1', teacher_id: 'u-1', status: 'skipped', language: null, topic: 'Seerat', subject: 'islamiat',
  coaching_session_id: 'sess-1', quiz_source: 'transcript',
  meta: { step: 'skipped', skip_reason: 'subject_not_allowed', subject: 'islamiat' },
};
const cp = (s) => [...String(s)].length;

const writesTo = (table) => (supabase.from.callsFor(table) || []).flat()
  .filter((c) => c[0] === 'update' || c[0] === 'insert');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  installFrom(supabase.from, {
    coaching_sessions: { data: [SESSION] },
    quizzes: { data: [HELD] },
    quiz_sessions: { data: [] },
  });
});

describe('a quiz held for its subject is never re-made', () => {
  test('claimForGeneration refuses it and writes nothing', async () => {
    const r = await Provider.claimForGeneration({
      userId: 'u-1', sessionId: 'sess-1', session: SESSION, quiz: HELD, quizLanguage: 'ur',
    });
    expect(r).toEqual({ error: 'held' });
    expect(writesTo('quizzes')).toEqual([]);
  });

  test('a /quiz list tap queues nothing and says the recording is held', async () => {
    expect(await List.handleListPick('tq_pick_sess-1', PHONE, USER)).toBe(true);
    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(writesTo('quizzes')).toEqual([]);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('tqRecordingHeld', { language: 'en' }));
  });

  test('the Flow\'s Make it in <language> queues nothing', async () => {
    const r = await Provider.startTranscriptLesson(USER, 'sess-1', { phone: PHONE, quizLanguage: 'ur', via: 'flow' });
    expect(r.outcome).toBe('held');
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  test('menus show it as held, with nothing to make', () => {
    expect(List.quizState(HELD)).toBe('held');
    expect(Flow.actionsFor({ state: 'held', quiz: HELD, session: SESSION, language: 'en' })).toEqual([]);
    expect(Flow.flowStatus(HELD, 'en')).toBe(resolveUx('tqFlowStatusHeld', { language: 'en' }));
    // a skip for any OTHER reason is still re-makeable, as before
    expect(List.quizState({ ...HELD, meta: { skip_reason: 'too_short' } })).toBe('none');
  });

  test('the new copy exists in both languages and fits its caps', () => {
    for (const language of ['en', 'ur']) {
      for (const key of ['tqRecordingHeld', 'tqRowHeld', 'tqFlowStatusHeld', 'tqFlowDoneHeldHead', 'tqFlowDoneHeldBody']) {
        expect(resolveUx(key, { language })).not.toMatch(/^tq/);
      }
      expect(cp(resolveUx('tqFlowStatusHeld', { language }))).toBeLessThanOrEqual(20);
      expect(cp(resolveUx('tqRowHeld', { language }))).toBeLessThanOrEqual(72);
    }
  });
});
