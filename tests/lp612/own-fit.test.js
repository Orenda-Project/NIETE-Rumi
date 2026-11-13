/**
 * bd-snkn32.40 — soft rules are fixed in code after the model's reply, never refused and never sent back to the model
 * (each refusal cost a paid repair round and, twice, her row). lp-own-fit.js is pure: minutes scaled to the day's
 * period, extra activities trimmed to her class size, and a plan longer than her day plan kept with a warning.
 */
const F = require('../../bot/shared/services/lp-own-fit');
const { LOAD, IDO_STEPS, timingProblems, overLoad } = require('../../bot/shared/services/lp-own-period');

const SECTIONS = ['hook', 'iDo', 'weDo', 'youDo', 'wrap'];
const sum = (s) => SECTIONS.reduce((a, k) => a + s[k].minutes, 0);

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

describe('fitMinutes — the five parts fill exactly the day\'s period', () => {
  it('leaves a plan that already fits untouched (no fix reported)', () => {
    const out = F.fitMinutes(day(), 30);
    expect(out.fixed).toBe(false);
    expect(out.script).toEqual(day());
  });

  it('fills missing minutes and scales so the five add up exactly, every part at least 1, all whole numbers', () => {
    const s = day(); delete s.hook.minutes; delete s.wrap.minutes; // a v8 day clocks only I Do/We Do/You Do
    const out = F.fitMinutes(s, 30);
    expect(out.fixed).toBe(true);
    expect(sum(out.script)).toBe(30);
    SECTIONS.forEach((k) => { expect(Number.isInteger(out.script[k].minutes)).toBe(true); expect(out.script[k].minutes).toBeGreaterThanOrEqual(1); });
    expect(timingProblems(out.script, 30)).toEqual([]);
  });

  it('scales an over-long plan down to the period and keeps the opening and the check small', () => {
    const s = day(); s.hook.minutes = 15; s.iDo.minutes = 12; s.weDo.minutes = 15; s.youDo.minutes = 15; s.wrap.minutes = 15;
    const out = F.fitMinutes(s, 40);
    expect(sum(out.script)).toBe(40);
    expect(out.script.hook.minutes).toBeLessThanOrEqual(6);
    expect(out.script.wrap.minutes).toBeLessThanOrEqual(6);
    expect(out.script.weDo.minutes).toBeGreaterThan(out.script.hook.minutes);
  });

  it('reads "5 min" strings and drops nonsense, and never edits the plan it was given', () => {
    const s = day(); s.iDo.minutes = '5 min'; s.youDo.minutes = 'lots';
    const before = JSON.stringify(s);
    const out = F.fitMinutes(s, 30);
    expect(sum(out.script)).toBe(30);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('with no period (the day states none) changes nothing', () => {
    const s = day(); delete s.hook.minutes;
    expect(F.fitMinutes(s, null)).toEqual({ script: s, fixed: false });
  });
});

describe('trimToLoad — extra activities beyond her class size are cut, never a picture', () => {
  it('cuts You Do questions, steps, checks and homework down to the cap, keeping the first ones', () => {
    const s = day();
    s.youDo.problems = [1, 2, 3, 4].map((n) => ({ prompt: `Q${n}` }));
    s.weDo.steps = [1, 2, 3].map((n) => ({ say: `s${n}` }));
    s.wrap.exitOptions = [{ prompt: 'e1' }, { prompt: 'e2' }];
    s.wrap.homework = ['h1', 'h2'];
    s.iDo.steps = [1, 2, 3, 4, 5].map((n) => ({ say: `i${n}` }));
    const c = LOAD.over70;
    const out = F.trimToLoad(s, 'over70');
    expect(out.script.youDo.problems.map((p) => p.prompt)).toEqual(['Q1', 'Q2'].slice(0, c.problems));
    expect(out.script.weDo.steps).toHaveLength(c.steps);
    expect(out.script.wrap.exitOptions).toHaveLength(c.checks);
    expect(out.script.wrap.homework).toEqual(['h1']);
    expect(out.script.iDo.steps).toHaveLength(IDO_STEPS);
    expect(overLoad(out.script, 'over70')).toEqual([]);
    expect(out.trimmed.join(' ')).toMatch(/youDo\.problems 4→2/);
    expect(s.youDo.problems).toHaveLength(4); // the reply itself is not edited
  });

  it('never cuts a worked example, a board drawing or a diagram, even inside a capped list', () => {
    const s = day();
    s.weDo.steps = [{ say: 'a' }, { say: 'b', board: 'draw 3 tens' }, { say: 'c' }, { say: 'd', diagram: '<svg/>' }];
    const out = F.trimToLoad(s, 'over70'); // cap 2
    expect(out.script.weDo.steps.map((x) => x.say)).toEqual(['b', 'd']);
    expect(out.script.iDo.worked).toEqual(day().iDo.worked);
  });

  it('a plan within the caps, or an unknown size, is not touched', () => {
    expect(F.trimToLoad(day(), 'up30')).toEqual({ script: day(), trimmed: [] });
    expect(F.trimToLoad(day(), undefined)).toEqual({ script: day(), trimmed: [] });
  });
});

describe('fitK5 — the soft fixes in one pass, after the reply', () => {
  const make = { size: 'over70', period: 30 };

  it('fixes minutes and caps and reports each fix', () => {
    const s = day(); delete s.hook.minutes; s.youDo.problems = [1, 2, 3].map((n) => ({ prompt: `${n}` }));
    const out = F.fitK5(day(), s, make);
    expect(sum(out.script)).toBe(30);
    expect(out.script.youDo.problems).toHaveLength(2);
    expect(out.fixes.join(' ')).toMatch(/minutes/);
    expect(out.fixes.join(' ')).toMatch(/youDo\.problems/);
    expect(out.warnings).toEqual([]);
  });

  it('a make longer than her day plan is kept, with a warning (never a refusal)', () => {
    const long = day(); long.weDo.action += ' Then every child reads the whole page aloud again, slowly.';
    const out = F.fitK5(day(), long, make);
    expect(out.script.weDo.action).toBe(long.weDo.action);
    expect(out.warnings.join(' ')).toMatch(/longer than her day plan/);
  });

  it('trimming that brings a make back within her day plan leaves no warning', () => {
    const s = day(); s.youDo.problems = [{ prompt: '1' }, { prompt: '2' }, { prompt: 'a much longer third question here' }];
    const out = F.fitK5(day(), s, make);
    expect(out.warnings).toEqual([]);
  });

  it('a change keeps its own 1.3x allowance: within it no warning, beyond it a warning, never a cap or a minute fix', () => {
    const near = day(); near.weDo.action = 'w'.repeat(20);
    expect(F.fitK5(day(), near, {}).warnings).toEqual([]);
    const far = day(); far.weDo.action = 'w'.repeat(5000); delete far.hook.minutes;
    const out = F.fitK5(day(), far, {});
    expect(out.warnings.join(' ')).toMatch(/longer/);
    expect(out.script).toEqual(far);
    expect(out.fixes).toEqual([]);
  });
});

describe('repairOnly — one-by-one checks in a big class go back once, never the last word', () => {
  it('names a per-child teacher check in a class over 30, and nothing for a small class', () => {
    const s = day(); s.youDo.action = 'Walk round and check each child\'s copy.';
    expect(F.repairOnly(s, 'over70').join(' ')).toMatch(/each child/);
    expect(F.repairOnly(s, 'up30')).toEqual([]);
    expect(F.repairOnly(day(), 'over70')).toEqual([]);
  });
});
