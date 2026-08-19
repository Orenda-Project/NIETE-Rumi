/**
 * bd-yd2kb (ports main-bot bd-1541) — releaseInFlightMessage puts a message back
 * on its OWN queue immediately (VisibilityTimeout: 0) so a deploy mid-analysis
 * doesn't strand a teacher for the full ~20-min visibility timeout.
 */

let cmvCalls;

function load({ video = true } = {}) {
  jest.resetModules();
  cmvCalls = [];
  const changeMessageVisibility = (params) => { cmvCalls.push(params); return { promise: () => Promise.resolve() }; };
  jest.doMock('aws-sdk', () => ({ config: { update: jest.fn() }, SQS: jest.fn(() => ({ changeMessageVisibility })) }), { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({ getCurrentCorrelationId: () => 'c1', logEvent: jest.fn() }));
  process.env.SQS_QUEUE_URL = 'https://sqs/main';
  if (video) process.env.SQS_VIDEO_QUEUE_URL = 'https://sqs/video'; else delete process.env.SQS_VIDEO_QUEUE_URL;
  process.env.SQS_QUIZ_QUEUE_URL = 'https://sqs/quiz';
  return require('../../bot/shared/services/queue/sqs-queue.service');
}

afterEach(() => {
  jest.resetModules();
  delete process.env.SQS_QUEUE_URL; delete process.env.SQS_VIDEO_QUEUE_URL; delete process.env.SQS_QUIZ_QUEUE_URL;
});

describe('bd-yd2kb — releaseInFlightMessage', () => {
  it('releases a main-queue message with VisibilityTimeout 0 on the main queue', async () => {
    const q = load();
    await q.releaseInFlightMessage('rh-main', 'main');
    expect(cmvCalls).toHaveLength(1);
    expect(cmvCalls[0]).toEqual({ QueueUrl: 'https://sqs/main', ReceiptHandle: 'rh-main', VisibilityTimeout: 0 });
  });

  it('routes to the video queue for a video job', async () => {
    const q = load();
    await q.releaseInFlightMessage('rh-vid', 'video');
    expect(cmvCalls[0].QueueUrl).toBe('https://sqs/video');
    expect(cmvCalls[0].VisibilityTimeout).toBe(0);
  });

  it('routes to the quiz queue for a quiz job', async () => {
    const q = load();
    await q.releaseInFlightMessage('rh-quiz', 'quiz');
    expect(cmvCalls[0].QueueUrl).toBe('https://sqs/quiz');
  });

  it('defaults to the main queue when sourceQueue is omitted', async () => {
    const q = load();
    await q.releaseInFlightMessage('rh-x');
    expect(cmvCalls[0].QueueUrl).toBe('https://sqs/main');
  });

  it('throws when the target queue is not configured (so shutdown falls back to visibility timeout)', async () => {
    const q = load({ video: false });
    await expect(q.releaseInFlightMessage('rh', 'video')).rejects.toThrow(/not configured/i);
  });
});
