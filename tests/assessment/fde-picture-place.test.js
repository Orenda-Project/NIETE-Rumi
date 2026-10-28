/**
 * A preposition item's picture is told the position its answer names (bd-5jmnfj.4.50.3).
 * v22 G2 English Q10 v: "A bird standing at the back of a wall, partly hidden by it" came back as a
 * bird looking over the wall's top, which a child reads as "on"; the key accepted only "behind".
 * The drawing prompt carried the description alone, never the item's answer.
 */

const Pictures = require('../../bot/shared/services/assessment/fde-pictures');
const Kie = require('../../bot/shared/services/assessment/fde-picture-kie');

// Shaped like v22 g2-english-exam.json unseen.subjective.Prepositions.
const item = (answer, describe, question) => ({
  slot: 'g2.english.B.Q10', lines: 1, marks: 1, answer, blooms: 'Apply',
  scheme: { accept: [answer], points: [{ kind: 'A', text: 'The correct position word', marks: 1 }] },
  picture: { kind: 'scene', describe }, question,
  main_question: 'Look at each picture and fill in the blank with in, on, under, near or behind',
});
const BIRD = 'A bird standing at the back of a wall, partly hidden by it.';
const exam = () => ({
  unseen: {
    subjective: {
      Prepositions: [
        item('in', 'A ball placed inside a basket.', 'The ball is ____ the basket.'),
        item('on', 'A book lying on top of a desk.', 'The book is ____ the desk.'),
        item('under', 'A dog sitting below a bench, underneath its seat.', 'The dog is ____ the bench.'),
        item('near', 'A girl standing close to a gate, a small space between them.', 'The girl is standing ____ the gate.'),
        item('behind', BIRD, 'The bird is ____ the wall.'),
      ],
      'Picture Description': [{ slot: 'g2.english.C.Q15', answer: 'The children play. The sun shines. A boy runs.',
        picture: { kind: 'scene', describe: 'A busy park with children playing.' }, question: 'Write three sentences.' }],
    },
  },
});

function deps() {
  const prompts = [];
  const store = {};
  return {
    prompts,
    store,
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

test('the "behind" picture is told the bird is hidden behind the wall, never on or over its top', async () => {
  const x = deps();
  await Pictures.resolvePictures(exam(), x.d);
  const p = x.prompts.find((s) => s.includes(BIRD.replace(/\.$/, '')));
  expect(p).toMatch(/is behind the second/);
  expect(p).toMatch(/hides most of it/);
  expect(p).toMatch(/not on top of the second/);
  expect(p).toMatch(/not looking over its top edge/);
});

test('every position answer reaches its picture, and is kept on the item', async () => {
  const x = deps();
  const out = await Pictures.resolvePictures(exam(), x.d);
  out.unseen.subjective.Prepositions.forEach((q) => expect(q.picture.place).toBe(q.answer));
  expect(x.prompts.filter((s) => /The position must be plain at a glance/.test(s))).toHaveLength(5);
});

test('a scene drawn before the fix, told no position, is never reused for a position item', () => {
  const told = Pictures.cacheKey({ kind: 'scene', describe: BIRD, place: 'behind' });
  expect(told).not.toBe(Pictures.cacheKey({ kind: 'scene', describe: BIRD }));
  expect(told).not.toBe(Pictures.cacheKey({ kind: 'scene', describe: BIRD, place: 'on' }));
});

test('a scene whose answer is not a position word keeps its prompt and its cached picture', async () => {
  const x = deps();
  const out = await Pictures.resolvePictures(exam(), x.d);
  const q15 = out.unseen.subjective['Picture Description'][0];
  expect(q15.picture.place).toBeUndefined();
  expect(Kie.promptFor(q15.picture)).not.toMatch(/position/);
  expect(Object.keys(x.store)).toContain(Pictures.cacheKey({ kind: 'scene', describe: 'A busy park with children playing.' }));
});

test('placeOf reads only a scene item whose answer is one position word', () => {
  expect(Kie.placeOf({ answer: ' Behind ', picture: { kind: 'scene' } })).toBe('behind');
  expect(Kie.placeOf({ answer: 'on', picture: { kind: 'object', name: 'cup' } })).toBeNull();
  expect(Kie.placeOf({ answer: 'constructor', picture: { kind: 'scene' } })).toBeNull();
  expect(Kie.placeOf({ answer: 'above', picture: { kind: 'scene' } })).toBeNull();
});
