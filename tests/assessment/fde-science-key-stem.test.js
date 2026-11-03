/**
 * G5 Science: a key point that only restates its own stem (v37r4 panel, bd-5jmnfj.4.58). The paper's items are the fixtures.
 * Tuned on fde-v37r4-g5-science.json: it flags the curtain point and the needle point, none of the good keys.
 */
const { keyStemFlags, keyStemNote } = require('../../bot/shared/services/assessment/fde-science-key-stem');
const { repeatedPoints, repeatedPointsNote } = require('../../bot/shared/services/assessment/fde-science-key-points');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const paper = require('./fixtures/fde-v37r4-g5-science.json');
const v34 = require('./fixtures/fde-v34-g5-science-v29.json');

const P = Patterns.get('fde_g5_2027').subjects.science;
const rule = (slot) => P.sections.flatMap((s) => s.slots).find((s) => s.slot === slot).prompt_rule;
const item = (question, ...texts) => ({ slot: 'science.C.Q3a', question, marks: 5, scheme: { points: texts.map((text) => ({ text, marks: 1, kind: 'K' })), accept: [] } });
const build = (...cs) => ({ unseen: { subjective: { 'Brief Answers': cs } } });
const lines = (rows) => rows.flatMap((r) => r.items);

describe('the paper the panel held', () => {
  const rows = keyStemFlags(paper);

  it('flags the curtain point and the needle point on Section C Q3 (a)', () => {
    expect(rows.every((r) => r.slot === 'science.C.Q3a' && r.reason === 'answer' && r.keyStem === true)).toBe(true);
    expect(lines(rows).some((l) => /curtain/i.test(l) && /Curtain lets some light pass through/.test(l))).toBe(true);
    expect(lines(rows).some((l) => /iron sewing needle/i.test(l) && /iron needle is picked up/.test(l))).toBe(true);
  });

  it('leaves the good keys alone (soap, the sound chain, the combustion points, the noise key)', () => {
    expect(lines(rows)).toHaveLength(2);
    expect(lines(rows).join(' ')).not.toMatch(/Soap removes|speaker|combustion|noise/i);
  });

  it('never changes the paper', () => {
    const copy = JSON.parse(JSON.stringify(paper));
    keyStemFlags(copy);
    expect(copy).toEqual(paper);
  });
});

describe('what counts as a restated stem', () => {
  it('flags a point whose content words nearly all sit in the stem', () => {
    const rows = keyStemFlags(build(item('Explain why a magnet picks up an iron nail.', 'A magnet picks up an iron nail', 'Iron is a magnetic material')));
    expect(lines(rows)).toHaveLength(1);
    expect(lines(rows)[0]).toMatch(/A magnet picks up an iron nail/);
  });

  it('needs three content words: a short point is never a restatement', () => {
    expect(keyStemFlags(build(item('Why do leaves change colour in autumn?', 'Leaves change', 'Chlorophyll breaks down')))).toEqual([]);
  });

  it('does not flag a point that adds a fact the stem does not state', () => {
    expect(keyStemFlags(build(item('Explain how a magnet picks up an iron nail.', 'The magnet makes the nail a temporary magnet while it touches')))).toEqual([]);
  });

  it('reads sub-questions of a Q2 (b) item against their own stem', () => {
    const b = { slot: 'science.B.Q2b', question: 'A situation.', marks: 5, questions: [{ question: 'Why does the candle flame go out under the glass jar?', answer: 'x', scheme: { points: [{ text: 'The candle flame goes out under the glass jar', marks: 1, kind: 'K' }, { text: 'Oxygen is used up', marks: 1, kind: 'K' }] } }] };
    expect(lines(keyStemFlags({ unseen: { subjective: { 'Situations': [b] } } }))).toHaveLength(1);
  });

  it('survives an empty or odd paper', () => {
    expect(keyStemFlags(null)).toEqual([]);
    expect(keyStemFlags({})).toEqual([]);
    expect(keyStemFlags(build({ slot: 'science.C.Q3a', question: 5, scheme: { points: [null, { text: 7 }] } }))).toEqual([]);
  });

  it('skips MCQs and Section A', () => {
    const m = { slot: 'science.A.Q1a', question: 'Which gas do plants take in?', options: ['a) carbon dioxide', 'b) x'], answer: 'a) carbon dioxide', scheme: { points: [{ text: 'Which gas do plants take in' }] } };
    expect(keyStemFlags({ unseen: { objective: { MCQs: [m] } } })).toEqual([]);
  });
});

describe('the re-ask', () => {
  it('writes a note naming the point and the rule, or nothing', () => {
    const rows = keyStemFlags(paper);
    const note = keyStemNote(rows);
    expect(note).toMatch(/restate/i);
    expect(note).toMatch(/Curtain lets some light pass through/);
    expect(keyStemNote([])).toBeNull();
    expect(keyStemNote([{ slot: 'x', reason: 'answer', items: ['one idea paid twice'] }])).toBeNull();
  });

  it('rides the rows repeatedPoints already returns, and repeatedPointsNote prints both kinds', () => {
    const rows = repeatedPoints(paper);
    expect(rows.some((r) => r.keyStem)).toBe(true);
    expect(repeatedPointsNote(rows)).toMatch(/Curtain lets some light pass through/);
  });

  it('keeps the one-idea note for twin rows alone', () => {
    const rows = [{ slot: 'science.C.Q3a', reason: 'answer', items: ['Q (the points «a» and «b» are one idea paid twice)'] }];
    expect(repeatedPointsNote(rows)).toMatch(/pay one idea as several marks/);
    expect(repeatedPointsNote(rows)).not.toMatch(/restate/i);
  });

  it('raises nothing new on the earlier good v34 paper beyond its stroking restatement', () => {
    expect(lines(keyStemFlags(v34)).every((l) => /Stroking|temporary magnet|fossil|Greenhouse/i.test(l))).toBe(true);
  });
});

describe('prompt rule', () => {
  it('Q3 (b) keys the chemical-change test as a new substance forming', () => {
    expect(rule('science.C.Q3b')).toMatch(/new substance forms \(chemical\)/);
    expect(rule('science.C.Q3b')).toMatch(/reversibility is only a supporting sign/);
  });
});
