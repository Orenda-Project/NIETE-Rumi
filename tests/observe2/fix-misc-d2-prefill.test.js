/**
 * FICO6 r2 fix-misc: D2's two count boxes start from what the coach typed on the live form (spec §7.4).
 *
 * `d2_children` starts at p1_spoke + p2_new and `d2_quiet_later` at p2_new when the form has both. Meta takes a
 * number box's init value only as a number, and there is no empty number, so a single screen cannot pre-fill a
 * visit that may have no count. The Flow therefore has two copies of the last room screen: COMBINED_THREE (blank
 * boxes, as before) and COMBINED_THREE_COUNTS (the same fields, the boxes pre-filled from numeric data). The endpoint
 * opens the second only when both counts are on the form and the Flow says it has that screen (`v6c` 3).
 * `cmb_D2_level` is never pre-selected on either.
 *
 * Real: endpoint, store, rules, Flow builder. Mocked: the database (in-memory), WhatsApp.
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

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const { buildEvidenceCheckFlow, V6_CHECK } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');

const token = (id, userId = 'coach-1') => `${userId}:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const cp = (s) => [...String(s)].length;

const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
  p2_spoke: '10', p2_new: '3', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no',
  incident: 'none', lp: 'none', priority: 'C8',
};
const MOMENTS = [{ id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight?', label: 'open question' }];

async function checkable(answers = ANSWERS) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), {
    period_minutes: 40, answers, sealed_at: '2026-11-12T05:39:00.000Z', part1_done_at: 'x', part2_done_at: 'x',
    coaching_session_id: 'sess-1', rumi_moments: { moments: MOMENTS, counts: {} },
    rumi_levels: { C1: { level: 2 } }, moments_ready_at: '2026-11-12T05:50:00.000Z',
  });
  return form.id;
}
const heard = (screen, extra = {}) => {
  const out = { screen, ...extra };
  for (let i = 1; i <= 8; i += 1) out[`${screen.toLowerCase()}_${i}`] = i === 1 && screen === 'HEARD_ASK' ? 'yes' : '';
  return out;
};
const ex = (id, screen, data) => Check.handleObserve2CheckDataExchange(token(id), screen, { screen, ...data });

const WHY = 'I saw it from the back of the room myself.';
const C1 = { cmb_C3_level: '3', cmb_C3_why: WHY, cmb_C5_level: '2', cmb_C5_why: WHY };
const C2 = { cmb_C7_level: 'NA', cmb_C7_why: 'No group task in this lesson at all.', cmb_D3_level: '1', cmb_D3_why: WHY };
const C3 = { cmb_D4_level: '3', cmb_D4_why: WHY, d2_children: '9', d2_quiet_later: '3', cmb_D2_level: '4', cmb_D2_why: WHY };

// Walks a v6 visit to the screen after COMBINED_TWO, on a Flow that posts `v6c`.
async function toThird(id, v6c = V6_CHECK) {
  for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK']) await ex(id, s, heard(s));
  const after = await ex(id, 'HEARD_EXPLAIN', heard('HEARD_EXPLAIN', { v6c }));
  if (after.screen === 'MISSED') await ex(id, 'MISSED', {});
  await ex(id, 'COMBINED_ONE', C1);
  return ex(id, 'COMBINED_TWO', C2);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', region: 'Sihala' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', teacher_level: ['PRIMARY'] },
    ],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
    app_settings: [{ key: 'fico_coach_rubric', value: 'v6' }],
  });
  Switch._resetCache();
});

describe('the Flow: a pre-filled copy of the last room screen', () => {
  const flow = buildEvidenceCheckFlow();
  const byId = Object.fromEntries(flow.screens.map((s) => [s.id, s]));
  const formOf = (s) => s.layout.children.find((c) => c.type === 'Form');
  const fields = (s) => formOf(s).children.filter((c) => c.name).map((c) => c.name);

  test('COMBINED_THREE_COUNTS has the fields of COMBINED_THREE, in the same order', () => {
    expect(byId.COMBINED_THREE_COUNTS).toBeTruthy();
    expect(fields(byId.COMBINED_THREE_COUNTS)).toEqual(fields(byId.COMBINED_THREE));
    expect(byId.COMBINED_THREE_COUNTS.title).toBe(byId.COMBINED_THREE.title);
  });

  test('the two count boxes start from numeric data; the D2 level and every other field start blank', () => {
    const s = byId.COMBINED_THREE_COUNTS;
    expect(formOf(s)['init-values']).toEqual({ d2_children: '${data.d2_children_init}', d2_quiet_later: '${data.d2_quiet_init}' });
    expect(s.data.d2_children_init.type).toBe('number');
    expect(s.data.d2_quiet_init.type).toBe('number');
    expect(formOf(byId.COMBINED_THREE)['init-values']).toBeUndefined();
  });

  test('no cmb_*_level anywhere has an init value', () => {
    for (const s of flow.screens) {
      const form = formOf(s);
      const init = (form && form['init-values']) || {};
      expect(Object.keys(init).filter((k) => /^cmb_.*_level$/.test(k))).toEqual([]);
      for (const c of (form ? form.children : [])) if (/^cmb_.*_level$/.test(c.name || '')) expect(c['init-value']).toBeUndefined();
    }
  });

  test('the D2 boxes keep Meta\'s caps in code points: label <= 20, helper <= 80', () => {
    for (const id of ['COMBINED_THREE', 'COMBINED_THREE_COUNTS']) {
      for (const c of formOf(byId[id]).children.filter((k) => /^d2_/.test(k.name || ''))) {
        expect(cp(c.label)).toBeLessThanOrEqual(20);
        expect(cp(c['helper-text'])).toBeLessThanOrEqual(80);
      }
    }
  });

  test('routing: COMBINED_TWO opens either copy; both go on to FIDELITY or ADDED_DC_ONE', () => {
    expect(flow.routing_model.COMBINED_TWO).toEqual(['COMBINED_THREE', 'COMBINED_THREE_COUNTS']);
    expect(flow.routing_model.COMBINED_THREE_COUNTS).toEqual(flow.routing_model.COMBINED_THREE);
  });

  test('the Flow says it has the screen: v6c 3', () => {
    expect(V6_CHECK).toBe('3');
    const explain = formOf(byId.HEARD_EXPLAIN).children.find((c) => c.type === 'Footer');
    expect(explain['on-click-action'].payload.v6c).toBe('3');
  });
});

describe('the endpoint', () => {
  test('both counts on the form: the pre-filled screen, children = p1_spoke + p2_new, quiet = p2_new, as numbers', async () => {
    const id = await checkable();
    const out = await toThird(id);
    expect(out.screen).toBe('COMBINED_THREE_COUNTS');
    expect(out.data.d2_children_init).toBe(9);
    expect(out.data.d2_quiet_init).toBe(3);
    expect(out.data.D2_ev).toBeTruthy();
  });

  test('a Flow published before the screen (v6c 2): the blank screen, as before', async () => {
    const id = await checkable();
    const out = await toThird(id, '2');
    expect(out.screen).toBe('COMBINED_THREE');
    expect(out.data.d2_children_init).toBeUndefined();
  });

  test.each([
    ['no p1_spoke', { p1_spoke: '' }],
    ['no p2_new', { p2_new: undefined }],
    ['a count that is not a whole number', { p1_spoke: 'six' }],
  ])('%s: the blank screen (no number to give)', async (_, patch) => {
    const id = await checkable({ ...ANSWERS, ...patch });
    const out = await toThird(id);
    expect(out.screen).toBe('COMBINED_THREE');
    expect(out.data.d2_children_init).toBeUndefined();
  });

  test('submitting the pre-filled screen saves as COMBINED_THREE does and goes on', async () => {
    const id = await checkable();
    await toThird(id);
    const out = await ex(id, 'COMBINED_THREE_COUNTS', C3);
    expect(out.screen).toBe('ADDED_DC_ONE');
    const review = row(id).evidence_review;
    expect(review.d2_counts).toEqual({ children: 9, quiet_later: 3 });
    expect(review.v6_D2).toMatchObject({ level: 4, set_by: 'coach', because: WHY });
    expect(review.cmb_D4_level).toBe('3');
  });

  test('a refused submit comes back to the pre-filled screen with the coach\'s own numbers', async () => {
    const id = await checkable();
    await toThird(id);
    const out = await ex(id, 'COMBINED_THREE_COUNTS', { ...C3, d2_children: '4', d2_quiet_later: '5' });
    expect(out.screen).toBe('COMBINED_THREE_COUNTS');
    expect(out.data.error_messages.d2_children).toBeTruthy();
    expect(out.data.d2_children_init).toBe(4);
    expect(out.data.d2_quiet_init).toBe(5);
  });

  test('a token that matches no record: the pre-filled screen still walks on', async () => {
    const out = await Check.handleObserve2CheckDataExchange(token('missing'), 'COMBINED_THREE_COUNTS', { screen: 'COMBINED_THREE_COUNTS', ...C3 });
    expect(out.screen).toBe('ADDED_DC_ONE');
  });
});
