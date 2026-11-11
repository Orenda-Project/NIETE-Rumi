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
const { buildEvidenceCheckFlow, V6_CHECK } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');
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
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', teacher_level: ['PRIMARY'] },  // bd-ra8xu.42: v6 reaches grades 1-5 visits only
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
      if (old.id === 'HEARD_ASK') {
        // bd-ra8xu.43: the rubric caption atop the first screen (one TextCaption + its declaration) is allowed.
        expect(now.data.scored_with).toEqual({ type: 'string', __example__: 'FICO17 v6' });
        delete now.data.scored_with;
        const form = now.layout.children[0];
        expect(form.children[0]).toEqual({ type: 'TextCaption', text: '${data.scored_with}' });
        form.children.shift();
      }
      if (old.id === 'HEARD_EXPLAIN') {
        const footer = fieldsOf(now).find((c) => c.type === 'Footer');
        expect(footer['on-click-action'].payload.v6c).toBe(V6_CHECK);
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
    expect(flow.routing_model.COMBINED_TWO).toEqual(['COMBINED_THREE', 'COMBINED_THREE_COUNTS']);
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
    expect(names).toContain('Switching activities'); // a v6 report prints names, no codes (spec §9.3)
  });
  test('v5: unchanged (every row printed, as today)', () => {
    const names = report('fico-ict-17-2026-09');
    expect(names.some((n) => n.startsWith('C7 '))).toBe(true);
  });
});

// ---------------------------------------------------------------- FICO6 (bd-qix9oh, lane check-v6)
// The stored record (spec §7.7, §13; CONTRACTS §6.2): dc_result (was rule_result), dc_evidence_ids = the items the
// screen showed, the N/A links at Submit (na_link_conflict), and the moments job's transcript_quality / shadow_v6
// lifted into analysis_data.observe2. The COMBINED screens show the room evidence and the §7.2 lines.
describe('FICO6: the room evidence and what the screens say', () => {
  const S = require('../../bot/shared/services/observe/observe2/strings').observe2Strings('en');
  const ROOM = {
    C3: [
      { id: 'room_C3_1', kind: 'name_called', minute: '05:10', quote: 'Sara, what is your answer?' },
      { id: 'room_C3_2', kind: 'pair_talk', minute: '09:00', quote: 'Tell your partner. '.repeat(10) },
      { id: 'room_C3_3', kind: 'name_called', minute: '11:00', quote: 'Bilal?' },
      { id: 'room_C3_4', kind: 'name_called', minute: '12:00', quote: 'Hina?' },
      { id: 'room_C3_5', kind: 'everyone_write', minute: '13:00', quote: 'Everyone write it.' },
      { id: 'room_C3_6', kind: 'random_pick', minute: '14:00', quote: 'Sixth one, not shown.' },
    ],
    C5: [{ id: 'room_C5_1', kind: 'signal', minute: '15:00', quote: 'Pens down, books open.', starts: '16:10' }],
  };
  beforeEach(() => setSwitch('v6'));

  test('COMBINED_ONE lists the room evidence: "MM:SS  \\"quote\\"", at most five, quotes clipped to 120', async () => {
    const id = await checkable({ rumi_moments: { moments: MOMENTS, counts: {}, room_evidence: ROOM } });
    const out = await toExplain(id);
    const lines = out.data.C3_ev.split('\n').filter((l) => /^\d\d:\d\d {2}"/.test(l));
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('05:10  "Sara, what is your answer?"');
    expect([...lines[1].slice(lines[1].indexOf('"') + 1, -1)].length).toBe(120);
    expect(lines[1].endsWith('…"')).toBe(true);
    expect(out.data.C3_ev).not.toContain('Sixth one');
    expect(out.data.C5_ev).toContain('15:00  "Pens down, books open."');
    expect(out.data.C3_ev).toContain(S.v6_coach_adds(V6.indicator('C3').coach_adds));
  });

  test('stored: dc_result (not rule_result) and dc_evidence_ids, the ids of what the screen showed', async () => {
    const id = await checkable({ rumi_moments: { moments: MOMENTS, counts: {}, room_evidence: ROOM } });
    await toExplain(id);
    await ex(id, 'COMBINED_ONE', C1);
    await ex(id, 'COMBINED_TWO', C2);
    await ex(id, 'COMBINED_THREE', C3);
    const r = row(id).evidence_review;
    expect(r.v6_C3.dc_evidence_ids).toEqual(['room_C3_1', 'room_C3_2', 'room_C3_3', 'room_C3_4', 'room_C3_5']);
    expect(r.v6_C5.dc_evidence_ids).toEqual(['room_C5_1']);
    expect(r.v6_D4.dc_evidence_ids).toEqual(['wrong_2']);
    for (const code of V6.COMBINED_CODES) {
      expect('rule_result' in r[`v6_${code}`]).toBe(false);
      expect('dc_result' in r[`v6_${code}`]).toBe(true);
    }
    expect(r.v6_D2.dc_result).toBeNull();
    // Until rules-v6 gives dc_result, the record keeps what the rules add up to for the row.
    expect(r.v6_C3.dc_result).toBe(Number(r.added.C3) || r.added.C3 || null);
  });

  test('a recording that could not be used: each room indicator says so, and shows no evidence', async () => {
    const id = await checkable({ rumi_moments: { moments: MOMENTS, counts: {}, room_evidence: ROOM, transcript_quality: { status: 'broken', coverage: 0.2, issues: [] } } });
    const out = await toExplain(id);
    expect(out.data.C3_ev).toContain(S.v6_ev_ie);
    expect(out.data.C3_ev).not.toContain('Sara, what is your answer?');
    await ex(id, 'COMBINED_ONE', C1);
    expect(row(id).evidence_review.v6_C3.dc_evidence_ids).toEqual([]);
  });

  test('nothing found: the "nothing" line, from strings', async () => {
    const id = await checkable();
    const out = await toExplain(id);
    expect(out.data.C5_ev).toContain(S.v6_ev_none);
  });

  test('the lines by the transcript-only result: IE → couldn\'t show; D3 NA → no child-to-child talk', () => {
    const { _evidenceText } = Check;
    const form = { rubric_version: 'fico17_v6', answers: {}, evidence_review: {}, rumi_moments: { moments: [], room_evidence: ROOM } };
    expect(_evidenceText(form, 'C3', { C3: { dc_result: 'IE' } })).toContain(S.v6_ev_ie);
    expect(_evidenceText(form, 'C3', { C3: { dc_result: 'IE' } })).not.toContain('Sara');
    expect(_evidenceText(form, 'D3', { D3: { dc_result: 'NA' } })).toContain(S.v6_ev_na_d3);
    expect(_evidenceText(form, 'C7', { C7: { dc_result: null } })).toContain(S.v6_ev_none);
  });
});

describe('FICO6: the N/A links at Submit (spec §8.4, Q7)', () => {
  beforeEach(() => setSwitch('v6'));
  async function submit(c1) {
    const id = await checkable();
    await toExplain(id);
    await ex(id, 'COMBINED_ONE', C1);
    await ex(id, 'COMBINED_TWO', C2);
    const a1 = await ex(id, 'COMBINED_THREE', C3);
    const keep = (d) => Object.fromEntries(Object.keys(d).filter((k) => /^[CDF]\d_level$/.test(k)).map((k) => [`${k.slice(0, 2)}_final`, d[k] || '2']));
    const first = keep(a1.data);
    const changed = first.C1_final !== c1;
    const a2 = await ex(id, 'ADDED_DC_ONE', { ...first, C1_final: c1, ...(changed ? { why6_one: 'No question was asked in the whole lesson.' } : {}) });
    expect(a2.screen).toBe('ADDED_DC_TWO');
    await ex(id, 'ADDED_DC_TWO', keep(a2.data));
    await ex(id, 'PRIORITY', { priority_final: 'C8', cv: '3', also_final_1: 'none', also_final_2: 'none' });
    await flush();
    return row(id);
  }

  test('C1 = 1 and the coach set C3 and D4: the coach\'s levels stand, each flagged na_link_conflict', async () => {
    const r = await submit('1');
    expect(r.final_levels).toMatchObject({ C1: '1', C3: '3', D4: '3' });
    expect(r.evidence_review.v6_levels.C3.na_link_conflict).toBe(true);
    expect(r.evidence_review.v6_levels.D4.na_link_conflict).toBe(true);
    expect(r.evidence_review.v6_levels.C5.na_link_conflict).toBeUndefined();
  });

  test('C1 above 1: no flag anywhere', async () => {
    const r = await submit('3');
    for (const code of V6.CODES) expect((r.evidence_review.v6_levels[code] || {}).na_link_conflict).toBeUndefined();
  });

  test('the rule itself: C3 and D4 not set by the coach become NA; set by the coach, kept and flagged', () => {
    const { _applyNaLinks } = Check;
    const rows = { C1: { level: 1 }, C3: { level: 2 }, D4: { level: 3 }, C5: { level: 2 } };
    const none = _applyNaLinks(rows, new Set());
    expect(none.C3).toMatchObject({ level: 'NA', because: 'no questions, so nobody could be chosen or try' });
    expect(none.D4.level).toBe('NA');
    expect(none.C5).toBe(rows.C5);
    const coach = _applyNaLinks(rows, new Set(['C3', 'D4']));
    expect(coach.C3).toEqual({ level: 2, na_link_conflict: true });
    expect(_applyNaLinks({ ...rows, C1: { level: 2 } }, new Set()).C3).toBe(rows.C3);
    expect(rows.C3).toEqual({ level: 2 });
  });
});

describe('FICO6: analysis_data.observe2 carries the moments job\'s verdicts', () => {
  const quality = { status: 'partial', coverage: 0.7, issues: [{ type: 'short', from: '28:00' }] };
  const shadow = { prompt_version: 'observe2-moments-v3', status: 'ok', rumi_levels: { C1: { level: 3 } } };
  test('v6: transcript_quality, v6_levels as stored', () => {
    const v6Levels = { C3: { level: 3, set_by: 'coach', dc_result: 2, dc_evidence_ids: ['room_C3_1'] } };
    const a = buildAnalysis({ id: 'f', rubric_version: 'fico17_v6', answers: {}, final_levels: {}, evidence_review: { v6_levels: v6Levels }, rumi_moments: { transcript_quality: quality } }, { brief: 'x' });
    expect(a.observe2.transcript_quality).toEqual(quality);
    expect(a.observe2.v6_levels).toEqual(v6Levels);
  });
  test('a v5 (shadow) visit: shadow_v6 and transcript_quality lifted, nothing else v6', () => {
    const a = buildAnalysis({ id: 'f', rubric_version: 'fico-ict-17-2026-09', answers: {}, final_levels: {}, evidence_review: {}, rumi_moments: { shadow_v6: shadow, transcript_quality: quality } }, { brief: 'x' });
    expect(a.observe2.shadow_v6).toEqual(shadow);
    expect(a.observe2.transcript_quality).toEqual(quality);
    expect(a.observe2.rubric).toBe('fico17');
    expect(a.observe2.v6_levels).toBeUndefined();
  });
  test('a v5 visit with neither: the observe2 keys exactly as before', () => {
    const a = buildAnalysis({ id: 'f', rubric_version: 'fico-ict-17-2026-09', answers: {}, final_levels: { C5: '3' }, evidence_review: {} }, { brief: 'x' });
    expect(Object.keys(a.observe2)).toEqual(['form_id', 'rubric', 'rubric_version', 'final_levels', 'priority', 'also', 'thinking', 'why', 'brief']);
  });
});

describe('FICO6: every new string, in English and Urdu (CONTRACTS §6.5)', () => {
  const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');
  const en = observe2Strings('en');
  const ur = observe2Strings('ur');
  const KEYS = ['v6_choose_level', 'v6_write_why', 'v6_check_numbers', 'v6_d2_mismatch', 'v6_why_changed', 'v6_why_kind', 'v6_pick_reason',
    'moments_broken', 'v6_ev_none', 'v6_ev_ie', 'v6_ev_na_d3', 'v6_report_ie', 'v6_report_broken', 'missed_title', 'missed_type', 'missed_min', 'missed_words'];
  test.each(KEYS)('%s: English and an Urdu draft', (k) => {
    expect(en[k]).toBeTruthy();
    expect(ur[k]).toBeTruthy();
    const e = typeof en[k] === 'function' ? en[k](['C1']) : en[k];
    const u = typeof ur[k] === 'function' ? ur[k](['C1']) : ur[k];
    expect(u).not.toBe(e);
    expect(u).toMatch(/[\u0600-\u06FF]/);
  });
  test('the English is the contract\'s, word for word', () => {
    expect(en).toMatchObject({
      v6_why_kind: 'Why did it change?',
      v6_pick_reason: 'Pick a reason for the change.',
      moments_broken: "The recording couldn't be used. Set the six room levels from what you saw.",
      v6_ev_none: 'The recording showed nothing for this.',
      v6_ev_ie: "The recording couldn't show this. Set the level from what you saw.",
      v6_ev_na_d3: 'The recording found no child-to-child talk.',
      v6_report_ie: "The recording didn't cover this part of the lesson.",
      v6_report_broken: "The recording couldn't be used, so this report has no levels from it.",
      missed_title: 'Add one Rumi missed', missed_type: 'What happened', missed_min: 'Minute', missed_words: 'The words',
    });
    expect(en.v6_override_reasons).toEqual({
      didnt_happen: "It didn't happen", wrong_speaker: 'Wrong speaker', wrong_label: 'Wrong label',
      recording_missed: 'Recording missed it', rubric_doesnt_fit: "Rubric doesn't fit",
    });
    expect(Object.keys(ur.v6_override_reasons)).toEqual(Object.keys(en.v6_override_reasons));
  });
  test('labels within their caps (20 for a text label, 30 for a radio label or title)', () => {
    for (const k of ['missed_type', 'missed_min', 'missed_words', 'v6_why_min']) expect([...en[k]].length).toBeLessThanOrEqual(20);
    for (const k of ['v6_why_kind', 'missed_title']) expect([...en[k]].length).toBeLessThanOrEqual(30);
    for (const t of Object.values(en.v6_override_reasons)) expect([...t].length).toBeLessThanOrEqual(30);
  });
});
