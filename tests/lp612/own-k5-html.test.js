/**
 * bd-snkn32.12 — a grades 1–5 v9/v10 day read IN FULL for Make my own (lp-k5-own-html.js, pure). The quiz digest
 * (lp-v9-html-source.toSlideScript) keeps only what a quiz needs, so a Make my own started from it had no Opening,
 * no We Do and an I Do with no steps. This reads every gradual-release part the teacher holds: Opening, I Do, We Do,
 * You Do, Check, Homework, by each section bar's own class (We Do and You Do share data-sec="activity").
 */
const { toK5Script } = require('../../bot/shared/services/lp-k5-own-html');
const { missingGrr } = require('../../bot/shared/services/lp-k5-own');
const { EN, UR, PARTIAL } = require('./fixtures/k5-own-v10-html');

const LESSON = 'grade_2_math_ch6_seg1';
const all = (v) => JSON.stringify(v);

describe('toK5Script — every part of the day', () => {
  const s = toK5Script(EN, { lessonId: LESSON });

  it('keeps the digest\'s outcome and meta, and has all five parts filled', () => {
    expect(s.goal).toBe('Sharing means the same number in every group.');
    expect(s.sloCode).toBe('M-02-DV-01');
    expect(s.meta).toEqual(expect.objectContaining({ lessonId: LESSON, grade: 2, topic: 'Sharing pebbles into equal groups', minutes: 35, language: 'en' }));
    expect(missingGrr(s)).toEqual([]);
  });

  it('Opening: the warm-up with its answer, the hook question, the next step, key words, board and materials', () => {
    expect(s.hook.minutes).toBe(4);
    expect(s.hook.warmUp).toEqual({ teacherAsks: 'Count to twelve in twos.', expectedAnswer: '2, 4, 6, 8, 10, 12' });
    expect(s.hook.conversation).toEqual([{ teacherAsks: 'HOOK-QUESTION: three friends, twelve sweets — fair?' }]);
    expect(s.hook.steps).toEqual([{ n: 1, action: 'OPENING-STEP: children guess aloud.' }]);
    expect(s.hook.keyWords).toEqual([{ term: 'equal', def: 'the same amount in each group' }]);
    expect(s.hook.board.content).toContain('TWELVE PEBBLES, THREE BAGS');
    expect(s.hook.materials).toEqual(['twelve pebbles', 'three bags']);
  });

  it('I Do: the script turns in order (do → action, the rest → say), the check and the mistake', () => {
    expect(s.iDo.minutes).toBe(9);
    expect(s.iDo.steps).toEqual([
      { n: 1, action: 'IDO-ACTION: put twelve pebbles on the desk.' },
      { n: 2, say: 'IDO-SAY: one pebble for each bag, again and again.' },
      { n: 3, say: 'IDO-ASK: are the bags equal?' },
    ]);
    expect(s.iDo.cfu).toBe('IDO-CFU: how do you know?');
    expect(s.iDo.misconception).toEqual({ slip: 'MIS-SLIP: the last bag gets the rest.', fix: 'MIS-FIX: count every bag again.' });
  });

  it('We Do is its own part (not merged into You Do), continued bars append, routines keep their steps', () => {
    expect(s.weDo.minutes).toBe(10);
    expect(s.weDo.strategy).toBe('WEDO-SETUP: circulate and ask where they started.');
    expect(s.weDo.steps.map((x) => x.action || x.say)).toEqual([
      'WEDO-ACTION: share 8 pebbles into 2 bags together.',
      'WEDO-FRAME: each bag has ___ pebbles.',
      'PARTNER CHECK · 2 minutes: ROUTINE-1: A shares. ROUTINE-2: B counts.',
    ]);
    expect(all(s.weDo)).not.toMatch(/YOUDO|PRACTICE/);
  });

  it('You Do: the task, practice with answers, the check, and both differentiation cards', () => {
    expect(s.youDo.minutes).toBe(9);
    expect(s.youDo.steps).toEqual([{ n: 1, action: 'YOUDO-TASK: pairs do p.41 Q2.' }]);
    expect(s.youDo.problems).toEqual([{ n: 1, prompt: 'PRACTICE-1: share 10 into 2.', answer: 'PRACTICE-1-ANSWER 5' }]);
    expect(s.youDo.cfu).toBe('YOUDO-ASK: how did you check?');
    expect(s.youDo.behind).toEqual({ prompt: 'BEHIND: use six pebbles first.' });
    expect(s.youDo.ahead).toEqual({ prompt: 'AHEAD: share 15 into 3.' });
  });

  it('Check and Homework: the exit ticket with its answer, the re-teach rule, the homework', () => {
    expect(s.wrap.minutes).toBe(3);
    expect(s.wrap.exitOptions).toEqual([{ prompt: 'EXIT-PROMPT: share 6 into 3.', answer: 'EXIT-ANSWER 2' }]);
    expect(s.wrap.reteach).toBe('RETEACH: if under 2 of 3, redo the bags.');
    expect(s.wrap.homework).toEqual(['HOMEWORK-1: share spoons at home.']);
  });

  it('never carries the coaching corner, its offer, the footer or diagram text', () => {
    expect(all(s)).not.toMatch(/COACH-TEXT|OFFER-TEXT|0300|FOOTER-LINE|SVG-TEXT/);
  });
});

describe('toK5Script — an Urdu day', () => {
  const s = toK5Script(UR, { lessonId: 'grade_1_urdu_ch3_seg2' });

  it('all five parts, Urdu minutes read as numbers, Urdu card labels', () => {
    expect(missingGrr(s)).toEqual([]);
    expect(s.meta.language).toBe('ur');
    expect([s.hook.minutes, s.iDo.minutes, s.weDo.minutes, s.youDo.minutes, s.wrap.minutes]).toEqual([5, 10, 12, 10, 3]);
    expect(s.weDo.steps[0].say).toBe('سب مل کر بولیں: ج اور ا، جا۔');
    expect(s.youDo.problems[0]).toEqual({ n: 1, prompt: 'ج + ا = ___', answer: 'جا' });
    expect(s.youDo.behind.prompt).toBe('ایک حرف سے شروع کریں۔');
    expect(s.youDo.ahead.prompt).toBe('تین حروف جوڑیں۔');
  });
});

describe('toK5Script — a document cut short', () => {
  it('reports the missing parts instead of inventing them', () => {
    expect(missingGrr(toK5Script(PARTIAL, { lessonId: LESSON }))).toEqual(['weDo', 'youDo', 'wrap']);
  });
});
