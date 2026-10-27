/**
 * /observe2 — five more "Work on first" choices, and the two existing ones in the coaches' own words
 * (FICO pilot sheet R20 and R21, two coaches, 16 Oct): classroom management, classroom rules, wait time
 * after a question, an engaging warm-up and effective lesson closure; "Following the plan's steps" says it is
 * the 5-step plan, and "Real group work" says it is assigning and managing group work.
 *
 * They are coaching focus areas, not scored indicators: no level, no section sum, no V4 bars, like the plan's
 * steps. Every reader of the pick is driven here with one: the seal, the check (all three of its published
 * versions), the record's focus, the brief in both languages, the report's one target, the next step, the
 * leader dashboard.
 *
 * Real: the form and check endpoints, the store, the rules, the brief, the analysis, the target resolver,
 * next-step, the /observe2 horizon, the leader patch. Mocked: the database (in memory),
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
const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');
const fico17 = require('../../bot/shared/services/observe/observe2/fico17');
const { CHECK_VERSION } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');
const { resolveTarget, resolveIndicator } = require('../../bot/shared/services/coaching/target-resolver');
const { selectNextStep, focusPatch } = require('../../bot/shared/services/coaching/next-step');
const { observe2Target } = require('../../bot/shared/services/coaching/report-v2/observe2-horizon');
const LeaderPatch = require('../../dashboard/services/leader-patch.service');

const { CODES, FOCUS, FOCUS_ORDER, PRIORITY } = fico17;
const NEW = ['wait', 'manage', 'rules', 'warmup', 'close'];
const TITLES = {
  wait: 'Wait time after a question', manage: 'Classroom management', rules: 'Classroom rules',
  warmup: 'An engaging warm-up', close: 'Effective lesson closure',
};
const EN = observe2Strings('en');
const UR = observe2Strings('ur');
const cp = (s) => [...String(s)].length;

const formToken = (id) => `coach-1:observe2-form:${id}`;
const checkToken = (id) => `coach-1:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };

const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
  p2_spoke: '10', p2_new: '5', p2_task: 'some', p2_teacher: ['round'], p2_stuck: 'sure', p2_think: ['recall'], p2_change: 'no',
  incident: 'none', lp: 'used',
};
// The plan the recording graded: the warm-up done, the exit check done (the coach says otherwise at the check).
const FIDELITY = {
  status: 'ok', fidelity_pct: 50, prescribed_count: 4, band: 'partial',
  moves: [
    { move_id: 'm1', phase: 'warm_up', text: 'Ask what they remember about fractions.', verdict: 'executed', counted: true },
    { move_id: 'm2', phase: 'explain', text: 'Show two fraction strips side by side.', verdict: 'executed', counted: true },
    { move_id: 'm3', phase: 'independent', text: 'Each child orders five fractions in the notebook.', verdict: 'not_done', counted: true },
    { move_id: 'm4', phase: 'exit', text: 'Exit ticket: order three fractions on a slip.', verdict: 'executed', counted: true },
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
    period_minutes: 40, answers: { ...ANSWERS, ...answers }, sealed_at: '2026-10-21T05:39:00.000Z', part1_done_at: 'x', part2_done_at: 'x',
    coaching_session_id: 'sess-1', rumi_moments: { moments: [], counts: {}, fidelity: FIDELITY }, moments_ready_at: 'x',
    // The levels the coach kept at the check: C5 2 (switches), C1 2, D1 1.
    evidence_review: { C5_final: '2', C1_final: '2', D1_final: '1' },
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

describe('the choices', () => {
  test('five coaching focus areas, in plain words within the 30-code-point option cap, none of them an indicator', () => {
    for (const id of NEW) {
      expect(FOCUS[id]).toBe(TITLES[id]);
      expect(cp(FOCUS[id])).toBeLessThanOrEqual(30);
      expect(CODES).not.toContain(id);
      expect(PRIORITY[id]).toBeUndefined();
    }
    expect(new Set(Object.values(FOCUS)).size).toBe(Object.keys(FOCUS).length);
  });

  test('each sits beside the choices it belongs with, and nothing is listed twice', () => {
    expect(FOCUS_ORDER).toHaveLength(17 + 1 + NEW.length);
    expect(new Set(FOCUS_ORDER).size).toBe(FOCUS_ORDER.length);
    expect(FOCUS_ORDER[FOCUS_ORDER.indexOf('D5') + 1]).toBe('wait');
    expect(FOCUS_ORDER.slice(FOCUS_ORDER.indexOf('C5'), FOCUS_ORDER.indexOf('C5') + 3)).toEqual(['C5', 'manage', 'rules']);
    expect(FOCUS_ORDER.slice(-3)).toEqual(['plan', 'warmup', 'close']);
  });

  test('the plan\'s steps and group work say what they are in the coaches\' own words', () => {
    const D = fico17.FOCUS_DESCRIPTION;
    expect(D.plan).toMatch(/5-step lesson plan/);
    expect(D.plan).toMatch(/lesson plan fidelity/i);
    expect(D.C7).toMatch(/^Assigning and managing group work/);
    expect(D.C5).toMatch(/switch|next/i);
    for (const id of NEW) expect(D[id]).toBeTruthy();
    for (const d of Object.values(D)) expect(cp(d)).toBeLessThanOrEqual(300);
  });

  test('none of them is scored: the record\'s sections are the same whichever is picked', () => {
    const base = { id: 'f1', answers: { ...ANSWERS }, rumi_moments: { moments: [], fidelity: FIDELITY }, final_levels: { C1: '2', C5: '2', D1: '1', C7: '1' } };
    const asC7 = buildAnalysis({ ...base, evidence_review: { priority_final: 'C7' } });
    for (const id of NEW) {
      const a = buildAnalysis({ ...base, evidence_review: { priority_final: id } });
      expect(a.domains).toEqual(asC7.domains);
      expect(a.scores).toEqual(asC7.scores);
    }
  });
});

describe('the seal screen', () => {
  test.each(NEW)('takes "%s" as the first pick and as an "also"', async (id) => {
    const iid = await unsealed();
    const other = NEW.find((x) => x !== id);
    const out = await Form.handleObserve2FormDataExchange(formToken(iid), 'AFTER', { ...SEAL, priority: id, also_1: other, also_2: 'plan' });
    expect(out.screen).toBe('SEALED');
    expect(row(iid).answers).toMatchObject({ priority: id, also_1: other, also_2: 'plan' });
    await flush();
  });

  test('a new choice picked twice is refused under the field, as any other', async () => {
    const iid = await unsealed();
    const out = await Form.handleObserve2FormDataExchange(formToken(iid), 'AFTER', { ...SEAL, priority: 'manage', also_1: 'manage' });
    expect(out.screen).toBe('AFTER');
    expect(out.data.error_messages.also_1).toBeTruthy();
    expect(row(iid).sealed_at).toBeUndefined();
  });
});

describe('the check\'s PRIORITY screen, on each published check', () => {
  test('this check (version 3) pre-fills all three picks, new choices included', async () => {
    expect(CHECK_VERSION).toBe('3');
    const id = await sealedWith({ priority: 'manage', also_1: 'wait', also_2: 'close' });
    const out = await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_TWO', { screen: 'ADDED_TWO', cv: CHECK_VERSION });
    // The coach's notes ride on every versioned check's PRIORITY screen (R23, notes-before-debrief.test.js); none typed here.
    expect(out).toEqual({
      screen: 'PRIORITY',
      data: { priority_level: 'manage', also_level_1: 'wait', also_level_2: 'close', notes_v: false, notes_body: '' },
    });
  });

  test('the round-6 check (version 2) is pre-filled only with what its lists have', async () => {
    const id = await sealedWith({ priority: 'manage', also_1: 'plan', also_2: 'wait' });
    const out = await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_TWO', { screen: 'ADDED_TWO', cv: '2' });
    expect(out).toEqual({
      screen: 'PRIORITY',
      data: { priority_level: '', also_level_1: 'plan', also_level_2: 'none', notes_v: false, notes_body: '' },
    });
  });

  test('the first check (no version) is pre-filled only with one of the 17', async () => {
    const id = await sealedWith({ priority: 'rules' });
    expect(await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_TWO', { screen: 'ADDED_TWO' }))
      .toEqual({ screen: 'PRIORITY', data: { priority_level: '' } });
  });
});

describe('Submit carries a new choice through the record, the brief and the report', () => {
  test('"Classroom management" first, two more after it', async () => {
    const id = await sealedWith({ priority: 'manage', also_1: 'wait', also_2: 'close' });
    const done = await Check.handleObserve2CheckDataExchange(checkToken(id), 'PRIORITY', {
      screen: 'PRIORITY', cv: CHECK_VERSION, priority_final: 'manage', also_final_1: 'wait', also_final_2: 'close', why: '',
    });
    expect(done.screen).toBe('DONE');
    expect(row(id).evidence_review).toMatchObject({ priority_final: 'manage', also_final: ['wait', 'close'] });
    await flush();

    const analysis = mockFake.__tables.coaching_sessions[0].analysis_data;
    expect(analysis.focus_area).toEqual({
      domain: 'high_leverage_practices',
      indicator: 'manage',
      title: 'Classroom management',
      rationale: 'What was seen: switching activities: signal given, but took long; only some children had a task of their own',
      try_this_tomorrow: EN.focus_next.manage,
      lever_question: expect.any(String),
    });
    expect(analysis.also_work_on.map((f) => [f.indicator, f.title])).toEqual([['wait', TITLES.wait], ['close', TITLES.close]]);
    expect(analysis.growth_opportunities.map((g) => g.area)).toEqual([TITLES.manage, TITLES.wait, TITLES.close]);
    expect(analysis.observe2).toMatchObject({ priority: 'manage', also: ['wait', 'close'] });

    const brief = analysis.observe2.brief;
    expect(brief).toContain('Work on first: *Classroom management*');
    expect(brief).toContain('What you saw: switching activities: signal given, but took long; only some children had a task of their own');
    expect(brief).toContain(`The next step: ${EN.focus_next.manage}`);
    expect(brief).toContain(`Also work on: *${TITLES.wait}* (what you saw: the teacher's questions: yes/no or chorus answers only; children's reasoning: one-word answers only)`);
    expect(brief).toContain(`Also work on: *${TITLES.close}* (what you saw: Exit ticket: order three fractions on a slip. (done))`);
    expect(brief).not.toMatch(/undefined|null|NaN/);

    // The report's ONE target is the coach's pick, never the weakest row.
    expect(resolveTarget(analysis)).toMatchObject({ indicator: 'manage', domain: 'high_leverage_practices', name: TITLES.manage, rung: null, levels: null, count: null });
    expect(resolveIndicator(analysis, 'manage')).toMatchObject({ indicator: 'manage', title: TITLES.manage });
    const step = selectNextStep(analysis);
    expect(step).toMatchObject({ fallback: false, target: { indicator: 'manage' } });
    expect(focusPatch(analysis, step.target)).toBeNull();
    expect(observe2Target(analysis)).toMatchObject({ indicator: 'manage', title: TITLES.manage, try: EN.focus_next.manage });
  });

  test('a Submit from the round-6 check keeps the sealed picks its lists could not show', async () => {
    const id = await sealedWith({ priority: 'warmup', also_1: 'rules' });
    await Check.handleObserve2CheckDataExchange(checkToken(id), 'PRIORITY', {
      screen: 'PRIORITY', cv: '2', priority_final: 'C5', also_final_1: 'none', also_final_2: 'none', why: '',
    });
    expect(row(id).evidence_review).toMatchObject({ priority_final: 'C5', also_final: ['warmup', 'rules'] });
    await flush();
  });

  test('a Submit from the first check keeps them too, beside the sealed picks it could show', async () => {
    const id = await sealedWith({ priority: 'close', also_1: 'C7' });
    await Check.handleObserve2CheckDataExchange(checkToken(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C2', why: '' });
    expect(row(id).evidence_review.also_final).toEqual(['close', 'C7']);
    await flush();
  });
});

describe('the brief says what the coach saw, and the next step, for each new choice', () => {
  const form = (priority, over = {}) => ({
    answers: { ...ANSWERS, priority, ...(over.answers || {}) },
    rumi_moments: { moments: over.moments || [], fidelity: 'fidelity' in over ? over.fidelity : FIDELITY },
    final_levels: { C1: '2', C5: '2', D1: '1', ...(over.final_levels || {}) },
    evidence_review: { priority_final: priority, ...(over.evidence_review || {}) },
  });

  test('wait time: the questions and the answers, then an asking moment to bring up', () => {
    const brief = buildBrief(form('wait', {
      moments: [{ id: 'm1', type: 'open_q_one', moment: 'ask', minute: '03:10', quote: 'Why does ice melt?' }],
      evidence_review: { heard_m1: 'yes' },
    }), { teacherName: 'Rabia', lang: 'en' });
    expect(brief).toContain(`Work on first: *${TITLES.wait}*`);
    expect(brief).toContain("What you saw: the teacher's questions: yes/no or chorus answers only; children's reasoning: one-word answers only");
    expect(brief).toContain(`The next step: ${EN.focus_next.wait}`);
    expect(brief).toContain('A moment to bring up (03:10): "Why does ice melt?"');
  });

  test('the warm-up: the plan\'s warm-up step and what happened to it', () => {
    const brief = buildBrief(form('warmup'), { lang: 'en' });
    expect(brief).toContain('What you saw: Ask what they remember about fractions. (done)');
    expect(brief).toContain(`The next step: ${EN.focus_next.warmup}`);
  });

  test('the closure: the plan\'s exit step as the coach confirmed it at the check', () => {
    const brief = buildBrief(form('close', {
      evidence_review: { fidelity: { fidelity_pct: 25, moves: [{ move_id: 'm4', text: 'Exit ticket: order three fractions on a slip.', verdict: 'not_done', counted: true }] } },
    }), { lang: 'en' });
    expect(brief).toContain('What you saw: Exit ticket: order three fractions on a slip. (not done)');
  });

  test('with nothing on the form for it, the brief points to the coach\'s own notes, and only when there are some', () => {
    const bare = buildBrief(form('close', { fidelity: null }), { lang: 'en' });
    expect(bare).toContain(`Work on first: *${TITLES.close}*`);
    expect(bare).not.toContain('What you saw:');
    expect(bare).toContain(`The next step: ${EN.focus_next.close}`);
    const noted = buildBrief(form('close', { fidelity: null, answers: { p2_notes: 'No wrap-up: the bell rang.' } }), { lang: 'en' });
    expect(noted).toContain('What you saw: see your notes below');
    expect(noted).toContain('No wrap-up: the bell rang.');
  });

  test.each(NEW)('in Urdu, "%s" reads in the coach\'s language around the plain words', (id) => {
    const brief = buildBrief(form(id), { teacherName: 'Rabia', lang: 'ur' });
    expect(brief).toContain(`پہلے اس پر کام: *${TITLES[id]}*`);
    expect(brief).toContain(`اگلا قدم: ${UR.focus_next[id]}`);
    expect(brief).not.toMatch(/undefined|null|NaN/);
  });

  test('every next step is written in both languages, in Urdu script with Urdu words for numbers, and addresses no one by gender', () => {
    for (const id of NEW) {
      expect(EN.focus_next[id]).toBeTruthy();
      expect(UR.focus_next[id]).toMatch(/[؀-ۿ]/);
      expect(UR.focus_next[id]).not.toEqual(EN.focus_next[id]);
      expect(UR.focus_next[id]).not.toMatch(/[0-9]/);
      expect(`${EN.focus_next[id]} ${UR.focus_next[id]}`).not.toMatch(/\b(she|he|her|his)\b|رہی ہیں|رہے ہیں|سکتی ہیں|سکتے ہیں/i);
    }
    for (const lang of [EN, UR]) for (const k of ['done', 'partial', 'not_done', 'not_adjudicable']) expect(lang.focus_verdict[k]).toBeTruthy();
  });
});

describe('every other reader of the pick takes a new choice by its title', () => {
  const analysisFor = (id) => buildAnalysis({ id: 'f1', answers: { ...ANSWERS, priority: id }, rumi_moments: { moments: [], fidelity: FIDELITY }, final_levels: { C5: '2' }, evidence_review: { priority_final: id } });

  test.each(NEW)('"%s": the record, the report\'s target and the next step all name it', (id) => {
    const a = analysisFor(id);
    expect(a.focus_area).toMatchObject({ indicator: id, title: TITLES[id], domain: 'high_leverage_practices', try_this_tomorrow: EN.focus_next[id] });
    expect(resolveTarget(a)).toMatchObject({ indicator: id, name: TITLES[id], rung: null });
    expect(selectNextStep(a)).toMatchObject({ fallback: false, target: { indicator: id } });
    expect(observe2Target(a)).toMatchObject({ indicator: id, title: TITLES[id] });
  });

  test('the leader dashboard names it', async () => {
    const a = analysisFor('rules');
    const teachers = await LeaderPatch.getPatchTeachers(async () => ({ rows: [{ rumi_user_id: 't1', teacher_ext_id: 'x1', last_analysis_data: a }] }), 'leader-1');
    expect(teachers[0].focusArea).toBe(TITLES.rules);
  });

  test('a new choice is never read as an indicator outside an /observe2 record', () => {
    expect(resolveTarget({ framework: 'fico', domains: { high_leverage_practices: { indicators: [] } }, focus_area: { indicator: 'manage', title: 'x' } })).toBeNull();
  });
});
