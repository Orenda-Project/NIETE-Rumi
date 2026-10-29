/**
 * G1 pictures that a child cannot read the way the key does (v24 review, pictures items 1-3).
 *
 * 1. G1 English Q8 iv: describe "A child swimming in a pool..." drew a girl sitting in a puddle; the key
 *    took only "swimming". The drawing prompt carried the describe alone, never the action the key names.
 * 2. G1 Maths Q8 i: "a long ribbon and a short ribbon side by side" drew a curled ribbon and a curled
 *    banner; nothing asked for straight, flat objects with their ends lined up. The slot rule's example
 *    ("a long pencil and a short pencil") invites two of the same thing.
 * 3. G1 Maths Q8 i key "the long ribbon": with two ribbons the only way to name the answer is the stem's
 *    size word. The slot has no answer_ok, so the item is never re-asked.
 */

const Pictures = require('../../bot/shared/services/assessment/fde-pictures');
const Kie = require('../../bot/shared/services/assessment/fde-picture-kie');
const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
const G1Maths = require('../../bot/shared/services/assessment/patterns/early/g1-maths.js');

const SWIM = 'A child swimming in a pool with arms stretched out in the water';
const RIBBON = 'a long ribbon and a short ribbon side by side';
const PARK = 'A busy park with children playing.';
const BIRD = 'A bird standing at the back of a wall, partly hidden by it.';

// Shaped like v24 g1-english-exam.json / g1-maths-exam.json.
const swim = () => ({ slot: 'g1.english.B.Q8', lines: 1, marks: 1, answer: 'swimming',
  question: 'What is the child doing? Write the -ing word.', picture: { kind: 'scene', describe: SWIM } });
const ribbon = () => ({ slot: 'g1.maths.B.Q8', lines: 1, marks: 1, answer: 'the long ribbon',
  scheme: { accept: ['the long ribbon', 'long ribbon'] },
  question: 'Which one is longer?', picture: { kind: 'scene', describe: RIBBON } });
const tree = () => ({ slot: 'g1.maths.B.Q8', lines: 1, marks: 1, answer: 'the tree',
  question: 'Which one is taller?', picture: { kind: 'scene', describe: 'a tall tree and a small bush side by side' } });
const park = () => ({ slot: 'g1.english.C.Q15', answer: 'The children play. The sun shines. A boy runs.',
  question: 'Write three sentences.', picture: { kind: 'scene', describe: PARK } });
const bird = () => ({ slot: 'g2.english.B.Q10', answer: 'behind', question: 'The bird is ____ the wall.',
  picture: { kind: 'scene', describe: BIRD } });

const exam = () => ({
  unseen: {
    subjective: {
      'Action Words': [swim()],
      Measurement: [ribbon(), tree()],
      'Picture Description': [park()],
      Prepositions: [bird()],
    },
  },
});

// Same harness as fde-picture-place.test.js: generateImage records prompts, R2 is an in-memory store.
function deps() {
  const prompts = [];
  const store = {};
  return {
    prompts,
    d: {
      headObject: async (key) => ({ exists: key in store }),
      downloadFromR2: async (key) => store[key],
      uploadBuffer: async (buf, key) => { store[key] = buf; },
      generateImage: async (prompt) => { prompts.push(prompt); return Buffer.from('png'); },
      shrink: async (buf) => buf,
      gray: async () => ({ data: new Uint8Array(100).fill(255), width: 10, height: 10 }),
    },
  };
}
const promptWith = (prompts, describe) => prompts.find((s) => s.includes(describe));
const q8Rule = () => G1Maths.sections.flatMap((s) => s.slots).find((sl) => sl.slot === 'g1.maths.B.Q8');

// The scene prompt and key as they stand before this change, for the controls.
const STYLE_PARK = Kie.promptFor({ kind: 'scene', describe: PARK });
const PARK_KEY = 'fde-pictures/v3/scene-no-text/a-busy-park-with-children-playing-3532c396.jpg';

describe('finding 1: G1 English Q8 action picture is told the action the key names', () => {
  test('the "swimming" picture is told the child is plainly swimming, so a child says "swimming"', async () => {
    const x = deps();
    await Pictures.resolvePictures(exam(), x.d);
    const p = promptWith(x.prompts, SWIM);
    expect(p).toMatch(/plainly swimming/);
    expect(p).toMatch(/says "swimming"/);
  });

  test('a swimming scene drawn before the fix, told no action, is never reused', async () => {
    const x = deps();
    const out = await Pictures.resolvePictures(exam(), x.d);
    const q = out.unseen.subjective['Action Words'][0];
    expect(q.picture.show).toBeTruthy();
    expect(Pictures.cacheKey(q.picture)).not.toBe(Pictures.cacheKey({ kind: 'scene', describe: SWIM }));
  });
});

describe('finding 2: G1 Maths Q8 compare picture draws two straight, flat things, ends lined up', () => {
  test('the "which one is longer" picture is told: laid straight and flat, left ends lined up, not curled', async () => {
    const x = deps();
    await Pictures.resolvePictures(exam(), x.d);
    const p = promptWith(x.prompts, RIBBON);
    expect(p).toMatch(/laid straight and flat/);
    expect(p).toMatch(/left ends lined up/);
    expect(p).toMatch(/not curled|Neither is curled/);
  });

  test('a compare scene drawn before the fix is never reused', async () => {
    const x = deps();
    const out = await Pictures.resolvePictures(exam(), x.d);
    const q = out.unseen.subjective.Measurement[0];
    expect(Pictures.cacheKey(q.picture)).not.toBe(Pictures.cacheKey({ kind: 'scene', describe: RIBBON }));
  });

  test('the Q8 slot rule asks for two different kinds of thing, never ribbon or anything that curls', () => {
    const rule = q8Rule().prompt_rule;
    expect(rule).not.toMatch(/long pencil and a short pencil/);
    expect(rule).toMatch(/different kinds/);
    expect(rule).toMatch(/never[^.]*ribbon/i);
  });
});

describe('finding 3: G1 Maths Q8 key never repeats the stem size word', () => {
  test('"the long ribbon" is re-asked; "the tree" is not', () => {
    const e = { unseen: { subjective: { Measurement: [ribbon(), tree()] } } };
    const short = Prompt.answerShortfall(e, G1Maths).filter((f) => f.slot === 'g1.maths.B.Q8');
    expect(short).toHaveLength(1);
    expect(short[0].items).toContain('Which one is longer? → the long ribbon');
    expect(short[0].items.some((i) => /the tree/.test(i))).toBe(false);
  });

  test('the Q8 slot carries an answer_ok that rejects a size word and an answer not named in the describe', () => {
    const ok = q8Rule().answer_ok;
    expect(typeof ok).toBe('function');
    expect(ok(ribbon())).toBe(false);
    expect(ok({ ...tree(), answer: 'the bucket' })).toBe(false);
    expect(ok(tree())).toBe(true);
  });
});

describe('controls: pictures outside these items are unchanged', () => {
  test('a picture-description scene keeps its prompt and its cached picture', async () => {
    const x = deps();
    const out = await Pictures.resolvePictures(exam(), x.d);
    const q = out.unseen.subjective['Picture Description'][0];
    expect(q.picture.show).toBeUndefined();
    expect(promptWith(x.prompts, PARK)).toBe(STYLE_PARK);
    expect(Pictures.cacheKey(q.picture)).toBe(PARK_KEY);
  });

  test('a position item keeps its place hint and gets no action or compare hint', async () => {
    const x = deps();
    const out = await Pictures.resolvePictures(exam(), x.d);
    const q = out.unseen.subjective.Prepositions[0];
    expect(q.picture.place).toBe('behind');
    expect(q.picture.show).toBeUndefined();
    const p = promptWith(x.prompts, BIRD.replace(/\.$/, ''));
    expect(p).toMatch(/is behind the second/);
    expect(p).not.toMatch(/plainly|lined up/);
  });

  test('a scene picture with no show field gets no action or compare hint', () => {
    const p = Kie.promptFor({ kind: 'scene', describe: SWIM });
    expect(p).not.toMatch(/plainly|lined up/);
  });

  test('a fair compare key ("the tree") raises no shortfall', () => {
    const e = { unseen: { subjective: { Measurement: [tree()] } } };
    expect(Prompt.answerShortfall(e, G1Maths)).toEqual([]);
  });

  test('a G1 English action key ending in -ing is still accepted by its slot', () => {
    const e = { unseen: { subjective: { 'Action Words': [swim()] } } };
    const G1English = require('../../bot/shared/services/assessment/patterns/early/g1-english.js');
    expect(Prompt.answerShortfall(e, G1English)).toEqual([]);
  });
});
