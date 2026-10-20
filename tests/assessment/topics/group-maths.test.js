'use strict';
/** Task 3 — Maths: one topic per SLO, word problems on their own (spec §4.1). Real fixture rows. */
const { parseMatrixTab } = require('../../../bot/shared/services/assessment/topics/matrix-rows');
const { groupChapter, isTopicRow } = require('../../../bot/shared/services/assessment/topics/group');
const { groupMaths, groupBySlo } = require('../../../bot/shared/services/assessment/topics/group-maths');
const sample = require('./fixtures/matrix-sample.json');

const maths = parseMatrixTab(sample.maths, 'maths');
const chapter = (n) => maths.filter((r) => r.chapter === n);
const code = (t) => t.sloCodes.join(',');

describe('Maths G1 Ch1 — one topic per SLO', () => {
  const topics = groupChapter('maths', chapter(1));
  const bySlo = (c) => topics.find((t) => t.sloCodes[0] === c);

  test('eight SLOs give eight topics in first-appearance order; 995/990 days are not topics', () => {
    expect(topics.map(code)).toEqual([
      'M-01-NS-01', 'M-01-NS-02', 'M-01-NS-04', 'M-01-NS-03',
      'M-01-NS-05', 'M-01-NS-06', 'M-01-NS-07', 'M-01-NS-08',
    ]);
    expect(topics.flatMap((t) => t.days)).not.toContain(13);
    expect(topics.flatMap((t) => t.days)).not.toContain(14);
  });

  test('NS-06 days 6-8 are one topic; day 12 (NS-06 + NS-07) adds its pages to both', () => {
    expect(bySlo('M-01-NS-06')).toMatchObject({ days: [6, 7, 8, 12], pages: [14, 15, 16, 17, 18, 19, 28, 29] });
    expect(bySlo('M-01-NS-07')).toMatchObject({ days: [9, 10, 11, 12], pages: [20, 21, 22, 23, 24, 25, 28, 29] });
  });

  test('a code taught alone takes its "I can…" statement as the name', () => {
    expect(bySlo('M-01-NS-05').name).toBe('Count backwards from 9');
    expect(bySlo('M-01-NS-05').sloDescriptions).toEqual(['I can count backwards from 9.']);
    expect(bySlo('M-01-NS-07').name).toBe('Arrange numbers (0 to 9) in ascending');
  });

  test('codes and descriptions line up by position, so a code taught only with others takes its own "I can…"', () => {
    expect(bySlo('M-01-NS-01')).toMatchObject({
      name: 'Identify numbers from 0 to 9', sloDescriptions: ['I can identify numbers from 0 to 9.'],
    });
    expect(bySlo('M-01-NS-02')).toMatchObject({
      name: 'Count numbers from 0 to 9', sloDescriptions: ['I can count numbers from 0 to 9.'],
    });
  });

  test('a row whose descriptions do not line up with its codes gives no description; the day names it', () => {
    const [d1] = chapter(1);
    const row = { ...d1, sloCodes: ['M-01-XX-01', 'M-01-XX-02'], sloDescriptions: ['I can do one thing.'] };
    expect(groupBySlo([row]).map((t) => [t.name, t.sloDescriptions])).toEqual([
      ["Numbers 0-4 on Bunty's Walk", []],
      ["Numbers 0-4 on Bunty's Walk", []],
    ]);
  });

  test('no headings, no SLO codes in names, id slug is the SLO code', () => {
    for (const t of topics) {
      expect(t).toMatchObject({ heading: null, headingOrder: null });
      expect(t.name).not.toMatch(/M-01/);
    }
    expect(topics[0].topicId).toBe('1-maths-1-m-01-ns-01');
    expect(topics.map((t) => t.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('Maths Ch2 — a "Topic N:" section name wins over "I can…"', () => {
  const topics = groupChapter('maths', chapter(2));

  test('the Memory Lane revision day 15 is not a topic', () => {
    expect(topics.flatMap((t) => t.days)).not.toContain(15);
  });

  test('the labelled day names its first SLO; codes never taught first sit inside that topic', () => {
    expect(topics.map(code)).toEqual(['M-01-PV-04,M-01-PV-03,M-01-PV-01', 'M-01-PV-02']);
    expect(topics[0]).toMatchObject({ name: 'Numbers to 99', days: [16, 17] });
    expect(topics[0].sloDescriptions[1]).toBe('I can read and write numbers up to 99 (2-digit numbers) in numerals and in words.');
    expect(topics[1].name).toBe('Recognise the place value of each digit');
  });

  test('a label later in the section ("Copy work + Topic 2: X — …") is found', () => {
    const [d16] = chapter(2).filter((r) => r.day === 16);
    const row = { ...d16, section: 'Copy work tail + Topic 2: Place Value — Skill Sharpener' };
    expect(groupBySlo([row])[0].name).toBe('Place Value');
  });

  test('the first label for a code wins', () => {
    const [d16, d17] = chapter(2).filter((r) => r.lpType === 'content');
    const later = { ...d17, sloCodes: ['M-01-PV-04'], section: 'Topic 9: Other Name — X' };
    expect(groupBySlo([d16, later])[0].name).toBe('Numbers to 99');
  });
});

describe('every "Topic N" label form in the real Maths matrix names its topic (verbatim sections)', () => {
  const [d16] = chapter(2).filter((r) => r.day === 16);
  const named = (section) => groupBySlo([{ ...d16, section }])[0].name;

  test.each([
    ['G1 colon + dash', 'Topic 1: Numbers to 99 — Adventure Begins + Leap and Learn', 'Numbers to 99'],
    ['G4 colon + slash', 'Topic 1: Exploring 5-Digit Numbers / Leap and Learn', 'Exploring 5-Digit Numbers'],
    ['G3 no colon + hyphen', 'Topic 1 Numbers up to 9999 - Leap and Learn', 'Numbers up to 9999'],
    ['G1 parenthesised', 'Topic 4 (ordinal position) — Adventure Begins + Leap and Learn', 'Ordinal position'],
  ])('%s', (_, section, name) => {
    expect(named(section)).toBe(name);
  });

  test.each([
    ['G2 nameless "Topic 1 —"', 'Topic 1 — Leap and Learn + Practice'],
    ['G4 "Topic 3 hook" is not a label', 'Discovery Playground / Skill Sharpener / Topic 3 hook'],
  ])('%s gives no name; the SLO statement names the topic', (_, section) => {
    expect(named(section)).toBe('Count objects and numbers to and across');
  });

  test('a nameless "Topic N —" still marks the chapter as split into book topics', () => {
    const row = (day, codes, section) => ({ ...d16, day, sloCodes: codes, sloDescriptions: codes.map((c) => `I can ${c}.`), section });
    const topics = groupBySlo([row(1, ['A'], 'Topic 1 — Leap and Learn + Practice'), row(2, ['A', 'B'], 'Practice')]);
    expect(topics.map(code)).toEqual(['A,B']);
  });

  test('G3 "Topic 2 Length Word Problems - …" makes its code a word-problem code', () => {
    const row = (day, skillType, codes, section) => ({ ...d16, day, skillType, pages: [day], sloCodes: codes,
      sloDescriptions: codes.map((c) => `I can ${c}.`), section });
    const topics = groupMaths([row(71, 'pictorial', ['LE-01'], 'Topic 1 Measuring Length - Leap and Learn'),
      row(73, 'pictorial', ['LE-02'], 'Topic 2 Length Word Problems - Leap and Learn'),
      row(75, 'word_problem', ['LE-01', 'LE-02'], 'Connect and Create')]);
    expect(topics.map((t) => [t.name, t.days])).toEqual([['Measuring Length', [71]], ['Word problems', [73, 75]]]);
  });
});

describe('Word problems are their own topic', () => {
  const base = chapter(1).filter((r) => r.lpType === 'content');
  const wp = (day, codes) => ({ ...base[0], day, skillType: 'word_problem', pages: [day + 30], sloCodes: codes,
    sloDescriptions: ['I can solve word problems.'], topic: 'Story Sums at the Market', section: 'Leap and Learn' });

  test('all word_problem days in a chapter form one "Word problems" topic, after the SLO topics', () => {
    const topics = groupChapter('maths', [...base, wp(20, ['M-01-NS-10']), wp(21, ['M-01-NS-09'])]);
    const last = topics[topics.length - 1];
    expect(last).toMatchObject({ name: 'Word problems', days: [20, 21], pages: [50, 51],
      sloCodes: ['M-01-NS-10', 'M-01-NS-09'], topicId: '1-maths-1-word-problems' });
    expect(topics.some((t) => t.sloCodes[0] === 'M-01-NS-09')).toBe(false);
  });

  test('a code that is the only code on a word-problem day takes its own days into "Word problems"', () => {
    const topics = groupChapter('maths', [...base, wp(20, ['M-01-NS-07'])]);
    expect(topics.find((t) => t.name === 'Word problems').days).toEqual([9, 20]);
    expect(topics.filter((t) => t.sloCodes.includes('M-01-NS-07'))).toHaveLength(1);
  });

  test('a day shared with another code stays with that code, without the word-problem code', () => {
    const topics = groupChapter('maths', [...base, wp(20, ['M-01-NS-07'])]);
    expect(topics.find((t) => t.sloCodes[0] === 'M-01-NS-06').days).toEqual([6, 7, 8, 12]);
    expect(topics.find((t) => t.sloCodes[0] === 'M-01-NS-08').days).toEqual([10, 11]);
    expect(topics.find((t) => t.name === 'Word problems').days).not.toContain(12);
  });

  test('codes that only share a word-problem day keep their own topics; "Word problems" is just that day', () => {
    const topics = groupChapter('maths', [...base, wp(20, ['M-01-NS-07', 'M-01-NS-08'])]);
    expect(topics.find((t) => t.name === 'Word problems')).toMatchObject({ days: [20] });
    expect(topics.find((t) => t.sloCodes[0] === 'M-01-NS-07').days).toEqual([9, 10, 11, 12]);
  });

  test('no word_problem days, no Word problems topic', () => {
    expect(groupMaths(base).some((t) => t.name === 'Word problems')).toBe(false);
  });
});

describe('in a labelled chapter, a code never taught first joins the topic it is taught with', () => {
  const row = (day, codes) => ({ ...chapter(1)[2], day, pages: [day], sloCodes: codes,
    sloDescriptions: codes.map((c) => `I can do ${c}.`), section: 'Practice' });

  test('labelled chapter, B only ever second -> one topic for A carrying both codes', () => {
    const labelled = { ...row(1, ['A']), section: 'Topic 1: Alpha — Adventure Begins' };
    const topics = groupBySlo([labelled, row(2, ['A', 'B']), row(3, ['A', 'B'])]);
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ days: [1, 2, 3], sloCodes: ['A', 'B'],
      sloDescriptions: ['I can do A.', 'I can do B.'] });
  });

  test('B first somewhere -> B keeps its own topic', () => {
    const labelled = { ...row(1, ['A', 'B']), section: 'Topic 1: Alpha — Adventure Begins' };
    expect(groupBySlo([labelled, row(2, ['B'])]).map(code)).toEqual(['A', 'B']);
  });

  test('chapter with no "Topic N:" labels -> one topic per SLO, even for a code never first', () => {
    expect(groupBySlo([row(1, ['A', 'B'])]).map(code)).toEqual(['A', 'B']);
  });
});

describe('Maths G1 Ch3 — the spec §4.2 table (real rows)', () => {
  const topics = groupChapter('maths', parseMatrixTab(sample.maths_g1_ch3, 'maths'));

  test('seven topics with the spec days; fact families sit inside subtraction facts', () => {
    expect(topics.map((t) => [t.name, t.days])).toEqual([
      ['How many more?', [31, 32, 33]],
      ['Addition Facts to 20', [34, 35, 36, 37]],
      ['Add 2-digit numbers mentally', [38, 39]],
      ['How many Less?', [40, 41, 42]],
      ['Subtraction Facts to 20', [43, 44, 45]],
      ['Subtraction', [46, 47]],
      ['Word problems', [48, 49, 50, 51]],
    ]);
    expect(topics[4].sloCodes).toEqual(['M-01-AS-06', 'M-01-AS-05']);
  });

  test('"Word problems": AS-08 only, pages from the fixture (104 is on the review day, so not 96-106)', () => {
    expect(topics[6]).toMatchObject({ sloCodes: ['M-01-AS-08'],
      pages: [96, 97, 98, 99, 100, 101, 102, 103, 105, 106] });
    expect(topics.filter((t) => t.sloCodes.includes('M-01-AS-08'))).toHaveLength(1);
  });
});

describe('Maths G1 Ch4 — a two-code word-problem day does not swallow the chapter (real rows)', () => {
  const topics = groupChapter('maths', parseMatrixTab(sample.maths_g1_ch4, 'maths'));

  test('MN-01 keeps its topic; "Topic 2: Solving Word Problems" (MN-02) folds into "Word problems" 58-60', () => {
    expect(topics.map((t) => [t.name, t.days])).toEqual([
      ['Pakistani Money', [55, 56, 57]],
      ['Word problems', [58, 59, 60]],
    ]);
    expect(topics[1].sloCodes).toEqual(['M-01-MN-02', 'M-01-MN-01']);
  });
});

describe('a chapter made only of word-problem codes still keeps an SLO topic', () => {
  const day = (d, skillType, codes) => ({ ...chapter(1)[0], day: d, skillType, pages: [d], sloCodes: codes,
    sloDescriptions: codes.map((c) => `I can solve ${c} problems.`), section: 'Practice' });
  const rows = [day(41, 'word_problem', ['WP-01']), day(43, 'word_problem', ['WP-02']),
    day(44, 'pictorial_abstract', ['WP-01', 'WP-02']), day(45, 'word_problem', ['WP-01', 'WP-02'])];

  test('only the word_problem days fold; day 44 gives SLO topics', () => {
    const topics = groupMaths(rows);
    expect(topics.find((t) => t.name === 'Word problems').days).toEqual([41, 43, 45]);
    expect(topics.filter((t) => t.name !== 'Word problems').map((t) => [code(t), t.days]))
      .toEqual([['WP-01', [44]], ['WP-02', [44]]]);
  });
});

describe.each(['maths', 'maths_g1_ch3', 'maths_g1_ch4'])('real %s rows', (key) => {
  test('every chapter with non-word-problem days has a topic other than "Word problems"', () => {
    const rows = parseMatrixTab(sample[key], 'maths');
    for (const n of new Set(rows.map((r) => r.chapter))) {
      const ch = rows.filter((r) => r.chapter === n);
      if (!ch.some((r) => isTopicRow(r) && r.skillType !== 'word_problem')) continue;
      expect(groupChapter('maths', ch).some((t) => t.name !== 'Word problems')).toBe(true);
    }
  });
});
