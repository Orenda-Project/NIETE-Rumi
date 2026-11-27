/**
 * bd-brblff — a job that failed PERMANENTLY is removed from the queue, not left for SQS to deliver again.
 *
 * Production, 27 Nov 2026: three uploads of one unfinished recording made 8 failed transcription jobs in 95 minutes.
 * handleJobFailure leaves every failed message to SQS ("Option 1: let SQS handle retry"), so each upload was
 * transcribed again at 20 and 40 minutes (the transcription job's visibility window), paid for at the transcribers
 * each time, and each delivery told the teacher on WhatsApp to try again. The processor now says when a retry
 * cannot help (`error.permanent`, see tests/coaching/bd-brblff-unreadable-recording-permanent.test.js); the worker
 * must act on it:
 *   - the failure is handled exactly as before (row failed), THEN the message is deleted: no further delivery;
 *   - an ordinary failure still leaves the message to SQS (unchanged);
 *   - a message already handed back at shutdown is never deleted (it may be another replica's now).
 *
 * The REAL SQSCoachingWorker, with only SQS, the logger, the DB and the coaching service doubled
 * (the harness of bd-3itk00-deploy-finishes-analysis.test.js).
 */

const mockRelease = jest.fn(() => Promise.resolve());
const mockComplete = jest.fn(() => Promise.resolve());
const mockCompleteVideo = jest.fn(() => Promise.resolve());
const mockProcessTranscription = jest.fn(() => Promise.resolve());
const mockRowUpdate = jest.fn();

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  releaseInFlightMessage: (...a) => mockRelease(...a),
  receiveJobs: jest.fn(() => Promise.resolve([])),
  receiveVideoJobs: jest.fn(() => Promise.resolve([])),
  receiveQuizJobs: jest.fn(() => Promise.resolve([])),
  completeJob: (...a) => mockComplete(...a),
  completeVideoJob: (...a) => mockCompleteVideo(...a),
  completeQuizJob: jest.fn(() => Promise.resolve()),
  deleteJob: jest.fn(() => Promise.resolve()),
  extendJobTimeout: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const b = {
    select: () => b,
    eq: () => b,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    update: (patch) => { mockRowUpdate(patch); return { eq: () => Promise.resolve({ data: null, error: null }) }; },
  };
  return { from: () => b };
});
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({
  processTranscription: (...a) => mockProcessTranscription(...a),
}));

let SQSCoachingWorker;

beforeEach(() => {
  [mockRelease, mockComplete, mockCompleteVideo, mockProcessTranscription, mockRowUpdate].forEach((m) => m.mockClear());
  process.env.SQS_QUEUE_URL = 'https://sqs/main';
  delete process.env.SQS_VIDEO_QUEUE_URL;
  delete process.env.SQS_QUIZ_QUEUE_URL;
  delete process.env.WORKER_QUEUES;
  jest.resetModules();
  ({ SQSCoachingWorker } = require('../../bot/workers/sqs-worker'));
});

const UNREADABLE = () => Object.assign(
  new Error('All transcription methods failed:\n- Soniox V3: … invalid_audio_file …\n- Soniox V2: … invalid_audio_file …\n- OpenAI Whisper: … could not be decoded …'),
  { permanent: true, permanentReason: 'unreadable_audio' },
);

async function runOne(w, error, { before } = {}) {
  mockProcessTranscription.mockImplementationOnce(async () => {
    if (before) before();
    throw error;
  });
  const failure = jest.spyOn(w, 'handleJobFailure');
  w.processJob({
    messageId: 'm-1', receiptHandle: 'rh-1', receiveCount: 1,
    body: { sessionId: 's1', jobType: 'transcription', payload: { from: '+92300FIXTURE3' } },
  });
  await w.activeJobs.get('rh-1').promise;
  return failure;
}

describe('bd-brblff — a permanent failure is not delivered again', () => {
  it('marks the row failed as before, then deletes the message (no redelivery)', async () => {
    const w = new SQSCoachingWorker('w1');
    const failure = await runOne(w, UNREADABLE());

    expect(failure).toHaveBeenCalledTimes(1);
    expect(mockRowUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledWith('rh-1');
    expect(mockRelease).not.toHaveBeenCalled();
    expect(w.stats.jobsFailed).toBe(1);
    expect(w.stats.jobsSucceeded).toBe(0);
  });

  it('an ordinary failure still leaves the message to SQS (unchanged)', async () => {
    const w = new SQSCoachingWorker('w2');
    const failure = await runOne(w, new Error('Soniox transcription timeout after 180 seconds'));

    expect(failure).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('a message already handed back at shutdown is never deleted, even on a permanent failure', async () => {
    const w = new SQSCoachingWorker('w3');
    await runOne(w, UNREADABLE(), { before: () => w.releasedHandles.add('rh-1') });

    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('a delete that fails is logged and swallowed: the message falls back to SQS as before', async () => {
    const w = new SQSCoachingWorker('w4');
    mockComplete.mockImplementationOnce(() => Promise.reject(new Error('ReceiptHandleIsInvalid')));
    await expect(runOne(w, UNREADABLE())).resolves.toBeDefined();
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(w.stats.jobsFailed).toBe(1);
  });
});
