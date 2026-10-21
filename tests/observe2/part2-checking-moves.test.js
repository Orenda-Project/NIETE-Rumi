/**
 * /observe2 — the teacher's checking moves while the children work on their own (FICO pilot sheet R4,
 * a coach's comment rewritten after round 6): asking children one by one whether they understood or
 * needed help (a check for understanding), and re-explaining a mistake many children made to the whole class.
 *
 * Two ticks under Part 2's "While they worked, the teacher" (form version 6). They feed the indicators whose
 * workbook descriptors they evidence (ROOT_CAUSE.md has the table): re-explaining is a response to wrong
 * answers, so C2 is at least 2 (C2 L2 "… or re-explains"); asking each child is named on C2 and C3, and sets
 * no level. The 17 descriptors and the section sums are unchanged.
 *
 * Real: the form and check endpoints, the store, the rules, the analysis. Mocked: the database (in memory),
 * WhatsApp, the debrief service's chat side, the child-test offer.
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
jest.mock('../../bot/shared/services/child-test/conversation/offer', () => ({ sendOffer: jest.fn(() => Promise.resolve(false)) }), { virtual: true });

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Form = require('../../bot/shared/routes/observe2-form-endpoint');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const { buildFieldFormFlow, FORM_VERSION, PREFILL, PREFILLED } = require('../../bot/shared/services/observe/observe2/field-form.flow');
const { addUp, TEACHER_SAID } = require('../../bot/shared/services/observe/observe2/rules');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');

const ASKED = 'asked children one by one whether they understood or needed help';
const RETAUGHT = 're-explained a common mistake to the whole class';

const formToken = (id) => `coach-1:observe2-form:${id}`;
const checkToken = (id) => `coach-1:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const cp = (s) => [...String(s)].length;

const PART_1 = {
  screen: 'PART_ONE', fv: FORM_VERSION, prefill: PREFILL, present: '30', p1_spoke: '6', p1_picked: 'often', p1_groups: 'combine', p1_listen: ['often'],
  p1_listen_other: '', p1_materials: 'children', p1_used: ['book'], p1_change: 'yes', p1_change_how: 'clear', p1_notes: '',
};
const PART_2 = (ticks) => ({
  screen: 'PART_TWO', fv: FORM_VERSION, prefill: PREFILL, p2_spoke: '9', p2_new: '3', p2_task: 'all', p2_teacher: ticks, p2_stuck: 'unsure',
  p2_think: ['why'], p2_change: 'yes', p2_change_how: 'slow', p2_notes: '',
});
const heard = (screen) => {
  const out = { screen };
  for (let i = 1; i <= 8; i += 1) out[`${screen.toLowerCase()}_${i}`] = '';
  return out;
};

async function newForm(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), { period_minutes: 35 }, patch);
  return form.id;
}

// Part 1 and Part 2 through the form's endpoint, sealed by hand, then the check to its first level screen.
async function checkedLevels(ticks) {
  const id = await newForm();
  await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', PART_1);
  const p2 = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_TWO', PART_2(ticks));
  expect(p2.screen).toBe('LESSON_PLAN');
  Object.assign(row(id), {
    answers: { ...row(id).answers, lp: 'none', incident: 'none', priority: 'C2' }, sealed_at: '2026-10-21T05:39:00.000Z',
    coaching_session_id: 'sess-1', rumi_moments: { moments: [], counts: {} }, moments_ready_at: 'x',
  });
  for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK']) await Check.handleObserve2CheckDataExchange(checkToken(id), s, heard(s));
  const out = await Check.handleObserve2CheckDataExchange(checkToken(id), 'HEARD_EXPLAIN', heard('HEARD_EXPLAIN'));
  expect(out.screen).toBe('ADDED_ONE');
  return { id, data: out.data };
}

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

describe('Part 2 asks for them', () => {
  const part2 = () => buildFieldFormFlow().screens.find((s) => s.id === 'PART_TWO');
  const find = (node, name) => {
    if (!node || typeof node !== 'object') return null;
    if (node.name === name) return node;
    for (const v of Object.values(node)) {
      const hit = Array.isArray(v) ? v.map((x) => find(x, name)).find(Boolean) : find(v, name);
      if (hit) return hit;
    }
    return null;
  };

  test('"While they worked, the teacher" has both moves, in plain words within the caps', () => {
    const options = find(part2(), 'p2_teacher')['data-source'];
    const byId = Object.fromEntries(options.map((o) => [o.id, o]));
    expect(byId.cfu).toEqual({ id: 'cfu', title: 'Asked children one by one', description: expect.stringMatching(/understood or needed help.*check for understanding/i) });
    expect(byId.reteach).toEqual({ id: 'reteach', title: 'Re-explained a common mistake', description: expect.stringMatching(/mistake many children made/) });
    for (const o of options) expect(cp(o.title)).toBeLessThanOrEqual(30);
    expect(Object.keys(TEACHER_SAID)).toEqual(expect.arrayContaining(['cfu', 'reteach']));
  });

  test('the form that asks them is version 6', () => {
    expect(FORM_VERSION).toBe('6');
  });
});

describe('they feed the indicators whose descriptors they evidence', () => {
  test('re-explaining a common mistake makes C2 at least 2, and both moves are named on C2\'s line at the check', async () => {
    const { data } = await checkedLevels(['round', 'cfu', 'reteach']);
    expect(data.C2_level).toBe('2');
    expect(data.C2_because).toContain(ASKED);
    expect(data.C2_because).toContain(RETAUGHT);
  });

  test('asking each child is named on C3\'s line too, and changes neither level', async () => {
    const { data } = await checkedLevels(['round', 'cfu']);
    expect(data.C3_level).toBe('3');
    expect(data.C3_because).toContain(ASKED);
    expect(data.C2_level).toBe('');
    expect(data.C2_because).toContain(ASKED);
  });

  test('re-explaining never raises C2 above 2 by itself, and a higher level from the recording stands', () => {
    const a = { p2_task: 'all', p2_teacher: ['reteach'], p2_stuck: 'unsure', p2_think: ['why'] };
    const twice = [{ type: 'wrong_reason' }, { type: 'wrong_reason' }];
    expect(addUp({ form: a, confirmed: [], heardCounts: {} }).C2.level).toBe(2);
    expect(addUp({ form: a, confirmed: twice, heardCounts: {} }).C2.level).toBe(3);
  });

  test('a failed recording leaves what the coach saw standing', () => {
    const out = addUp({ form: { incident: 'tech', p2_task: 'all', p2_teacher: ['reteach'], p2_stuck: 'sure', p2_think: ['recall'] }, confirmed: [], heardCounts: {} });
    expect(out.C2).toMatchObject({ level: 2, source: 'seen' });
    expect(out.C2.because).toContain(RETAUGHT);
  });

  test('F1 and D5 are not touched by either move', () => {
    const base = { p2_task: 'all', p2_teacher: ['round'], p2_stuck: 'unsure', p2_think: ['why'] };
    const before = addUp({ form: base, confirmed: [], heardCounts: {} });
    const after = addUp({ form: { ...base, p2_teacher: ['round', 'cfu', 'reteach'] }, confirmed: [], heardCounts: {} });
    expect(after.F1).toEqual(before.F1);
    expect(after.D5).toEqual(before.D5);
  });

  test('the record keeps them under C2 and C3, which is what the teacher\'s portal shows', () => {
    const analysis = buildAnalysis({
      id: 'f1', answers: { p1_picked: 'often', p2_task: 'all', p2_teacher: ['cfu', 'reteach'], p2_stuck: 'unsure', p2_think: ['why'] },
      rumi_moments: { moments: [] }, final_levels: { C2: '2', C3: '3' }, evidence_review: { priority_final: 'C2' },
    });
    const ind = (code) => Object.values(analysis.domains).flatMap((d) => d.indicators).find((i) => i.id === code);
    expect(ind('C2').evidence).toContain(ASKED);
    expect(ind('C2').evidence).toContain(RETAUGHT);
    expect(ind('C3').evidence).toContain(ASKED);
  });
});

describe('a form opened on an older Flow', () => {
  // Meta takes an init value only from the field's own list. "While they worked, the teacher" sits inside an
  // If, and fields inside an If are never pre-filled (field-form.flow.js PREFILL_SCREENS), so a tick added in
  // version 6 can never be sent to an older Flow's list. If that ever changes, the pre-fill must filter by `fv`.
  test('Part 2 comes back with what was saved, but never pre-fills the teacher\'s ticks', async () => {
    expect(PREFILLED.PART_TWO).not.toContain('p2_teacher');
    const id = await newForm({ part1_done_at: 'x', part2_done_at: 'x', answers: { present: '30', p1_spoke: '6', p2_teacher: ['round', 'cfu', 'reteach'], p2_task: 'all' } });
    const back = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', { ...PART_1, fv: '5' });
    expect(back.screen).toBe('PART_TWO');
    expect(back.data.init_p2_task).toBe('all');
    expect(Object.keys(back.data)).not.toContain('init_p2_teacher');
  });

  test('its Part 2 saves as before', async () => {
    const id = await newForm();
    await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', { ...PART_1, fv: '5' });
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_TWO', { ...PART_2(['round', 'helped']), fv: '5' });
    expect(out.screen).toBe('LESSON_PLAN');
    expect(row(id).answers.p2_teacher).toEqual(['round', 'helped']);
  });
});
