'use strict';
/**
 * bd-v0toag.32 — the weekly report job: the teacher-nudge sweeper's `weekly_usage_report` kind.
 * prepare() schedules one row per group B teacher per week; send() turns one claimed row into one template
 * message, or a logged skip. The job is under test; its neighbours are mocked at their module boundary
 * (store, reader, switch, WhatsApp, the event log, the sweeper registry and the v10 check).
 */

const mockStore = {
  KINDS: { WEEKLY_USAGE_REPORT: 'weekly_usage_report' },
  schedule: jest.fn(),
};
jest.mock('../../../shared/services/nudges/teacher-nudges.store', () => mockStore);
const mockRegister = jest.fn();
jest.mock('../../../shared/services/nudges/teacher-nudges.sweeper', () => ({ register: (...a) => mockRegister(...a) }));
const mockReader = { groupBTeachers: jest.fn(), teacher: jest.fn(), readWeek: jest.fn() };
jest.mock('../../../shared/services/coaching/weekly-report/reader', () => mockReader);
const mockSettings = jest.fn();
jest.mock('../../../shared/services/coaching/weekly-report/switch', () => ({ reportSettings: (...a) => mockSettings(...a) }));
const mockSendTemplate = jest.fn();
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendTemplate: (...a) => mockSendTemplate(...a) }));
const mockEvent = jest.fn();
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: (...a) => mockEvent(...a) }));
const mockLog = jest.fn();
jest.mock('../../../shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
const mockCheck = jest.fn();
jest.mock('../../../shared/services/coaching/thing-to-try-pick', () => ({ checkThing: (...a) => mockCheck(...a) }), { virtual: true });

const job = require('../../../shared/services/coaching/weekly-report/job');

const SAT_10 = new Date('2026-10-17T05:00:00Z'); // Sat 17 Oct 10:00 PKT
const FRI_10 = new Date('2026-10-16T05:00:00Z');
const ON = { enabled: true, approved: ['weekly_usage_v1', 'weekly_usage_quiet_v1'] };
const ROW = { id: 'n1', user_id: 'u1', kind: 'weekly_usage_report', nudge_date: '2026-10-12', context: { group: 'B' } };
const TEACHER = { id: 'u1', name: 'Ayesha Khan', phone_number: '923001234567', preferred_language: 'en' };
const busyWeek = () => ({
  messages: [{ created_at: '2026-10-12T05:00:00' }],
  deliveries: [{ lesson_id: 'L1', created_at: '2026-10-12T05:00:00Z' }],
  opens: [],
  sessions: [{ id: 's1', created_at: '2026-10-13T05:00:00Z', lp: { status: 'ok' } }],
  priors: [
    { id: 's1', created_at: '2026-10-13T05:00:00Z', thing: { tag: 'new' } },
    { id: 'p0', created_at: '2026-10-09T05:00:00Z', thing: { tag: 'old' } },
  ],
  ratings: [{ coaching_session_id: 's1', user_satisfaction_rating: 1 }],
});
const events = (name) => mockEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);

beforeEach(() => {
  jest.clearAllMocks();
  job._reset();
  mockSettings.mockResolvedValue(ON);
  mockReader.teacher.mockResolvedValue(TEACHER);
  mockReader.readWeek.mockResolvedValue(busyWeek());
  mockCheck.mockReturnValue({ outcome: 'did' });
  mockSendTemplate.mockResolvedValue(true);
});

test('registers its kind with the teacher-nudge sweeper at load (Class Q: send and prepare have a caller)', () => {
  let fresh;
  jest.isolateModules(() => { fresh = require('../../../shared/services/coaching/weekly-report/job'); });
  expect(mockRegister).toHaveBeenCalledWith('weekly_usage_report', fresh.send, { prepare: fresh.prepare });
});

describe('prepare — one row per group B teacher per week', () => {
  test('outside the Saturday window it reads nothing', async () => {
    await job.prepare({ now: FRI_10 });
    expect(mockSettings).not.toHaveBeenCalled();
    expect(mockReader.groupBTeachers).not.toHaveBeenCalled();
  });

  test('switch off: no cohort read, nothing scheduled, said once in the log', async () => {
    mockSettings.mockResolvedValue({ enabled: false, approved: [] });
    await job.prepare({ now: SAT_10 });
    await job.prepare({ now: SAT_10 });
    expect(mockReader.groupBTeachers).not.toHaveBeenCalled();
    expect(mockStore.schedule).not.toHaveBeenCalled();
    expect(mockLog.mock.calls.filter(([m]) => /switch is off/.test(m))).toHaveLength(1);
  });

  test('schedules each B teacher for this week, keyed on the Monday, due now; once per process per week', async () => {
    mockReader.groupBTeachers.mockResolvedValue(['u1', 'u2']);
    mockStore.schedule.mockResolvedValue({ row: {}, created: true });
    await job.prepare({ now: SAT_10 });
    await job.prepare({ now: SAT_10 });
    expect(mockReader.groupBTeachers).toHaveBeenCalledTimes(1);
    expect(mockStore.schedule).toHaveBeenCalledTimes(2);
    expect(mockStore.schedule).toHaveBeenCalledWith({
      userId: 'u1', kind: 'weekly_usage_report', nudgeDate: '2026-10-12', scheduledAt: SAT_10,
      context: { group: 'B', week: '2026-10-12' },
    });
  });

  test('a failed cohort read is logged and retried on the next tick', async () => {
    mockReader.groupBTeachers.mockRejectedValueOnce(new Error('down')).mockResolvedValue(['u1']);
    mockStore.schedule.mockResolvedValue({ row: {}, created: true });
    await job.prepare({ now: SAT_10 });
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('cohort'), expect.objectContaining({ error: 'down' }), 'error');
    await job.prepare({ now: SAT_10 });
    expect(mockStore.schedule).toHaveBeenCalledTimes(1);
  });

  test('one teacher failing to schedule does not stop the rest', async () => {
    mockReader.groupBTeachers.mockResolvedValue(['u1', 'u2']);
    mockStore.schedule.mockRejectedValueOnce(new Error('23514')).mockResolvedValue({ row: {}, created: true });
    await job.prepare({ now: SAT_10 });
    expect(mockStore.schedule).toHaveBeenCalledTimes(2);
    expect(events('v10.weekly_report.failed')[0]).toEqual(expect.objectContaining({ userId: 'u1', group: 'B', stage: 'schedule' }));
  });
});

describe('send — one claimed row', () => {
  test('sends weekly_usage_v1 with the counts and logs sent with userId + group', async () => {
    const out = await job.send(ROW, { now: SAT_10 });
    expect(out).toEqual({ sent: true, messageIds: [], context: expect.objectContaining({ template: 'weekly_usage_v1' }) });
    const [to, name, code, components, opts] = mockSendTemplate.mock.calls[0];
    expect([to, name, code]).toEqual(['923001234567', 'weekly_usage_v1', 'en_US']);
    expect(components[0].parameters.map((p) => p.text)).toEqual(
      ['Ayesha', '12–16 Oct', '1', '2', '1', 'done in 1 of 1 recordings', '1 of 1'],
    );
    expect(opts).toEqual({ report: {} });
    expect(mockReader.readWeek).toHaveBeenCalledWith('u1', expect.objectContaining({ weekStart: '2026-10-12' }));
    expect(events('v10.weekly_report.sent')).toEqual([expect.objectContaining({
      userId: 'u1', group: 'B', week: '2026-10-12', nudgeId: 'n1', template: 'weekly_usage_v1', language: 'en',
    })]);
  });

  test('the thing to try is checked against the session BEFORE each recording, never the recording itself', async () => {
    await job.send(ROW, { now: SAT_10 });
    expect(mockCheck).toHaveBeenCalledWith({ tag: 'old' }, { status: 'ok' });
  });

  test('a quiet week sends the no-numbers template', async () => {
    mockReader.readWeek.mockResolvedValue({ messages: [], deliveries: [], opens: [], sessions: [], priors: [], ratings: [] });
    await job.send(ROW, { now: SAT_10 });
    expect(mockSendTemplate.mock.calls[0][1]).toBe('weekly_usage_quiet_v1');
  });

  test.each([
    ['the switch is off', () => mockSettings.mockResolvedValue({ enabled: false, approved: ON.approved }), SAT_10, ROW, 'disabled'],
    ['the row is from an earlier week', () => {}, SAT_10, { ...ROW, nudge_date: '2026-10-05' }, 'window_closed'],
    ['it is past the Saturday window', () => {}, new Date('2026-10-17T16:30:00Z'), ROW, 'window_closed'],
    ['the template is not approved', () => mockSettings.mockResolvedValue({ enabled: true, approved: ['weekly_usage_quiet_v1'] }), SAT_10, ROW, 'template_not_approved'],
  ])('skips when %s — logged, nothing sent', async (_, arrange, now, row, reason) => {
    arrange();
    expect(await job.send(row, { now })).toEqual({ skipped: reason, context: expect.any(Object) });
    expect(mockSendTemplate).not.toHaveBeenCalled();
    expect(events('v10.weekly_report.skipped')).toEqual([expect.objectContaining({ userId: 'u1', group: 'B', reason })]);
  });

  test.each([132001, 132015, 132016])('Meta refuses the template (%i): skipped, and the template is not tried again this hour', async (code) => {
    mockSendTemplate.mockImplementation(async (to, n, l, c, opts) => { opts.report.code = code; return false; });
    expect((await job.send(ROW, { now: SAT_10 })).skipped).toBe('template_not_approved');
    expect((await job.send({ ...ROW, id: 'n2' }, { now: SAT_10 })).skipped).toBe('template_not_approved');
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    expect(mockSendTemplate.mock.calls.every((c) => c[1].startsWith('weekly_usage'))).toBe(true);
  });

  test('any other send failure throws (the sweeper marks it failed) and logs failed with userId + group', async () => {
    mockSendTemplate.mockResolvedValue(false);
    await expect(job.send(ROW, { now: SAT_10 })).rejects.toThrow(/send/);
    expect(events('v10.weekly_report.failed')).toEqual([expect.objectContaining({ userId: 'u1', group: 'B', stage: 'send' })]);
  });

  test('a read failure throws and logs failed — never a report with a missing count', async () => {
    mockReader.readWeek.mockRejectedValue(new Error('opens down'));
    await expect(job.send(ROW, { now: SAT_10 })).rejects.toThrow('opens down');
    expect(mockSendTemplate).not.toHaveBeenCalled();
    expect(events('v10.weekly_report.failed')[0]).toEqual(expect.objectContaining({ userId: 'u1', error: 'opens down' }));
  });

  test('a teacher with no phone or no live account throws (failed), nothing sent', async () => {
    mockReader.teacher.mockResolvedValue({ ...TEACHER, phone_number: null });
    await expect(job.send(ROW, { now: SAT_10 })).rejects.toThrow(/phone/);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});
