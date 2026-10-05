/**
 * /observe2 — the check (POST /api/flows/observe2-check) and the brief that follows it.
 *
 * The coach walks four screens of moments from the recording ("yes, this happened" / "no, or not
 * like this"), then every level pre-filled with what their sealed answers and the moments they
 * confirmed add up to, then the pick they sealed; on Submit the record is checked once and a
 * brief for the conversation with the teacher arrives in the chat. The recording's own levels
 * are never on any screen.
 *
 * Real: endpoint, store, rules, brief. Mocked: the database (in-memory), WhatsApp.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  displayTimeZone: () => 'Asia/Karachi',
  buildDebriefChoiceButtons: jest.fn((sessionId, S) => ({ body: S.debrief_choice_body, buttons: [{ id: `observe_debrief_now_${sessionId}` }] })),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const { FIELDS } = require('../../bot/shared/services/observe/observe2/field-form.flow');
const { CODES, PRIORITY } = require('../../bot/shared/services/observe/observe2/fico17');

const token = (id, userId = 'coach-1') => `${userId}:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };

const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
  p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no',
  incident: 'none', lp: 'used', priority: 'C8',
};
const MOMENTS = [
  { id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? Ali?', label: 'open question' },
  { id: 'ask_2', moment: 'ask', type: 'reasoning', minute: '00:52', quote: 'Because they make food from it.', label: 'child explained why' },
  { id: 'wrong_1', moment: 'wrong', type: 'wrong_ignored', minute: '05:10', quote: 'No, that is wrong. Who else?', label: 'wrong answer left' },
];

async function checkable(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), {
    period_minutes: 40, answers: ANSWERS, sealed_at: '2026-09-30T05:39:00.000Z', part1_done_at: 'x', part2_done_at: 'x',
    coaching_session_id: 'sess-1', rumi_moments: { moments: MOMENTS, counts: { closed_q: 3, praise_generic: 1 } },
    rumi_levels: { C1: { level: 2 } }, moments_ready_at: '2026-09-30T05:50:00.000Z',
  }, patch);
  return form.id;
}

const heardPayload = (screen, answers = {}) => {
  const out = { screen };
  for (let i = 1; i <= 8; i += 1) out[`${screen.toLowerCase()}_${i}`] = answers[i] || '';
  return out;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en' },
    ],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
  });
});

describe('the moments', () => {
  test('INIT opens on "asking": each moment is its minute, what it is, and the words; empty slots hidden', async () => {
    const id = await checkable();
    const out = await Check.handleObserve2CheckInit(token(id));
    expect(out.screen).toBe('HEARD_ASK');
    expect(out.data).toMatchObject({
      heard_ask_1_t: '00:40 · open question', heard_ask_1_d: '"Why do plants need sunlight? Ali?"', heard_ask_1_v: true,
      heard_ask_2_t: '00:52 · child explained why', heard_ask_2_v: true,
      heard_ask_3_v: false, heard_ask_8_v: false,
    });
    for (const [k, v] of Object.entries(out.data)) if (k.endsWith('_t')) expect([...v].length).toBeLessThanOrEqual(30);
    expect(JSON.stringify(out.data)).not.toMatch(/level/i);
  });

  test('each screen saves its answers and opens the next', async () => {
    const id = await checkable();
    const out = await Check.handleObserve2CheckDataExchange(token(id), 'HEARD_ASK', heardPayload('HEARD_ASK', { 1: 'yes', 2: 'no' }));
    expect(out.screen).toBe('HEARD_WRONG');
    expect(out.data.heard_wrong_1_t).toBe('05:10 · wrong answer left');
    expect(row(id).evidence_review).toMatchObject({ heard_ask_1: 'yes', heard_ask_2: 'no' });
  });
});

describe('the levels', () => {
  async function toAdded(id, wrongAnswer = 'yes') {
    await Check.handleObserve2CheckDataExchange(token(id), 'HEARD_ASK', heardPayload('HEARD_ASK', { 1: 'yes', 2: 'yes' }));
    await Check.handleObserve2CheckDataExchange(token(id), 'HEARD_WRONG', heardPayload('HEARD_WRONG', { 1: wrongAnswer }));
    await Check.handleObserve2CheckDataExchange(token(id), 'HEARD_WORK', heardPayload('HEARD_WORK'));
    return Check.handleObserve2CheckDataExchange(token(id), 'HEARD_EXPLAIN', heardPayload('HEARD_EXPLAIN'));
  }

  test('after the last moment screen: pre-filled from the sealed answers and the confirmed moments', async () => {
    const id = await checkable();
    const out = await toAdded(id);
    expect(out.screen).toBe('ADDED_ONE');
    expect(out.data.C3_level).toBe('3');
    expect(out.data.C3_because).toMatch(/you saw/);
    expect(out.data.C2_level).toBe('1');
    expect(out.data.D2_level).toBe('4');
  });

  test('a moment the coach says did not happen does not count', async () => {
    const id = await checkable();
    const out = await toAdded(id, 'no');
    expect(out.data.C2_level).toBe('');
  });

  test('then the second half of the levels, then the pick sealed before any moment was seen', async () => {
    const id = await checkable();
    await toAdded(id);
    const a2 = await Check.handleObserve2CheckDataExchange(token(id), 'ADDED_ONE', { screen: 'ADDED_ONE', C1_final: '2', C2_final: '1', C3_final: '3', C6_final: '2', D1_final: '2', D2_final: '4', D4_final: 'IE', D5_final: '1' });
    expect(a2.screen).toBe('ADDED_TWO');
    expect(Object.keys(a2.data).filter((k) => k.endsWith('_level')).sort()).toEqual(['C4_level', 'C5_level', 'C7_level', 'C8_level', 'D3_level', 'F1_level', 'F2_level', 'F3_level', 'F4_level'].sort());
    const pr = await Check.handleObserve2CheckDataExchange(token(id), 'ADDED_TWO', { screen: 'ADDED_TWO', C4_final: '1', C5_final: '2', C7_final: '3', C8_final: '3', D3_final: '2', F1_final: '3', F2_final: '2', F3_final: '2', F4_final: '1' });
    expect(pr).toEqual({ screen: 'PRIORITY', data: { priority_level: 'C8' } });
  });
});

describe('Submit, and the brief', () => {
  async function toPriority(id) {
    for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK', 'HEARD_EXPLAIN']) {
      // eslint-disable-next-line no-await-in-loop
      await Check.handleObserve2CheckDataExchange(token(id), s, heardPayload(s, { 1: 'yes', 2: 'yes' }));
    }
    await Check.handleObserve2CheckDataExchange(token(id), 'ADDED_ONE', { screen: 'ADDED_ONE', C1_final: '3', C2_final: '1', C3_final: '3', C6_final: '2', D1_final: '3', D2_final: '4', D4_final: 'IE', D5_final: '1' });
    await Check.handleObserve2CheckDataExchange(token(id), 'ADDED_TWO', { screen: 'ADDED_TWO', C4_final: '1', C5_final: '2', C7_final: '3', C8_final: '2', D3_final: '2', F1_final: '3', F2_final: '2', F3_final: '2', F4_final: '1' });
  }

  // Submit hands the visit to /observe's end (end-of-visit.test.js runs that part for real): the
  // session is saved as a submitted /observe form, the coach is asked "debrief now or later?", and the
  // brief is kept as this visit's debrief guide.
  test('Submit checks the record once, closes on DONE, and hands the visit to the debrief with its brief', async () => {
    const id = await checkable();
    await toPriority(id);
    const done = await Check.handleObserve2CheckDataExchange(token(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C2', why: 'the wrong answers mattered more' });
    expect(done.screen).toBe('DONE');
    expect(done.data.record_id).toBe(id);
    expect(done.data.done_line).toMatch(/^Saved at \d{2}:\d{2}$/);
    const f = row(id);
    expect(f.checked_at).toBeTruthy();
    expect(Object.keys(f.final_levels).sort()).toEqual([...CODES].sort());
    expect(f.final_levels).toMatchObject({ C2: '1', D2: '4', D4: 'IE' });
    expect(f.evidence_review).toMatchObject({ priority_final: 'C2', why: 'the wrong answers mattered more' });
    expect(mockFake.__tables.coaching_sessions[0].status).toBe('observer_review_complete');

    await flush();
    // As /observe on this branch: the saved line, then "Debrief now or later?" for this visit.
    const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][0]).toBe('923000000001');
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toBe(observeStrings('en').submitted_ack);
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendInteractiveButtons.mock.calls[0][1].buttons[0].id).toBe('observe_debrief_now_sess-1');
    const brief = mockFake.__tables.coaching_sessions[0].analysis_data.observe2.brief;
    expect(brief).toContain('Rabia');
    expect(brief).toContain(PRIORITY.C2);
    expect(brief).toContain('No, that is wrong. Who else?');
    expect(brief).toContain('How many children spoke');
  });

  test('a second Submit changes nothing and asks nothing again', async () => {
    const id = await checkable();
    await toPriority(id);
    await Check.handleObserve2CheckDataExchange(token(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C2', why: '' });
    const again = await Check.handleObserve2CheckDataExchange(token(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'F1', why: 'x' });
    expect(again.screen).toBe('DONE');
    await flush();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(row(id).evidence_review.priority_final).toBe('C2');
  });

  test("another coach's token sees no moments and cannot check the record", async () => {
    const id = await checkable();
    const out = await Check.handleObserve2CheckInit(token(id, 'coach-2'));
    expect(out.screen).toBe('HEARD_ASK');
    expect(Object.entries(out.data).filter(([k, v]) => k.endsWith('_v') && v)).toEqual([]);
    const done = await Check.handleObserve2CheckDataExchange(token(id, 'coach-2'), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C1' });
    expect(done.screen).toBe('DONE');
    expect(row(id).checked_at).toBeUndefined();
  });
});

test('the brief is built from data only, in both languages', () => {
  const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
  const form = { answers: ANSWERS, rumi_moments: { moments: MOMENTS }, evidence_review: { heard_wrong_1: 'yes', priority_final: 'C2' }, final_levels: { C2: '1', D2: '4', C3: '3', C7: '3' } };
  for (const lang of ['en', 'ur']) {
    const text = buildBrief(form, { teacherName: 'Rabia', lang });
    expect(text).toContain('Rabia');
    expect(text).toContain(PRIORITY.C2);
    expect(text).not.toMatch(/undefined|null|NaN/);
  }
  expect(FIELDS).toBeDefined();
});
