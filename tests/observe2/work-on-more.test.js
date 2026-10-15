/**
 * /observe2 — "Work on first", "Also work on", and "Following the plan's steps" (FICO pilot sheet
 * R14, the ICT lead, 14 Oct: "a teacher may need support in multiple areas … 'Follow the Lesson Plan
 * Structure' is missing").
 *
 * One "Work on first" still drives the brief, the record's focus and the teacher's report. Up to two
 * more are optional. The plan's own steps (Section B) can be any of the three picks; it is not a
 * C, D or F indicator, so every consumer that used to assume one is driven here with it.
 *
 * Real: the form and check endpoints, the store, the rules, the brief, the analysis, the target
 * resolver. Mocked: the database (in memory), WhatsApp, the debrief service's chat side.
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
const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
// This branch has no coaching/target-resolver.js: the report's target for an /observe2 record is observe2Target.
const { observe2Target } = require('../../bot/shared/services/coaching/report-v2/observe2-horizon');
const { PRIORITY, FOCUS, PLAN_FOCUS } = require('../../bot/shared/services/observe/observe2/fico17');
const { CHECK_VERSION } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');

const formToken = (id) => `coach-1:observe2-form:${id}`;
const checkToken = (id) => `coach-1:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };

const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
  p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no',
  incident: 'none', lp: 'used',
};
// The plan the recording graded: two steps done, two not done.
const FIDELITY = {
  status: 'ok', fidelity_pct: 50, prescribed_count: 4, band: 'partial',
  moves: [
    { move_id: 'm1', phase: 'warm_up', text: 'Ask what they remember about fractions.', verdict: 'executed', counted: true },
    { move_id: 'm2', phase: 'explain', text: 'Show two fraction strips side by side.', verdict: 'executed', counted: true },
    { move_id: 'm3', phase: 'guided', text: 'Pairs order three fractions on the strip chart.', verdict: 'not_done', counted: true },
    { move_id: 'm4', phase: 'independent', text: 'Each child orders five fractions in the notebook.', verdict: 'not_done', counted: true },
  ],
};

async function unsealed() {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), { period_minutes: 40, answers: { ...ANSWERS }, part1_done_at: 'x', part2_done_at: 'x' });
  return form.id;
}

async function sealedWith(answers, extra = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), {
    period_minutes: 40, answers: { ...ANSWERS, ...answers }, sealed_at: '2026-10-15T05:39:00.000Z', part1_done_at: 'x', part2_done_at: 'x',
    coaching_session_id: 'sess-1', rumi_moments: { moments: [], counts: {}, fidelity: FIDELITY }, moments_ready_at: 'x',
  }, extra);
  return form.id;
}

const SEAL = { screen: 'AFTER', incident: 'none', detail: '', note: '', seal_ok: true };

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

describe('the seal screen', () => {
  test('takes "Following the plan\'s steps" as the first pick, and up to two more', async () => {
    const id = await unsealed();
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'AFTER', { ...SEAL, priority: 'plan', also_1: 'C7', also_2: 'D1' });
    expect(out.screen).toBe('SEALED');
    expect(row(id).answers).toMatchObject({ priority: 'plan', also_1: 'C7', also_2: 'D1' });
    await flush();
  });

  test('"Nothing else" is a valid answer for the optional picks', async () => {
    const id = await unsealed();
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'AFTER', { ...SEAL, priority: 'C7', also_1: 'none', also_2: 'none' });
    expect(out.screen).toBe('SEALED');
    await flush();
  });

  test('a repeat of the first pick, or of each other, is refused under the field and nothing is sealed', async () => {
    const id = await unsealed();
    const same = await Form.handleObserve2FormDataExchange(formToken(id), 'AFTER', { ...SEAL, priority: 'C7', also_1: 'C7' });
    expect(same.screen).toBe('AFTER');
    expect(same.data.error_messages.also_1).toBeTruthy();
    expect(same.data.error).toBe(same.data.error_messages.also_1);
    const twice = await Form.handleObserve2FormDataExchange(formToken(id), 'AFTER', { ...SEAL, priority: 'C7', also_1: 'D1', also_2: 'D1' });
    expect(twice.data.error_messages.also_2).toBeTruthy();
    expect(row(id).sealed_at).toBeUndefined();
  });
});

describe('the check\'s PRIORITY screen', () => {
  test('a check on the new Flow pre-fills all three picks from the seal', async () => {
    const id = await sealedWith({ priority: 'plan', also_1: 'C7' });
    const out = await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_TWO', { screen: 'ADDED_TWO', cv: CHECK_VERSION });
    expect(out).toEqual({ screen: 'PRIORITY', data: { priority_level: 'plan', also_level_1: 'C7', also_level_2: 'none' } });
  });

  test('a check opened on today\'s Flow keeps today\'s screen data, and never pre-fills a pick its list lacks', async () => {
    const id = await sealedWith({ priority: 'plan', also_1: 'C7' });
    const out = await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_TWO', { screen: 'ADDED_TWO' });
    expect(out).toEqual({ screen: 'PRIORITY', data: { priority_level: '' } });
    const id2 = await sealedWith({ priority: 'C8' });
    expect(await Check.handleObserve2CheckDataExchange(checkToken(id2), 'ADDED_TWO', { screen: 'ADDED_TWO' }))
      .toEqual({ screen: 'PRIORITY', data: { priority_level: 'C8' } });
  });
});

describe('Submit carries the picks through', () => {
  test('the plan as first pick: the record\'s focus, the others, the brief, and the report\'s one target', async () => {
    const id = await sealedWith({ priority: 'C1', also_1: 'D1' });
    const done = await Check.handleObserve2CheckDataExchange(checkToken(id), 'PRIORITY', {
      screen: 'PRIORITY', cv: CHECK_VERSION, priority_final: 'plan', also_final_1: 'C7', also_final_2: 'C7', why: 'the plan was skipped',
    });
    expect(done.screen).toBe('DONE');
    expect(row(id).evidence_review).toMatchObject({ priority_final: 'plan', also_final: ['C7'] });
    await flush();

    const analysis = mockFake.__tables.coaching_sessions[0].analysis_data;
    expect(analysis.focus_area).toMatchObject({ indicator: 'plan', domain: 'lesson_plan_fidelity', title: FOCUS.plan });
    expect(analysis.focus_area.rationale).toMatch(/2 of 4 planned steps done/);
    expect(analysis.focus_area.try_this_tomorrow).toMatch(/Pairs order three fractions/);
    expect(analysis.also_work_on).toEqual([expect.objectContaining({ indicator: 'C7', title: PRIORITY.C7 })]);
    expect(analysis.growth_opportunities.map((g) => g.area)).toEqual([FOCUS.plan, PRIORITY.C7]);
    expect(analysis.observe2).toMatchObject({ priority: 'plan', also: ['C7'] });

    const brief = analysis.observe2.brief;
    expect(brief).toContain(`Work on first: *${FOCUS.plan}*`);
    expect(brief).toContain('Pairs order three fractions on the strip chart.');
    expect(brief).toContain(`Also work on: *${PRIORITY.C7}*`);
    expect(brief).not.toMatch(/undefined|null|NaN/);

    // The teacher's report names ONE area: the coach's first pick, here the plan (Section B), with no V4 bars.
    expect(observe2Target(analysis)).toMatchObject({ indicator: 'plan', domain: 'lesson_plan_fidelity', name: FOCUS.plan, count: null, levels: null });
  });

  test('a Submit from today\'s check Flow keeps the "also" picks sealed in the form', async () => {
    const id = await sealedWith({ priority: 'C1', also_1: 'D1', also_2: 'C2' });
    await Check.handleObserve2CheckDataExchange(checkToken(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C2', why: '' });
    expect(row(id).evidence_review.also_final).toEqual(['D1']);
    await flush();
    const analysis = mockFake.__tables.coaching_sessions[0].analysis_data;
    expect(analysis.focus_area.indicator).toBe('C2');
    expect(analysis.also_work_on.map((x) => x.indicator)).toEqual(['D1']);
  });
});

describe('the plan as a focus, without a graded plan', () => {
  const form = (lp) => ({
    answers: { ...ANSWERS, lp, priority: PLAN_FOCUS }, rumi_moments: { moments: [] }, final_levels: {},
    evidence_review: { priority_final: PLAN_FOCUS },
  });

  test.each(['en', 'ur'])('the brief says what the coach saw (%s)', (lang) => {
    const none = buildBrief(form('none'), { teacherName: 'Rabia', lang });
    const notFollowed = buildBrief(form('notfollowed'), { teacherName: 'Rabia', lang });
    for (const text of [none, notFollowed]) {
      expect(text).toContain(FOCUS.plan);
      expect(text).not.toMatch(/undefined|null|NaN/);
    }
    expect(none).not.toEqual(notFollowed);
    if (lang === 'en') {
      expect(none).toContain('What you saw: there was no lesson plan for this lesson');
      expect(notFollowed).toContain('What you saw: the teacher had a plan and did not follow it');
    }
  });

  test('the record says it too, and the report still names the plan', () => {
    const a = buildAnalysis({ id: 'f1', ...form('none') });
    expect(a.focus_area).toMatchObject({ indicator: 'plan', domain: 'lesson_plan_fidelity' });
    expect(a.focus_area.rationale).toMatch(/no lesson plan/);
    expect(observe2Target(a)).toMatchObject({ indicator: 'plan', domain: 'lesson_plan_fidelity' });
  });

  test('"plan" is never read as an indicator outside an /observe2 record', () => {
    expect(observe2Target({ framework: 'fico', domains: { lesson_plan_fidelity: { indicators: [] } }, focus_area: { indicator: 'plan', title: 'x' } })).toBeNull();
  });
});
