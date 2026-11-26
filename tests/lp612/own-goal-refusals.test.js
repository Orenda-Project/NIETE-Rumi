'use strict';
/**
 * bd-snkn32.58.9 (queue #365) — "Make my own" from a learning goal was refused 15 of 35 times on live (24–26 Nov,
 * own_plan.check result=refused → OWN_GOAL_UNSURE). Re-running real refused rows showed faults on BOTH sides:
 *
 *   The plan      the goal was written over the wrong day ("Draft and write a formal letter" over the Survival Haiku
 *                 day, though the next day is the formal letter), and the writer was told to "use only facts the day's
 *                 plan supports", so it kept teaching the book day's topic: every section off her goal.
 *   The checker   it judged the plan's labels (the book day's sloFull / meta topic) as wrong, and it listed lines it
 *                 itself called "not an error" / "this is fine" — and any listed line refused the plan.
 *
 * So: each goal picks the topic's day whose title shares its words; the writer replaces content that is not about her
 * goal; the checker sees only what is taught and never counts a line it dismissed itself.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const S = require('../../bot/shared/services/lp-own-goal-skills');
const { dayForGoal, k5GoalLines } = require('../../bot/shared/services/lp-k5-own-goal');
const A = require('../../bot/shared/services/lp612-own-accuracy');
const C = require('../../bot/shared/services/lp-own-goal-check');

const lesson = (id, type, topic) => ({ lesson_id: id, lp_type: type, topic, pages: [] });
const BOOK = {
  grade: 5, subject_key: 'english',
  chapters: [{ number: 13, title: 'Ready, Set, Survive!', lessons: [
    lesson('e_ch13_seg5', 'content', 'Grammar Playground: Connector Choices'),
    lesson('e_ch13_seg6', 'content', 'Survival Haiku'),
    lesson('e_ch13_seg7', 'content', 'Formal Letter on Survival Preparedness + Recalling Riddles'),
    lesson('e_ch13_seg995', 'assessment', 'Chapter 13 Assessment Worksheet'),
  ] }],
};
// the live matrix row: one topic, two days, a haiku SLO and a formal-letter SLO
const HAIKU_TOPIC = {
  chapter_number: 13, name: 'Survival Haiku', pages: [172, 173, 174], days: [2, 3], sort_order: 1,
  slo_codes: ['E-05-WR-29', 'E-05-WR-30'],
  slo_descriptions: ['Write a haiku (poem).', 'Draft and write a formal letter/email, application, complaint.'],
};

describe('the plan: each goal is written over the day that teaches it', () => {
  it('a formal-letter goal picks the formal-letter day, the haiku goal keeps the haiku day', () => {
    expect(dayForGoal(HAIKU_TOPIC, BOOK, 'Draft and write a formal letter/email, application, complaint.').lesson_id).toBe('e_ch13_seg7');
    expect(dayForGoal(HAIKU_TOPIC, BOOK, 'Write a haiku (poem).').lesson_id).toBe('e_ch13_seg6');
  });

  it('no shared words: the first day, as before', () => {
    expect(dayForGoal(HAIKU_TOPIC, BOOK, 'Take turns to speak on a topic.').lesson_id).toBe('e_ch13_seg6');
  });

  it('the goal list carries the matching day for each goal', () => {
    const rows = S.skillRows([HAIKU_TOPIC], BOOK, 'english');
    expect(rows.map((r) => [r.slo_code, r.segment_id])).toEqual([['E-05-WR-29', 'e_ch13_seg6'], ['E-05-WR-30', 'e_ch13_seg7']]);
  });

  it('the writer replaces what is not about her goal instead of teaching only what the day supports', () => {
    const text = k5GoalLines({ kind: 'outcome', text: 'Draft and write a formal letter.' }).join('\n');
    expect(text).not.toMatch(/teach the part it supports/);
    expect(text).toMatch(/replace/i);
  });
});

describe('the checker: judges what is taught, counts only real errors', () => {
  it('is told not to judge labels and not to list what it finds correct', () => {
    const [sys] = A.goalCheckMessages({ plan: '{}', goal: { text: 'x' }, grade: 5 });
    expect(sys.content).toMatch(/labels/i);
    expect(sys.content).toMatch(/never list a statement you find correct/i);
  });

  it('a line it dismissed itself does not refuse the plan', () => {
    const r = A.parseGoalCheck(JSON.stringify({
      accurate: false, on_goal: true, off_goal: [],
      errors: [
        "Mercury's boiling point given as 357°C -> commonly cited value is 356.7°C, acceptable rounding, not an error",
        'W3 states a wider tube is less sensitive -> true only if bulb size is held constant, which is stated, so this is fine',
      ],
    }));
    expect(r).toEqual({ accurate: true, errors: [], onGoal: true, offGoal: [] });
  });

  it('a real error still refuses', () => {
    const r = A.parseGoalCheck(JSON.stringify({ accurate: false, on_goal: true, off_goal: [], errors: ['7 x 8 = 54 -> it is 56'] }));
    expect(r.accurate).toBe(false);
    expect(r.errors).toEqual(['7 x 8 = 54 -> it is 56']);
  });

  it('a grades 1-5 plan reaches the checker without the book day\'s labels', async () => {
    const seen = [];
    const script = {
      meta: { day: 6, topic: 'Survival Haiku' }, goal: 'old', sloFull: 'I can write a survival haiku.', sloCode: 'E-05-WR-29',
      hook: { a: 1 }, iDo: { steps: ['x'] }, weDo: { a: 1 }, youDo: { a: 1 }, wrap: { a: 1 },
    };
    const goal = { kind: 'outcome', text: 'Draft and write a formal letter.' };
    const d = { log: () => {}, goalCheck: async ({ plan }) => { seen.push(JSON.parse(plan)); return { accurate: true, errors: [], onGoal: true, offGoal: [] }; } };
    const out = await C.goalGate(d, { row: { id: 'r1', answers: { goal } }, band: 'k5', doc: script, grade: 5, rewrite: async () => null });
    expect(Object.keys(seen[0]).sort()).toEqual(['goal', 'hook', 'iDo', 'weDo', 'wrap', 'youDo']);
    expect(seen[0].goal).toBe('Draft and write a formal letter.');
    expect(out.meta).toEqual(script.meta); // what she gets keeps every field
    expect(out.sloCode).toBe('E-05-WR-29');
  });
});

describe('the checker: an unexplained "not accurate" still refuses', () => {
  it('accurate false with no lines at all stays not accurate', () => {
    expect(A.parseGoalCheck(JSON.stringify({ accurate: false, errors: [], on_goal: true, off_goal: [] })).accurate).toBe(false);
  });
});
