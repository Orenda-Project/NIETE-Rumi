/**
 * The child-test offer at the end of /observe2 (bd-s1oo0.4): after the brief, "Test 5 children
 * now? About 25 minutes" with a button carrying the visit (form) id — only when the child test is
 * gated on for this coach. Drives the real check endpoint through Submit (same setup as
 * tests/observe2/check-endpoint.test.js). Mocked: the database (in-memory), WhatsApp.
 */
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const WhatsAppService = require('../../../bot/shared/services/whatsapp.service');
const Store = require('../../../bot/shared/services/observe/observe2/field-form.store');
const Check = require('../../../bot/shared/routes/observe2-check-endpoint');
const { FIELDS } = require('../../../bot/shared/services/observe/observe2/field-form.flow');
const { CODES, PRIORITY } = require('../../../bot/shared/services/observe/observe2/fico17');

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
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', role: 'coach', region: 'niete', preferred_language: 'en' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en' },
    ],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
  });
});

describe('the offer after the brief', () => {
  async function toPriority(id) {
    for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK', 'HEARD_EXPLAIN']) {
      // eslint-disable-next-line no-await-in-loop
      await Check.handleObserve2CheckDataExchange(token(id), s, heardPayload(s, { 1: 'yes', 2: 'yes' }));
    }
    await Check.handleObserve2CheckDataExchange(token(id), 'ADDED_ONE', { screen: 'ADDED_ONE', C1_final: '3', C2_final: '1', C3_final: '3', C6_final: '2', D1_final: '3', D2_final: '4', D4_final: 'IE', D5_final: '1' });
    await Check.handleObserve2CheckDataExchange(token(id), 'ADDED_TWO', { screen: 'ADDED_TWO', C4_final: '1', C5_final: '2', C7_final: '3', C8_final: '2', D3_final: '2', F1_final: '3', F2_final: '2', F3_final: '2', F4_final: '1' });
  }

  const SAVED = { ...process.env };
  afterEach(() => { process.env = SAVED; });

  test('gated on: the offer follows the brief, carrying the form id', async () => {
    process.env.CHILD_TEST_ENABLED = 'true';
    process.env.CHILD_TEST_OBSERVE_LINK = 'true';
    const id = await checkable();
    await toPriority(id);
    await Check.handleObserve2CheckDataExchange(token(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C2', why: '' });
    await flush();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);           // the brief
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [to, msg] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe('923000000001');
    expect(msg.body).toMatch(/Test 5 children now\? About 25 minutes/);
    expect(msg.buttons.map((b) => b.id)).toEqual([`ctst_offer:f:${id}`, `ctst_later:f:${id}`]);
    const briefOrder = WhatsAppService.sendMessage.mock.invocationCallOrder[0];
    expect(WhatsAppService.sendInteractiveButtons.mock.invocationCallOrder[0]).toBeGreaterThan(briefOrder);
  });

  test('kept separate (CHILD_TEST_OBSERVE_LINK unset): the brief only, no child-test offer', async () => {
    process.env.CHILD_TEST_ENABLED = 'true';
    delete process.env.CHILD_TEST_OBSERVE_LINK;
    const id = await checkable();
    await toPriority(id);
    await Check.handleObserve2CheckDataExchange(token(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C2', why: '' });
    await flush();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('gated off: the brief only', async () => {
    delete process.env.CHILD_TEST_ENABLED;
    const id = await checkable();
    await toPriority(id);
    await Check.handleObserve2CheckDataExchange(token(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C2', why: '' });
    await flush();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('a teacher observer (not a coach) gets no offer', async () => {
    process.env.CHILD_TEST_ENABLED = 'true';
    process.env.CHILD_TEST_OBSERVE_LINK = 'true';
    mockFake.__tables.users[0].role = 'teacher';
    const id = await checkable();
    await toPriority(id);
    await Check.handleObserve2CheckDataExchange(token(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C2', why: '' });
    await flush();
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });
});
