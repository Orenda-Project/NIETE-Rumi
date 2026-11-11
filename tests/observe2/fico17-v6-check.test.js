/**
 * /observe2 on FICO17 v6 (bd-ra8xu.38), behind the coach switch (app_settings fico_coach_rubric, default OFF).
 *
 * - The rubric is stamped once, when the visit's record is made; a flip mid-visit changes nothing for it.
 * - A v5 visit (switch off) walks today's check, screen for screen; the v5 screens of the Flow are unchanged.
 * - A v6 visit gets three COMBINED screens after the moments: the coach sets C3 C5 C7 D3 D4 D2 from the room,
 *   starting blank, each with a written reason of 20+ characters; D2 also takes the two child counts.
 * - Then Rumi's other 11 levels, pre-filled (operator's Q2-B); changing one needs a reason.
 * - On Submit every level is kept as today (final_levels, strings) and the v6 record says who set each one.
 *
 * Real: endpoint, store, rules, switch. Mocked: the database (in-memory), WhatsApp.
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
const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const { buildEvidenceCheckFlow } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
const V5_FLOW = require('./fixtures/evidence-check-v5.json');

const token = (id, userId = 'coach-1') => `${userId}:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };
const setSwitch = (value) => {
  mockFake.__tables.app_settings = value == null ? [] : [{ key: 'fico_coach_rubric', value }];
  Switch._resetCache();
};

const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
  p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no',
  incident: 'none', lp: 'used', priority: 'C8',
};
const MOMENTS = [
  { id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? Ali?', label: 'open question' },
  { id: 'wrong_1', moment: 'wrong', type: 'wrong_ignored', minute: '05:10', quote: 'No, that is wrong. Who else?', label: 'wrong answer left' },
  { id: 'wrong_2', moment: 'wrong', type: 'hedged', minute: '07:02', quote: 'Maybe it is... twelve?', label: 'unsure answer' },
];

async function checkable(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), {
    period_minutes: 40, answers: ANSWERS, sealed_at: '2026-11-12T05:39:00.000Z', part1_done_at: 'x', part2_done_at: 'x',
    coaching_session_id: 'sess-1', rumi_moments: { moments: MOMENTS, counts: { closed_q: 3 } },
    rumi_levels: { C1: { level: 2 } }, moments_ready_at: '2026-11-12T05:50:00.000Z',
  }, patch);
  return form.id;
}

const heard = (screen, answers = {}, extra = {}) => {
  const out = { screen, ...extra };
  for (let i = 1; i <= 8; i += 1) out[`${screen.toLowerCase()}_${i}`] = answers[i] || '';
  return out;
};
const ex = (id, screen, data) => Check.handleObserve2CheckDataExchange(token(id), screen, { screen, ...data });

async function toExplain(id, extra = { v6c: '1' }) {
  await ex(id, 'HEARD_ASK', heard('HEARD_ASK', { 1: 'yes' }));
  await ex(id, 'HEARD_WRONG', heard('HEARD_WRONG', { 1: 'yes', 2: 'yes' }));
  await ex(id, 'HEARD_WORK', heard('HEARD_WORK'));
  return ex(id, 'HEARD_EXPLAIN', heard('HEARD_EXPLAIN', {}, extra));
}

const WHY = 'I saw it from the back of the room myself.';
const C1 = { cmb_C3_level: '3', cmb_C3_why: WHY, cmb_C5_level: '2', cmb_C5_why: WHY };
const C2 = { cmb_C7_level: 'NA', cmb_C7_why: 'No group task in this lesson at all.', cmb_D3_level: '1', cmb_D3_why: WHY };
const C3 = { cmb_D4_level: '3', cmb_D4_why: WHY, d2_children: '7', d2_quiet_later: '2', cmb_D2_level: '4', cmb_D2_why: WHY };

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

describe('the rubric is stamped once, when the visit starts', () => {
  test('switch off (no row): v5, as today', async () => {
    const id = await checkable();
    expect(row(id).rubric_version).toBe('fico-ict-17-2026-09');
  });
  test('switch on for the coach\'s region: v6', async () => {
    setSwitch('{"sihala":"v6"}');
    const id = await checkable();
    expect(row(id).rubric_version).toBe('fico17_v6');
  });
  test('switch on for one test account only', async () => {
    setSwitch('{"user:coach-1":"v6","*":"current"}');
    expect(row(await checkable()).rubric_version).toBe('fico17_v6');
  });
  test('an unknown value is off', async () => {
    setSwitch('v7');
    expect(row(await checkable()).rubric_version).toBe('fico-ict-17-2026-09');
  });
  test('a flip mid-visit changes nothing: a v6 visit stays v6, a v5 visit stays v5', async () => {
    setSwitch('v6');
    const v6 = await checkable();
    setSwitch(null);
    expect((await toExplain(v6)).screen).toBe('COMBINED_ONE');
    const v5 = await checkable();
    setSwitch('v6');
    expect((await toExplain(v5)).screen).toBe('ADDED_ONE');
  });
});

describe('the Flow', () => {
  const flow = buildEvidenceCheckFlow();
  const byId = Object.fromEntries(flow.screens.map((s) => [s.id, s]));
  const fieldsOf = (s) => {
    const out = [];
    const walk = (list) => (list || []).forEach((c) => { out.push(c); walk(c.children); walk(c.then); walk(c.else); });
    walk(s.layout.children);
    return out;
  };

  test('every v5 screen is as it was, but for the v6 marker on the last moments screen\'s footer', () => {
    for (const old of V5_FLOW.screens) {
      const now = JSON.parse(JSON.stringify(byId[old.id]));
      if (old.id === 'HEARD_EXPLAIN') {
        const footer = fieldsOf(now).find((c) => c.type === 'Footer');
        expect(footer['on-click-action'].payload.v6c).toBe('1');
        delete footer['on-click-action'].payload.v6c;
      }
      expect(now).toEqual(old);
    }
    for (const [from, to] of Object.entries(V5_FLOW.routing_model)) {
      for (const t of to) expect(flow.routing_model[from]).toContain(t);
    }
  });

  test('three COMBINED screens hold C3 C5 / C7 D3 / D4 D2, each level blank (no init-value) and a reason required', () => {
    const want = { COMBINED_ONE: ['C3', 'C5'], COMBINED_TWO: ['C7', 'D3'], COMBINED_THREE: ['D4', 'D2'] };
    for (const [id, codes] of Object.entries(want)) {
      const s = byId[id];
      expect(s).toBeTruthy();
      const form = s.layout.children[0];
      const init = form['init-values'] || {};
      for (const code of codes) {
        expect(init[`cmb_${code}_level`]).toBeUndefined();
        const radio = fieldsOf(s).find((c) => c.name === `cmb_${code}_level`);
        expect(radio).toMatchObject({ type: 'RadioButtonsGroup', required: true });
        expect(radio['data-source'].map((o) => o.title).slice(0, 4)).toEqual(V6.TITLES[code]);
        for (const o of radio['data-source']) {
          expect([...o.title].length).toBeLessThanOrEqual(30);
          expect([...(o.description || '')].length).toBeLessThanOrEqual(300);
        }
        const why = fieldsOf(s).find((c) => c.name === `cmb_${code}_why`);
        expect(why).toMatchObject({ type: 'TextArea', required: true, label: 'Why this level' });
        expect([...why['helper-text']].length).toBeLessThanOrEqual(80);
      }
      expect(form['error-messages']).toBe('${data.error_messages}');
    }
    const d2 = fieldsOf(byId.COMBINED_THREE).filter((c) => ['d2_children', 'd2_quiet_later'].includes(c.name));
    expect(d2.map((c) => c['input-type'])).toEqual(['number', 'number']);
  });

  test('the v6 level screens list only the 11 DC indicators, pre-filled', () => {
    const codes = ['ADDED_DC_ONE', 'ADDED_DC_TWO'].flatMap((id) => fieldsOf(byId[id]).filter((c) => /_final$/.test(c.name || '')).map((c) => c.name.slice(0, 2)));
    expect(codes.sort()).toEqual([...V6.DC_CODES].sort());
    for (const id of ['ADDED_DC_ONE', 'ADDED_DC_TWO']) {
      const init = byId[id].layout.children[0]['init-values'];
      for (const c of fieldsOf(byId[id]).filter((x) => /_final$/.test(x.name || ''))) expect(init[c.name]).toBe(`\${data.${c.name.slice(0, 2)}_level}`);
    }
  });

  test('routes: moments → COMBINED → plan or the v6 levels → PRIORITY', () => {
    expect(flow.routing_model.HEARD_EXPLAIN).toEqual(expect.arrayContaining(['FIDELITY', 'ADDED_ONE', 'COMBINED_ONE']));
    expect(flow.routing_model.COMBINED_ONE).toEqual(['COMBINED_TWO']);
    expect(flow.routing_model.COMBINED_TWO).toEqual(['COMBINED_THREE']);
    expect(flow.routing_model.COMBINED_THREE).toEqual(expect.arrayContaining(['FIDELITY', 'ADDED_DC_ONE']));
    expect(flow.routing_model.FIDELITY).toEqual(expect.arrayContaining(['ADDED_ONE', 'ADDED_DC_ONE']));
    expect(flow.routing_model.ADDED_DC_ONE).toEqual(['ADDED_DC_TWO']);
    expect(flow.routing_model.ADDED_DC_TWO).toEqual(['PRIORITY']);
  });
});

describe('a v5 visit walks today\'s check', () => {
  test('even from the new Flow (v6 marker sent), the moments go straight to the levels', async () => {
    const id = await checkable();
    const out = await toExplain(id);
    expect(out.screen).toBe('ADDED_ONE');
  });
});

describe('a v6 visit', () => {
  beforeEach(() => setSwitch('v6'));

  test('from an older Flow (no v6 marker) the check runs on the v5 screens and says so', async () => {
    const id = await checkable();
    const out = await toExplain(id, {});
    expect(out.screen).toBe('ADDED_ONE');
    expect(row(id).evidence_review.v6_fallback).toBe(true);
  });

  test('the moments lead to COMBINED_ONE: the definition, the recording\'s evidence and what the coach adds', async () => {
    const id = await checkable();
    const out = await toExplain(id);
    expect(out.screen).toBe('COMBINED_ONE');
    expect(out.data.C3_ev).toContain(V6.indicator('C3').definition);
    expect(out.data.C3_ev).toMatch(/The recording showed nothing for this\./);
    expect(out.data.C3_ev).toContain(`Coach adds: ${V6.indicator('C3').coach_adds}`);
    expect(out.data.error_messages).toEqual({});
    expect(JSON.stringify(out.data)).not.toMatch(/"cmb_C3_level"/);
  });

  test('D4\'s evidence lists the unsure answer the recording caught', async () => {
    const id = await checkable();
    await toExplain(id);
    await ex(id, 'COMBINED_ONE', C1);
    const out = await ex(id, 'COMBINED_TWO', C2);
    expect(out.screen).toBe('COMBINED_THREE');
    expect(out.data.D4_ev).toContain('07:02  "Maybe it is... twelve?"');
    expect(out.data.D2_ev).toContain('On your form: 6 spoke in Part 1, 5 spoke for the first time in Part 2 (11 in all).');
  });

  test('no level: refused, the same screen with a message under the level', async () => {
    const id = await checkable();
    await toExplain(id);
    const out = await ex(id, 'COMBINED_ONE', { ...C1, cmb_C5_level: '' });
    expect(out.screen).toBe('COMBINED_ONE');
    expect(out.data.error_messages).toEqual({ cmb_C5_level: 'Choose a level.' });
  });

  test('a reason under 20 characters: refused', async () => {
    const id = await checkable();
    await toExplain(id);
    const out = await ex(id, 'COMBINED_ONE', { ...C1, cmb_C3_why: 'saw it' });
    expect(out.screen).toBe('COMBINED_ONE');
    expect(out.data.error_messages).toEqual({ cmb_C3_why: 'Write why you chose this level.' });
  });

  test('D2: counts that do not add up are refused; a level off the counts needs a number in the reason', async () => {
    const id = await checkable();
    await toExplain(id);
    await ex(id, 'COMBINED_ONE', C1);
    await ex(id, 'COMBINED_TWO', C2);
    let out = await ex(id, 'COMBINED_THREE', { ...C3, d2_children: '3', d2_quiet_later: '5' });
    expect(out.data.error_messages).toEqual({ d2_children: 'Check the two numbers.' });
    out = await ex(id, 'COMBINED_THREE', { ...C3, cmb_D2_level: '2' });
    expect(out.screen).toBe('COMBINED_THREE');
    expect(out.data.error_messages).toEqual({ cmb_D2_why: "Your level doesn't match the counts. Change one, or say why." });
    out = await ex(id, 'COMBINED_THREE', { ...C3, cmb_D2_level: '2', cmb_D2_why: 'Only 2 children spoke more than a word.' });
    expect(out.screen).toBe('ADDED_DC_ONE');
  });

  test('then Rumi\'s 11, pre-filled: a change with no reason is refused, naming the row', async () => {
    const id = await checkable();
    await toExplain(id);
    await ex(id, 'COMBINED_ONE', C1);
    await ex(id, 'COMBINED_TWO', C2);
    const a1 = await ex(id, 'COMBINED_THREE', C3);
    expect(a1.screen).toBe('ADDED_DC_ONE');
    const shown = Object.keys(a1.data).filter((k) => k.endsWith('_level')).map((k) => k.slice(0, 2)).sort();
    expect(shown).toEqual(['C1', 'C2', 'C6', 'D1', 'D5']);
    const pre = Object.fromEntries(shown.map((c) => [`${c}_final`, a1.data[`${c}_level`]]));
    const changed = { ...pre, C2_final: pre.C2_final === '3' ? '2' : '3' };
    let out = await ex(id, 'ADDED_DC_ONE', changed);
    expect(out.screen).toBe('ADDED_DC_ONE');
    expect(out.data.error_messages.why6_one).toMatch(/Helping when a child is wrong/);
    expect(out.data.C2_level).toBe(changed.C2_final);
    out = await ex(id, 'ADDED_DC_ONE', { ...changed, why6_one: 'The teacher explained the reason twice.' });
    expect(out.screen).toBe('ADDED_DC_TWO');
    expect(Object.keys(out.data).filter((k) => k.endsWith('_level')).map((k) => k.slice(0, 2)).sort()).toEqual(['C4', 'C8', 'F1', 'F2', 'F3', 'F4']);
  });

  test('Submit: final_levels as today, and the v6 record says who set each level, why, and on which rubric', async () => {
    const id = await checkable();
    await toExplain(id);
    await ex(id, 'COMBINED_ONE', C1);
    await ex(id, 'COMBINED_TWO', C2);
    const a1 = await ex(id, 'COMBINED_THREE', C3);
    const keep = (d) => Object.fromEntries(Object.keys(d).filter((k) => k.endsWith('_level')).map((k) => [`${k.slice(0, 2)}_final`, d[k] || '2']));
    const a2 = await ex(id, 'ADDED_DC_ONE', { ...keep(a1.data), C1_final: '4', why6_one: 'Asked why and followed up with Ali twice.' });
    const pr = await ex(id, 'ADDED_DC_TWO', keep(a2.data));
    expect(pr.screen).toBe('PRIORITY');
    const done = await ex(id, 'PRIORITY', { priority_final: 'C8', cv: '3', also_final_1: 'none', also_final_2: 'none' });
    expect(done.screen).toBe('DONE');
    await flush();
    const r = row(id);
    expect(r.final_levels).toMatchObject({ C3: '3', C5: '2', C7: 'NA', D3: '1', D4: '3', D2: '4', C1: '4' });
    const v6 = r.evidence_review.v6_levels;
    for (const code of V6.COMBINED_CODES) {
      expect(v6[code]).toMatchObject({ set_by: 'coach', source: 'coach', rubric: 'fico17_v6' });
      expect(V6.isJustified(v6[code].because)).toBe(true);
    }
    expect(v6.C1).toMatchObject({ level: 4, set_by: 'coach', because: 'Asked why and followed up with Ali twice.', rubric: 'fico17_v6' });
    expect(v6.F1.set_by).toBe(a2.data.F1_level ? 'rumi' : 'coach');
    expect(r.evidence_review.d2_counts).toEqual({ children: 7, quiet_later: 2 });
  });
});

describe('the analysis the dashboard reads', () => {
  test('a v6 visit is stamped fico17_v6 (with the coach prompt version), never fico17, so v6 C5 is never averaged with v5 C5', () => {
    const a = buildAnalysis({ id: 'f', rubric_version: 'fico17_v6', answers: {}, final_levels: { C5: '3' }, evidence_review: {} }, { brief: 'x' });
    expect(a.observe2.rubric).toBe('fico17_v6');
    expect(a.observe2.prompt_version).toBe(V6.COACH_PROMPT_VERSION);
  });
  test('a v5 visit keeps fico17 exactly', () => {
    const a = buildAnalysis({ id: 'f', rubric_version: 'fico-ict-17-2026-09', answers: {}, final_levels: { C5: '3' }, evidence_review: {} }, { brief: 'x' });
    expect(a.observe2.rubric).toBe('fico17');
    expect(a.observe2.prompt_version).toBeUndefined();
  });
});

describe('the brief and the record read a v6 visit in v6 words', () => {
  const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
  const levels = { C1: '3', C2: '2', C3: '3', C4: '2', C5: '2', C6: '3', C7: 'NA', C8: '3', D1: '3', D2: '4', D3: '1', D4: '3', D5: '2', F1: '3', F2: '2', F3: '2', F4: '1' };
  const form = (rubric) => ({ id: 'f', rubric_version: rubric, answers: { priority: 'C5' }, final_levels: levels, evidence_review: { priority_final: 'C5' } });
  test('v6: C5 in minutes', () => {
    const brief = buildBrief(form('fico17_v6'));
    expect(brief).toContain('Signal, 2-3 min');
    const a = buildAnalysis(form('fico17_v6'), { brief });
    expect(a.focus_area.rationale).toContain('Signal, 2-3 min');
    expect(a.domains.high_leverage_practices.indicators.find((i) => i.id === 'C5').name).toBe('Switching activities');
  });
  test('v5: exactly the v5 phrase, as before', () => {
    const { PLAIN } = require('../../bot/shared/services/observe/observe2/fico17');
    const brief = buildBrief(form('fico-ict-17-2026-09'));
    expect(brief).toContain(PLAIN.C5[1]);
    expect(brief).not.toContain('Signal, 2-3 min');
  });
});

describe('the teacher report never prints a v6 N/A or couldn\'t-tell row as 0/4', () => {
  const { transformFICOToReportData } = require('../../bot/shared/services/coaching/report-transformers/fico-report-transformer');
  const levels = { C1: '3', C2: '2', C3: '3', C4: '2', C5: '2', C6: '3', C7: 'NA', C8: '3', D1: '3', D2: '4', D3: 'IE', D4: '3', D5: '2', F1: '3', F2: '2', F3: '2', F4: '1' };
  const report = (rubric) => {
    const a = buildAnalysis({ id: 'f', rubric_version: rubric, answers: {}, final_levels: levels, evidence_review: {} }, { brief: 'x' });
    const r = transformFICOToReportData({ id: 's' }, 'Rabia', a);
    return (r.goals || r.reportData?.goals || []).flatMap((g) => g.criteria.map((c) => c.name));
  };
  test('v6: C7 (NA) and D3 (IE) are left out', () => {
    const names = report('fico17_v6');
    expect(names.some((n) => n.startsWith('C7 '))).toBe(false);
    expect(names.some((n) => n.startsWith('D3 '))).toBe(false);
    expect(names.some((n) => n.startsWith('C5 '))).toBe(true);
  });
  test('v5: unchanged (every row printed, as today)', () => {
    const names = report('fico-ict-17-2026-09');
    expect(names.some((n) => n.startsWith('C7 '))).toBe(true);
  });
});
