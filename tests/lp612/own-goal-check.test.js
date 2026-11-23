'use strict';
/**
 * bd-snkn32.58.3 (queue #155 C) — a goal plan stays on its goal and is checked BEFORE she sees it (Amena 19 Nov: "how do
 * we ensure it remains on task without a textbook?").
 *
 *   The goal box      added by code: a grades 1–5 plan's `goal` is the exact official goal (printed at the top, and the
 *                     "Before they write" criteria come from it); a 6–12 plan gets it as an objective
 *   The check         one model call (the accuracy job): factual errors AND whether each section serves the goal
 *   Fix or refuse     a failed check → one fix rewrite fed the findings → re-check; still failing → refused
 *                     (OWN_GOAL_UNSURE); an unreadable check is asked once more, then refused
 *   Book plans        unchanged: no check before ready
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const A = require('../../bot/shared/services/lp612-own-accuracy');
const C = require('../../bot/shared/services/lp-own-goal-check');
const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');
const BASE = require('./__fixtures__/v9_gate_base.lp.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const GOAL = { kind: 'outcome', text: 'Multiply 2 digit numbers by 1 digit number.' };
const PASS = { accurate: true, errors: [], onGoal: true, offGoal: [] };
const WRONG = { accurate: false, errors: ['7 x 8 = 54 -> it is 56'], onGoal: true, offGoal: [] };

describe('the check call (lp612-own-accuracy, the same job)', () => {
  it('asks for facts and goal match per section', () => {
    const [sys, user] = A.goalCheckMessages({ plan: '{}', goal: GOAL, grade: 3 });
    expect(sys.content).toMatch(/FACTUAL/);
    expect(sys.content).toMatch(/serves the goal/);
    expect(user.content).toContain(GOAL.text);
  });
  it('reads the answer; errors or an off-goal section mean not passed; unreadable is null', () => {
    expect(A.parseGoalCheck('{"accurate":true,"errors":[],"on_goal":true,"off_goal":[]}')).toEqual(PASS);
    expect(A.parseGoalCheck('{"accurate":true,"errors":["x -> y"],"on_goal":true,"off_goal":[]}').accurate).toBe(false);
    expect(A.parseGoalCheck('{"accurate":true,"errors":[],"on_goal":true,"off_goal":["You do: about cricket"]}').onGoal).toBe(false);
    expect(A.parseGoalCheck('not json')).toBeNull();
    expect(A.parseGoalCheck('{"accurate":"yes"}')).toBeNull();
  });
  it('the call never throws: a failure is null', async () => {
    const client = { chat: { completions: { create: jest.fn(async () => { throw new Error('down'); }) } } };
    expect(await A.checkGoalPlan(client, 'm', { plan: '{}', goal: GOAL, grade: 3 })).toBeNull();
    expect(client.chat.completions.create.mock.calls[0][0].job).toBe(A.ACCURACY_JOB);
  });
});

describe('checkBeforeReady: fix or refuse', () => {
  const run = (answers, fixed = { doc: 'FIXED' }) => {
    const check = jest.fn();
    answers.forEach((a) => check.mockResolvedValueOnce(a));
    const fix = jest.fn(async () => fixed);
    return { check, fix, go: () => C.checkBeforeReady({ check, fix, doc: 'DOC' }) };
  };
  it('passes first time: the plan as it was', async () => {
    const { check, fix, go } = run([PASS]);
    expect(await go()).toEqual({ verdict: 'pass', doc: 'DOC', findings: 0 });
    expect(check).toHaveBeenCalledTimes(1);
    expect(fix).not.toHaveBeenCalled();
  });
  it('a wrong fact: one fix rewrite fed the findings, re-checked: fixed', async () => {
    const { check, fix, go } = run([WRONG, PASS]);
    expect(await go()).toEqual({ verdict: 'fixed', doc: 'FIXED', findings: 1 });
    expect(JSON.stringify(fix.mock.calls[0][0])).toMatch(/7 x 8 = 54/); // the findings
    expect(check).toHaveBeenLastCalledWith('FIXED');
  });
  it('still wrong after the fix: refused', async () => {
    const { go } = run([WRONG, WRONG]);
    expect((await go()).verdict).toBe('refused');
  });
  it('the fix rewrite itself fails: refused', async () => {
    const { go } = run([WRONG], null);
    expect((await go()).verdict).toBe('refused');
  });
  it('an unreadable check is asked once more; unreadable twice: refused', async () => {
    expect((await run([null, PASS]).go()).verdict).toBe('pass');
    expect((await run([null, null]).go()).verdict).toBe('refused');
  });
  it('the fix instruction names the goal and keeps the plan whole', () => {
    const t = C.fixInstruction(WRONG, GOAL);
    expect(t).toContain(GOAL.text);
    expect(t).toMatch(/7 x 8 = 54/);
    expect(t).toMatch(/Keep every section/);
  });
});

describe('the goal box, added by code', () => {
  it('grades 1–5: the plan\'s goal is the exact official goal', () => {
    const s = { goal: 'model text', wrap: {} };
    expect(C.goalBoxK5(s, GOAL).goal).toBe(GOAL.text);
    expect(s.goal).toBe('model text'); // never changes the one given
  });
  it('grades 6–12: the goal is added once, as the last objective (no Urdu pointer moves)', () => {
    const doc = { objectives: { items: [{ text: 'You can name the parts.' }] } };
    const once = C.goalBox612(doc, GOAL);
    expect(once.objectives.items.map((o) => o.text)).toEqual(['You can name the parts.', `Today's goal: ${GOAL.text}`]);
    expect(C.goalBox612(once, GOAL).objectives.items).toHaveLength(2);
    expect(C.goalBox612({}, GOAL)).toEqual({});
  });
});

describe('the worker checks goal plans before ready', () => {
  const ROW612 = {
    id: 'own-1', user_id: 'u1', segment_id: 'grade_8_science.c02.p010-013', lang: 'en', template_version: 'v9.1', status: 'authoring',
    answers: { size: '51_70', resources: [], level: 'mixed', way: 'worked', note: '', goal: { kind: 'outcome', text: 'Explain air pressure' } },
  };
  const SEG = { segment_id: ROW612.segment_id, grade: 8, subject: 'General Science', curriculum: 'ict', printed_page_start: 10, printed_page_end: 13 };
  const ROWK5 = { id: 'own-2', user_id: 'u1', lesson_id: 'grade_3_math_ch2_seg1', lang: 'en', status: 'authoring',
    answers: { size: '51_70', resources: [], level: 'mixed', way: 'games', note: '', goal: GOAL } };
  const SCRIPT = { goal: 'model goal', meta: { day: 1, topic: 'T' }, hook: { warmUp: { teacherAsks: 'How many?' } }, iDo: { steps: [{ action: 'Show', say: 's' }] }, weDo: { action: 'w' }, youDo: { action: 'y' }, wrap: { exitOptions: [{ prompt: 'p' }] } };

  function harness(row, verdicts) {
    const patches = [];
    const goalCheck = jest.fn();
    verdicts.forEach((v) => goalCheck.mockResolvedValueOnce(v));
    const deps = {
      claimOwn: jest.fn(async () => clone(row)),
      loadSegment: jest.fn(async () => ({ ...SEG })),
      readStoredDoc: jest.fn(async () => clone(BASE)),
      revise: jest.fn(async () => ({ accepted: true, lpDoc: clone(BASE), model: 'm1' })),
      render: jest.fn(async () => ({ pdfPath: '/tmp/x.pdf' })),
      loadK5: jest.fn(async () => ({ script: clone(SCRIPT), lang: 'en', grade: 3, subject: 'math', subjectName: 'Maths', pages: { start: 2, end: 3 } })),
      rewriteK5: jest.fn(async () => ({ script: clone(SCRIPT), model: 'm2' })),
      renderK5: jest.fn(async () => Buffer.from('%PDF')),
      readFile: jest.fn(async () => Buffer.from('%PDF')),
      upload: jest.fn(async () => {}),
      patchOwn: jest.fn(async (id, f) => { patches.push(f); }),
      bookText: jest.fn(async () => 'BOOK'),
      sleep: jest.fn(async () => {}),
      now: (() => { let t = 0; return () => (t += 1000); })(),
      log: jest.fn(),
      goalCheck,
    };
    return { worker: createOwnWorker(deps), deps, patches };
  }
  const checkLog = (deps) => deps.log.mock.calls.find(([m]) => m === 'own_plan.check');

  it('grades 1–5 goal plan passing: ready, the goal box in the printed plan, the check logged (ids only)', async () => {
    const { worker, deps, patches } = harness(ROWK5, [PASS]);
    await worker.process({ ownId: 'own-2' });
    expect(patches.at(-1).status).toBe('ready');
    expect(deps.renderK5.mock.calls[0][0].script.goal).toBe(GOAL.text);
    expect(checkLog(deps)[1]).toEqual(expect.objectContaining({ ownId: 'own-2', result: 'pass', band: 'k5' }));
  });
  it('grades 1–5 seeded wrong fact, not fixed: refused with OWN_GOAL_UNSURE, nothing printed', async () => {
    const { worker, deps, patches } = harness(ROWK5, [WRONG, WRONG]);
    await worker.process({ ownId: 'own-2' });
    expect(patches.at(-1)).toEqual(expect.objectContaining({ status: 'failed', error_code: 'OWN_GOAL_UNSURE' }));
    expect(deps.rewriteK5).toHaveBeenCalledTimes(2); // the make, then one fix
    expect(deps.renderK5).not.toHaveBeenCalled();
    expect(checkLog(deps)[1].result).toBe('refused');
  });
  it('grades 6–12 seeded wrong fact, fixed: ready after one fix rewrite', async () => {
    const { worker, deps, patches } = harness(ROW612, [WRONG, PASS]);
    await worker.process({ ownId: 'own-1' });
    expect(deps.revise).toHaveBeenCalledTimes(2);
    expect(deps.revise.mock.calls[1][0].instruction).toMatch(/7 x 8 = 54/);
    expect(patches.at(-1).status).toBe('ready');
    expect(checkLog(deps)[1].result).toBe('fixed');
  });
  it('a book plan (no goal): no check before ready', async () => {
    const { worker, deps, patches } = harness({ ...ROW612, answers: { ...ROW612.answers, goal: undefined } }, []);
    await worker.process({ ownId: 'own-1' });
    expect(deps.goalCheck).not.toHaveBeenCalled();
    expect(patches.at(-1).status).toBe('ready');
  });
});
