'use strict';
/**
 * bd-snkn32.58.17 (queue #381; causes bd-snkn32.58.14, .58.15) — goal plans still refused on main after #367's fix.
 *
 *   Phonics (.58.14)   G3 EN vowel-sound goal over ch3_seg1, a dictionary-method day. The writer was handed the day's
 *                      plan with the BOOK's outcome in `goal`/`sloFull`/`meta.sloDescriptions` and told "never change the
 *                      learning outcome" — so every section kept the 3-step dictionary method and the checker listed all
 *                      five off-goal (q367 re-run, run-grade_3_english_ch3_seg1-*.json). A goal start now hands the writer
 *                      the day with HER goal in those fields.
 *   Subtract (.58.15)  accurate:true, one line "Row C repeats the modelled problem" in off_goal → refused. The checker
 *                      had nowhere to put a tip, so tips landed in off_goal. It now has `notes`, which never refuse.
 *   Cut-off check      the re-check after the fix came back null (2,000 output tokens, cut-off JSON) and refused at
 *                      once; a null re-check is asked once more, and the check gets 4,000 tokens.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { goalLabelsK5 } = require('../../bot/shared/services/lp-k5-own-goal');
const A = require('../../bot/shared/services/lp612-own-accuracy');
const C = require('../../bot/shared/services/lp-own-goal-check');

const PASS = { accurate: true, errors: [], onGoal: true, offGoal: [] };
const GOAL = { kind: 'outcome', text: 'Recognise the five major vowel sounds and their letters.' };
const DAY = {
  meta: { lessonId: 'grade_3_english_ch3_seg1', topic: 'Memory Lane + New Words: my magical dictionary', minutes: 40,
    sloDescriptions: ['The 3-step method helps you find any word\'s meaning on your own.'] },
  goal: 'The 3-step method helps you find any word\'s meaning on your own.',
  sloFull: 'The 3-step method helps you find any word\'s meaning on your own.',
  sloCode: 'E-03-VO-06',
  hook: { minutes: 5 },
};

describe('phonics: the writer is given her goal as the day\'s outcome, not the book\'s', () => {
  it('replaces the book outcome everywhere the writer reads it', () => {
    const s = goalLabelsK5(DAY, GOAL);
    expect(JSON.stringify(s)).not.toMatch(/3-step method|magical dictionary|E-03-VO-06/);
    expect(s.goal).toBe(GOAL.text);
    expect(s.sloFull).toBe(GOAL.text);
    expect(s.meta.sloDescriptions).toEqual([GOAL.text]);
    expect(s.meta.topic).toBe(GOAL.text);
    expect(s.meta.lessonId).toBe(DAY.meta.lessonId);
    expect(s.meta.minutes).toBe(40);
    expect(s.hook).toEqual(DAY.hook);
  });
  it('never changes the day it was given; no goal → the day as it is', () => {
    const before = JSON.stringify(DAY);
    goalLabelsK5(DAY, GOAL);
    expect(JSON.stringify(DAY)).toBe(before);
    expect(goalLabelsK5(DAY, null)).toBe(DAY);
  });
});

describe('subtract: a tip is a note, and notes never refuse', () => {
  it('the checker is told where tips go', () => {
    const [sys] = A.goalCheckMessages({ plan: '{}', goal: { text: 'x' }, grade: 3 });
    expect(sys.content).toMatch(/"notes"/);
    expect(sys.content).toMatch(/different skill or topic/i);
  });
  it('an accurate plan with only notes passes', () => {
    const r = A.parseGoalCheck(JSON.stringify({ accurate: true, errors: [], on_goal: true, off_goal: [],
      notes: ['weDo Row C repeats the modelled problem 7,180 - 7'] }));
    expect(C.passed(r)).toBe(true);
  });
  it('a section teaching something else still refuses', () => {
    const r = A.parseGoalCheck('{"accurate":true,"errors":[],"on_goal":false,"off_goal":["youDo: about cricket"],"notes":[]}');
    expect(C.passed(r)).toBe(false);
  });
  it('a line it calls correct itself is not an error', () => {
    const r = A.parseGoalCheck(JSON.stringify({ accurate: false, on_goal: true, off_goal: [],
      errors: ["keyWords 'invite' has a short i sound -> this is correct, but could confuse children"] }));
    expect(r.accurate).toBe(true);
  });
});

describe('a cut-off re-check is asked once more', () => {
  it('fix, then null, then pass → fixed', async () => {
    const check = jest.fn().mockResolvedValueOnce({ ...PASS, accurate: false, errors: ['x -> y'] })
      .mockResolvedValueOnce(null).mockResolvedValueOnce(PASS);
    const r = await C.checkBeforeReady({ doc: { a: 1 }, check, fix: async () => ({ doc: { a: 2 } }) });
    expect(r.verdict).toBe('fixed');
    expect(check).toHaveBeenCalledTimes(3);
  });
  it('the check has room to answer: 4,000 tokens', async () => {
    const create = jest.fn(async () => ({ choices: [{ message: { content: '{"accurate":true,"errors":[],"on_goal":true,"off_goal":[]}' } }] }));
    await A.checkGoalPlan({ chat: { completions: { create } } }, 'm', { plan: '{}', goal: { text: 'x' }, grade: 3 });
    expect(create.mock.calls[0][0].max_completion_tokens).toBe(4000);
  });
});

describe('the worker hands the writer the day with her goal', () => {
  jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
  jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
  jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
  const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const SCRIPT = { ...DAY, hook: { warmUp: { teacherAsks: 'How many?' } }, iDo: { steps: [{ action: 'Show', say: 's' }] }, weDo: { action: 'w' }, youDo: { action: 'y' }, wrap: { exitOptions: [{ prompt: 'p' }] } };
  const ROW = { id: 'own-3', user_id: 'u1', lesson_id: 'grade_3_english_ch3_seg1', lang: 'en', status: 'authoring',
    answers: { size: '51_70', resources: [], level: 'mixed', way: 'games', note: '', goal: GOAL } };
  function run(row) {
    const deps = {
      claimOwn: jest.fn(async () => clone(row)),
      loadK5: jest.fn(async () => ({ script: clone(SCRIPT), lang: 'en', grade: 3, subject: 'english', subjectName: 'English', pages: { start: 26, end: 27 } })),
      rewriteK5: jest.fn(async (a) => ({ script: clone(a.script), model: 'm2' })),
      renderK5: jest.fn(async () => Buffer.from('%PDF')),
      upload: jest.fn(async () => {}), patchOwn: jest.fn(async () => {}), bookText: jest.fn(async () => 'BOOK'),
      sleep: jest.fn(async () => {}), now: (() => { let t = 0; return () => (t += 1000); })(), log: jest.fn(),
      goalCheck: jest.fn(async () => PASS),
    };
    return { worker: createOwnWorker(deps), deps };
  }
  it('a goal start: the writer never sees the book outcome', async () => {
    const { worker, deps } = run(ROW);
    await worker.process({ ownId: 'own-3' });
    const given = deps.rewriteK5.mock.calls[0][0].script;
    expect(given.goal).toBe(GOAL.text);
    expect(JSON.stringify(given)).not.toMatch(/3-step method/);
  });
  it('a book start: the day as it is', async () => {
    const { worker, deps } = run({ ...ROW, answers: { ...ROW.answers, goal: undefined } });
    await worker.process({ ownId: 'own-3' });
    expect(deps.rewriteK5.mock.calls[0][0].script.goal).toBe(DAY.goal);
  });
});

// q381 re-runs (outputs/q381-runs): after the notes change the refusals were "errors" that are teaching nits.
describe('an error is a false statement, not a teaching nit', () => {
  it('the checker is told what is not an error', () => {
    const [sys] = A.goalCheckMessages({ plan: '{}', goal: { text: 'x' }, grade: 3 });
    expect(sys.content).toMatch(/not taught earlier/i);
    expect(sys.content).toMatch(/only a statement that is false/i);
  });
  it('a line it says is not factually wrong is not an error', () => {
    const r = A.parseGoalCheck(JSON.stringify({ accurate: false, on_goal: true, off_goal: [], errors: [
      "Bottle cap numbering used as a finger code -> this conflates two systems, which is confusing but not factually wrong; not listing as a factual error, only as a potential confusion.",
    ] }));
    expect(r.accurate).toBe(true);
  });
});
