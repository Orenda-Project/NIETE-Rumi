/**
 * bd-5jmnfj.4.58.2: v26 picture-prompt findings, tested through Kie.promptFor / Pictures.cacheKey.
 *  3  G1 English Q13 i, ii: the describe said "next to the printed bubble"; the model drew a bubble, and the frame added another.
 *  4  G1 Maths Q8 iv: "a toothbrush and a spoon lying straight side by side" drew the toothbrush under the spoon, overlapping.
 *  5  G1 Urdu Q7 ii: picture name "elderly grandfather with a cane" (answer دادی) drew an old woman in a dress.
 *  6  G2 English Q10 i: "A ball on the floor under a chair", place "under": the ball looked on or in the chair.
 * Item shapes from v26 g1-english / g1-maths / g1-urdu / g2-english exam.json.
 */
const crypto = require('crypto');
const Kie = require('../../bot/shared/services/assessment/fde-picture-kie');
const Pictures = require('../../bot/shared/services/assessment/fde-pictures');
const Describe = require('../../bot/shared/services/assessment/fde-picture-describe');

const BUBBLE = 'Two children meet in the morning. The child on the right stands next to the printed bubble.';
const BUBBLE2 = 'A child helps another child carry a box. The child on the right, who was helped, stands next to the printed bubble.';
const oldKey = (describe, place) => `${Pictures.PREFIX}/scene-no-text/${describe.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)}-`
  + `${crypto.createHash('sha256').update(describe.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + (place ? `|${place}` : '')).digest('hex').slice(0, 8)}.jpg`;

describe('speech-bubble item: the frame draws the bubble, the picture has none (item 3)', () => {
  test.each([BUBBLE, BUBBLE2])('the prompt never tells the model to draw a bubble: %s', (describe) => {
    const p = Kie.promptFor({ kind: 'scene', describe });
    expect(p).not.toMatch(/printed bubble|next to the (?:printed |empty )?bubble/i);
    expect(p).toMatch(/no speech bubbles/i);
    expect(p).toContain('The child on the right');
  });

  test('every scene prompt rules out speech and thought bubbles', () => {
    expect(Kie.promptFor({ kind: 'scene', describe: 'a park' })).toMatch(/no speech bubbles/i);
    expect(Kie.NEGATIVE).toContain('speech bubble');
  });

  test('a picture drawn with a bubble in its describe is never reused from the cache', () => {
    expect(Pictures.cacheKey({ kind: 'scene', describe: BUBBLE })).not.toBe(oldKey(BUBBLE));
    expect(Pictures.cacheKey({ kind: 'scene', describe: 'a park' })).toBe(oldKey('a park'));
  });

  test('withoutBubbles keeps the sentence about who stands where', () => {
    expect(Describe.withoutBubbles(BUBBLE2)).toBe('A child helps another child carry a box. The child on the right, who was helped, stands at the right edge of the picture.');
    expect(Describe.withoutBubbles('Two children wave. A speech bubble floats above them.')).toBe('Two children wave.');
  });
});

describe('comparison picture: two things side by side, apart, on one base line (item 4)', () => {
  const p = Kie.promptFor({ kind: 'scene', show: { compare: true }, describe: 'a toothbrush and a spoon lying straight side by side, the toothbrush clearly shorter' });
  test('names the gap and forbids overlap or stacking', () => {
    expect(p).toMatch(/clear (?:empty )?gap/i);
    expect(p).toMatch(/do(?:es)? not (?:touch|overlap)|never (?:touch|overlap)/i);
    expect(p).toMatch(/not one above or below the other/i);
  });

  test('a cached comparison drawn before this is never reused', () => {
    const q = { kind: 'scene', show: { compare: true }, describe: 'a pencil and a crayon lying straight side by side' };
    const old = `${Pictures.PREFIX}/scene-no-text/a-pencil-and-a-crayon-lying-straight-side-by-side-`
      + `${crypto.createHash('sha256').update(`a pencil and a crayon lying straight side by side|${JSON.stringify(q.show)}`).digest('hex').slice(0, 8)}.jpg`;
    expect(Pictures.cacheKey(q)).not.toBe(old);
  });
});

describe('a masculine person is drawn with its markers (item 5)', () => {
  test.each([
    ['elderly grandfather with a cane', /old man/i, /beard/i, /cap/i],
    ['father with a briefcase', /man/i, /moustache/i, /cap/i],
    ['male teacher with a pointer stick', /man/i, /moustache/i, /not a woman/i],
    ['boy', /boy/i, /short hair/i, /trousers/i],
  ])('%s', (name, ...marks) => {
    const p = Kie.promptFor({ kind: 'object', name });
    marks.forEach((m) => expect(p).toMatch(m));
    expect(p).toMatch(/not a woman|no dress/i);
  });

  test('the Urdu and English kinship words map to the same markers', () => {
    ['دادا', 'نانا', 'ابو', 'چچا', 'ماموں', 'grandfather', 'uncle', 'dada', 'nana'].forEach((w) => {
      expect(Describe.genderNote(w)).toMatch(/man|boy/i);
    });
  });

  test('a feminine or neutral thing gets no marker', () => {
    ['grandmother', 'lion', 'mango', 'doll', 'manager'].forEach((w) => expect(Describe.genderNote(w)).toBe(''));
  });

  test('a person drawn before this is never reused; a plain object keeps its key', () => {
    expect(Pictures.cacheKey({ kind: 'object', name: 'elderly grandfather with a cane' })).not.toBe(`${Pictures.PREFIX}/object/elderly-grandfather-with-a-cane.jpg`);
    expect(Pictures.cacheKey({ kind: 'object', name: 'mango' })).toBe(`${Pictures.PREFIX}/object/mango.jpg`);
  });
});

describe('a position picture has only the key\'s reading (item 6)', () => {
  const scene = (describe, place) => Kie.promptFor({ kind: 'scene', describe, place });
  test('under: the ball is on the floor beneath the seat, the legs on the same floor, a gap of white', () => {
    const p = scene('A ball on the floor under a chair', 'under');
    expect(p).toMatch(/on the floor/i);
    expect(p).toMatch(/legs/i);
    expect(p).toMatch(/clear gap of white/i);
    expect(p).toMatch(/not on, in or behind/i);
  });
  test('on: rests on the top and nothing hangs below the top edge', () => {
    expect(scene('A bird sitting on top of a house roof', 'on')).toMatch(/nothing of the first thing hangs below/i);
  });
  test('in: wholly inside with the rim round it; near: side by side on one floor', () => {
    expect(scene('A fish inside a bowl', 'in')).toMatch(/completely inside/i);
    expect(scene('A flower close to a fence', 'near')).toMatch(/side by side on the same floor/i);
  });
  test('a position drawn before this is never reused', () => {
    expect(Pictures.cacheKey({ kind: 'scene', describe: 'A ball on the floor under a chair', place: 'under' })).not.toBe(oldKey('A ball on the floor under a chair', 'under'));
  });
});

describe('the slot rules carry the picture wording (items 3, 4, 6)', () => {
  const Patterns = require('../../bot/shared/services/assessment/patterns');
  const slot = (pattern, subject, id) => Patterns.get(pattern).subjects[subject].sections.flatMap((s) => s.slots).find((s) => s.slot === id);

  test('G1 English Q13 tells the model never to mention the printed bubble', () => {
    expect(slot('fde_g1_2026', 'english', 'g1.english.C.Q13').prompt_rule).toMatch(/never mentions one/i);
  });
  test('G1 Maths Q8 rejects a describe that stacks or overlaps the two things', () => {
    const q = (describe, answer) => ({ answer, picture: { kind: 'scene', describe } });
    const ok = slot('fde_g1_2026', 'maths', 'g1.maths.B.Q8').answer_ok;
    expect(ok(q('a toothbrush and a spoon side by side, the toothbrush clearly shorter', 'the toothbrush'))).toBe(true);
    expect(ok(q('a toothbrush lying under a spoon, the toothbrush clearly shorter', 'the toothbrush'))).toBe(false);
  });
  test('G2 English Q10 asks for the floor and the thing\'s own legs', () => {
    expect(slot('fde_g2_2026', 'english', 'g2.english.B.Q10').prompt_rule).toMatch(/floor/);
  });
});
