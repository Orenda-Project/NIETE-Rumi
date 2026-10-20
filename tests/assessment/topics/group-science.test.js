'use strict';
/** Task 3 — Science: "Topic N" labels group days; unlabelled chapters fall back to one topic per SLO. */
const { parseMatrixTab } = require('../../../bot/shared/services/assessment/topics/matrix-rows');
const { groupChapter } = require('../../../bot/shared/services/assessment/topics/group');
const { groupScience } = require('../../../bot/shared/services/assessment/topics/group-science');
const sample = require('./fixtures/matrix-sample.json');

const science = parseMatrixTab(sample.science, 'science');
const chapter = (g, n) => science.filter((r) => r.grade === g && r.chapter === n);
const content = (g, n) => chapter(g, n).filter((r) => r.lpType === 'content');

describe('G5 Ch1 — "Topic 1 - X" labels', () => {
  const topics = groupChapter('science', chapter(5, 1));

  test('three topics by topic number, names from the "Topic N: X - …" cell', () => {
    expect(topics.map((t) => [t.name, t.days])).toEqual([
      ["What's Inside Us?", [1, 2, 3]],
      ['How do Lungs and Heart Work Together?', [4, 5]],
      ['How do We Feel and React?', [6, 7]],
    ]);
  });

  test('pages and SLOs are the union; the id slug is the first SLO code', () => {
    expect(topics[1]).toMatchObject({
      pages: [9, 10, 11, 12, 13, 14, 15],
      sloCodes: ['S-05-LS-02', 'S-05-LS-04', 'S-05-LS-05', 'S-05-LS-06'],
      heading: null, headingOrder: null, topicId: '5-science-1-s-05-ls-02',
    });
  });
});

describe('G4 Ch2 — "Topic 1 · X" labels group the same way', () => {
  const topics = groupChapter('science', chapter(4, 2));

  test('two topics; the unlabelled Connect and Create day joins the topic sharing its SLO', () => {
    expect(topics.map((t) => [t.name, t.days])).toEqual([
      ['How can we classify animals?', [13, 14]],
      ['How do animals digest food?', [15, 16, 17]],
    ]);
  });

  test('review_assess (day 19) and the 995 (day 18) are dropped', () => {
    expect(topics.flatMap((t) => t.days)).not.toContain(18);
    expect(topics.flatMap((t) => t.days)).not.toContain(19);
  });

  test('" · " and " - " separators group alike', () => {
    const dashed = content(4, 2).map((r) => ({ ...r, section: r.section.replace(' · ', ' - ') }));
    expect(groupScience(dashed).map((t) => t.days)).toEqual(topics.map((t) => t.days));
  });
});

describe('unlabelled days in a labelled chapter', () => {
  const rows = content(4, 2);
  const free = (over) => ({ ...rows[4], ...over, section: 'Connect and Create' });

  test('with no shared SLO, the day joins the topic before it', () => {
    const out = groupScience([...rows.slice(0, 2), free({ day: 14.5, sloCodes: ['S-04-LS-99'] }), ...rows.slice(2, 4)]);
    expect(out[0].days).toEqual([13, 14, 14.5]);
  });

  test('a shared SLO wins over position', () => {
    const out = groupScience([...rows.slice(0, 4), free({ day: 20, sloCodes: ['S-04-LS-09'] })]);
    expect(out[0].days).toEqual([13, 14, 20]);
  });

  test('before any labelled day and with no shared SLO, it joins the first topic', () => {
    const out = groupScience([free({ day: 12, sloCodes: ['S-04-LS-99'] }), ...rows.slice(0, 4)]);
    expect(out[0].days).toEqual([12, 13, 14]);
  });
});

describe('G4 Ch1 — no labels: one topic per SLO', () => {
  const topics = groupChapter('science', chapter(4, 1));

  test('seven SLOs, seven topics, review_assess dropped', () => {
    expect(topics.map((t) => [t.sloCodes[0], t.days])).toEqual([
      ['S-04-LS-01', [1, 2, 3]],
      ['S-04-LS-03', [2, 4, 5]],
      ['S-04-LS-02', [6, 7]],
      ['S-04-LS-05', [7]],
      ['S-04-LS-04', [8, 9]],
      ['S-04-LS-06', [10]],
      ['S-04-LS-07', [10]],
    ]);
    expect(topics.flatMap((t) => t.days)).not.toContain(12);
  });

  test('names come from the single-SLO "I can…" statement, else the first day', () => {
    expect(topics[1].name).toBe('Investigate how plants use water');
    expect(topics[3].name).toBe('Flowering & Non-Flowering Plants');
    for (const t of topics) expect(Array.from(t.name).length).toBeLessThanOrEqual(40);
  });
});

describe('label and cell-name edge cases', () => {
  const [base] = content(4, 2);
  const day = (d, section, topic, codes = ['S-04-LS-50']) => ({ ...base, day: d, section, topic, sloCodes: codes });

  test('"Topic 10" and "Topic 1" are different topics; extra spaces still match', () => {
    const out = groupScience([day(1, 'Topic 1 · A', 'Alpha'), day(2, 'Topic 10 · B', 'Beta'), day(3, 'Topic  1 · C', 'Gamma')]);
    expect(out.map((t) => t.days)).toEqual([[1, 3], [2]]);
  });

  test.each([
    ['Topic 1: Plants', 'Plants'],
    ['Topic 1:Plants - how they grow', 'Plants'],
    ['Topic 10: Plants - how they grow', 'Plants'],
    ['Topic  1 : Plants - how they grow', 'Plants'],
  ])('cell "%s" names the topic "%s"', (cell, name) => {
    expect(groupScience([day(1, 'Topic 1 · X', cell)])[0].name).toBe(name);
  });

  test('a cell that only mentions a topic later on does not name it', () => {
    expect(groupScience([day(1, 'Topic 1 · X', 'Recap Topic 1: Old')])[0].name).toBe('Recap Topic 1: Old');
  });

  test('the day name drops only the last stage tag and anything after "→"', () => {
    const out = groupScience([day(1, 'Topic 1 · X', 'Plants (green) and more (concept) → next')]);
    expect(out[0].name).toBe('Plants (green) and more');
  });
});
