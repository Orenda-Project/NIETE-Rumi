'use strict';
/**
 * bd-snkn32.58.1 (queue #155 A) — grades 1–5 learning goals are SKILL-sized, grouped by skill (Amena 19 Nov: "learning
 * goals could be 2 digit with 1 digit addition or multiplication, reading poems or grammatical concepts").
 *
 *   One goal per official SLO code (the matrix rows are chapter-sized topics; each carries several SLOs).
 *   Deduped by code, then by text. Matrix working notes ("[DERIVED …]") are page notes, not skills: hidden.
 *   Grouped by the code's strand (M-03-MU-04 → MU → "mul_div"); an unknown strand → "other".
 *   Each goal names the day of the FIRST topic that carries it (lp-k5-own-goal.dayFor), in book order.
 */
const S = require('../../bot/shared/services/lp-own-goal-skills');

const lesson = (id, idx, type, pages) => ({ lesson_id: id, segment_index: idx, lp_type: type, pages });
const BOOK = {
  grade: 3, subject_key: 'math',
  chapters: [
    { number: 1, title: 'Numbers', lessons: [lesson('m_ch1_seg1', 1, 'content', [1]), lesson('m_ch1_seg2', 2, 'content', [2])] },
    { number: 2, title: 'Multiplication', lessons: [lesson('m_ch2_seg1', 1, 'content', [10]), lesson('m_ch2_seg2', 2, 'content', [11])] },
  ],
};
const topic = (o) => ({ chapter_title: null, sort_order: 1, pages: [], days: [], ...o });

const TOPICS = [
  topic({ chapter_number: 2, chapter_title: 'Multiplication', name: 'Word problems', days: [3], slo_codes: ['M-03-MU-06', 'M-03-MU-04'],
    slo_descriptions: ['I can solve real-world word problems involving multiplication.', 'I can multiply 2 digit numbers by 1 digit number mentally and in written form.'] }),
  topic({ chapter_number: 1, chapter_title: 'Numbers', name: 'Counting', days: [1], slo_codes: ['M-03-NS-01', 'M-03-AS-01'],
    slo_descriptions: ['Count up to 9999 (4-digit numbers).', 'I can add up to 4-digit numbers with and without regrouping in written form.'] }),
  // the same code again later: kept once, on its first day
  topic({ chapter_number: 2, chapter_title: 'Multiplication', name: 'Times 2', days: [4], slo_codes: ['M-03-MU-04', 'M-03-ZZ-01'],
    slo_descriptions: ['I can multiply 2 digit numbers by 1 digit number (again).', 'I can do a thing nobody grouped.'] }),
  // a page note, not a skill
  topic({ chapter_number: 1, chapter_title: 'Numbers', name: 'Opener', days: [2], slo_codes: ['M-03-NS-09'],
    slo_descriptions: ['Name the pictures on page 2. [DERIVED — opener has no explicit SLO]'] }),
  // codes and texts that do not line up: texts kept, no code (grouped under "other"), deduped by text
  topic({ chapter_number: 1, chapter_title: 'Numbers', name: 'Mixed', days: [2], slo_codes: ['M-03-NS-02'],
    slo_descriptions: ['Read numbers aloud.', 'Count up to 9999 (4-digit numbers).'] }),
];

describe('strand and group of an SLO code', () => {
  it('reads the strand from the code', () => {
    expect(S.strandOf('M-03-MU-04')).toBe('MU');
    expect(S.strandOf('U-04-GR-01')).toBe('GR');
    expect(S.strandOf('nonsense')).toBeNull();
  });
  it('groups strands per subject; unknown → other', () => {
    expect(S.groupOf('maths', 'M-02-AD-01')).toBe('add_sub');
    expect(S.groupOf('maths', 'M-03-MU-04')).toBe('mul_div');
    expect(S.groupOf('english', 'E-02-RD-26')).toBe('reading');
    expect(S.groupOf('english', 'E-01-VG-26')).toBe('grammar');
    expect(S.groupOf('urdu', 'U-04-GR-01')).toBe('grammar');
    expect(S.groupOf('science', 'S-04-LS-01')).toBe('living');
    expect(S.groupOf('maths', 'M-03-ZZ-01')).toBe('other');
    expect(S.groupOf('maths', null)).toBe('other');
    expect(S.groupOf('history', 'M-03-MU-04')).toBe('other');
  });
});

describe('skillRows: one goal per skill, grouped, each on its first day', () => {
  const rows = S.skillRows(TOPICS, BOOK, 'maths');
  const texts = rows.map((r) => r.slo_descriptions[0]);

  it('one row per code, the first text seen in book order wins', () => {
    expect(rows.filter((r) => r.slo_code === 'M-03-MU-04')).toHaveLength(1);
    expect(texts).toContain('Multiply 2 digit numbers by 1 digit number mentally and in written form.');
    expect(texts).not.toContain('Multiply 2 digit numbers by 1 digit number (again).');
  });
  it('the day is the first topic (book order) carrying the code', () => {
    expect(rows.find((r) => r.slo_code === 'M-03-MU-04').segment_id).toBe('m_ch2_seg1');
    expect(rows.find((r) => r.slo_code === 'M-03-NS-01').segment_id).toBe('m_ch1_seg1');
  });
  it('hides [DERIVED] page notes; tidies "I can"', () => {
    expect(texts.some((t) => /DERIVED|page 2/.test(t))).toBe(false);
    expect(texts).toContain('Add up to 4-digit numbers with and without regrouping in written form.');
  });
  it('codes and texts that do not line up: the texts stay, as "other", deduped by text', () => {
    expect(texts.filter((t) => t === 'Count up to 9999 (4-digit numbers).')).toHaveLength(1);
    const read = rows.find((r) => r.slo_descriptions[0] === 'Read numbers aloud.');
    expect(read).toEqual(expect.objectContaining({ slo_code: null, group: 'other' }));
  });
  it('carries the group and the goal-row shape (outcomeList reads it)', () => {
    expect(rows.find((r) => r.slo_code === 'M-03-MU-06')).toEqual(expect.objectContaining({
      group: 'mul_div', chapter_number: 2, chapter_title: 'Multiplication', menu_title: 'Word problems',
    }));
    expect(rows.find((r) => r.slo_code === 'M-03-ZZ-01').group).toBe('other');
  });
  it('book order: chapter 1 goals before chapter 2', () => {
    const i = (c) => rows.findIndex((r) => r.slo_code === c);
    expect(i('M-03-NS-01')).toBeLessThan(i('M-03-MU-04'));
  });
  it('no book or no topics: []', () => {
    expect(S.skillRows(TOPICS, null, 'maths')).toEqual([]);
    expect(S.skillRows(null, BOOK, 'maths')).toEqual([]);
  });
});

describe('wired in (bd-snkn32.58.1): the grades 1–5 store and outcomeList hand back skill goals with their group', () => {
  jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
  const { goalRows } = require('../../bot/shared/services/lp612-own-goal.store');
  const { outcomeList } = require('../../bot/shared/services/lp612-own-goal');
  const q = (data) => { const x = { select: () => x, eq: () => x, limit: () => Promise.resolve({ data, error: null }) }; return { from: () => x }; };

  it('one row per SLO, grouped; outcomeList keeps group and code', async () => {
    const t = topic({ chapter_number: 1, chapter_title: 'Numbers', name: 'Adding', days: [1],
      slo_codes: ['M-03-AS-01', 'M-03-MU-04'], slo_descriptions: ['I can add up to 4-digit numbers.', 'I can multiply 2 digit numbers by 1 digit number.'] });
    const rows = await goalRows(q([t]), { grade: 3, subject: 'math' });
    expect(rows).toHaveLength(2);
    const out = outcomeList(rows);
    expect(out.map((o) => [o.text, o.group, o.code])).toEqual([
      ['Add up to 4-digit numbers.', 'add_sub', 'M-03-AS-01'],
      ['Multiply 2 digit numbers by 1 digit number.', 'mul_div', 'M-03-MU-04'],
    ]);
  });
  it('a 6–12 row has no group, and no goal carries a chapter name (bd-snkn32.61)', () => {
    expect(outcomeList([{ segment_id: 'a', chapter_title: 'Cells', slo_descriptions: ['Compare cells'] }]))
      .toEqual([{ segmentId: 'a', text: 'Compare cells' }]);
  });
});
