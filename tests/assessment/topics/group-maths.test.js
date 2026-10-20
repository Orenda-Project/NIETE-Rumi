'use strict';
/** Task 3 — Maths: one topic per SLO, word problems on their own (spec §4.1). Real fixture rows. */
const { parseMatrixTab } = require('../../../bot/shared/services/assessment/topics/matrix-rows');
const { groupChapter } = require('../../../bot/shared/services/assessment/topics/group');
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

  test('a code never taught alone falls back to its first day name and carries no guessed description', () => {
    expect(bySlo('M-01-NS-01')).toMatchObject({ name: "Numbers 0-4 on Bunty's Walk", sloDescriptions: [] });
    expect(bySlo('M-01-NS-03').name).toBe('Count the Group and Write the Numeral');
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

  test('the labelled day names the topic of its first SLO only', () => {
    expect(topics.map(code)).toEqual(['M-01-PV-04', 'M-01-PV-03', 'M-01-PV-01', 'M-01-PV-02']);
    expect(topics[0]).toMatchObject({ name: 'Numbers to 99', days: [16, 17] });
    expect(topics[1].name).toBe('Counting to 99: grouping in tens');
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

describe('Word problems are their own topic', () => {
  const base = chapter(1).filter((r) => r.lpType === 'content');
  const wp = (day, codes) => ({ ...base[0], day, skillType: 'word_problem', pages: [day + 30], sloCodes: codes,
    sloDescriptions: ['I can solve word problems.'], topic: 'Story Sums at the Market', section: 'Leap and Learn' });

  test('all word_problem days in a chapter form one "Word problems" topic, after the SLO topics', () => {
    const topics = groupChapter('maths', [...base, wp(20, ['M-01-NS-06']), wp(21, ['M-01-NS-09'])]);
    const last = topics[topics.length - 1];
    expect(last).toMatchObject({ name: 'Word problems', days: [20, 21], pages: [50, 51],
      sloCodes: ['M-01-NS-06', 'M-01-NS-09'], topicId: '1-maths-1-word-problems' });
    expect(topics.find((t) => t.sloCodes[0] === 'M-01-NS-06').days).toEqual([6, 7, 8, 12]);
    expect(topics.some((t) => t.sloCodes[0] === 'M-01-NS-09')).toBe(false);
  });

  test('no word_problem days, no Word problems topic', () => {
    expect(groupMaths(base).some((t) => t.name === 'Word problems')).toBe(false);
  });
});
