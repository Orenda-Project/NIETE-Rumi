'use strict';
/**
 * bd-snkn32.15 — her change as the instruction for the rewrite (pure). 6-12: one instruction for the existing edit lane
 * (reviseLessonPlan). Grades 1–5: the existing rewrite's system rules plus her one change, on the latest plan.
 */
const { buildEditInstruction, k5EditMessages } = require('../../bot/shared/services/lp-own-edit-instruction');

const SCRIPT = { goal: 'Count to 10', meta: { day: 3 }, hook: { say: 'h' }, iDo: { steps: ['a'] }, weDo: { say: 'w' }, youDo: { say: 'y' }, wrap: { say: 'z' } };

describe('grades 6–12', () => {
  it('names the one section to change, keeps the rest, and carries her words', () => {
    const s = buildEditInstruction({ part: 'activity', text: 'Use a role play with four groups' });
    expect(s).toMatch(/only the Activity section/);
    expect(s).toMatch(/every other section exactly as it is/);
    expect(s).toContain('"Use a role play with four groups"');
    expect(s).toMatch(/learning outcomes/);
  });

  it('the whole plan: her change across the plan, outcomes and pages kept', () => {
    const s = buildEditInstruction({ part: 'whole', text: 'Make it suit a class of 70 with no board' });
    expect(s).toMatch(/across the whole plan/);
    expect(s).not.toMatch(/only the/);
  });

  it('refuses a part it does not know', () => {
    expect(() => buildEditInstruction({ part: 'hook', text: 'x'.repeat(20) })).toThrow();
  });
});

describe('grades 1–5', () => {
  it('starts from the plan it is given, changes one part, and keeps the existing rules', () => {
    const [sys, user] = k5EditMessages({ script: SCRIPT, edit: { part: 'we_do', text: 'Pairs count bottle caps' }, lang: 'en', grade: 1, subject: 'Mathematics' });
    expect(sys.role).toBe('system');
    expect(sys.content).toMatch(/Never change: the learning outcome/);
    expect(user.content).toMatch(/Change only the weDo part/);
    expect(user.content).toMatch(/hook, iDo, youDo and wrap/);
    expect(user.content).toContain('"Pairs count bottle caps"');
    expect(user.content).toContain(JSON.stringify(SCRIPT));
  });

  it('an Urdu book keeps the Urdu rule', () => {
    const [sys] = k5EditMessages({ script: SCRIPT, edit: { part: 'hook', text: 'کہانی سے شروع کریں اور سوال پوچھیں' }, lang: 'ur', grade: 2, subject: 'Urdu' });
    expect(sys.content).toMatch(/URDU book/);
  });

  it('refuses a part it does not know', () => {
    expect(() => k5EditMessages({ script: SCRIPT, edit: { part: 'activity', text: 'x' }, lang: 'en' })).toThrow();
  });
});
