/**
 * v10 coaching test (bd-v0toag.12): every report part the teacher is sent (image, voice, buttons)
 * is logged with Meta's message id and the school's group, so the tracker can join it to the
 * delivered/read status lines the webhook already logs. Behind ab_v10_enabled: off, nothing is
 * logged and no group is read. Tracking never throws.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockSwitch = { v10Enabled: jest.fn(async () => true) };
jest.mock('../../bot/shared/services/coaching/ab-v10-switch', () => mockSwitch);
const mockArms = { groupFor: jest.fn(async () => ({ group: 'C', plan: 'v9', report: 'new' })) };
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => mockArms);

const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { createReportTracker } = require('../../bot/shared/services/coaching/report-tracking');

const CTX = { coachingSessionId: 'sess-1', userId: 'user-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockSwitch.v10Enabled.mockResolvedValue(true);
  mockArms.groupFor.mockResolvedValue({ group: 'C', plan: 'v9', report: 'new' });
});

test('a sent part logs coaching.report.sent with its wamid and the group', async () => {
  const t = createReportTracker(CTX);
  t.opts('image').onMessageId('wamid.IMG');
  await t.record('image', true);
  expect(logEvent).toHaveBeenCalledWith('coaching.report.sent', {
    coachingSessionId: 'sess-1', userId: 'user-1', part: 'image', wamid: 'wamid.IMG',
    group: 'C', report: 'new', error: null,
  });
});

test('a failed part logs coaching.report.failed with the error', async () => {
  const t = createReportTracker(CTX);
  await t.record('voice', false, new Error('upload 400'));
  expect(logEvent).toHaveBeenCalledWith('coaching.report.failed', expect.objectContaining({
    part: 'voice', wamid: null, error: 'upload 400',
  }));
});

test('each part keeps its own wamid', async () => {
  const t = createReportTracker(CTX);
  t.opts('image').onMessageId('wamid.IMG');
  t.opts('buttons').onMessageId('wamid.BTN');
  await t.record('buttons', true);
  expect(logEvent.mock.calls[0][1].wamid).toBe('wamid.BTN');
});

test('the group is read once per report, not once per part', async () => {
  const t = createReportTracker(CTX);
  await t.record('image', true);
  await t.record('voice', true);
  await t.record('buttons', true);
  expect(mockArms.groupFor).toHaveBeenCalledTimes(1);
  expect(mockArms.groupFor).toHaveBeenCalledWith('user-1');
  expect(logEvent).toHaveBeenCalledTimes(3);
});

test('an undrawn school still logs, with a null group', async () => {
  mockArms.groupFor.mockResolvedValue(null);
  const t = createReportTracker(CTX);
  await t.record('image', true);
  expect(logEvent.mock.calls[0][1]).toMatchObject({ group: null, report: null });
});

test('switch off: nothing is logged and no group is read', async () => {
  mockSwitch.v10Enabled.mockResolvedValue(false);
  const t = createReportTracker(CTX);
  t.opts('image').onMessageId('wamid.IMG');
  await t.record('image', true);
  expect(logEvent).not.toHaveBeenCalled();
  expect(mockArms.groupFor).not.toHaveBeenCalled();
});

test.each([
  ['the switch read throws', () => mockSwitch.v10Enabled.mockRejectedValue(new Error('db'))],
  ['the group read throws', () => mockArms.groupFor.mockRejectedValue(new Error('db'))],
  ['logEvent throws', () => logEvent.mockImplementation(() => { throw new Error('pino'); })],
])('never throws when %s', async (_, arrange) => {
  arrange();
  const t = createReportTracker(CTX);
  await expect(t.record('image', true)).resolves.toBeUndefined();
});

test('opts() is safe to hand to a sender: onMessageId with no id is ignored', async () => {
  const t = createReportTracker(CTX);
  t.opts('image').onMessageId(undefined);
  await t.record('image', true);
  expect(logEvent.mock.calls[0][1].wamid).toBeNull();
});
