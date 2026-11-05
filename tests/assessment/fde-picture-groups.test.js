/**
 * bd-cj8ggk.5 — field report: Grade 1-2 Maths had no picture items for multiplication and division.
 * G2 Maths Q10 (Multiplication) and Q12 (Division) printed bare number facts. They now carry an
 * equal-groups picture, drawn here as SVG: g rings, each holding the same number of dots. The fact
 * stays as the stem, so the child reads the picture and writes the answer.
 */

const Svg = require('../../bot/shared/services/assessment/fde-picture-svg');
const Pictures = require('../../bot/shared/services/assessment/fde-pictures');
const G2 = require('../../bot/shared/services/assessment/patterns/early/g2-maths');
const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');

const count = (s, rx) => (s.match(rx) || []).length;

describe('groups: an equal-groups picture', () => {
  test('draws g rings, each with the same number of dots', () => {
    const svg = Svg.svgFor({ kind: 'groups', groups: 3, each: 4 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(count(svg, /data-group=/g)).toBe(3);
    expect(count(svg, /<circle [^>]*fill="#000"/g)).toBe(12);
  });

  test('is a kind the paper draws itself', () => {
    expect(Svg.SVG_KINDS).toContain('groups');
  });

  test.each([[1, 3], [6, 3], [3, 0], [3, 11], ['3', 2]])('refuses groups=%p each=%p', (groups, each) => {
    expect(() => Svg.svgFor({ kind: 'groups', groups, each })).toThrow('groups');
  });

  test('the pipeline embeds it as an image', async () => {
    const q = { slot: 'g2.maths.B.Q10', question: '2 × 5 = ____', picture: { kind: 'groups', groups: 2, each: 5 } };
    await Pictures.resolvePictures({ unseen: { objective: { Multiplication: [q] } } }, { log: () => {} });
    expect(q.picture.src).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

describe('G2 Maths: multiplication and division carry the picture', () => {
  const slotOf = (id) => G2.sections.flatMap((x) => x.slots).find((x) => x.slot === id);

  test.each(['g2.maths.B.Q10', 'g2.maths.B.Q12'])('%s allows a groups picture and keeps its stem', (id) => {
    const slot = slotOf(id);
    expect(slot.picture).toEqual(['groups']);
    expect(slot.picture_only).not.toBe(true);
    expect(slot.prompt_rule).toMatch(/kind:"groups"/);
  });

  test('the writer check accepts a full groups picture and flags an empty one', () => {
    const paper = (picture) => ({ unseen: { objective: { Multiplication: [{ slot: 'g2.maths.B.Q10', picture }] } } });
    expect(Prompt.pictureShortfall(paper({ kind: 'groups', groups: 3, each: 2 }), G2)).toEqual([]);
    expect(Prompt.pictureShortfall(paper({ kind: 'groups' }), G2)).toEqual([{ slot: 'g2.maths.B.Q10', reason: 'picture' }]);
    expect(Prompt.pictureShortfall(paper({ kind: 'groups', groups: 9, each: 2 }), G2)).toHaveLength(1);
  });
});
