/**
 * The worker records a web quiz's read-aloud clips (job quiz_web_audio).
 *
 * A child on WhatsApp's in-app browser (Android) has no phone voice: a question with no
 * recorded clip is silent. Clips used to be made only when the page was first opened, inside
 * the web process (lost on a deploy, queued behind every other quiz). Now a job on the quiz
 * queue records them; this test drives the REAL executeJob with the AWS SDK mocked at its edge.
 */
const mockSend = jest.fn(() => ({ promise: () => Promise.resolve({ MessageId: 'm' }) }));
jest.mock('aws-sdk', () => {
  class SQS {
    constructor() {
      this.changeMessageVisibility = jest.fn(() => ({ promise: () => Promise.resolve({}) }));
      this.sendMessage = (...a) => mockSend(...a);
      this.receiveMessage = jest.fn(() => ({ promise: () => Promise.resolve({ Messages: [] }) }));
      this.deleteMessage = jest.fn(() => ({ promise: () => Promise.resolve({}) }));
      this.getQueueAttributes = jest.fn(() => ({ promise: () => Promise.resolve({ Attributes: {} }) }));
      this.purgeQueue = jest.fn(() => ({ promise: () => Promise.resolve({}) }));
    }
  }
  return { config: { update: jest.fn() }, SQS };
});
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));
// The publish service has its own suite (network mocked at its edge); here only the hand-off is observed.
const mockRun = jest.fn(() => Promise.resolve({ ok: true }));
jest.mock('../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../shared/services/quiz/web-quiz-publish.service'),
  runQuizAudioJob: (...a) => mockRun(...a),
}));

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.SQS_QUEUE_URL = process.env.SQS_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/000000000000/test-queue.fifo';
process.env.SQS_QUIZ_QUEUE_URL = process.env.SQS_QUIZ_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/000000000000/test-quiz';

const { SQSCoachingWorker } = require('../../workers/sqs-worker');

test('a quiz_web_audio job records that quiz\'s clips', async () => {
  const worker = new SQSCoachingWorker('test-worker');
  const quizId = '11111111-1111-4111-8111-111111111111';
  await worker.executeJob(quizId, 'quiz_web_audio', { quizId }, 'receipt', 'quiz', { groupId: quizId, jobType: 'quiz_web_audio', payload: { quizId } });
  expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ quizId }));
});

test('a teacher\'s quiz generation never waits behind clip jobs: at most 2 run at once per worker, the rest come back in a minute', async () => {
  mockRun.mockClear(); mockSend.mockClear();
  const worker = new SQSCoachingWorker('test-worker');
  worker.activeJobs.set('r-a', { sourceQueue: 'quiz', jobType: 'quiz_web_audio' });
  worker.activeJobs.set('r-b', { sourceQueue: 'quiz', jobType: 'quiz_web_audio' });
  worker.activeJobs.set('r-gen', { sourceQueue: 'quiz', jobType: 'quiz_generate' });
  const quizId = '22222222-2222-4222-8222-222222222222';
  await worker.executeJob(quizId, 'quiz_web_audio', { quizId }, 'r-c', 'quiz', { groupId: quizId, jobType: 'quiz_web_audio', payload: { quizId } });
  expect(mockRun).not.toHaveBeenCalled();
  const sent = mockSend.mock.calls.map((c) => c[0]).filter((p) => JSON.parse(p.MessageBody).jobType === 'quiz_web_audio');
  expect(sent).toHaveLength(1);
  expect(sent[0].DelaySeconds).toBeGreaterThanOrEqual(60);
  expect(JSON.parse(sent[0].MessageBody).payload).toEqual(expect.objectContaining({ quizId }));
});
