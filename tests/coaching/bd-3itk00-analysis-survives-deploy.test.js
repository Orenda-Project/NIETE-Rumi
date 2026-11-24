'use strict';
/**
 * bd-3itk00 — a worker deploy must never throw away a finished analysis, pay for it twice, or tell the
 * teacher it failed.
 *
 * What a deploy did to two sessions (made-up ids below, the shapes are real):
 *   - run 1 got its model reply, then the replica handed the message back at its 30 s shutdown limit and
 *     exited. The next replica ran the whole analysis again from zero: a second model call, ~2 more minutes.
 *   - on that second run the model call's connection was closed from the far side ('TypeError: terminated').
 *     The row was marked failed and the teacher got the generic "please try again" message, although SQS
 *     delivered the same job again 15 minutes later and she got her report then.
 *
 * So, in processAnalysis:
 *   1. the analysis is saved with the id of the queue message that produced it; a later run of the SAME
 *      message finds it and carries on from there, without a second model call;
 *   2. a connection dropped mid-call (or anything cut off while this worker is shutting down) is handed back
 *      for another attempt while the queue still has attempts left: the row is not marked failed and nothing
 *      is sent. The last attempt fails exactly as before, so the teacher is still told.
 *
 * The real processAnalysis, with only the network boundaries doubled (same harness as bd-pw1ccr.11).
 */

const mockUpdates = [];
jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn((patch) => { mockUpdates.push(patch); return builder; }),
    eq: jest.fn(() => builder), not: jest.fn(() => builder), in: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' } }, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ PEDAGOGICAL_ANALYSIS_MEDIA_ID: null }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve()), sendSticker: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(() => Promise.resolve()), markAsFailed: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/report-generator.service', () => ({
  fetchAndCompressPriorFeedback: jest.fn(() => Promise.resolve({ exists: false })),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({ getCoachingMessage: jest.fn(() => 'msg') }));
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
  conductReflectiveConversation: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/frameworks/framework-selector', () => ({
  selectFrameworkWithReason: jest.fn(() => Promise.resolve({
    framework: require('../../bot/shared/services/coaching/frameworks/fico-framework'),
    frameworkKey: 'fico',
    reason: 'default',
  })),
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: jest.fn(() => {
    const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
    return Promise.resolve({ analysis: fico.computeScores({ framework: 'fico', domains: {} }), usage: { cost: 0.02 } });
  }),
  extractReflectiveCorpus: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator', () => ({
  isFidelityEnabled: jest.fn(() => false),
  resolveFidelitySources: jest.fn(() => Promise.resolve({ ok: false })),
  computeLpFidelity: jest.fn(() => Promise.resolve(null)),
  fidelityPatch: jest.fn(() => ({})),
}));
jest.mock('../../bot/shared/services/nudges/topic-end-recording', () => ({
  onRecording: jest.fn(() => Promise.resolve({ scheduled: true })),
}));

const WhatsApp = require('../../bot/shared/services/whatsapp.service');
const Sessions = require('../../bot/shared/services/coaching/coaching-session.service');
const GPT = require('../../bot/shared/services/gpt5-mini.service');
const Reflective = require('../../bot/shared/services/coaching/reflective-conversation.service');
const Interruption = require('../../bot/shared/utils/job-interruption');
const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');

const SID = 'sess-deploy';
const ERROR_TEXT = /error analyzing your classroom/i;

/** undici's error when the far side closes the socket mid-body (the shape production logged). */
function terminated() {
  const e = new TypeError('terminated');
  e.cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
  return e;
}

function freshRow(over = {}) {
  return {
    id: SID, user_id: 'u1', observation_type: null, created_at: '2026-11-24T05:11:00Z', status: 'confirmed',
    transcript_text: 't', transcript_language: 'ur', classroom_photos: [],
    users: { phone_number: '92300', name: 'A B' },
    ...over,
  };
}

/** The row as run 1 left it after saving its analysis (analysis_complete), stamped with its message. */
function savedRow(messageId, over = {}) {
  const saved = mockUpdates.find((u) => u.analysis_data);
  return freshRow({
    status: 'analysis_complete',
    analysis_started_at: '2026-11-24T05:11:58Z',
    analysis_completed_at: '2026-11-24T05:14:13Z',
    analysis_data: saved ? saved.analysis_data : { framework: 'fico', analysis_job: { message_id: messageId } },
    ...over,
  });
}

const errorMessagesSent = () => WhatsApp.sendMessage.mock.calls.filter(([, text]) => ERROR_TEXT.test(String(text)));

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdates.length = 0;
  Interruption._resetForTests();
  global.__SESSION = freshRow();
});

describe('bd-3itk00 — the saved analysis is the checkpoint', () => {
  test('the analysis is saved with the id of the queue message that produced it', async () => {
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' }, { messageId: 'msg-1', receiveCount: 1 });
    const saved = mockUpdates.filter((u) => u.analysis_data);
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe('analysis_complete');
    expect(saved[0].analysis_data.analysis_job).toEqual({ message_id: 'msg-1' });
  });

  test('SIGTERM after the save, mid hand-off: result saved once, ONE model call, no error message, no failed row', async () => {
    // Run 1: the model replies and the analysis is saved; the hand-off is then cut off by the shutdown.
    Reflective.conductReflectiveConversation.mockImplementationOnce(() => {
      Interruption.markShuttingDown();
      return Promise.reject(terminated());
    });
    const run1 = AnalysisProcessor.processAnalysis(SID, { from: '92300' }, { messageId: 'msg-1', receiveCount: 1 });
    await expect(run1).rejects.toMatchObject({ retryable: true });

    // Run 2: the same message, delivered again to a fresh replica.
    Interruption._resetForTests();
    global.__SESSION = savedRow('msg-1');
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' }, { messageId: 'msg-1', receiveCount: 2 });

    expect(GPT.analyzePedagogy).toHaveBeenCalledTimes(1);                       // paid for once
    expect(mockUpdates.filter((u) => u.analysis_data)).toHaveLength(1);          // saved once
    expect(Sessions.markAsFailed).not.toHaveBeenCalled();                        // never marked failed
    expect(errorMessagesSent()).toHaveLength(0);                                  // never told it failed
    expect(Reflective.conductReflectiveConversation).toHaveBeenCalledTimes(2);   // the hand-off did happen
    // and run 2 never put the row back to 'analyzing'
    expect(Sessions.updateStatus.mock.calls.filter(([, s]) => s === 'analyzing')).toHaveLength(1);
  });

  test('a re-run of the same message whose hand-off already happened does nothing at all', async () => {
    global.__SESSION = savedRow('msg-1', { status: 'reflection_in_progress' });
    const out = await AnalysisProcessor.processAnalysis(SID, { from: '92300' }, { messageId: 'msg-1', receiveCount: 2 });
    expect(out).toEqual(expect.objectContaining({ skipped: 'already_analysed' }));
    expect(GPT.analyzePedagogy).not.toHaveBeenCalled();
    expect(Reflective.conductReflectiveConversation).not.toHaveBeenCalled();
    expect(mockUpdates).toHaveLength(0);
  });

  test('a run left failed after the save carries on from the saved analysis and puts the row back', async () => {
    global.__SESSION = savedRow('msg-1', { status: 'failed' });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' }, { messageId: 'msg-1', receiveCount: 3 });
    expect(GPT.analyzePedagogy).not.toHaveBeenCalled();
    expect(Sessions.updateStatus).toHaveBeenCalledWith(SID, 'analysis_complete');
    expect(Reflective.conductReflectiveConversation).toHaveBeenCalledTimes(1);
  });

  test('a DIFFERENT message (a new analysis request) analyses afresh', async () => {
    global.__SESSION = savedRow('msg-old');
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' }, { messageId: 'msg-new', receiveCount: 1 });
    expect(GPT.analyzePedagogy).toHaveBeenCalledTimes(1);
  });

  test('no message id (a direct call) analyses afresh, as before', async () => {
    global.__SESSION = savedRow('msg-1');
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(GPT.analyzePedagogy).toHaveBeenCalledTimes(1);
  });

  test('a cleared analysis (the manual retry clears analysis_data) analyses afresh', async () => {
    global.__SESSION = savedRow('msg-1', { analysis_data: null, status: 'confirmed' });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' }, { messageId: 'msg-1', receiveCount: 2 });
    expect(GPT.analyzePedagogy).toHaveBeenCalledTimes(1);
  });
});

describe('bd-3itk00 — a cut-off model call is retried, not reported as a failure', () => {
  test('connection closed mid-call on a healthy worker, attempts left: handed back, not failed, nothing sent', async () => {
    GPT.analyzePedagogy.mockImplementationOnce(() => Promise.reject(terminated()));
    const run = AnalysisProcessor.processAnalysis(SID, { from: '92300' }, { messageId: 'msg-1', receiveCount: 1 });
    await expect(run).rejects.toMatchObject({ retryable: true, retryReason: 'transport' });
    expect(Sessions.markAsFailed).not.toHaveBeenCalled();
    expect(errorMessagesSent()).toHaveLength(0);
  });

  test('the same on the LAST attempt the queue allows: failed and told, as before', async () => {
    GPT.analyzePedagogy.mockImplementationOnce(() => Promise.reject(terminated()));
    const run = AnalysisProcessor.processAnalysis(SID, { from: '92300' }, { messageId: 'msg-1', receiveCount: 3 });
    await expect(run).rejects.toThrow('terminated');
    await run.catch((e) => expect(e.retryable).toBeFalsy());
    expect(Sessions.markAsFailed).toHaveBeenCalledWith(SID, 'analysis', 'terminated');
    expect(errorMessagesSent()).toHaveLength(1);
  });

  test('cut off while this worker is shutting down: handed back even when the attempt count is unknown', async () => {
    GPT.analyzePedagogy.mockImplementationOnce(() => {
      Interruption.markShuttingDown();
      const e = new Error('This operation was aborted');
      e.name = 'AbortError';
      return Promise.reject(e);
    });
    const run = AnalysisProcessor.processAnalysis(SID, { from: '92300' }, { messageId: 'msg-1' });
    await expect(run).rejects.toMatchObject({ retryable: true, retryReason: 'shutdown' });
    expect(Sessions.markAsFailed).not.toHaveBeenCalled();
    expect(errorMessagesSent()).toHaveLength(0);
  });

  test('an ordinary failure (a broken reply) still fails and tells her, as before', async () => {
    GPT.analyzePedagogy.mockImplementationOnce(() => Promise.reject(new Error('JSON parsing failed: Expected , after property value')));
    const run = AnalysisProcessor.processAnalysis(SID, { from: '92300' }, { messageId: 'msg-1', receiveCount: 1 });
    await expect(run).rejects.toThrow(/JSON parsing failed/);
    expect(Sessions.markAsFailed).toHaveBeenCalledTimes(1);
    expect(errorMessagesSent()).toHaveLength(1);
  });
});

describe('isTransportAbort — only a dropped connection, never our own error', () => {
  test.each([
    ['undici terminated', terminated(), true],
    ['ECONNRESET', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }), true],
    ['socket hang up', new Error('socket hang up'), true],
    ['AbortError', Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }), true],
    ['400 bad request', Object.assign(new Error('400 invalid'), { status: 400 }), false],
    ['timeout', Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }), false],
    ['JSON', new Error('JSON parsing failed'), false],
    ['null', null, false],
  ])('%s → %s', (_label, err, expected) => {
    expect(Interruption.isTransportAbort(err)).toBe(expected);
  });
});
