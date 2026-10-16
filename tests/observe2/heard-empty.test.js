/**
 * /observe2 — a part of the lesson with no moment never reaches the coach as a blank question
 * (bd-eal7zn.3; pilot sheet R8, R9, 14 Oct).
 *
 * "When children work, what do they do?" came up with no options at all: every slot of the screen is
 * hidden when Rumi found no moment of that kind, and nothing else on the screen said so. Each moments
 * screen now opens with a line from the endpoint: with moments, what to do with them and how they
 * count; with none, that Rumi found no clear moment for the question and there is nothing to check.
 *
 * Real: endpoint, store, rules, the Flow generator. Mocked: the database (in-memory), WhatsApp.
 */
const fs = require('fs');
const path = require('path');
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  displayTimeZone: () => 'Asia/Karachi',
  acknowledgeFormSubmitted: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/child-test/conversation/offer', () => ({ sendOffer: jest.fn(() => Promise.resolve(false)) }), { virtual: true });

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const { buildEvidenceCheckFlow, HEARD_SCREENS, SLOTS } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');

const token = (id, userId = 'coach-1') => `${userId}:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const heardPayload = (screen) => {
  const out = { screen };
  for (let i = 1; i <= SLOTS; i += 1) out[`${screen.toLowerCase()}_${i}`] = '';
  return out;
};

// Asking and wrong answers only: nothing for "working" and "explaining" (a 14 Oct prod form had asking only).
const MOMENTS = [
  { id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? — Because they make food.', label: 'open question' },
  { id: 'wrong_1', moment: 'wrong', type: 'wrong_ignored', minute: '05:10', quote: 'No, that is wrong. Who else?', label: 'wrong answer left' },
];

async function checkable(moments = MOMENTS) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), {
    period_minutes: 40, answers: { present: '30', priority: 'C1' }, sealed_at: '2026-10-14T05:39:00.000Z',
    coaching_session_id: 'sess-1', rumi_moments: { moments, counts: { closed_q: 2, praise_generic: 1 } },
    moments_ready_at: '2026-10-14T05:50:00.000Z',
  });
  return form.id;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' }],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
  });
});

describe('the endpoint: every moments screen opens with a line that says what is there', () => {
  test('a part with no moment says plainly that Rumi found none and there is nothing to check', async () => {
    const id = await checkable();
    await Check.handleObserve2CheckDataExchange(token(id), 'HEARD_ASK', heardPayload('HEARD_ASK'));
    const work = await Check.handleObserve2CheckDataExchange(token(id), 'HEARD_WRONG', heardPayload('HEARD_WRONG'));
    expect(work.screen).toBe('HEARD_WORK');
    for (let i = 1; i <= SLOTS; i += 1) expect(work.data[`heard_work_${i}_v`]).toBe(false);
    expect(work.data.heard_work_intro).toMatch(/no clear moment/i);
    expect(work.data.heard_work_intro).toMatch(/nothing to check/i);
    expect(work.data.heard_work_intro).toMatch(/Next/);

    const explain = await Check.handleObserve2CheckDataExchange(token(id), 'HEARD_WORK', heardPayload('HEARD_WORK'));
    expect(explain.screen).toBe('HEARD_EXPLAIN');
    expect(explain.data.heard_explain_intro).toMatch(/no clear moment/i);
  });

  test('a part with moments says what to do with them and that only what is confirmed counts', async () => {
    const id = await checkable();
    const ask = await Check.handleObserve2CheckInit(token(id));
    expect(ask.screen).toBe('HEARD_ASK');
    expect(ask.data.heard_ask_1_v).toBe(true);
    expect(ask.data.heard_ask_intro).toMatch(/as written/i);
    expect(ask.data.heard_ask_intro).toMatch(/counts? for nothing/i);
    expect(ask.data.heard_ask_intro).not.toMatch(/nothing to check/i);
  });

  test('explaining moments are not added up for the coach, and the screen says so', async () => {
    const id = await checkable([...MOMENTS, { id: 'explain_1', moment: 'explain', type: 'term_defined', minute: '06:00', quote: 'A noun is the name of a person, place or thing.', label: 'word explained' }]);
    await Check.handleObserve2CheckDataExchange(token(id), 'HEARD_ASK', heardPayload('HEARD_ASK'));
    await Check.handleObserve2CheckDataExchange(token(id), 'HEARD_WRONG', heardPayload('HEARD_WRONG'));
    const explain = await Check.handleObserve2CheckDataExchange(token(id), 'HEARD_WORK', heardPayload('HEARD_WORK'));
    expect(explain.data.heard_explain_1_v).toBe(true);
    expect(explain.data.heard_explain_intro).toMatch(/not added up for you/i);
  });

  test("another coach's token: the line says the check is not available, never a blank", async () => {
    const id = await checkable();
    const out = await Check.handleObserve2CheckInit(token(id, 'coach-2'));
    expect(out.data.heard_ask_intro).toMatch(/not available/i);
  });

  test("today's fields keep their meaning, so a check opened on today's Flow behaves as before", async () => {
    const id = await checkable();
    const out = await Check.handleObserve2CheckInit(token(id));
    for (let i = 1; i <= SLOTS; i += 1) {
      for (const s of ['_t', '_d', '_v']) expect(out.data).toHaveProperty(`heard_ask_${i}${s}`);
    }
    expect(out.data.heard_ask_1_t).toBe('00:40 · open question');
  });
});

describe('the Flow: the line is on every moments screen, bound to data', () => {
  const flow = buildEvidenceCheckFlow();
  const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/flows/observe2-evidence-check.json'), 'utf8'));

  test.each(HEARD_SCREENS.map((h) => h.id))('%s shows ${data.<screen>_intro} above the moments, declared as a string', (id) => {
    for (const f of [flow, committed]) {
      const screen = f.screens.find((s) => s.id === id);
      const form = screen.layout.children.find((c) => c.type === 'Form');
      const k = `${id.toLowerCase()}_intro`;
      const at = form.children.findIndex((c) => c.text === `\${data.${k}}`);
      const firstSlot = form.children.findIndex((c) => c.type === 'RadioButtonsGroup');
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(firstSlot);
      expect(screen.data[k]).toEqual({ type: 'string', __example__: expect.any(String) });
      expect(JSON.stringify(screen.layout)).not.toMatch(/Say whether each one really happened/);
    }
  });

  test('no route changed: a check opened on today\'s Flow walks the same screens', () => {
    expect(flow.routing_model).toEqual(committed.routing_model);
    expect(flow.routing_model.HEARD_ASK).toEqual(['HEARD_WRONG']);
    expect(flow.routing_model.HEARD_WRONG).toEqual(['HEARD_WORK']);
    expect(flow.routing_model.HEARD_WORK).toEqual(['HEARD_EXPLAIN']);
  });
});
