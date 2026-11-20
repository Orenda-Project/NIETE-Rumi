/**
 * bd-snkn32.56 (queue #151, #134 E) — "Start from a learning goal or topic": no textbook in class.
 *
 * Step 1 offers her grade+subject's learning outcomes (each one a catalogue lesson's own slo_descriptions) or a typed
 * topic. Either way the plan is still written over the closest catalogue lesson, so its facts stay grounded in a page
 * the model is given; what changes is that the CLASS has no book: every text and exercise goes into the plan itself.
 */
const {
  parseGoal, outcomeList, matchTopic, goalLines, TOPIC_MAX,
} = require('../../bot/shared/services/lp612-own-goal');

const rows = [
  { segment_id: 'g7.sci.c02.p010', chapter_number: 2, order_index: 1, chapter_title: 'Cells', menu_title: 'Plant cells', subtopic_title: 'Plant and animal cells', slo_descriptions: ['Compare plant and animal cells'] },
  { segment_id: 'g7.sci.c01.p001', chapter_number: 1, order_index: 1, chapter_title: 'Living things', menu_title: 'Living things', subtopic_title: 'Characteristics of living things', slo_descriptions: ['List the characteristics of living things'] },
  { segment_id: 'g7.sci.c01.p004', chapter_number: 1, order_index: 2, chapter_title: 'Living things', menu_title: 'Living things 2', subtopic_title: 'Characteristics again', slo_descriptions: ['List the characteristics of living things'] },
  { segment_id: 'g7.sci.c03.p020', chapter_number: 3, order_index: 1, chapter_title: 'Water', menu_title: 'The water cycle', subtopic_title: 'Evaporation and condensation', slo_descriptions: null },
];

describe('parseGoal', () => {
  it('takes an outcome she picked, with its lesson', () => {
    expect(parseGoal({ kind: 'outcome', text: '  Compare plant and animal cells ' }))
      .toEqual({ ok: true, goal: { kind: 'outcome', text: 'Compare plant and animal cells' } });
  });
  it('takes a typed topic, quote marks stripped and bounded', () => {
    const out = parseGoal({ kind: 'topic', text: '"Rain and   the water cycle"' });
    expect(out).toEqual({ ok: true, goal: { kind: 'topic', text: 'Rain and the water cycle' } });
    expect(parseGoal({ kind: 'topic', text: 'x'.repeat(500) }).goal.text).toHaveLength(TOPIC_MAX);
  });
  it.each([
    ['no goal', null],
    ['a list', ['topic']],
    ['an unknown kind', { kind: 'book', text: 'cells' }],
    ['too short', { kind: 'topic', text: 'ab' }],
    ['no text', { kind: 'outcome' }],
  ])('refuses %s', (_, raw) => {
    expect(parseGoal(raw).ok).toBe(false);
  });
});

describe('outcomeList', () => {
  it('one row per outcome, in the book order, each naming the first lesson that teaches it', () => {
    expect(outcomeList(rows)).toEqual([
      { segmentId: 'g7.sci.c01.p001', text: 'List the characteristics of living things' },
      { segmentId: 'g7.sci.c02.p010', text: 'Compare plant and animal cells' },
      { segmentId: 'g7.sci.c03.p020', text: 'Evaporation and condensation' },
    ]);
  });
  it('is empty with no rows', () => {
    expect(outcomeList(null)).toEqual([]);
  });
});

describe('matchTopic', () => {
  it('finds the lesson whose words her topic shares most', () => {
    expect(matchTopic('the water cycle and rain', rows).segment_id).toBe('g7.sci.c03.p020');
    expect(matchTopic('Animal cells', rows).segment_id).toBe('g7.sci.c02.p010');
  });
  it('is null when no lesson shares a real word (never a guess)', () => {
    expect(matchTopic('the and of', rows)).toBeNull();
    expect(matchTopic('volcanoes', rows)).toBeNull();
  });
});

describe('goalLines', () => {
  it('tells the model the class has no textbook and names her goal', () => {
    const text = goalLines({ kind: 'topic', text: 'Rain and the water cycle' }).join('\n');
    expect(text).toMatch(/no textbook/i);
    expect(text).toContain('"Rain and the water cycle"');
    expect(text).toMatch(/never send the class to a book page/i);
  });
  it('keeps facts to the pages it is given (the accuracy guard)', () => {
    expect(goalLines({ kind: 'outcome', text: 'Compare plant and animal cells' }).join('\n')).toMatch(/only facts the pages support/i);
  });
});

// bd-m8zwt1.3 (queue #164): official goals run to 371 characters; a picked one must never be cut (it is printed at the
// top of her plan and checked against). A typed topic keeps its 120-character cap.
describe('bd-m8zwt1.3 goal length', () => {
  const { parseGoal } = require('../../bot/shared/services/lp612-own-goal');
  test('a picked outcome keeps its full text up to 400 characters', () => {
    const long = `Students will be able to ${'arrange numbers in ascending and descending order '.repeat(6)}`.trim();
    expect(long.length).toBeGreaterThan(300);
    expect(parseGoal({ kind: 'outcome', text: long }).goal.text).toBe(long);
    expect(parseGoal({ kind: 'outcome', text: 'x'.repeat(900) }).goal.text).toHaveLength(400);
  });
  test('a typed topic is still cut at 120', () => {
    expect(parseGoal({ kind: 'topic', text: 'y'.repeat(300) }).goal.text).toHaveLength(120);
  });
});
