/**
 * FICO6 round 2, lane fix-check (bd-qix9oh; CONTRACTS §11.4). The breaks the r1 red team found in the check and the
 * record, each a case copied from its test (outputs/lanes/redteam/tests, synthetic data):
 *
 * - T4.1 / T4.2: a v6 record never names an NA or IE row as "work on first", "also work on" or a growth opportunity;
 *   the record and the brief name the same picks (focus-areas.workOnPicks). v5: buildAnalysis byte-identical.
 * - T5.2: a v6 visit on a Flow without the v6 screens (fallback) shows no level and no reason for the six room codes.
 * - D2 counts (comms finding, Appendix C): COMBINED_THREE's D2 text starts with the recording's student turns per
 *   half (rumi_moments.d2_turns), recorded in dc_evidence_ids and lifted to analysis_data.observe2.d2_turns.
 * - T1 minor: the field form's error screens show the v6 C5 titles only for a visit known to be v6.
 *
 * Real: endpoints, store, rules, switch, analysis, brief. Mocked: the database (fake-supabase), WhatsApp, logger.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
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
const FormEndpoint = require('../../bot/shared/routes/observe2-form-endpoint');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
const { switchedOptions } = require('../../bot/shared/services/observe/observe2/field-form.flow');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');
const { applyLpFidelity } = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const { FORMS } = require('./fixtures/report-v5-forms');
const GOLDEN = require('./fixtures/report-v5-golden.json');

const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', region: 'Sihala' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'T', preferred_language: 'en', teacher_level: ['PRIMARY'] },
    ],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
  });
  Switch._resetCache();
});

// ------------------------------------------------------------------ T4.1 / T4.2 (redteam t4-ie-na-teacher B1, B2)

// C7 NA (no group task), D3 IE (couldn't tell), C1 IE.
const LEVELS = { C1: 'IE', C2: '4', C3: '3', C4: '2', C5: '2', C6: '3', C7: 'NA', C8: '3', D1: '3', D2: '4', D3: 'IE', D4: '3', D5: '2', F1: '3', F2: '2', F3: '2', F4: '1' };
const notJudged = (code) => !/^[1-4]$/.test(String(LEVELS[code]));

function v6Record({ priority = 'C5', also = [], quality = null } = {}) {
  const v6Levels = {};
  for (const c of V6.COMBINED_CODES) v6Levels[c] = { level: LEVELS[c], because: 'What I saw from the back of the room.', source: 'coach', set_by: 'coach', dc_result: c === 'D2' ? null : 2 };
  return {
    id: 'form-v6', rubric_version: 'fico17_v6', period_minutes: 40,
    answers: { lp: 'none', priority },
    final_levels: { ...LEVELS },
    rumi_moments: { moments: [], ...(quality ? { transcript_quality: quality } : {}) },
    evidence_review: { priority_final: priority, also_final: also, v6_levels: v6Levels },
  };
}

describe('T4.1 / T4.2: the v6 record never picks an NA or IE row to work on', () => {
  test('B1: focus_area is never an IE row (priority_final D3 = IE); the next pick with a level takes its place', () => {
    const a = buildAnalysis(v6Record({ priority: 'D3', also: ['C4'] }));
    expect(a.focus_area && notJudged(a.focus_area.indicator)).toBe(false);
    expect(a.focus_area.indicator).toBe('C4');
    expect(a.observe2.priority).toBe('C4');
  });

  test('B1: focus_area is never an NA row (priority_final C7 = NA)', () => {
    const a = buildAnalysis(v6Record({ priority: 'C7', also: ['C4'] }));
    expect(a.focus_area && notJudged(a.focus_area.indicator)).toBe(false);
  });

  test('B2: also_work_on and growth_opportunities never carry an NA or IE row', () => {
    const a = buildAnalysis(v6Record({ priority: 'C4', also: ['C7', 'D3'] }));
    expect((a.also_work_on || []).map((f) => f.indicator).filter(notJudged)).toEqual([]);
    expect(a.growth_opportunities.map((g) => g.area)).toEqual([a.focus_area.title]);
    expect(a.observe2.also).toEqual([]);
  });

  test('every pick is NA or IE: no focus at all, as a record with no pick', () => {
    const a = buildAnalysis(v6Record({ priority: 'D3', also: ['C7', 'C1'] }));
    expect(a.focus_area).toBeUndefined();
    expect(a.growth_opportunities).toBeUndefined();
    expect(a.also_work_on).toEqual([]);
  });

  test('a coaching focus area stays a pick (it has no level to lack)', () => {
    const a = buildAnalysis(v6Record({ priority: 'wait', also: ['D3', 'C4'] }));
    expect(a.focus_area.indicator).toBe('wait');
    expect(a.also_work_on.map((f) => f.indicator)).toEqual(['C4']);
  });

  test('broken transcript: only the six room levels stand, so an 11-row pick moves on', () => {
    const a = buildAnalysis(v6Record({ priority: 'C4', also: ['D4'], quality: { status: 'broken', coverage: 0.3, issues: [] } }));
    expect(a.focus_area.indicator).toBe('D4');
  });

  test('the record and the brief name the same "work on first"', () => {
    const form = v6Record({ priority: 'D3', also: ['C4'] });
    const a = buildAnalysis(form);
    expect(buildBrief(form)).toContain(a.focus_area.title);
  });

  test('strengths leave out the pick the record works on (as the brief does)', () => {
    const a = buildAnalysis(v6Record({ priority: 'D3', also: ['C2'] }));
    expect(a.focus_area.indicator).toBe('C2');
    expect(a.strengths.map((s) => s.title)).not.toContain(V6.indicator('C2').name);
  });
});

describe('v5: buildAnalysis reads exactly as before (golden at origin/sandbox afeab2a69b)', () => {
  // RULINGS R28 / CONTRACTS §11.5: the two fields fico-framework.js produces are checked against applyLpFidelity on
  // the current tree; every other byte against the golden.
  const normalised = (a) => ({ ...a, domains: { ...a.domains, lesson_plan_fidelity: '<fico-framework>' }, scores: '<fico-framework>' });
  test.each(Object.keys(FORMS))('%s', (k) => {
    const a = buildAnalysis(FORMS[k]);
    expect(JSON.stringify(normalised(a))).toBe(JSON.stringify(normalised(GOLDEN.analyses[k])));
    const { lesson_plan_fidelity: _lp, ...rest } = a.domains;
    const again = applyLpFidelity({ ...a, domains: { ...rest, lesson_plan_fidelity: { indicators: [], domain_score: 0, domain_max: 28, indicators_applicable: 0 } }, scores: {} }, a.lp_fidelity);
    expect(JSON.stringify(a.domains.lesson_plan_fidelity)).toBe(JSON.stringify(again.domains.lesson_plan_fidelity));
    expect(JSON.stringify(a.scores)).toBe(JSON.stringify(again.scores));
  });
});

// ------------------------------------------------------------------ the check endpoint

const ctoken = (id) => `coach-1:observe2-check:${id}`;
const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'no',
  p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no',
  incident: 'none', lp: 'used', priority: 'C8',
};
// Two unsure answers and one unasked: D4's transcript-only result is 4 (HEARD_RULES.D4).
const MOMENTS = [
  { id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight?', label: 'open question' },
  { id: 'wrong_1', moment: 'wrong', type: 'hedged', minute: '05:10', quote: 'Maybe it is twelve?', label: 'unsure answer' },
  { id: 'wrong_2', moment: 'wrong', type: 'hedged', minute: '07:02', quote: 'Fourteen, no, fifteen', label: 'unsure answer' },
  { id: 'wrong_3', moment: 'wrong', type: 'unprompted', minute: '09:00', quote: 'Miss, I want to try', label: 'tried unasked' },
];

async function visit({ v6 = true, moments = {} } = {}) {
  mockFake.__tables.app_settings = v6 ? [{ key: 'fico_coach_rubric', value: '{"user:coach-1":"v6"}' }] : [];
  Switch._resetCache();
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), {
    period_minutes: 40, answers: ANSWERS, sealed_at: '2026-11-12T05:39:00.000Z', part1_done_at: 'x', part2_done_at: 'x',
    coaching_session_id: 'sess-1', rumi_moments: { moments: MOMENTS, counts: {}, ...moments },
    rumi_levels: { C1: { level: 2 } }, moments_ready_at: '2026-11-12T05:50:00.000Z',
  });
  expect(row(form.id).rubric_version).toBe(v6 ? 'fico17_v6' : 'fico-ict-17-2026-09');
  return form.id;
}
const heard = (screen, answers = {}, extra = {}) => {
  const out = { screen, ...extra };
  for (let i = 1; i <= 8; i += 1) out[`${screen.toLowerCase()}_${i}`] = answers[i] || '';
  return out;
};
const ex = (id, screen, data) => Check.handleObserve2CheckDataExchange(ctoken(id), screen, { screen, ...data });
async function toExplain(id, extra) {
  await ex(id, 'HEARD_ASK', heard('HEARD_ASK', { 1: 'yes' }));
  await ex(id, 'HEARD_WRONG', heard('HEARD_WRONG', { 1: 'yes', 2: 'yes', 3: 'yes' }));
  await ex(id, 'HEARD_WORK', heard('HEARD_WORK'));
  return ex(id, 'HEARD_EXPLAIN', heard('HEARD_EXPLAIN', {}, extra));
}
const WHY = 'I saw it from the back of the room myself.';
const ROOM_SIX = new Set(V6.COMBINED_CODES);
const LEAK = /\bLevel [1-4]\b|Not Observed|Developing|Proficient|Highly Effective|tried while openly unsure|without being asked, or kept going|the recording: /;

describe('T5.2: a v6 visit on a Flow without the v6 screens (fallback)', () => {
  test('ADDED_ONE and ADDED_TWO show no level and no reason for the six room codes', async () => {
    const id = await visit();
    const one = await toExplain(id, {});
    expect(one.screen).toBe('ADDED_ONE');
    expect(row(id).evidence_review.v6_fallback).toBe(true);
    const two = await ex(id, 'ADDED_ONE', Object.fromEntries(Object.keys(one.data).filter((k) => k.endsWith('_level')).map((k) => [k.replace(/_level$/, '_final'), '2'])));
    expect(two.screen).toBe('ADDED_TWO');
    let seen = 0;
    for (const s of [one, two]) {
      for (const [k, v] of Object.entries(s.data)) {
        const code = k.split('_')[0];
        if (ROOM_SIX.has(code)) {
          seen += 1;
          expect([k, v]).toEqual([k, '']);
        }
        expect(String(v)).not.toMatch(LEAK);
      }
    }
    expect(seen).toBe(2 * V6.COMBINED_CODES.length);
  });

  test('the other 11 keep the rules\' level and reason on the fallback screens', async () => {
    const id = await visit();
    const one = await toExplain(id, {});
    const others = Object.keys(one.data).filter((k) => k.endsWith('_level') && !ROOM_SIX.has(k.split('_')[0]));
    expect(others.length).toBeGreaterThan(0);
    for (const k of others) expect(one.data[k]).toMatch(/^([1-4]|NA|IE)?$/);
    expect(others.some((k) => one.data[k] !== '')).toBe(true);
  });

  test('v5: the same walk shows every level and reason as before', async () => {
    const id = await visit({ v6: false });
    const one = await toExplain(id, {});
    expect(one.screen).toBe('ADDED_ONE');
    expect(one.data.D4_level).toBe('4');
    expect(one.data.D4_because).not.toBe('');
  });
});

describe('D2 on COMBINED_THREE: the recording\'s student turns per half', () => {
  async function toThree(id) {
    await toExplain(id, { v6c: '2' });
    await ex(id, 'MISSED', {});
    await ex(id, 'COMBINED_ONE', { cmb_C3_level: '3', cmb_C3_why: WHY, cmb_C5_level: '2', cmb_C5_why: WHY });
    return ex(id, 'COMBINED_TWO', { cmb_C7_level: '2', cmb_C7_why: WHY, cmb_D3_level: '1', cmb_D3_why: WHY });
  }
  const D2_DONE = { cmb_D4_level: '2', cmb_D4_why: WHY, d2_children: '7', d2_quiet_later: '2', cmb_D2_level: '4', cmb_D2_why: WHY };

  test('D2_ev begins with the turns; the record lists d2_turns as shown; analysis_data carries the counts', async () => {
    const id = await visit({ moments: { d2_turns: { first_half: 9, second_half: 4 } } });
    const three = await toThree(id);
    expect(three.screen).toBe('COMBINED_THREE');
    expect(three.data.D2_ev.split('\n')[0]).toBe('Student turns: 9 in the first half, 4 in the second.');
    expect(three.data.D2_ev).toContain(V6.indicator('D2').definition);
    expect(three.data.D2_ev).toContain('On your form: 6 spoke in Part 1, 5 spoke for the first time in Part 2 (11 in all).');
    expect(three.data.D2_ev).not.toContain(observe2Strings('en').v6_ev_none);
    expect([...three.data.D2_ev].length).toBeLessThanOrEqual(4096);
    expect(three.data.D4_ev.startsWith('Student turns')).toBe(false);
    await ex(id, 'COMBINED_THREE', D2_DONE);
    const rec = row(id).evidence_review.v6_D2;
    expect(rec.dc_evidence_ids).toEqual(['d2_turns']);
    expect(rec.dc_result).toBeNull();
    expect(row(id).evidence_review.v6_D4.dc_evidence_ids).not.toContain('d2_turns');
    expect(buildAnalysis(row(id)).observe2.d2_turns).toEqual({ first_half: 9, second_half: 4 });
  });

  test('zero turns are shown as counts, not as "nothing"', async () => {
    const id = await visit({ moments: { d2_turns: { first_half: 0, second_half: 0 } } });
    const three = await toThree(id);
    expect(three.data.D2_ev.split('\n')[0]).toBe('Student turns: 0 in the first half, 0 in the second.');
  });

  test('no d2_turns (a visit before fix-moments): D2_ev and the record read as today', async () => {
    const id = await visit();
    const three = await toThree(id);
    const S = observe2Strings('en');
    const d2 = V6.indicator('D2');
    expect(three.data.D2_ev).toBe(`${d2.definition}\n\n${S.v6_ev_none}\n\n${S.v6_coach_adds(d2.coach_adds)}\n\nOn your form: 6 spoke in Part 1, 5 spoke for the first time in Part 2 (11 in all).`);
    await ex(id, 'COMBINED_THREE', D2_DONE);
    expect(row(id).evidence_review.v6_D2.dc_evidence_ids).toEqual([]);
    expect(buildAnalysis(row(id)).observe2).not.toHaveProperty('d2_turns');
  });

  test('a broken recording shows no counts from it', async () => {
    const id = await visit({ moments: { d2_turns: { first_half: 9, second_half: 4 }, transcript_quality: { status: 'broken', coverage: 0.2, issues: [] } } });
    const three = await toThree(id);
    expect(three.data.D2_ev).not.toContain('Student turns');
  });

  test('the string exists in English and Urdu', () => {
    expect(observe2Strings('en').v6_d2_turns(9, 4)).toBe('Student turns: 9 in the first half, 4 in the second.');
    expect(typeof observe2Strings('ur').v6_d2_turns(9, 4)).toBe('string');
    expect(observe2Strings('ur').v6_d2_turns(9, 4)).not.toBe(observe2Strings('en').v6_d2_turns(9, 4));
  });
});

// ------------------------------------------------------------------ T1 minor: the field form's error screens

describe('T1: C5 titles on the field form when the record cannot be loaded', () => {
  const ftoken = (id, userId = 'coach-1') => `${userId}:observe2-form:${id}`;
  const V5_TITLES = switchedOptions(null).map((o) => o.title);
  const V6_TITLES = switchedOptions({ rubric_version: 'fico17_v6' }).map((o) => o.title);
  async function formRow(v6) {
    mockFake.__tables.app_settings = v6 ? [{ key: 'fico_coach_rubric', value: '{"user:coach-1":"v6"}' }] : [];
    Switch._resetCache();
    const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
    Object.assign(row(form.id), { period_minutes: 40 });
    return form.id;
  }
  const titles = (out) => out.data.switched.map((o) => o.title);

  test('a v6 visit this coach opened: a failed read still shows the v6 titles, on Part 1 and Part 2', async () => {
    const id = await formRow(true);
    expect(titles(await FormEndpoint.handleObserve2FormInit(ftoken(id)))).toEqual(V6_TITLES);
    mockFake.__failNext({ message: 'timeout' });
    const p1 = await FormEndpoint.handleObserve2FormDataExchange(ftoken(id), 'PART_ONE', { screen: 'PART_ONE' });
    expect(p1.data.has_error).toBe(true);
    expect(titles(p1)).toEqual(V6_TITLES);
    mockFake.__failNext({ message: 'timeout' });
    const p2 = await FormEndpoint.handleObserve2FormDataExchange(ftoken(id), 'PART_TWO', { screen: 'PART_TWO' });
    expect(titles(p2)).toEqual(V6_TITLES);
  });

  test('a v5 visit, or one never read: the v5 titles (never a guess of v6)', async () => {
    const v5 = await formRow(false);
    await FormEndpoint.handleObserve2FormInit(ftoken(v5));
    mockFake.__failNext({ message: 'timeout' });
    expect(titles(await FormEndpoint.handleObserve2FormDataExchange(ftoken(v5), 'PART_ONE', { screen: 'PART_ONE' }))).toEqual(V5_TITLES);
    mockFake.__failNext({ message: 'timeout' });
    expect(titles(await FormEndpoint.handleObserve2FormDataExchange(ftoken('never-read-1'), 'PART_ONE', { screen: 'PART_ONE' }))).toEqual(V5_TITLES);
  });

  test('another coach\'s token for a v6 visit: the v5 titles', async () => {
    const id = await formRow(true);
    await FormEndpoint.handleObserve2FormInit(ftoken(id));
    const out = await FormEndpoint.handleObserve2FormDataExchange(ftoken(id, 'coach-2'), 'PART_ONE', { screen: 'PART_ONE' });
    expect(out.data.has_error).toBe(true);
    expect(titles(out)).toEqual(V5_TITLES);
  });
});
