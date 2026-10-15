/**
 * /observe2 — children's thinking, made explicit without a new scored indicator (FICO pilot sheet R16,
 * The ICT lead, 14 Oct: "Critical thinking does not appear to be explicitly or adequately addressed … help
 * coaches distinguish between simple recall of information and deeper thinking").
 *
 * Six of the 17 already score it (the workbook's descriptors): what the teacher does, C1 (a question
 * needing reasoning, probed), F3 (why it works; children reason it out), F4 (links; children make
 * their own); what the children do, D1 (reasoning vs restating), D4 (trying when unsure), D5 (their own
 * content questions). Part 2 now asks what the children's work showed, recall or reasoning, and the
 * answer feeds D1, D5, F3 and F4. The six are grouped as "Thinking" where the coach and the record read
 * them.
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
const { buildEvidenceCheckFlow } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');
const { addUp, THINK_SAID } = require('../../bot/shared/services/observe/observe2/rules');
const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
const { THINKING, ROW, PLAIN } = require('../../bot/shared/services/observe/observe2/fico17');

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
const components = (screen) => { const out = []; walk(screen.layout.children, (c) => out.push(c)); return out; };

const PART_1 = {
  present: '30', p1_spoke: '6', p1_picked: 'often', p1_groups: 'combine', p1_listen: ['often'], p1_materials: 'children', p1_used: ['book'],
  p1_change: 'yes', p1_change_how: 'clear',
};
const PART_2 = {
  screen: 'PART_TWO', fv: FORM_VERSION, p2_spoke: '9', p2_new: '3', p2_task: 'all', p2_teacher: ['round'], p2_stuck: 'sure',
  p2_think: ['why', 'ownq'], p2_change: 'no', p2_notes: '',
};
const ANSWERS = { ...PART_1, ...PART_2, screen: undefined, fv: undefined };

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' }],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
  });
});

describe('the Thinking group', () => {
  test('is the six indicators that already score it: what the teacher does, and what the children do', () => {
    expect(THINKING.teacher).toEqual(['C1', 'F3', 'F4']);
    expect(THINKING.children).toEqual(['D1', 'D4', 'D5']);
    expect(THINKING.codes.sort()).toEqual(['C1', 'D1', 'D4', 'D5', 'F3', 'F4']);
  });

  test('the check labels those six rows "Thinking"', () => {
    const flow = buildEvidenceCheckFlow();
    const heads = flow.screens.filter((s) => s.id.startsWith('ADDED_')).flatMap(components)
      .filter((c) => c.type === 'TextSubheading').map((c) => c.text);
    for (const code of THINKING.codes) expect(heads).toContain(`Thinking: ${ROW[code]}`);
    expect(heads).toContain(ROW.C7);
  });
});

describe('Part 2 asks what the children\'s work showed', () => {
  test('a required tick-list, recall or reasoning, whose every answer has a rule', () => {
    const part2 = buildFieldFormFlow().screens.find((s) => s.id === 'PART_TWO');
    const q = components(part2).find((c) => c.name === 'p2_think');
    expect(q.type).toBe('CheckboxGroup');
    expect(q.required).toBe(true);
    expect(q['data-source'].map((o) => o.id).sort()).toEqual(Object.keys(THINK_SAID).sort());
    expect(q['data-source'].map((o) => o.id)).toContain('recall');
  });

  test('Part 2 is refused without it, and saved with it', async () => {
    const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: null, visitContext: {} });
    Object.assign(row(form.id), { period_minutes: 30, answers: PART_1, part1_done_at: 'x' });
    const refused = await Form.handleObserve2FormDataExchange(formToken(form.id), 'PART_TWO', { ...PART_2, p2_think: [] });
    expect(refused.data.error_messages.p2_think).toBeTruthy();
    const out = await Form.handleObserve2FormDataExchange(formToken(form.id), 'PART_TWO', PART_2);
    expect(out.screen).toBe('LESSON_PLAN');
    expect(row(form.id).answers.p2_think).toEqual(['why', 'ownq']);
  });
});

describe('what it adds up to', () => {
  const lv = (think, code, extra = {}) => addUp({ form: { ...ANSWERS, p2_think: think, ...(extra.form || {}) }, confirmed: extra.confirmed || [] })[code];

  test('D1: a reason the coach saw counts once, as a confirmed moment does', () => {
    expect(lv(['why'], 'D1')).toMatchObject({ level: 2, hole: true });
    expect(lv(['why'], 'D1', { confirmed: [{ type: 'reasoning' }] }).level).toBe(3);
    expect(lv(['why', 'new'], 'D1').level).toBe(3);
    expect(lv(['why', 'new', 'apply'], 'D1').level).toBe(4);
    expect(lv(['why'], 'D1').because).toMatch(/you saw in Part 2, children explained why or how/);
  });

  test('recall is named, and never raises a level', () => {
    const r = lv(['recall'], 'D1');
    expect(r.level).toBe(1);
    expect(r.because).toMatch(/repeated or copied it/);
    expect(lv(['recall'], 'F3').because).toMatch(/repeated or copied it/);
    expect(lv(['recall'], 'F3').level).toBeNull();
  });

  test('D5: a question about the content is level 3', () => {
    expect(lv(['ownq'], 'D5').level).toBe(3);
    expect(lv(['recall'], 'D5').level).toBe(1);
  });

  test('F3 and F4 stay the coach\'s pick, with what was seen on the line', () => {
    expect(lv(['why', 'new'], 'F3')).toMatchObject({ level: null, source: 'pick' });
    expect(lv(['why', 'new'], 'F3').because).toMatch(/explained why or how; solved a new problem/);
    expect(lv(['apply'], 'F4').because).toMatch(/gave their own example or link/);
  });

  test('a failed recording keeps what the coach saw, and only that', () => {
    const failed = { form: { incident: 'tech' } };
    expect(lv(['ownq'], 'D5', failed).level).toBe(3);
    expect(lv(['why', 'new'], 'D1', failed).level).toBe(3);
    expect(lv(['recall'], 'D1', failed).level).toBe('IE');
    expect(lv(['ownq'], 'C1', failed).level).toBe('IE');
  });

  test('the check pre-fills D1 and D5 from it', async () => {
    const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: null, visitContext: {} });
    Object.assign(row(form.id), {
      answers: { ...ANSWERS, incident: 'none', lp: 'none', priority: 'D1' }, sealed_at: 'x', part1_done_at: 'x', part2_done_at: 'x',
      coaching_session_id: 'sess-1', rumi_moments: { moments: [], counts: {} }, moments_ready_at: 'x',
    });
    let out;
    for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK', 'HEARD_EXPLAIN']) {
      // eslint-disable-next-line no-await-in-loop
      out = await Check.handleObserve2CheckDataExchange(checkToken(form.id), s, { screen: s });
    }
    expect(out.data).toMatchObject({ D1_level: '2', D5_level: '3' });
    expect(out.data.D5_because).toMatch(/asked a question about it/);
  });
});

describe('where the coach and the record read it', () => {
  const form = {
    id: 'f1', answers: { ...ANSWERS, priority: 'C7' }, rumi_moments: { moments: [] }, evidence_review: {},
    final_levels: { C1: '3', F3: '2', D1: '2', D4: '2', D5: '3', C7: '2' },
  };

  test.each(['en', 'ur'])('the brief has a children\'s thinking block (%s)', (lang) => {
    const text = buildBrief(form, { lang });
    if (lang === 'en') {
      expect(text).toContain("Children's thinking:");
      expect(text).toContain('• You saw: explained why or how; asked a question about it');
      expect(text).toContain(`• The teacher: ${PLAIN.C1[2].toLowerCase()} · ${PLAIN.F3[1].toLowerCase()}`);
      expect(text).toContain(`• The children: ${PLAIN.D1[1].toLowerCase()} · ${PLAIN.D4[1].toLowerCase()} · ${PLAIN.D5[2].toLowerCase()}`);
    }
    expect(text).not.toMatch(/undefined|null|NaN/);
  });

  test('the record groups the six as thinking and adds what was seen to their evidence', () => {
    const a = buildAnalysis(form);
    const inds = Object.values(a.domains).flatMap((d) => d.indicators);
    expect(inds.filter((i) => i.group === 'thinking').map((i) => i.id).sort()).toEqual(['C1', 'D1', 'D4', 'D5', 'F3', 'F4']);
    expect(a.observe2.thinking).toEqual({ teacher: ['C1', 'F3', 'F4'], children: ['D1', 'D4', 'D5'], seen: ['why', 'ownq'] });
    expect(inds.find((i) => i.id === 'D5').evidence).toContain('Seen in Part 2, children asked a question about it');
    // The section sums are unchanged by the grouping.
    expect(a.domains.student_engagement.domain_score).toBe(2 + 2 + 3);
  });
});
