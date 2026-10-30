/**
 * G5 Science: a Section C item that asks a Section B item's task again (v37r4 panel, bd-5jmnfj.4.58). The paper's own items
 * are the fixtures: fde-v37r4-g5-science.json is the shipped paper with the three repeats the panel held.
 */
const { crossSectionRepeats } = require('../../bot/shared/services/assessment/fde-science-task-repeats');
const { scienceRepeats } = require('../../bot/shared/services/assessment/fde-science-repeats');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const paper = require('./fixtures/fde-v37r4-g5-science.json');

const P = Patterns.get('fde_g5_2027').subjects.science;
const rule = (slot) => P.sections.flatMap((s) => s.slots).find((s) => s.slot === slot).prompt_rule;
const clone = (o) => JSON.parse(JSON.stringify(o));
const cItems = (e) => e.unseen.subjective['Brief Answers'];

describe('the paper the panel held', () => {
  const flags = crossSectionRepeats(paper);
  const textOf = (f) => f.text.join(' ');

  it('flags the three Section C items that repeat a Section B task, on the later slot', () => {
    expect(flags).toHaveLength(3);
    flags.forEach((f) => expect(f).toMatchObject({ slot: 'science.C.Q3a', reason: 'giveaway', printed: false }));
    flags.forEach((f) => expect(f.with.every((s) => /^science\.B\./.test(s))).toBe(true));
  });

  it('respiratory parts: draw and label five, name five', () => {
    const f = flags.find((x) => x.words.includes('respiratory'));
    expect(f).toBeTruthy();
    expect(textOf(f)).toMatch(/Draw the human respiratory system/);
  });

  it('magnet: which objects it picks up and why', () => {
    const f = flags.find((x) => x.words.includes('magnet') && x.words.includes('pick'));
    expect(f).toBeTruthy();
    expect(textOf(f)).toMatch(/magnet pick up/);
  });

  it('fossil fuels: what the carbon dioxide does to the Earth\'s temperature', () => {
    const f = flags.find((x) => x.words.includes('heat') || x.words.includes('warm'));
    expect(f).toBeTruthy();
    expect(textOf(f)).toMatch(/carbon dioxide/);
  });

  it('is part of the science repeat list the re-ask reads', () => {
    const rows = scienceRepeats(paper).filter((f) => f.slot === 'science.C.Q3a' && f.text.some((t) => /same task/.test(t)));
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('never changes the paper', () => {
    const copy = clone(paper);
    crossSectionRepeats(copy);
    expect(copy).toEqual(paper);
  });
});

describe('items that share a topic but ask something else', () => {
  it('raises none when each Section C item is a different task', () => {
    const e = clone(paper);
    e.unseen.subjective['Brief Answers'] = cItems(e).filter((q) => !/respiratory|magnet pick|petrol/.test(q.question));
    expect(crossSectionRepeats(e)).toEqual([]);
  });

  it('does not pair two items of one section', () => {
    const e = clone(paper);
    e.unseen.subjective['Brief Answers'].push(clone(cItems(e).find((q) => /respiratory/.test(q.question))));
    const flags = crossSectionRepeats(e);
    expect(flags.filter((f) => f.with.some((s) => /^science\.C\./.test(s)))).toEqual([]);
  });

  it('survives an empty or odd paper', () => {
    expect(crossSectionRepeats(null)).toEqual([]);
    expect(crossSectionRepeats({})).toEqual([]);
    expect(crossSectionRepeats({ unseen: { subjective: { x: [null, { slot: 'science.C.Q3a' }] } } })).toEqual([]);
  });
});

describe('prompt rule', () => {
  it('Section C never re-asks a topic task already in Section B', () => {
    expect(rule('science.C.Q3a')).toMatch(/never re-asks a topic task already in Section B/i);
    expect(rule('science.C.Q3b')).toMatch(/never re-asks a topic task already in Section B/i);
  });
});
