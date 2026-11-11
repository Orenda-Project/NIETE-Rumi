/**
 * /observe2 on FICO17 v6 — "Add one Rumi missed" (spec §9.2; CONTRACTS §6.3; RULINGS R7).
 *
 * After the four moments screens a v6 visit gets one more screen, MISSED: two slots, each a type, a minute and the
 * words. A slot counts only when it has a type and words. What counts is stored with the visit as a coach-added
 * moment (source 'coach', confirmed) and adds up with the confirmed moments, so Rumi's pre-filled levels include it.
 * A v5 visit never sees the screen; a v6 visit opened on the Flow before it (v6c '1') goes straight to COMBINED_ONE.
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
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const { buildEvidenceCheckFlow, V6_CHECK } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');
const MomentTypes = require('../../bot/shared/services/observe/observe2/moment-types');

const token = (id) => `coach-1:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const cp = (s) => [...String(s)].length;
const setSwitch = (value) => {
  mockFake.__tables.app_settings = value == null ? [] : [{ key: 'fico_coach_rubric', value }];
  Switch._resetCache();
};

const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
  p2_spoke: '10', p2_new: '5', p2_task: 'all', p2_change: 'no', incident: 'none', lp: 'used', priority: 'C8',
};
const MOMENTS = [
  { id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? Ali?', label: 'open question' },
];

async function checkable() {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), {
    period_minutes: 40, answers: ANSWERS, sealed_at: '2026-11-12T05:39:00.000Z', part1_done_at: 'x', part2_done_at: 'x',
    coaching_session_id: 'sess-1', rumi_moments: { moments: MOMENTS, counts: {} }, moments_ready_at: '2026-11-12T05:50:00.000Z',
  });
  return form.id;
}
const heard = (screen, answers = {}, extra = {}) => {
  const out = { screen, ...extra };
  for (let i = 1; i <= 8; i += 1) out[`${screen.toLowerCase()}_${i}`] = answers[i] || '';
  return out;
};
const ex = (id, screen, data) => Check.handleObserve2CheckDataExchange(token(id), screen, { screen, ...data });
async function toExplain(id, extra = { v6c: V6_CHECK }) {
  await ex(id, 'HEARD_ASK', heard('HEARD_ASK', { 1: 'yes' }));
  await ex(id, 'HEARD_WRONG', heard('HEARD_WRONG'));
  await ex(id, 'HEARD_WORK', heard('HEARD_WORK'));
  return ex(id, 'HEARD_EXPLAIN', heard('HEARD_EXPLAIN', {}, extra));
}
const EMPTY = { missed_1_type: '', missed_1_min: '', missed_1_words: '', missed_2_type: '', missed_2_min: '', missed_2_words: '' };
const WHY = 'I saw it from the back of the room myself.';
const C1 = { cmb_C3_level: '3', cmb_C3_why: WHY, cmb_C5_level: '2', cmb_C5_why: WHY };
const C2 = { cmb_C7_level: 'NA', cmb_C7_why: 'No group task in this lesson at all.', cmb_D3_level: '1', cmb_D3_why: WHY };
const C3 = { cmb_D4_level: '3', cmb_D4_why: WHY, d2_children: '7', d2_quiet_later: '2', cmb_D2_level: '4', cmb_D2_why: WHY };
async function toAddedDc(id, missed) {
  await toExplain(id);
  await ex(id, 'MISSED', { ...EMPTY, ...missed });
  await ex(id, 'COMBINED_ONE', C1);
  await ex(id, 'COMBINED_TWO', C2);
  return ex(id, 'COMBINED_THREE', C3);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', region: 'Sihala' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en' },
    ],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
  });
  Switch._resetCache();
});

describe('the Flow', () => {
  const flow = buildEvidenceCheckFlow();
  const s = flow.screens.find((x) => x.id === 'MISSED');
  const comps = [];
  const walk = (list) => (list || []).forEach((c) => { comps.push(c); walk(c.children); walk(c.then); walk(c.else); });
  if (s) walk(s.layout.children);
  const S = observe2Strings('en');

  test('MISSED sits between the moments and the room levels, v6 only', () => {
    expect(s).toBeTruthy();
    expect(flow.routing_model.HEARD_EXPLAIN).toContain('MISSED');
    expect(flow.routing_model.MISSED).toEqual(['COMBINED_ONE']);
    expect(V6_CHECK).toBe('2');
    const footer = flow.screens.find((x) => x.id === 'HEARD_EXPLAIN').layout.children[0].children.find((c) => c.type === 'Footer');
    expect(footer['on-click-action'].payload.v6c).toBe('2');
  });

  test('two slots, each optional: a type from the endpoint\'s list, the minute, the words', () => {
    expect(s.title).toBe(S.missed_title);
    for (const i of [1, 2]) {
      const type = comps.find((c) => c.name === `missed_${i}_type`);
      const min = comps.find((c) => c.name === `missed_${i}_min`);
      const words = comps.find((c) => c.name === `missed_${i}_words`);
      expect(type).toMatchObject({ type: 'Dropdown', required: false, label: S.missed_type, 'data-source': '${data.missed_types}' });
      expect(min).toMatchObject({ type: 'TextInput', 'input-type': 'number', required: false, label: S.missed_min });
      expect(words).toMatchObject({ type: 'TextArea', required: false, label: S.missed_words, 'max-length': 280 });
    }
    expect(s.data.missed_types.type).toBe('array');
    expect((s.layout.children[0]['init-values'] || {})).toEqual({});
  });

  test('caps: labels within 20, helpers within 80, the title within 30, at most 50 components', () => {
    expect(cp(S.missed_title)).toBeLessThanOrEqual(30);
    for (const c of comps) {
      if (c.label) expect(cp(c.label)).toBeLessThanOrEqual(20);
      if (c['helper-text']) expect(cp(c['helper-text'])).toBeLessThanOrEqual(80);
    }
    expect(comps.length).toBeLessThanOrEqual(50);
  });
});

describe('a v5 visit never sees MISSED', () => {
  test('even from the new Flow, the moments go straight to the levels', async () => {
    const id = await checkable();
    expect((await toExplain(id)).screen).toBe('ADDED_ONE');
  });
});

describe('a v6 visit', () => {
  beforeEach(() => setSwitch('v6'));

  test('the moments lead to MISSED, with every moment type the coach can add', async () => {
    const id = await checkable();
    const out = await toExplain(id);
    expect(out.screen).toBe('MISSED');
    const types = MomentTypes.TYPES_V6 || MomentTypes.TYPES;
    const want = Object.values(types).flatMap((g) => Object.keys(g));
    expect(out.data.missed_types.map((o) => o.id)).toEqual(want);
    for (const o of out.data.missed_types) expect(cp(o.title)).toBeLessThanOrEqual(30);
  });

  test('a v6 visit on the Flow before MISSED (v6c 1) goes straight to the room levels', async () => {
    const id = await checkable();
    expect((await toExplain(id, { v6c: '1' })).screen).toBe('COMBINED_ONE');
  });

  test('a slot with a type and words is stored as a confirmed coach moment; words without a type are ignored', async () => {
    const id = await checkable();
    await toExplain(id);
    const out = await ex(id, 'MISSED', {
      ...EMPTY,
      missed_1_type: 'open_q_one', missed_1_min: '12', missed_1_words: '  Ayesha, what do you think happens next?  ',
      missed_2_type: '', missed_2_min: '20', missed_2_words: 'Something with no type',
    });
    expect(out.screen).toBe('COMBINED_ONE');
    expect(row(id).evidence_review.missed).toEqual([
      { id: 'missed_1', type: 'open_q_one', minute: 12, quote: 'Ayesha, what do you think happens next?', source: 'coach', confirmed: true },
    ]);
  });

  test('an unknown type, or a type with no words, is ignored; a minute that is not a whole number is kept as none', async () => {
    const id = await checkable();
    await toExplain(id);
    await ex(id, 'MISSED', {
      ...EMPTY,
      missed_1_type: 'not_a_type', missed_1_words: 'Some words here',
      missed_2_type: 'probe', missed_2_min: 'twelve', missed_2_words: 'How do you know?',
    });
    expect(row(id).evidence_review.missed).toEqual([
      { id: 'missed_2', type: 'probe', minute: null, quote: 'How do you know?', source: 'coach', confirmed: true },
    ]);
  });

  test('nothing added: an empty list, and the check goes on', async () => {
    const id = await checkable();
    await toExplain(id);
    expect((await ex(id, 'MISSED', EMPTY)).screen).toBe('COMBINED_ONE');
    expect(row(id).evidence_review.missed).toEqual([]);
  });

  test('the added moments add up with the confirmed ones: a second open question lifts C1 from 2 to 3', async () => {
    const without = await toAddedDc(await checkable(), {});
    expect(without.screen).toBe('ADDED_DC_ONE');
    expect(without.data.C1_level).toBe('2');
    const id = await checkable();
    const withIt = await toAddedDc(id, { missed_1_type: 'open_q_one', missed_1_min: '12', missed_1_words: 'Ayesha, what do you think happens next?' });
    expect(withIt.data.C1_level).toBe('3');
    expect(row(id).evidence_review.added.C1).toBe('3');
  });

  test('the words are kept to 280 code points', async () => {
    const id = await checkable();
    await toExplain(id);
    await ex(id, 'MISSED', { ...EMPTY, missed_1_type: 'probe', missed_1_words: 'ب'.repeat(400) });
    expect(cp(row(id).evidence_review.missed[0].quote)).toBe(280);
  });
});

describe('the analysis', () => {
  test('a v6 visit carries the coach-added moments in observe2.missed', () => {
    const missed = [{ id: 'missed_1', type: 'probe', minute: 12, quote: 'How do you know?', source: 'coach', confirmed: true }];
    const a = buildAnalysis({ id: 'f', rubric_version: 'fico17_v6', answers: {}, final_levels: {}, evidence_review: { missed } }, { brief: 'x' });
    expect(a.observe2.missed).toEqual(missed);
  });
  test('a v5 visit has no missed key', () => {
    const a = buildAnalysis({ id: 'f', rubric_version: 'fico-ict-17-2026-09', answers: {}, final_levels: {}, evidence_review: {} }, { brief: 'x' });
    expect('missed' in a.observe2).toBe(false);
  });
});
