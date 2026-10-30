/**
 * v37 loop 4 G1 English Q8 ii: the "jumping" child was drawn over a water line, so "swimming" and
 * "diving" fit the picture too; the action prompt itself mentioned "the water surface" for every action
 * (bd-5jmnfj.4.58.9.1). Only a swimming picture is told about water; every other action stands on dry
 * ground, and its cache key changes so the old water picture is never reused.
 */
const Kie = require('../../bot/shared/services/assessment/fde-picture-kie');
const { cacheKey } = require('../../bot/shared/services/assessment/fde-pictures');

const item = (answer, describe) => ({
  question: 'What is the child doing?', answer,
  picture: { kind: 'scene', describe },
});

describe('an action picture is drawn where only that action fits', () => {
  test('a jumping child stands on dry ground and is told no water', () => {
    const q = item('jumping', 'A child jumping high with both feet off the ground and arms up, nothing in their hands.');
    q.picture.show = Kie.showOf(q);
    const prompt = Kie.promptFor(q.picture);
    expect(prompt).toMatch(/dry ground/i);
    expect(prompt).toMatch(/no water/i);
    expect(prompt).not.toMatch(/water surface/i);
  });

  test('a swimming child is drawn in water', () => {
    const q = item('swimming', 'A child in water up to the chest, arms stretched forward in swimming strokes.');
    q.picture.show = Kie.showOf(q);
    const prompt = Kie.promptFor(q.picture);
    expect(prompt).toMatch(/water surface/i);
    expect(prompt).not.toMatch(/no water/i);
  });

  test('the jumping picture drawn before this fix is never reused', () => {
    const q = item('jumping', 'A child jumping high with both feet off the ground and arms up, nothing in their hands.');
    q.picture.show = Kie.showOf(q);
    const before = cacheKey({ ...q.picture, show: { action: 'jumping' } });
    expect(cacheKey(q.picture)).not.toBe(before);
  });
});
