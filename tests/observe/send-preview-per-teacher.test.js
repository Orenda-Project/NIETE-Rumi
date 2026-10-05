/**
 * Sending the report: "Someone else" after a preview must show a new preview (sandbox E2E, 4 Oct).
 *
 * The coach previewed the report for the bound teacher, tapped "Someone else", typed another
 * teacher's name and number, was told "I'm preparing the report now", and nothing ever came: the
 * second preview job was dropped by the queue's 1-hour duplicate guard, whose key is
 * <session>:observe_teacher_report:preview, the same for every recipient. A preview is now told
 * apart by its recipient (dedupNonce from the teacher's number, the mechanism the debrief jobs use),
 * so a double tap for the same teacher is still one job.
 *
 * Real: the job-queue facade and the send service. Mocked: the queue driver, the database
 * (in-memory), WhatsApp, the observe state, the roster.
 */
const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(null)), setState: jest.fn(() => Promise.resolve(true)), clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-roster', () => ({ upsertTeacher: jest.fn(() => Promise.resolve(true)) }));

const JobQueue = require('../../bot/shared/services/coaching/coaching-job-queue.service');
const Send = require('../../bot/shared/services/observe/observe-send.service');

let queued;
beforeEach(() => {
  jest.clearAllMocks();
  queued = [];
  jest.spyOn(JobQueue, 'queueJob').mockImplementation((sid, type, payload) => { queued.push({ sid, type, payload }); return Promise.resolve('msg-1'); });
  mockDb = createFakeSupabase({ coaching_sessions: [{ id: 'sess-1', analysis_data: { framework: 'fico', teacher_delivery: { teacher_phone: '993330000204', status: 'awaiting_confirm' } } }] });
});
afterEach(() => jest.restoreAllMocks());

describe('the preview job is told apart by its recipient', () => {
  test('previews for two different teachers are two jobs; the same teacher twice is one', async () => {
    await JobQueue.queueObserveTeacherReport('sess-1', { from: 'f', phase: 'preview', teacherPhone: '993330000204' });
    await JobQueue.queueObserveTeacherReport('sess-1', { from: 'f', phase: 'preview', teacherPhone: '923365709413' });
    await JobQueue.queueObserveTeacherReport('sess-1', { from: 'f', phase: 'preview', teacherPhone: '923365709413' });
    const nonces = queued.map((q) => q.payload.dedupNonce);
    expect(nonces[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(nonces[1]).not.toBe(nonces[0]);
    expect(nonces[2]).toBe(nonces[1]);
  });

  test('delivery and the teacher\'s tap keep their key shape', async () => {
    await JobQueue.queueObserveTeacherReport('sess-1', { from: 'f', phase: 'deliver' });
    expect(queued[0].payload.dedupNonce).toBeUndefined();
  });
});

test('"Someone else", then a typed teacher: the preview job carries that teacher\'s number', async () => {
  const user = { id: 'coach-1', role: 'coach', preferred_language: 'en' };
  const handled = await Send.handleTeacherDetailsText(user, '923365709413', 'Haroon test, 0336 5709413', { state: 'awaiting_teacher_details', sessionId: 'sess-1' });
  expect(handled).toBe(true);
  const preview = queued.find((q) => q.type === 'observe_teacher_report');
  expect(preview.payload).toMatchObject({ phase: 'preview', teacherPhone: '923365709413' });
  expect(preview.payload.dedupNonce).toMatch(/^[0-9a-f]{16}$/);
});
