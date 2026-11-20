/**
 * bd-snkn32.59.4 (queue #165, phase 2) — "A whole unit" from her learning goals, with NO textbook behind it.
 * Amena, 20 Nov: "learning goals wont be related to the textbook, it could be any few goals that need a plan, pls dont
 * link the textbook for learning goals". So a goal unit is split into days from her goals alone: no chapter, no page,
 * no book day.
 */
const G = require('../../bot/shared/services/lp-own-unit-goals');
const { startEditing, edit, checkOutline } = require('../../bot/shared/services/lp-own-unit-edit');

const goal = (text, extra = {}) => ({ kind: 'outcome', text, ...extra });
const FOUR = [goal('Add 2-digit numbers'), goal('Subtract 2-digit numbers'), { kind: 'topic', text: 'Word problems' }, goal('Read a clock to the hour')];
const kinds = (days) => days.map((d) => d.kind);

describe('parseUnitGoals — any few goals, her order, no book', () => {
  it('keeps 2-8 goals in her order, each { kind, text } (a picked goal may keep its code)', () => {
    const out = G.parseUnitGoals([goal('Add 2-digit numbers', { code: 'M-03-AD-02' }), { kind: 'topic', text: 'Telling time' }]);
    expect(out).toEqual({ ok: true, goals: [{ kind: 'outcome', text: 'Add 2-digit numbers', code: 'M-03-AD-02' }, { kind: 'topic', text: 'Telling time' }] });
  });
  it('refuses fewer than 2 or more than 8 goals', () => {
    expect(G.parseUnitGoals([goal('Add numbers')])).toEqual({ ok: false, error: 'goals_count' });
    expect(G.parseUnitGoals(Array.from({ length: 9 }, (_, i) => goal(`Goal number ${i}`)))).toEqual({ ok: false, error: 'goals_count' });
    expect(G.parseUnitGoals('add')).toEqual({ ok: false, error: 'goals_count' });
  });
  it('the same goal twice counts once', () => {
    expect(G.parseUnitGoals([goal('Add numbers'), goal('add numbers')])).toEqual({ ok: false, error: 'goals_count' });
  });
  it('refuses a goal with a blocked word, and a goal too short to plan', () => {
    expect(G.parseUnitGoals([goal('Add numbers'), { kind: 'topic', text: 'sex' }]).ok).toBe(false);
    expect(G.parseUnitGoals([goal('Add numbers'), { kind: 'topic', text: 'ab' }]).ok).toBe(false);
  });
  it('drops a code that is not an official code shape; a typed topic never carries one', () => {
    const out = G.parseUnitGoals([goal('Add numbers', { code: 'grade_3_math_ch2_seg1' }), { kind: 'topic', text: 'Time', code: 'M-03-TI-01' }]);
    expect(out.goals).toEqual([{ kind: 'outcome', text: 'Add numbers' }, { kind: 'topic', text: 'Time' }]);
  });
  it('takes nothing from the book: a segmentId or lesson id sent with a goal is dropped', () => {
    const out = G.parseUnitGoals([{ ...goal('Add numbers'), segmentId: 'grade_3_math_ch2_seg1' }, goal('Subtract numbers')]);
    expect(JSON.stringify(out)).not.toMatch(/seg|chapter|page/);
  });
});

describe('buildGoalOutline — her goals become days', () => {
  const build = (over = {}) => G.buildGoalOutline({ goals: FOUR, pace: 'recommended', period: 35, ...over });

  it('recommended: one day per goal, a review after every 3 goals, then a review of all and a check day', () => {
    const out = build();
    expect(out.ok).toBe(true);
    expect(kinds(out.days)).toEqual(['lesson', 'lesson', 'lesson', 'review', 'lesson', 'review', 'test']);
    expect(out.days[0]).toEqual({ kind: 'lesson', chapter: 1, lesson_ids: ['goal_1'], topic: 'Add 2-digit numbers' });
    expect(out.days[3]).toMatchObject({ kind: 'review', lesson_ids: ['review_1'], covers: [1, 3] });
    expect(out.days[5]).toMatchObject({ kind: 'review', covers: [1, 4] });
    expect(out.days[6]).toMatchObject({ kind: 'test', lesson_ids: ['check'], covers: [1, 4] });
  });
  it('2 goals = 4 days; 8 goals = 12 days (reviews after goals 3 and 6, then the review of all and the check)', () => {
    expect(kinds(build({ goals: FOUR.slice(0, 2) }).days)).toEqual(['lesson', 'lesson', 'review', 'test']);
    const eight = Array.from({ length: 8 }, (_, i) => goal(`Goal number ${i + 1}`));
    expect(kinds(build({ goals: eight }).days)).toEqual(['lesson', 'lesson', 'lesson', 'review', 'lesson', 'lesson', 'lesson', 'review', 'lesson', 'lesson', 'review', 'test']);
  });
  it('slower: one practice day after each goal', () => {
    const { days } = build({ pace: 'slower' });
    expect(days).toHaveLength(11);
    expect(days[1]).toEqual({ kind: 'practice', chapter: 1, lesson_ids: ['goal_1'], topic: 'Add 2-digit numbers' });
  });
  it('faster: no review in the middle; the review of all and the check day stay', () => {
    expect(kinds(build({ pace: 'faster' }).days)).toEqual(['lesson', 'lesson', 'lesson', 'lesson', 'review', 'test']);
  });
  it('faster with nothing to drop (3 goals or fewer) is not offered', () => {
    expect(build({ goals: FOUR.slice(0, 3), pace: 'faster' })).toEqual({ ok: false, error: 'no_faster' });
  });
  it('no day names a book day, chapter title or page', () => {
    const s = JSON.stringify(build({ pace: 'slower' }).days);
    expect(s).not.toMatch(/grade_\d|_seg|_ch\d|pages/);
  });
  it('refuses a bad pace or period', () => {
    expect(build({ pace: 'quick' })).toEqual({ ok: false, error: 'bad_pace' });
    expect(build({ period: 10 })).toEqual({ ok: false, error: 'bad_period' });
  });
});

describe('goalPaceCounts — the day count beside each pace', () => {
  it('4 goals: recommended 7, slower 11, faster 6; 3 goals: 5 and 8, no faster', () => {
    expect(G.goalPaceCounts({ goals: FOUR, period: 35 })).toEqual({ recommended: 7, slower: 11, faster: 6 });
    expect(G.goalPaceCounts({ goals: FOUR.slice(0, 3), period: 35 })).toEqual({ recommended: 5, slower: 8, faster: null });
  });
});

describe('her changes to a goal unit use the same ⋯ menu rules', () => {
  const built = G.buildGoalOutline({ goals: FOUR, pace: 'recommended', period: 35 }).days;
  it('two goals join into one day, split back, and the outline still checks', () => {
    let st = startEditing(built);
    const j = edit(st, { op: 'join', at: 0 });
    expect(j.ok).toBe(true);
    st = j.state;
    expect(st.days[0]).toMatchObject({ lesson_ids: ['goal_1', 'goal_2'] });
    expect(checkOutline(st.days, built)).toEqual({ ok: true });
    st = edit(st, { op: 'split', at: 0 }).state;
    expect(checkOutline(st.days, built)).toEqual({ ok: true });
  });
  it('the check day stays last', () => {
    const st = startEditing(built);
    expect(edit(st, { op: 'move', at: 5, dir: 1 })).toEqual({ ok: false, error: 'test_day_fixed' });
  });
  it('an outline that drops a goal is refused', () => {
    expect(checkOutline(built.filter((d) => d.lesson_ids[0] !== 'goal_2'), built)).toEqual({ ok: false, error: 'missing_day' });
  });
});

describe('goalsOfDay — the goals a day teaches, practises, reviews or checks', () => {
  const texts = FOUR.map((g) => g.text);
  const { days } = G.buildGoalOutline({ goals: FOUR, pace: 'recommended', period: 35 });
  it('a lesson day: its goal(s); a review or check day: the goals it covers', () => {
    expect(G.goalsOfDay(days[0], texts)).toEqual(['Add 2-digit numbers']);
    expect(G.goalsOfDay({ ...days[0], lesson_ids: ['goal_1', 'goal_2'] }, texts)).toEqual(['Add 2-digit numbers', 'Subtract 2-digit numbers']);
    expect(G.goalsOfDay(days[3], texts)).toEqual(texts.slice(0, 3));
    expect(G.goalsOfDay(days[6], texts)).toEqual(texts);
  });
});
