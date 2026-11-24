/**
 * bd-3itk00 — the two seams the worker and processor tests double away (pre-merge class O/Q).
 *
 * A cut-off analysis may be handed back only while the queue has attempts left, which it learns from the
 * delivery count. That number has to come from SQS (ApproximateReceiveCount is returned only when it is asked
 * for) and survive the hop through the orchestrator, or every cut-off run reads "count unknown" and fails as
 * before, with every unit test still green.
 */

let received;

function loadQueue(messages) {
  jest.resetModules();
  received = [];
  const receiveMessage = (params) => { received.push(params); return { promise: () => Promise.resolve({ Messages: messages }) }; };
  jest.doMock('aws-sdk', () => ({ config: { update: jest.fn() }, SQS: jest.fn(() => ({ receiveMessage })) }), { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({ getCurrentCorrelationId: () => 'c1', logEvent: jest.fn() }));
  process.env.SQS_QUEUE_URL = 'https://sqs/main';
  return require('../../bot/shared/services/queue/sqs-queue.service');
}

afterEach(() => {
  jest.resetModules();
  delete process.env.SQS_QUEUE_URL;
});

describe('bd-3itk00 — the delivery count reaches processAnalysis', () => {
  it('receiveJobs asks SQS for ApproximateReceiveCount and hands it on as receiveCount', async () => {
    const q = loadQueue([{
      MessageId: 'm-1', ReceiptHandle: 'rh-1', Body: JSON.stringify({ sessionId: 's1', jobType: 'analysis', payload: {} }),
      Attributes: { ApproximateReceiveCount: '2' },
    }]);
    const jobs = await q.receiveJobs(3);
    expect(received[0].AttributeNames).toEqual(expect.arrayContaining(['ApproximateReceiveCount']));
    expect(jobs[0]).toMatchObject({ messageId: 'm-1', receiptHandle: 'rh-1', receiveCount: 2 });
  });

  it('a message without the attribute reads as unknown (null), never as 0 or NaN', async () => {
    const q = loadQueue([{ MessageId: 'm-2', ReceiptHandle: 'rh-2', Body: JSON.stringify({ sessionId: 's2', jobType: 'analysis' }) }]);
    const jobs = await q.receiveJobs(1);
    expect(jobs[0].receiveCount).toBeNull();
  });

  it('the orchestrator passes the delivery through to the analysis processor unchanged', async () => {
    jest.resetModules();
    const processAnalysis = jest.fn(() => Promise.resolve('done'));
    jest.doMock('../../bot/shared/services/coaching/analysis-processor.service', () => ({ processAnalysis }));
    const Orchestrator = require('../../bot/shared/services/coaching-orchestrator.service');
    await Orchestrator.processAnalysis('s3', { from: '92300' }, { messageId: 'm-3', receiveCount: 1 });
    expect(processAnalysis).toHaveBeenCalledWith('s3', { from: '92300' }, { messageId: 'm-3', receiveCount: 1 });
  });
});
