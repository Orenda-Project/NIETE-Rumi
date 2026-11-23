'use strict';
/**
 * bd-ptl6x9.7 — the sweeper's `weak_skill_jugnu` kind. prepare() schedules one row per reached teacher per week
 * (Saturday window, switch on); send() turns one row into one template message or a logged skip. Neighbours are
 * mocked at their module boundary; the picker and message builder run for real.
 */
const mockStore = { KINDS: { WEAK_SKILL_JUGNU: 'weak_skill_jugnu' }, schedule: jest.fn() };
jest.mock('../../../shared/services/nudges/teacher-nudges.store', () => mockStore);
const mockRegister = jest.fn();
jest.mock('../../../shared/services/nudges/teacher-nudges.sweeper', () => ({ register: (...a) => mockRegister(...a) }));
const mockReader = { teachers: jest.fn(), listsOf: jest.fn(), groupResults: jest.fn(), teacher: jest.fn() };
jest.mock('../../../shared/services/nudges/weak-skill-jugnu/reader', () => mockReader);
const mockSettings = jest.fn();
jest.mock('../../../shared/services/nudges/weak-skill-jugnu/switch', () => ({ nudgeSettings: (...a) => mockSettings(...a) }));
const mockSendTemplate = jest.fn();
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendTemplate: (...a) => mockSendTemplate(...a) }));
jest.mock('../../../shared/services/quiz/teacher-report-token', () => ({ signTeacherReport: ({ teacherId }) => `tok-${teacherId}` }));
const mockEvent = jest.fn();
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: (...a) => mockEvent(...a) }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const job = require('../../../shared/services/nudges/weak-skill-jugnu/job');

const SAT_10 = new Date('2026-11-21T05:00:00Z'); // Sat 21 Nov 10:00 PKT
const FRI_10 = new Date('2026-11-20T05:00:00Z');
const ON = { enabled: true, approved: ['weak_skill_jugnu_v1'], testOnly: true };
const ROW = { id: 'n1', user_id: 'u1', kind: 'weak_skill_jugnu', nudge_date: '2026-11-16' };
const TEACHER = { id: 'u1', name: 'Ayesha Khan', phone_number: '+92300FIXTURE1', preferred_language: 'en', is_test_user: true };
const LIST = { listId: '11111111-2222-3333-4444-555555555555', label: 'Grade 3 A', classId: 'c3', schoolId: 'sch', grade: 3 };
const hard = [{ egma: 'ma.missing4', scored: 8, passing: 3 }, { egma: 'ma.number_id8', scored: 8, passing: 7 }];
const events = (name) => mockEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);

beforeEach(() => {
  jest.clearAllMocks();
  job._reset();
  mockSettings.mockResolvedValue(ON);
  mockReader.teachers.mockResolvedValue(['u1', 'u2']);
  mockReader.teacher.mockResolvedValue(TEACHER);
  mockReader.listsOf.mockResolvedValue([LIST]);
  mockReader.groupResults.mockResolvedValue(hard);
  mockStore.schedule.mockResolvedValue({ created: true });
  mockSendTemplate.mockResolvedValue(true);
});

test('registers its kind with the sweeper at load', () => {
  let fresh;
  jest.isolateModules(() => { fresh = require('../../../shared/services/nudges/weak-skill-jugnu/job'); });
  expect(mockRegister).toHaveBeenCalledWith('weak_skill_jugnu', fresh.send, { prepare: fresh.prepare });
});

describe('prepare', () => {
  test('Saturday, switch on: one row per reached teacher, keyed on the Monday', async () => {
    await job.prepare({ now: SAT_10 });
    expect(mockReader.teachers).toHaveBeenCalledWith({ testOnly: true });
    expect(mockStore.schedule.mock.calls.map(([a]) => [a.userId, a.kind, a.nudgeDate])).toEqual([
      ['u1', 'weak_skill_jugnu', '2026-11-16'], ['u2', 'weak_skill_jugnu', '2026-11-16'],
    ]);
  });
  test('switch off or not Saturday → nothing scheduled', async () => {
    await job.prepare({ now: FRI_10 });
    mockSettings.mockResolvedValue({ ...ON, enabled: false });
    await job.prepare({ now: SAT_10 });
    expect(mockStore.schedule).not.toHaveBeenCalled();
  });
  test('a second tick the same week does not read the cohort again', async () => {
    await job.prepare({ now: SAT_10 });
    await job.prepare({ now: SAT_10 });
    expect(mockReader.teachers).toHaveBeenCalledTimes(1);
  });
});

describe('send', () => {
  test('a hard skill → one template to the teacher, button to that game; logged sent', async () => {
    const out = await job.send(ROW, { now: SAT_10 });
    expect(out.sent).toBe(true);
    const [to, name, code, components] = mockSendTemplate.mock.calls[0];
    expect([to, name, code]).toEqual(['+92300FIXTURE1', 'weak_skill_jugnu_v1', 'en_US']);
    expect(components[1].parameters[0].text).toBe(`tok-u1/sfwd?class=${LIST.listId}&ex=missing&lang=en`);
    expect(events('weak_skill_jugnu.sent')[0]).toMatchObject({ userId: 'u1', game: 'missing', grade: 3 });
  });

  test('the window is the 8 weeks before the Saturday', async () => {
    await job.send(ROW, { now: SAT_10 });
    const a = mockReader.groupResults.mock.calls[0][0];
    expect(a).toMatchObject({ schoolId: 'sch', grade: 3, includeTestCoaches: true });
    expect((Date.parse(a.untilIso) - Date.parse(a.sinceIso)) / 86400000).toBe(56);
  });

  test('4 children → skipped no_weak_skill; nothing sent and no count logged', async () => {
    mockReader.groupResults.mockResolvedValue([{ egma: 'ma.missing4', scored: 4, passing: 0 }]);
    const out = await job.send(ROW, { now: SAT_10 });
    expect(out.skipped).toBe('no_weak_skill');
    expect(mockSendTemplate).not.toHaveBeenCalled();
    expect(JSON.stringify(mockEvent.mock.calls)).not.toMatch(/"scored"|"passing"/);
  });

  test('two lists of the same school+grade are read once; the next group is tried when the first has nothing', async () => {
    const other = { ...LIST, listId: 'L-other', grade: 4, label: 'Grade 4' };
    mockReader.listsOf.mockResolvedValue([LIST, { ...LIST, listId: 'L-dup', label: 'Grade 3 B' }, other]);
    mockReader.groupResults.mockImplementation(async ({ grade }) => (grade === 4 ? hard : []));
    await job.send(ROW, { now: SAT_10 });
    expect(mockReader.groupResults).toHaveBeenCalledTimes(2);
    expect(mockSendTemplate.mock.calls[0][3][1].parameters[0].text).toMatch(/class=L-other/);
  });

  test('no class list → skipped no_class_list', async () => {
    mockReader.listsOf.mockResolvedValue([]);
    expect((await job.send(ROW, { now: SAT_10 })).skipped).toBe('no_class_list');
  });

  test('a real teacher while the audience is test accounts → skipped disabled', async () => {
    mockReader.teacher.mockResolvedValue({ ...TEACHER, is_test_user: null });
    expect((await job.send(ROW, { now: SAT_10 })).skipped).toBe('disabled');
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  test('switch off → disabled; out of the window → window_closed; unapproved → template_not_approved', async () => {
    mockSettings.mockResolvedValue({ ...ON, enabled: false });
    expect((await job.send(ROW, { now: SAT_10 })).skipped).toBe('disabled');
    mockSettings.mockResolvedValue(ON);
    expect((await job.send(ROW, { now: FRI_10 })).skipped).toBe('window_closed');
    mockSettings.mockResolvedValue({ ...ON, approved: [] });
    expect((await job.send(ROW, { now: SAT_10 })).skipped).toBe('template_not_approved');
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  test('Meta says the template is paused → template_not_approved, and it is not tried again for an hour', async () => {
    mockSendTemplate.mockImplementation(async (to, n, c, comp, { report }) => { report.code = 132015; return false; });
    expect((await job.send(ROW, { now: SAT_10 })).skipped).toBe('template_not_approved');
    expect((await job.send(ROW, { now: SAT_10 })).skipped).toBe('template_not_approved');
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
  });

  test('any other send failure throws (the sweeper marks the row failed)', async () => {
    mockSendTemplate.mockResolvedValue(false);
    await expect(job.send(ROW, { now: SAT_10 })).rejects.toThrow(/send failed/);
  });
});
