/**
 * /observe2 on FICO17 v6 — why Rumi's level changed (spec §9.1; CONTRACTS §6.2, §6.5; RULINGS Q2, R8).
 *
 * On ADDED_DC_ONE / ADDED_DC_TWO (Rumi's 11, pre-filled) a changed level needs a reason from the list (didn't
 * happen, wrong speaker, wrong label, recording missed it, rubric doesn't fit) and the written note of 20+
 * characters; the minute is optional and, when given, a whole minute inside the period. Each changed row is stored
 * with override = { from, to, reason, minute, by: 'coach', at }; a row left as Rumi set it has no override. A v6
 * visit on the Flow before the list (v6c '1') is asked only for the note, as that Flow does.
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
  buildDebriefChoiceButtons: jest.fn(() => ({ body: '', buttons: [] })),
}));

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const { buildEvidenceCheckFlow, V6_CHECK } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');

const token = (id) => `coach-1:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const cp = (s) => [...String(s)].length;
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };
const S = observe2Strings('en');
const REASONS = ['didnt_happen', 'wrong_speaker', 'wrong_label', 'recording_missed', 'rubric_doesnt_fit'];

const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
  p2_spoke: '10', p2_new: '5', p2_task: 'all', p2_change: 'no', incident: 'none', lp: 'used', priority: 'C8',
};
const MOMENTS = [
  { id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? Ali?', label: 'open question' },
  { id: 'wrong_1', moment: 'wrong', type: 'wrong_ignored', minute: '05:10', quote: 'No, that is wrong. Who else?', label: 'wrong answer left' },
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
const WHY = 'I saw it from the back of the room myself.';
const NOTE = 'The teacher gave the reason twice, at 5 and 9.';
async function toAddedDc(id, v6c = V6_CHECK) {
  await ex(id, 'HEARD_ASK', heard('HEARD_ASK', { 1: 'yes' }));
  await ex(id, 'HEARD_WRONG', heard('HEARD_WRONG', { 1: 'yes' }));
  await ex(id, 'HEARD_WORK', heard('HEARD_WORK'));
  const next = await ex(id, 'HEARD_EXPLAIN', heard('HEARD_EXPLAIN', {}, { v6c }));
  if (next.screen === 'MISSED') await ex(id, 'MISSED', {});
  await ex(id, 'COMBINED_ONE', { cmb_C3_level: '3', cmb_C3_why: WHY, cmb_C5_level: '2', cmb_C5_why: WHY });
  await ex(id, 'COMBINED_TWO', { cmb_C7_level: 'NA', cmb_C7_why: 'No group task in this lesson at all.', cmb_D3_level: '1', cmb_D3_why: WHY });
  return ex(id, 'COMBINED_THREE', { cmb_D4_level: '3', cmb_D4_why: WHY, d2_children: '7', d2_quiet_later: '2', cmb_D2_level: '4', cmb_D2_why: WHY });
}
const keep = (d) => Object.fromEntries(Object.keys(d).filter((k) => /^[CDF]\d_level$/.test(k)).map((k) => [`${k.slice(0, 2)}_final`, d[k]]));

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', region: 'Sihala' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', teacher_level: ['PRIMARY'] },  // bd-ra8xu.42: v6 reaches grades 1-5 visits only
    ],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
    app_settings: [{ key: 'fico_coach_rubric', value: 'v6' }],
  });
  Switch._resetCache();
});

describe('the Flow', () => {
  const flow = buildEvidenceCheckFlow();
  const comps = (id) => {
    const out = [];
    const walk = (list) => (list || []).forEach((c) => { out.push(c); walk(c.children); walk(c.then); walk(c.else); });
    walk(flow.screens.find((s) => s.id === id).layout.children);
    return out;
  };
  test.each([['ADDED_DC_ONE', 'one'], ['ADDED_DC_TWO', 'two']])('%s asks why it changed: the five reasons, the minute, the note', (id, k) => {
    const c = comps(id);
    const kind = c.find((x) => x.name === `why6_kind_${k}`);
    expect(kind).toMatchObject({ type: 'RadioButtonsGroup', required: false, label: S.v6_why_kind });
    expect(kind['data-source'].map((o) => o.id)).toEqual(REASONS);
    expect(kind['data-source'].map((o) => o.title)).toEqual(REASONS.map((r) => S.v6_override_reasons[r]));
    for (const o of kind['data-source']) expect(cp(o.title)).toBeLessThanOrEqual(30);
    expect(cp(kind.label)).toBeLessThanOrEqual(30);
    const min = c.find((x) => x.name === `why6_min_${k}`);
    expect(min).toMatchObject({ type: 'TextInput', 'input-type': 'number', required: false });
    expect(cp(min.label)).toBeLessThanOrEqual(20);
    expect(cp(min['helper-text'])).toBeLessThanOrEqual(80);
    expect(c.find((x) => x.name === `why6_${k}`)).toMatchObject({ type: 'TextArea', required: false });
    expect((flow.screens.find((s) => s.id === id).layout.children[0]['init-values'] || {})[`why6_kind_${k}`]).toBeUndefined();
    expect(c.length).toBeLessThanOrEqual(50);
  });
});

describe('a changed level', () => {
  test('without a reason from the list: refused, a message under the list', async () => {
    const id = await checkable();
    const a1 = await toAddedDc(id);
    expect(a1.screen).toBe('ADDED_DC_ONE');
    const changed = { ...keep(a1.data), C2_final: a1.data.C2_level === '3' ? '2' : '3' };
    const out = await ex(id, 'ADDED_DC_ONE', { ...changed, why6_one: NOTE });
    expect(out.screen).toBe('ADDED_DC_ONE');
    expect(out.data.error_messages).toEqual({ why6_kind_one: S.v6_pick_reason });
  });

  test('without the note (20+ characters): refused, naming the row', async () => {
    const id = await checkable();
    const a1 = await toAddedDc(id);
    const out = await ex(id, 'ADDED_DC_ONE', { ...keep(a1.data), C2_final: '3', why6_kind_one: 'wrong_label', why6_one: 'short' });
    expect(out.screen).toBe('ADDED_DC_ONE');
    expect(Object.keys(out.data.error_messages)).toEqual(['why6_one']);
    expect(out.data.error_messages.why6_one).toMatch(/Helping when a child is wrong/);
  });

  test('a minute outside the period: refused', async () => {
    const id = await checkable();
    const a1 = await toAddedDc(id);
    const out = await ex(id, 'ADDED_DC_ONE', { ...keep(a1.data), C2_final: '3', why6_kind_one: 'recording_missed', why6_min_one: '55', why6_one: NOTE });
    expect(out.data.error_messages).toEqual({ why6_min_one: S.v6_minute_range(40) });
  });

  test('with a reason and the note: stored as override {from, to, reason, minute, by, at}; unchanged rows carry none', async () => {
    const id = await checkable();
    const a1 = await toAddedDc(id);
    const from = a1.data.C2_level;
    expect(from).toBe('1');
    const a2 = await ex(id, 'ADDED_DC_ONE', { ...keep(a1.data), C2_final: '3', why6_kind_one: 'recording_missed', why6_min_one: '9', why6_one: NOTE });
    expect(a2.screen).toBe('ADDED_DC_TWO');
    const pr = await ex(id, 'ADDED_DC_TWO', { ...keep(a2.data), why6_kind_two: '', why6_min_two: '', why6_two: '' });
    expect(pr.screen).toBe('PRIORITY');
    const rec = row(id).evidence_review.v6_C2;
    expect(rec).toMatchObject({ level: 3, because: NOTE, set_by: 'coach', rumi_level: 1 });
    expect(rec.override).toEqual({ from: 1, to: 3, reason: 'recording_missed', minute: 9, by: 'coach', at: expect.any(String) });
    expect(Number.isNaN(Date.parse(rec.override.at))).toBe(false);
    for (const code of ['C1', 'C6', 'D1', 'D5', 'C4', 'F1']) expect(row(id).evidence_review[`v6_${code}`].override).toBeUndefined();
    await ex(id, 'PRIORITY', { priority_final: 'C8', cv: '3', also_final_1: 'none', also_final_2: 'none' });
    await flush();
    expect(row(id).evidence_review.v6_levels.C2.override).toMatchObject({ from: 1, to: 3, reason: 'recording_missed', minute: 9, by: 'coach' });
    expect(row(id).final_levels.C2).toBe('3');
  });

  test('the minute is optional: none given is stored as null', async () => {
    const id = await checkable();
    const a1 = await toAddedDc(id);
    await ex(id, 'ADDED_DC_ONE', { ...keep(a1.data), C2_final: '2', why6_kind_one: 'rubric_doesnt_fit', why6_min_one: '', why6_one: NOTE });
    expect(row(id).evidence_review.v6_C2.override).toMatchObject({ from: 1, to: 2, reason: 'rubric_doesnt_fit', minute: null });
  });

  test('an unknown reason is not a reason', async () => {
    const id = await checkable();
    const a1 = await toAddedDc(id);
    const out = await ex(id, 'ADDED_DC_ONE', { ...keep(a1.data), C2_final: '2', why6_kind_one: 'because', why6_one: NOTE });
    expect(out.data.error_messages).toEqual({ why6_kind_one: S.v6_pick_reason });
  });

  test('nothing changed: no reason asked, no override stored', async () => {
    const id = await checkable();
    const a1 = await toAddedDc(id);
    const out = await ex(id, 'ADDED_DC_ONE', keep(a1.data));
    expect(out.screen).toBe('ADDED_DC_TWO');
    for (const code of ['C1', 'C2', 'C6', 'D1', 'D5']) expect(row(id).evidence_review[`v6_${code}`].override).toBeUndefined();
  });

  test('on the Flow before the list (v6c 1): the note alone, the override stored with no reason', async () => {
    const id = await checkable();
    const a1 = await toAddedDc(id, '1');
    expect(a1.screen).toBe('ADDED_DC_ONE');
    const out = await ex(id, 'ADDED_DC_ONE', { ...keep(a1.data), C2_final: '3', why6_one: NOTE });
    expect(out.screen).toBe('ADDED_DC_TWO');
    expect(row(id).evidence_review.v6_C2.override).toMatchObject({ from: 1, to: 3, reason: null, minute: null, by: 'coach' });
  });
});
