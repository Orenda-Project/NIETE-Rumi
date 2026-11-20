'use strict';
/**
 * bd-snkn32.59.4 (queue #165, phase 2) — one day of a GOAL unit is made with no textbook and no book day behind it
 * (Amena 20 Nov: "learning goals wont be related to the textbook … pls dont link the textbook for learning goals").
 * The guardrails stay: blocked words refused, the goal check before she sees it (the worker's goalGate).
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const U = require('../../bot/shared/services/lp-own-unit-day');
const { parseOwnAnswers } = require('../../bot/shared/services/lp612-own-instruction');
const { k5Messages, missingGrr } = require('../../bot/shared/services/lp-k5-own');
const { createOwnService } = require('../../bot/shared/services/lp612-own.service');
const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');

const ID = '0b6c1d9e-3f43-4c1e-9d55-1c7f1f1b2a10';
const unit = (over = {}) => ({
  unit_id: ID, day_no: 2, of: 7, kind: 'lesson', period: 35, start: 'goals', grade: 3, subject: 'math', lang: 'en',
  goals: ['Subtract 2-digit numbers'], recap: 'Add 2-digit numbers', ...over,
});
const base = { size: '31_50', level: 'on_track', way: 'cpa', resources: ['textbook', 'board'], note: '' };

describe('parseGoalUnit', () => {
  it('keeps a goal day: no lessons, no chapter, no page', () => {
    expect(U.parseGoalUnit(unit())).toEqual({ ok: true, unit: unit() });
  });
  it.each([
    [{ start: 'book' }], [{ unit_id: 'x' }], [{ day_no: 9 }], [{ kind: 'extra' }], [{ period: 5 }], [{ grade: 7 }],
    [{ subject: 'Math!' }], [{ lang: 'fr' }], [{ goals: [] }], [{ goals: ['ab'] }], [{ goals: ['a goal', 'b goal', 'c goal'] }],
    [{ kind: 'practice', goals: ['a goal', 'b goal'] }],
  ])('refuses %j', (over) => {
    expect(U.parseGoalUnit(unit(over)).ok).toBe(false);
  });
  it('drops unknown keys (a lesson id sent with it is not kept)', () => {
    const u = U.parseGoalUnit({ ...unit(), lessons: ['grade_3_math_ch2_seg4'], pages: { start: 3 } }).unit;
    expect(u.lessons).toBeUndefined();
    expect(u.pages).toBeUndefined();
  });
  it('a review or check day may cover all 8 goals', () => {
    expect(U.parseGoalUnit(unit({ kind: 'test', goals: Array.from({ length: 8 }, (_, i) => `Goal ${i + 1}`) })).ok).toBe(true);
  });
});

describe('parseOwnAnswers for a goal unit day', () => {
  it('her day\'s goals become the goal; the textbook is gone', () => {
    const r = parseOwnAnswers({ ...base, unit: unit({ goals: ['Add 2-digit numbers', 'Subtract 2-digit numbers'] }) }, { goalUnit: true });
    expect(r.ok).toBe(true);
    expect(r.answers.goal).toEqual({ kind: 'outcome', text: 'Add 2-digit numbers • Subtract 2-digit numbers' });
    expect(r.answers.resources).toEqual(['board']);
    expect(r.answers.unit.start).toBe('goals');
  });
  it('refuses a blocked word in a goal, and a goal sent beside the unit', () => {
    expect(parseOwnAnswers({ ...base, unit: unit({ goals: ['sex education'] }) }, { goalUnit: true }).ok).toBe(false);
    expect(parseOwnAnswers({ ...base, unit: unit(), goal: { kind: 'topic', text: 'Other' } }, { goalUnit: true }).ok).toBe(false);
  });
  it('a goal unit day is never accepted on a book day', () => {
    expect(parseOwnAnswers({ ...base, unit: unit() }, { lessonId: 'grade_3_math_ch2_seg4' }).ok).toBe(false);
  });
});

describe('the frame and the request for a goal day', () => {
  const answers = parseOwnAnswers({ ...base, unit: unit() }, { goalUnit: true }).answers;
  const script = U.goalDayScript(answers.unit);
  it('the frame has all five parts, her goals at the top and her period', () => {
    expect(missingGrr(script)).toEqual([]);
    expect(script.goal).toBe('Subtract 2-digit numbers');
    expect(script.meta.minutes).toBe(35);
  });
  it('the request says there is no textbook and no plan behind it, and never "the day\'s plan supports"', () => {
    const [, user] = k5Messages({ script, answers, lang: 'en', grade: 3, subject: 'math' });
    expect(user.content).toMatch(/NO textbook and NO ready plan/);
    expect(user.content).toMatch(/Teach her goal today: "Subtract 2-digit numbers"/);
    expect(user.content).not.toMatch(/day's plan supports|instead of the board|picture on the book page/);
    expect(user.content).toMatch(/use their copies instead/);
  });
  it.each([['review', /REVIEW day/], ['test', /CHECK day/], ['practice', /PRACTICE day/]])('a %s day says what it is', (kind, re) => {
    const a = parseOwnAnswers({ ...base, unit: unit({ kind }) }, { goalUnit: true }).answers;
    expect(k5Messages({ script: U.goalDayScript(a.unit), answers: a, lang: 'en', grade: 3, subject: 'math' })[1].content).toMatch(re);
  });
});

describe('requestOwn — a goal unit day', () => {
  const svc = (over = {}) => {
    const d = {
      unitOn: jest.fn(async () => true), countToday: jest.fn(async () => 0), env: {},
      insertOwn: jest.fn(async (row) => ({ id: 'own-9', ...row })), queueJob: jest.fn(async () => {}),
      k5Lesson: jest.fn(), segmentExists: jest.fn(), log: jest.fn(), ...over,
    };
    return { d, s: createOwnService(d) };
  };
  it('writes a row naming no segment and no book day, in the subject\'s language, and queues it', async () => {
    const { d, s } = svc();
    const out = await s.requestOwn({ userId: 'u1', answers: { ...base, unit: unit({ subject: 'urdu', lang: 'ur' }) } });
    expect(out).toEqual({ outcome: 'queued', ownId: 'own-9' });
    const row = d.insertOwn.mock.calls[0][0];
    expect(row.segment_id).toBeUndefined();
    expect(row.lesson_id).toBeUndefined();
    expect(row.lang).toBe('ur');
    expect(d.k5Lesson).not.toHaveBeenCalled();
  });
  it('the unit switch off → not found; the daily limit holds', async () => {
    expect(await svc({ unitOn: jest.fn(async () => false) }).s.requestOwn({ userId: 'u1', answers: { ...base, unit: unit() } })).toEqual({ outcome: 'not_found' });
    expect(await svc({ countToday: jest.fn(async () => 99) }).s.requestOwn({ userId: 'u1', answers: { ...base, unit: unit() } })).toEqual({ outcome: 'daily_limit' });
  });
});

describe('the job for a goal unit day', () => {
  const answers = parseOwnAnswers({ ...base, unit: unit() }, { goalUnit: true }).answers;
  const deps = (over = {}) => ({
    claimOwn: jest.fn(async () => ({ id: 'own-9', user_id: 'u1', segment_id: null, lesson_id: null, lang: 'en', template_version: 'k5_own_v1', status: 'authoring', answers })),
    loadK5: jest.fn(), bookText: jest.fn(),
    rewriteK5: jest.fn(async ({ script }) => ({ script, model: 'm' })),
    goalCheck: jest.fn(async () => ({ accurate: true, onGoal: true, errors: [], offGoal: [] })),
    renderK5: jest.fn(async () => Buffer.from('%PDF')),
    upload: jest.fn(async () => {}), patchOwn: jest.fn(async () => {}), sleep: jest.fn(), now: () => 0, log: jest.fn(),
    keys: { assertKeyInPrefix: (k) => k }, ...over,
  });
  it('reads no book day and no book text, checks the goal, stores under the unit, ends ready', async () => {
    const d = deps();
    await createOwnWorker(d).process({ ownId: 'own-9' });
    expect(d.loadK5).not.toHaveBeenCalled();
    expect(d.bookText).not.toHaveBeenCalled();
    expect(d.rewriteK5.mock.calls[0][0]).toEqual(expect.objectContaining({ bookText: null, dayPages: null, grade: 3, subject: 'math' }));
    expect(d.goalCheck).toHaveBeenCalled();
    expect(d.upload.mock.calls[0][1]).toMatch(/^lp612\/own-k5\/en\/unit_0b6c1d9e_d2\/[0-9a-f]{16}\.pdf$/);
    expect(d.patchOwn.mock.calls.at(-1)[1].status).toBe('ready');
  });
  it('a plan that fails the goal check twice is refused (never shown)', async () => {
    const d = deps({ goalCheck: jest.fn(async () => ({ accurate: false, onGoal: true, errors: ['7 - 3 = 5'], offGoal: [] })) });
    await createOwnWorker(d).process({ ownId: 'own-9' });
    expect(d.patchOwn.mock.calls.at(-1)[1]).toMatchObject({ status: 'failed', error_code: 'OWN_GOAL_UNSURE' });
  });
});

describe('"Change this plan" on a goal unit day', () => {
  const { bandOf } = require('../../bot/shared/services/lp-own-edit-guard');
  it('is a grades 1–5 plan (its parts, its stored script), though it names no book day', () => {
    expect(bandOf({ lesson_id: null, segment_id: null, answers: { unit: { start: 'goals' } } })).toBe('k5');
    expect(bandOf({ lesson_id: null, segment_id: 'grade_7_x', answers: {} })).toBe('g612');
  });
  it('the change row names no book day and is queued under the unit', async () => {
    const { createChangeService } = require('../../bot/shared/services/lp612-own-change');
    const root = { id: 'r1', user_id: 'u1', segment_id: null, lesson_id: null, lang: 'en', template_version: 'k5_own_v1', status: 'ready', r2_key: 'lp612/own-k5/en/unit_x_d2/h.pdf', answers: { unit: { start: 'goals' } } };
    const queued = [];
    const d = { selectOwn: async () => root, listChain: async () => [root], countToday: async () => 0, env: {},
      insertOwn: jest.fn(async (row) => ({ id: 'c1', ...row })), queueJob: async (key) => { queued.push(key); }, log: jest.fn(), patchOwn: jest.fn() };
    const out = await createChangeService(d).requestChange({ userId: 'u1', ownId: 'r1', part: 'i_do', text: 'Use bottle caps to count' });
    expect(out.outcome).toBe('queued');
    expect(d.insertOwn.mock.calls[0][0].lesson_id).toBeNull();
    expect(queued[0]).toBe('unit_r1');
  });
});
