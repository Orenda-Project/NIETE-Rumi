'use strict';
// A question FDE splits across thinking levels inside itself carries that split, and its one tag is the
// highest level in it, so a judge reading the tag does not see a letter-writing task called "Understand".
const { splitTags } = require('../../bot/shared/services/assessment/fde-split-tags');

const exam = (items, slots) => ({
  _layout: { sections: [{ id: 'C', slots }] },
  unseen: { subjective: { 'Long Answer': items } },
});
const LETTER = { slot: 'english.C.Q7', levels: { Remember: 4, Understand: 3, Apply: 3 } };
const RHYME = { slot: 'english.C.Q5', levels: { Remember: 2, Understand: 1, Apply: 1 } };
const PLAIN = { slot: 'english.A.Q1' };

describe('splitTags', () => {
  it('tags a split question at its highest level and carries the split', () => {
    const out = splitTags(exam([{ slot: 'english.C.Q7', blooms: 'Understand', question: 'Write a letter' }], [LETTER]));
    const q = out.examJson.unseen.subjective['Long Answer'][0];
    expect(q.blooms).toBe('Apply');
    expect(q.levels).toEqual({ Remember: 4, Understand: 3, Apply: 3 });
    expect(out.notes).toHaveLength(1);
  });

  it('skips a level with no marks when choosing the highest', () => {
    const slot = { slot: 'x.Q', levels: { Remember: 2, Understand: 2, Apply: 0 } };
    const out = splitTags(exam([{ slot: 'x.Q', blooms: 'Remember' }], [slot]));
    expect(out.examJson.unseen.subjective['Long Answer'][0].blooms).toBe('Understand');
  });

  it('leaves a question whose slot has no split untouched', () => {
    const item = { slot: 'english.A.Q1', blooms: 'Remember' };
    const out = splitTags(exam([item], [PLAIN]));
    expect(out.examJson.unseen.subjective['Long Answer'][0]).toEqual(item);
    expect(out.notes).toHaveLength(0);
  });

  it('does not note a question already tagged right', () => {
    const out = splitTags(exam([{ slot: 'english.C.Q5', blooms: 'Apply', levels: RHYME.levels }], [RHYME]));
    expect(out.notes).toHaveLength(0);
  });

  it('never throws on a paper it cannot read', () => {
    expect(() => splitTags(null)).not.toThrow();
    expect(() => splitTags({ unseen: { a: { b: [null, 3] } } })).not.toThrow();
    expect(splitTags(null).examJson).toBeNull();
  });

  it('does not change the input', () => {
    const input = exam([{ slot: 'english.C.Q7', blooms: 'Understand' }], [LETTER]);
    const copy = JSON.parse(JSON.stringify(input));
    splitTags(input);
    expect(input).toEqual(copy);
  });
});

describe('keyFixes runs splitTags', () => {
  it('a G5 English letter leaves the key fixes tagged Apply with its split', () => {
    const { keyFixes } = require('../../bot/shared/services/assessment/fde-g5-key-fixes');
    const out = keyFixes(exam([{ slot: 'english.C.Q7', blooms: 'Understand', question: 'Write a letter' }], [LETTER]));
    const q = out.examJson.unseen.subjective['Long Answer'][0];
    expect(q.blooms).toBe('Apply');
    expect(q.levels).toEqual(LETTER.levels);
    expect(out.notes).toContainEqual({ slot: 'english.C.Q7', from: 'Understand', to: 'Apply' });
  });
});
