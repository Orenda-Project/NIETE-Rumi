/**
 * /observe2 — what materials were used, named (FICO pilot sheet R17, the ICT lead, 14 Oct: "a teacher who uses
 * only the textbook and board may receive the same score as a teacher who prepares additional teaching
 * aids … Teacher-developed materials should be recognised when they add meaningful instructional value,
 * rather than being rewarded simply because extra materials are present").
 *
 * C8's level still comes from who used the materials (its descriptors are the rubric owner's). Part 1 now
 * also asks what was used, and the answer is named on C8's line at the check, in the record (the teacher's
 * portal) and in the brief, so a teacher's own materials are recognised by name.
 *
 * Real: endpoints, store, rules, brief, analysis. Mocked: the database (in memory), WhatsApp.
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

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Form = require('../../bot/shared/routes/observe2-form-endpoint');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const { buildFieldFormFlow, FORM_VERSION } = require('../../bot/shared/services/observe/observe2/field-form.flow');
const { addUp, USED_SAID } = require('../../bot/shared/services/observe/observe2/rules');
const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
const { PLAIN } = require('../../bot/shared/services/observe/observe2/fico17');

const formToken = (id) => `coach-1:observe2-form:${id}`;
const checkToken = (id) => `coach-1:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);

function walk(node, visit) {
  if (Array.isArray(node)) node.forEach((c) => walk(c, visit));
  else if (node && typeof node === 'object') {
    if (node.type) visit(node);
    for (const k of ['children', 'then', 'else']) if (Array.isArray(node[k])) walk(node[k], visit);
  }
}

const PART_1 = {
  screen: 'PART_ONE', fv: FORM_VERSION, present: '30', p1_spoke: '6', p1_picked: 'often', p1_groups: 'none',
  p1_materials: 'children', p1_used: ['pictures', 'made'], p1_change: 'no', p1_notes: '',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' }],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
  });
});

async function newForm(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: null, visitContext: {} });
  Object.assign(row(form.id), { period_minutes: 35 }, patch);
  return form.id;
}

describe('Part 1 asks what was used', () => {
  test('a tick-list, shown once materials were used, whose every answer is named', () => {
    const part1 = buildFieldFormFlow().screens.find((s) => s.id === 'PART_ONE');
    const ifs = [];
    let used;
    walk(part1.layout.children, (c) => {
      if (c.type === 'If') ifs.push(c.condition);
      if (c.name === 'p1_used') used = c;
    });
    expect(used).toBeDefined();
    expect(used.type).toBe('CheckboxGroup');
    expect(used.required).toBe(true);
    expect(used['data-source'].map((o) => o.id).sort()).toEqual(Object.keys(USED_SAID).sort());
    expect(used['data-source'].map((o) => o.title)).toEqual(['Textbook or board', 'Charts or pictures', 'Objects or manipulatives', 'Materials the teacher made']);
    expect(ifs).toEqual(expect.arrayContaining(["${form.p1_materials} != 'none'", "${form.p1_materials} != 'nofit'"]));
  });

  test('refused without it once materials were used, and saved with it', async () => {
    const id = await newForm();
    const refused = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', { ...PART_1, p1_used: [] });
    expect(refused.screen).toBe('PART_ONE');
    expect(refused.data.error_messages.p1_used).toBeTruthy();
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', PART_1);
    expect(out.screen).toBe('PART_TWO');
    expect(row(id).answers.p1_used).toEqual(['pictures', 'made']);
  });

  test('not asked when nothing was used, nor on a form on today\'s Flow', async () => {
    const none = await Form.handleObserve2FormDataExchange(formToken(await newForm()), 'PART_ONE', { ...PART_1, p1_materials: 'none', p1_used: [] });
    expect(none.screen).toBe('PART_TWO');
    const old = await Form.handleObserve2FormDataExchange(formToken(await newForm()), 'PART_ONE', { ...PART_1, fv: undefined, p1_used: undefined });
    expect(old.screen).toBe('PART_TWO');
  });
});

describe('the materials are named; C8\'s level is unchanged', () => {
  const answers = { ...PART_1, screen: undefined, fv: undefined };

  test('C8\'s line at the check names them, and the level is still who used them', () => {
    const r = addUp({ form: answers }).C8;
    expect(r.level).toBe(3);
    expect(r.because).toBe(`you saw: ${PLAIN.C8[2].toLowerCase()}. Used: charts or pictures; materials the teacher made`);
    expect(addUp({ form: { ...answers, p1_used: ['book'] } }).C8.level).toBe(3);
  });

  test('the check shows it', async () => {
    const id = await newForm({
      answers: { ...answers, p2_spoke: '3', p2_new: '0', incident: 'none', lp: 'none', priority: 'C8' },
      sealed_at: 'x', part1_done_at: 'x', part2_done_at: 'x', coaching_session_id: 'sess-1',
      rumi_moments: { moments: [], counts: {} }, moments_ready_at: 'x',
    });
    const out = await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_ONE', { screen: 'ADDED_ONE' });
    expect(out.screen).toBe('ADDED_TWO');
    expect(out.data.C8_because).toMatch(/Used: charts or pictures; materials the teacher made/);
  });

  test('the record and the brief name them', () => {
    const form = { id: 'f1', answers: { ...answers, priority: 'C8' }, rumi_moments: { moments: [] }, evidence_review: {}, final_levels: { C8: '3', C3: '3' } };
    const a = buildAnalysis(form);
    const c8 = a.domains.high_leverage_practices.indicators.find((i) => i.id === 'C8');
    expect(c8.evidence).toBe(`${PLAIN.C8[2]}. Used: charts or pictures; materials the teacher made`);
    expect(c8.score).toBe(3);
    for (const lang of ['en', 'ur']) {
      const text = buildBrief(form, { lang });
      expect(text).toContain('charts or pictures; materials the teacher made');
      expect(text).not.toMatch(/undefined|null|NaN/);
    }
  });
});
