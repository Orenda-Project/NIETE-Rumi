'use strict';
// The queue index reads QUEUE_DRIVER when it is first required — set it before any service loads.
process.env.QUEUE_DRIVER = 'bullmq';
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
/**
 * Every quiz job the bot enqueues goes through the queue DRIVER
 * (shared/services/queue → sqs | bullmq), never the SQS singleton by name.
 *
 * Under QUEUE_DRIVER=bullmq (the local mock lane, any deploy without AWS)
 * the quiz services required queue/sqs-queue.service directly, so
 * quiz_generate threw "SQS Queue not configured" and the teacher was told
 * "I couldn't start that quiz just now" — while bullmq-queue.service already
 * routes quiz_* to its quiz queue. Executed against the real services with
 * the two drivers as the boundary: the bullmq driver must receive the job,
 * the SQS singleton must never be touched.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/quiz-funnel', () => ({ emit: jest.fn(), channelOf: () => 'menu' }), { virtual: true });
jest.mock('../../bot/shared/services/queue/bullmq-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('job-1') }));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn(() => { throw new Error('SQS Queue not configured'); }),
}));

const supabase = require('../../bot/shared/config/supabase');
const Bull = require('../../bot/shared/services/queue/bullmq-queue.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');

function neverUpdatingTable() {
  const chain = {
    select: () => chain, eq: () => chain, is: () => chain, in: () => chain, order: () => chain, limit: () => chain,
    update: () => chain, insert: () => chain,
    maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }),
    then: (res) => res({ data: [], error: null }),
  };
  return chain;
}

describe('quiz jobs are enqueued through the queue driver (QUEUE_DRIVER=bullmq)', () => {
  beforeEach(() => { jest.clearAllMocks(); supabase.from.mockImplementation(neverUpdatingTable); });

  test('queueLpQuiz (the lesson-plan quiz) reaches the bullmq driver, not the SQS singleton', async () => {
    const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
    const ok = await Offer.queueLpQuiz({ quizId: 'q-lp', nudgeId: 'n-1', phone: '923000000001', language: 'en' });
    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(Bull.queueJob).toHaveBeenCalledWith('q-lp', 'quiz_generate', expect.objectContaining({ quizId: 'q-lp' }), expect.anything());
    expect(ok).toBe(true);
  });

  test('enqueueGenerate (a /quiz tap) reaches the bullmq driver', async () => {
    const Provider = require('../../bot/shared/services/quiz/transcript-lesson-provider');
    await Provider.enqueueGenerate('q-tr', '923000000001', 'en', 'list');
    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(Bull.queueJob).toHaveBeenCalledWith('q-tr', 'quiz_generate', expect.objectContaining({ quizId: 'q-tr' }), expect.anything());
  });

  test('scheduleOffer / triggerEarly (the recording offer) reach the bullmq driver', async () => {
    const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
    await Offer.triggerEarly('cs-1');
    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(Bull.queueJob).toHaveBeenCalledWith('cs-1', 'quiz_offer', expect.objectContaining({ coachingSessionId: 'cs-1' }), expect.anything());
  });

  test('no quiz service names the SQS singleton by path', () => {
    const fs = require('fs'); const path = require('path');
    const dir = path.join(__dirname, '..', '..', 'bot', 'shared', 'services', 'quiz');
    const offenders = fs.readdirSync(dir).filter(f => f.endsWith('.js'))
      .filter(f => /queue\/sqs-queue\.service/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
