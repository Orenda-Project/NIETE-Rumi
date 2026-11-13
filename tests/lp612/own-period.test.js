/**
 * bd-snkn32.30 — a "Make my own" plan fits ONE period, and a bigger class gets LESS to do, not just less time.
 * Tester (G3 English): "The content given in LP cannot be covered in one class specifically the schools which have
 * large number of students in the class." lp-own-period.js is the pure rule both bands use.
 */
const P = require('../../bot/shared/services/lp-own-period');

const day = (over = {}) => ({
  goal: 'g',
  meta: { day: 1, minutes: 30 },
  hook: { minutes: 3, story: 's', conversation: [{ teacherAsks: 'a' }] },
  iDo: { minutes: 6, steps: [{ say: 'a' }, { say: 'b' }], worked: { work: ['x', 'y', 'z', 'w', 'v'] } },
  weDo: { minutes: 9, action: 'w', steps: [{ say: 'a' }] },
  youDo: { minutes: 9, action: 'y', problems: [{ prompt: '1' }, { prompt: '2' }] },
  wrap: { minutes: 3, exitOptions: [{ prompt: 'e' }], homework: ['hw'] },
  ...over,
});

describe('periodOf — the period the day was written for', () => {
  it('is the day\'s own meta.minutes (30 for a v8 day, 40 for a v9 day)', () => {
    expect(P.periodOf(day())).toBe(30);
    expect(P.periodOf(day({ meta: { minutes: 40 } }))).toBe(40);
  });
  it('falls back to the parts\' sum, and is null when the day states no minutes (never an assumed number)', () => {
    expect(P.periodOf(day({ meta: {} }))).toBe(30);
    expect(P.periodOf({ meta: {}, hook: {}, iDo: {} })).toBeNull();
  });
});

describe('timingProblems — every GRR part is clocked and the five add up to the period', () => {
  it('a day whose parts sum to the period passes', () => {
    expect(P.timingProblems(day(), 30)).toEqual([]);
  });
  it('the stored v8 shape (no minutes on hook and wrap, 24 of 30) is refused', () => {
    const s = day(); delete s.hook.minutes; delete s.wrap.minutes;
    expect(P.timingProblems(s, 30).join(' ')).toMatch(/hook.*minutes|minutes.*hook/);
  });
  it('parts that run over the period are refused, naming both numbers', () => {
    const s = day(); s.youDo.minutes = 15;
    expect(P.timingProblems(s, 30).join(' ')).toMatch(/36.*30/);
  });
  it('no period stated: nothing to check', () => {
    expect(P.timingProblems(day(), null)).toEqual([]);
  });
});

describe('the load by class size — a bigger class gets fewer activities', () => {
  it('caps shrink (never grow) as the class grows', () => {
    const order = ['up30', '31_50', '51_70', 'over70'];
    for (let i = 1; i < order.length; i++) {
      const a = P.LOAD[order[i - 1]]; const b = P.LOAD[order[i]];
      expect(b.steps).toBeLessThanOrEqual(a.steps);
      expect(b.problems).toBeLessThanOrEqual(a.problems);
    }
    expect(P.LOAD.over70.problems).toBeLessThan(P.LOAD.up30.problems);
    expect(P.LOAD.over70.steps).toBeLessThan(P.LOAD.up30.steps);
  });

  it('overLoad names the part that carries too many activities for her class', () => {
    const s = day(); s.youDo.problems = [1, 2, 3, 4].map((n) => ({ prompt: String(n) }));
    expect(P.overLoad(s, 'up30')).toEqual([]);
    expect(P.overLoad(s, 'over70').join(' ')).toMatch(/youDo.*problems/);
  });

  it('diagrams and worked examples are never counted as load (shorten by cutting activities, not pictures)', () => {
    const s = day(); s.hook.board = { content: 'a\nb\nc\nd\ne' }; s.iDo.worked = { work: Array(9).fill('x') };
    expect(P.overLoad(s, 'over70')).toEqual([]);
  });

  it('the prompt line for a big class says fewer activities, whole-class checks and the book (never naming slates)', () => {
    const big = P.loadLine('over70');
    expect(big).toMatch(new RegExp(`at most ${P.LOAD.over70.steps} `));
    expect(big).toMatch(/choral/i);
    expect(big).toMatch(/in the book or their copies/);
    expect(big).not.toMatch(/slates?/i);
    expect(P.loadLine('up30')).not.toEqual(big);
  });

  it('timingLine gives every part a share that adds up to the period', () => {
    const t = P.timingLine(40);
    expect(t).toMatch(/40 minutes/);
    const nums = (t.match(/about (\d+)/g) || []).map((x) => Number(x.replace(/\D/g, '')));
    expect(nums).toHaveLength(5);
    expect(nums.reduce((a, b) => a + b, 0)).toBe(40);
  });
});

describe('perChildChecks — no check a teacher of 40+ cannot run', () => {
  it('catches checking each child\'s work one by one', () => {
    expect(P.perChildChecks(day({ youDo: { minutes: 9, action: 'Walk round and check each child\'s copy.' } }))).toHaveLength(1);
    expect(P.perChildChecks(day({ wrap: { minutes: 3, howToRun: 'Children read aloud to you one by one.' } }))).toHaveLength(1);
  });
  it('leaves independent work alone ("each child works alone" is You Do, not a teacher check)', () => {
    expect(P.perChildChecks(day({ youDo: { minutes: 9, action: 'Each child works alone in the book.' } }))).toEqual([]);
  });
  it('slates are named: ICT classes work in the book', () => {
    expect(P.slates(day({ weDo: { minutes: 9, action: 'Write it on your slate.' } }))).toHaveLength(1);
    expect(P.slates(day())).toEqual([]);
  });
});
