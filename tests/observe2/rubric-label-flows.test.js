'use strict';
/**
 * bd-ra8xu.43 — the /observe2 Flows show the visit's stored rubric (framework + version) in one small caption at the top
 * of their first screen (operator 11 Nov ~18:15/18:45), from the visit's stamp, never the switch.
 */
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
jest.mock('../../bot/shared/services/child-test/conversation/offer', () => ({ sendOffer: jest.fn(() => Promise.resolve(false)) }));

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


const { buildEvidenceCheckFlow } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');
const { buildFieldFormFlow } = require('../../bot/shared/services/observe/observe2/field-form.flow');
const Form = require('../../bot/shared/routes/observe2-form-endpoint');

const first = (flow, id) => flow.screens.find((s) => s.id === id);
const kidsOf = (screen) => {
  const form = screen.layout.children.find((c) => c.type === 'Form');
  return form ? form.children : screen.layout.children;
};

describe('the check opens with the visit\'s rubric', () => {
  test('the Flow: a caption bound to scored_with tops HEARD_ASK, declared with an example', () => {
    const s = first(buildEvidenceCheckFlow(), 'HEARD_ASK');
    expect(kidsOf(s)[0]).toEqual({ type: 'TextCaption', text: '${data.scored_with}' });
    expect(s.data.scored_with).toEqual({ type: 'string', __example__: 'FICO17 v6' });
  });
  test.each([['fico-ict-17-2026-09', 'FICO17 v5'], ['fico17_v6', 'FICO17 v6']])('a %s visit opens with %s', async (rubricVersion, label) => {
    const id = await checkable({ rubric_version: rubricVersion });
    const out = await Check.handleObserve2CheckInit(token(id));
    expect(out.screen).toBe('HEARD_ASK');
    expect(out.data.scored_with).toBe(label);
  });
});

describe('the live form opens with the visit\'s rubric', () => {
  test('the Flow: a caption bound to scored_with tops PART_ONE', () => {
    const s = first(buildFieldFormFlow(), 'PART_ONE');
    expect(kidsOf(s)[0]).toEqual({ type: 'TextCaption', text: '${data.scored_with}' });
    expect(s.data.scored_with).toEqual({ type: 'string', __example__: 'FICO17 v6' });
  });
  test.each([['fico-ict-17-2026-09', 'FICO17 v5'], ['fico17_v6', 'FICO17 v6']])('a %s visit: Part 1 says %s', async (rubricVersion, label) => {
    const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
    Object.assign(row(form.id), { period_minutes: 40, rubric_version: rubricVersion });
    const out = await Form.handleObserve2FormInit(`coach-1:observe2-form:${form.id}`);
    expect(out.screen).toBe('PART_ONE');
    expect(out.data.scored_with).toBe(label);
  });
});
