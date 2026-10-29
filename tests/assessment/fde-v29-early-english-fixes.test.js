/**
 * v28 Grade 1-2 English keys (bd-5jmnfj.4.58.4), fixed in code by fde-early-english-fixes:
 *   G1 English Q6 refused a real rhyme printed elsewhere on the paper (cat, hat, fan);
 *   G2 English Q11 keyed a lone pronoun while the accept line held the sentence;
 *   G2 English Q10 ii keyed «in» for a bird in a tree and called «on» an error.
 * Fixtures are the real v28 papers with the picture data stripped. Pure: {examJson, notes}.
 */

const { earlyEnglishFixes } = require('../../bot/shared/services/assessment/fde-early-english-fixes');

const G1 = require('./fixtures/early/fde-v28-g1-english-exam.json');
const G2 = require('./fixtures/early/fde-v28-g2-english-exam.json');

const itemsOf = (ex) => Object.values(ex.unseen).flatMap((byType) => Object.values(byType).flat());
const run = (ex) => earlyEnglishFixes({ examJson: ex, notes: [] });
const slotItems = (ex, slot) => itemsOf(ex).filter((q) => q.slot === slot);

describe('G1 English Q6 accepts every real rhyme printed on the paper', () => {
  const out = () => run(G1);
  const by = (word) => slotItems(out().examJson, 'g1.english.B.Q6').find((q) => q.question === word);

  test('rat accepts cat (Q3 i) and hat (Q4 v) and keeps its own list', () => {
    expect(by('rat').scheme.accept).toEqual(expect.arrayContaining(['sat', 'fat', 'pat', 'cat', 'hat']));
  });

  test('man accepts fan (Q3 iii)', () => {
    expect(by('man').scheme.accept).toEqual(expect.arrayContaining(['can', 'ran', 'tan', 'fan']));
  });

  test('never the given word, the answer, a different rime or a one-letter word', () => {
    const rat = by('rat').scheme.accept;
    expect(rat).not.toContain('rat');
    expect(rat).not.toContain('mat');
    expect(rat).not.toContain('at');
    expect(rat).not.toEqual(expect.arrayContaining(['pig']));
    expect(by('jug').scheme.accept.sort()).toEqual(['bug', 'rug', 'tug']);
    expect(by('pot').scheme.accept).not.toContain('mop');
  });

  test('a printed word with the rime counts wherever it lives: option, box, picture name', () => {
    const ex = JSON.parse(JSON.stringify(G1));
    slotItems(ex, 'g1.english.B.Q6')[0].question = 'ten';
    slotItems(ex, 'g1.english.B.Q6')[0].answer = 'men';
    slotItems(ex, 'g1.english.B.Q6')[0].scheme.accept = [];
    const pen = slotItems(ex, 'g1.english.A.Q4').find((q) => q.answer === 'pen');
    expect(pen).toBeTruthy(); // picture name «pen» on Q4 iii
    const got = slotItems(run(ex).examJson, 'g1.english.B.Q6')[0].scheme.accept;
    expect(got).toContain('pen');
    expect(got).toContain('hen');
  });

  test('a note names the item; the input paper is not changed', () => {
    const before = JSON.stringify(G1);
    expect(out().notes.some((n) => /rat/.test(n))).toBe(true);
    expect(JSON.stringify(G1)).toBe(before);
  });
});

describe('G2 English Q11 keys the rewritten sentence', () => {
  const qs = () => slotItems(run(G2).examJson, 'g2.english.C.Q11');

  test('the sentence becomes the answer; the point pays the pronoun in the sentence', () => {
    const q = qs().find((x) => x.question === 'Hamza is playing outside.');
    expect(q.answer).toBe('He is playing outside.');
    expect(q.scheme.accept).not.toContain('He is playing outside.');
    expect(q.scheme.points[0].text).toMatch(/correct pronoun in the rewritten sentence/i);
    expect(q.scheme.points[0].marks).toBe(1);
  });

  test('all four items are fixed', () => {
    expect(qs().map((q) => q.answer)).toEqual([
      'He is playing outside.', 'She is drawing a flower.', 'It is on the wall.', 'They are running fast.']);
  });

  test('a key already holding the sentence, or a lone pronoun with no sentence, is left alone', () => {
    const ex = JSON.parse(JSON.stringify(G2));
    const items = slotItems(ex, 'g2.english.C.Q11');
    items[0].answer = 'He is playing outside.';
    items[1].scheme.accept = [];
    const out = slotItems(run(ex).examJson, 'g2.english.C.Q11');
    expect(out[0]).toEqual(items[0]);
    expect(out[1].answer).toBe('She');
  });
});

describe('G2 English Q10: a tree or branch accepts in and on', () => {
  const bird = (ex) => slotItems(ex, 'g2.english.B.Q10').find((q) => /bird/.test(q.question));

  test('«in» keyed for the bird in the tree also accepts «on»; the «on instead of in» error goes', () => {
    const q = bird(run(G2).examJson);
    expect(q.answer).toBe('in');
    expect(q.scheme.accept).toContain('on');
    expect(q.scheme.common_error || '').not.toMatch(/on instead of in/i);
  });

  test('«on» keyed for a branch accepts «in» too', () => {
    const ex = JSON.parse(JSON.stringify(G2));
    const q = bird(ex);
    q.question = 'The owl is ____ the branch.';
    q.answer = 'on';
    q.scheme.common_error = 'Writing in instead of on';
    const out = slotItems(run(ex).examJson, 'g2.english.B.Q10').find((x) => /owl/.test(x.question));
    expect(out.scheme.accept).toContain('in');
    expect(out.scheme.common_error || '').not.toMatch(/instead of on/i);
  });

  test('a bag on a chair, and a dog under a table, are untouched', () => {
    const before = slotItems(G2, 'g2.english.B.Q10').filter((q) => !/bird/.test(q.question));
    const after = slotItems(run(G2).examJson, 'g2.english.B.Q10').filter((q) => !/bird/.test(q.question));
    expect(after).toEqual(before);
  });

  test('a picture describe that names the tree is read when the stem does not', () => {
    const ex = JSON.parse(JSON.stringify(G2));
    const q = bird(ex);
    q.question = 'The bird is ____ the oak.';
    const out = slotItems(run(ex).examJson, 'g2.english.B.Q10').find((x) => /oak/.test(x.question));
    expect(out.scheme.accept).toContain('on');
  });
});
