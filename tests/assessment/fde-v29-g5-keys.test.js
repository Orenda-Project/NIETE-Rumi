/**
 * v28 G5 key defects fixed in v29 (bd-5jmnfj.4.58.4):
 *   G5 Urdu Q3: the key accepts «مثالی» for تمثیلی, a different meaning.
 *   G5 Science Q3(b) 5: the key pays for battery polarity in a one-battery, one-bulb circuit.
 * keyFixes removes the false accepted meaning and the polarity clause; the slots' prompt rules forbid both,
 * and state the poem-title, punctuation-model and Urdu count rules (G5 Urdu Q6, Urdu Q7/Q8, English Q3).
 */

const { keyFixes } = require('../../bot/shared/services/assessment/fde-g5-key-fixes');
const pattern = require('../../bot/shared/services/assessment/patterns/fde-g5-2027');

const paper = (type, items, slot) => ({
  unseen: { subjective: { [type]: items } },
  _layout: { sections: [{ id: 'C', slots: [{ slot, type }] }] },
});
const first = (ex) => Object.values(ex.unseen.subjective).flat()[0];

const ruleOf = (id) => {
  const walk = (n) => {
    if (!n || typeof n !== 'object') return null;
    if (n.slot === id && typeof n.prompt_rule === 'string') return n.prompt_rule;
    for (const v of Object.values(n)) { const r = walk(v); if (r) return r; }
    return null;
  };
  return walk(pattern);
};

describe('G5 Urdu Q3: «مثالی» is never a meaning of تمثیلی', () => {
  const q3 = () => paper('Word Meanings', [{
    slot: 'urdu.C.Q3', marks: 5, words: ['حریص', 'تمثیلی'],
    answer: 'حریص: لالچی، لالچ کرنے والا\nتمثیلی: مثالی، جو مثال کے طور پر پیش کیا جا سکے\nرائج: دستور کے مطابق',
    scheme: {
      points: [{ text: 'درست معنی', marks: 5, kind: 'A' }],
      accept: ['حریص: لالچ کرنے والا', 'تمثیلی: مثالی', 'رائج: جاری'],
    },
  }], 'urdu.C.Q3');

  test('the accept entry for تمثیلی that is only «مثالی» goes; other entries stay', () => {
    const { examJson, notes } = keyFixes(q3());
    expect(first(examJson).scheme.accept).toEqual(['حریص: لالچ کرنے والا', 'رائج: جاری']);
    expect(notes.some((n) => /urdu\.C\.Q3/.test(n) && /مثالی/.test(n))).toBe(true);
  });

  test('the model answer line for تمثیلی loses «مثالی»; the other lines are untouched', () => {
    const lines = first(keyFixes(q3()).examJson).answer.split('\n');
    expect(lines[1]).toBe('تمثیلی: جو مثال کے طور پر پیش کیا جا سکے');
    expect(lines[0]).toBe('حریص: لالچی، لالچ کرنے والا');
    expect(lines[2]).toBe('رائج: دستور کے مطابق');
  });

  test('an accept entry that lists «مثالی» beside other meanings keeps the others', () => {
    const ex = q3();
    first(ex).scheme.accept = ['تمثیلی: مثالی، علامتی'];
    expect(first(keyFixes(ex).examJson).scheme.accept).toEqual(['تمثیلی: علامتی']);
  });

  test('a word list without تمثیلی is left alone', () => {
    const ex = q3();
    first(ex).answer = 'حریص: لالچی'; first(ex).scheme.accept = ['حریص: لالچ کرنے والا'];
    const out = keyFixes(ex);
    expect(first(out.examJson).answer).toBe('حریص: لالچی');
    expect(out.notes).toEqual([]);
  });
});

describe('G5 Science Q3(b) 5: no mark for battery direction with one battery and one bulb', () => {
  const circuit = (question = 'A child joins a battery, a bulb and two wires but the bulb does not light up. Explain what could be wrong.') => paper('Long Question', [{
    slot: 'science.C.Q3b', marks: 9, question,
    answer: 'The loop must be closed. They should also check that the battery is joined the right way round, with positive and negative terminals connected properly. If wood is in the loop, replace it with a conductor.',
    scheme: { points: [
      { text: 'The circuit must be a complete closed loop for current to flow', marks: 2, kind: 'A' },
      { text: 'Check the battery is connected correctly (positive and negative terminals) and is not dead', marks: 2, kind: 'A' },
      { text: 'An insulator in the loop stops current; use a conductor', marks: 5, kind: 'A' },
    ] },
  }], 'science.C.Q3b');

  test('the point keeps «not dead», loses the polarity clause, marks unchanged', () => {
    const { examJson, notes } = keyFixes(circuit());
    const pts = first(examJson).scheme.points;
    expect(pts[1]).toEqual({ text: 'Check the battery is not dead', marks: 2, kind: 'A' });
    expect(pts.reduce((s, p) => s + p.marks, 0)).toBe(9);
    expect(notes.some((n) => /science\.C\.Q3b/.test(n) && /polarity|terminal/i.test(n))).toBe(true);
  });

  test('the model answer sentence on battery direction becomes the dead-battery check', () => {
    const a = first(keyFixes(circuit()).examJson).answer;
    expect(a).not.toMatch(/right way round|positive and negative|terminals/i);
    expect(a).toMatch(/check that the battery is not dead\./);
    expect(a).toMatch(/If wood is in the loop/);
  });

  test('an item about several batteries keeps its polarity point', () => {
    const { examJson, notes } = keyFixes(circuit('A child joins two batteries and a bulb but the bulb does not light up.'));
    expect(first(examJson).scheme.points[1].text).toMatch(/positive and negative/);
    expect(notes).toEqual([]);
  });
});

describe('prompt rules on the named slots', () => {
  test('G5 Urdu Q3: accepted meanings share the word\'s meaning, never a look-alike from the same root letters', () => {
    const r = ruleOf('urdu.C.Q3');
    expect(r).toMatch(/look-alike/);
    expect(r).toMatch(/same root letters/);
  });
  test('G5 Urdu Q6: a poem whose questions depend on the speaker prints the title with the verses', () => {
    const r = ruleOf('urdu.C.Q6');
    expect(r).toMatch(/first line of `passage` is the poem's title/);
    expect(r).toMatch(/who speaks/);
    expect(r).toMatch(/only on what is printed/);
  });
  test('G5 Urdu Q7: the scheme pays for no title and the answer is not framed by one', () => {
    expect(ruleOf('urdu.C.Q7')).toMatch(/never a title/);
  });
  test('G5 Urdu Q8: the key follows the stem count, 10 to 12 sentences, dialogue turns included', () => {
    const r = ruleOf('urdu.C.Q8');
    expect(r).toMatch(/dialogue/);
    expect(r).toMatch(/دس سے بارہ جملے/);
    expect(r).toMatch(/never «آٹھ باتیں»/);
  });
  test('G5 English Q3: the model is the printed words, only capitals and punctuation added', () => {
    const r = ruleOf('english.C.Q3');
    expect(r).toMatch(/the printed words exactly/);
    expect(r).toMatch(/only capitals and punctuation/);
    expect(r).toMatch(/never turn a reported question into direct speech/);
    expect(r).toMatch(/punctuation the printed words can carry/);
  });
  test('G5 Science Q3(b): never pay for battery direction with one battery and one bulb', () => {
    expect(ruleOf('science.C.Q3b')).toMatch(/battery direction/);
  });
});
