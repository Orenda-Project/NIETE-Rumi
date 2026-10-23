/**
 * The Grade 1-2 prompts (bd-5jmnfj.4.1): Grade 5's section prompt on the masked
 * pattern, with the picture rule in place of "no pictures"; the oral prompt; and
 * the checks on what comes back (oral tasks filled, pictures drawable).
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');

const g1 = (key) => Patterns.get('fde_g1_2026').subjects[key];
const SCOPE = { kind: 'fde', chapters: null, pages: null };

function prompt(key, sectionIndex = 0) {
  const P = g1(key);
  const section = P.sections[sectionIndex];
  return Prompt.sectionPrompt(Gen.buildPatternUserPrompt, {
    grade: 1, subject: key, pageContent: 'BOOK TEXT', pageReference: '1-10', section, slots: section.slots, lang: P.medium, P, scope: SCOPE, poem: null,
  });
}

test('the section prompt carries the picture rule, never "no pictures"', () => {
  const text = prompt('maths');
  expect(text).toContain(Prompt.PICTURE_RULE);
  expect(text).not.toContain(Prompt.NO_PICTURES);
  expect(text).toContain('g1.maths.A.Q3');
});

test('the masked key keeps Grade 5\'s per-subject rules out', () => {
  expect(Prompt.maskP(g1('urdu')).key).toBe('early_urdu');
  expect(g1('urdu').key).toBe('urdu');
  // Grade 5's Urdu grammar list is asked only for key 'urdu'.
  expect(prompt('urdu')).not.toMatch(/Q4 asks/);
});

test('a builder that stops carrying the rule fails loudly, not silently without pictures', () => {
  expect(() => Prompt.sectionPrompt(() => 'some prompt', { P: g1('maths') })).toThrow(/no-pictures/);
});

test('the oral prompt names every task, in the paper\'s language, with the book', () => {
  const P = g1('english');
  const text = Prompt.oralPrompt({ oral: P.oral, grade: 1, P, pageContent: 'THE BOOK' });
  P.oral.tasks.forEach((t) => expect(text).toContain(`id "${t.id}"`));
  expect(text).toContain('in English');
  expect(text).toContain('THE BOOK');
  const U = g1('urdu');
  expect(Prompt.oralPrompt({ oral: U.oral, grade: 1, P: U, pageContent: 'x' })).toContain('in Urdu');
});

describe('oralContent', () => {
  const P = g1('english');
  const full = () => ({ oral: [
    { id: 'listening', script: 'Ali has a ball.', items: [1, 2, 3, 4, 5].map((i) => ({ ask: `q${i}`, answer: 'a' })) },
    { id: 'speaking', script: '', items: [1, 2, 3].map((i) => ({ ask: `p${i}` })) },
    { id: 'read_aloud', items: ['cat', 'dog', 'sun', 'hat', 'the', 'is'].map((w) => ({ ask: w })) },
  ] });

  test('a full reply fills every task', () => {
    const r = Prompt.oralContent(full(), P.oral);
    expect(r.missing).toEqual([]);
    expect(r.content.map((c) => c.id)).toEqual(['listening', 'speaking', 'read_aloud']);
    expect(r.content[1].script).toBeUndefined();
  });

  test('a listening task with no story, or a task short of items, is missing', () => {
    const t = full();
    t.oral[0].script = ' ';
    t.oral[2].items = t.oral[2].items.slice(0, 4);
    expect(Prompt.oralContent(t, P.oral).missing).toEqual(['listening', 'read_aloud']);
  });

  test('a task with no items asked (n = 0) needs its passage', () => {
    const E2 = Patterns.get('fde_g2_2026').subjects.english;
    const reply = { oral: E2.oral.tasks.map((t) => ({ id: t.id, script: t.id === 'read_aloud' ? '' : 'story', items: Array.from({ length: t.n }, () => ({ ask: 'q' })) })) };
    expect(Prompt.oralContent(reply, E2.oral).missing).toEqual(['read_aloud']);
  });

  test('a reply that is not the shape asked for leaves every task missing', () => {
    expect(Prompt.oralContent({}, P.oral).missing).toHaveLength(3);
  });
});

describe('pictureShortfall', () => {
  const P = g1('maths');
  const paper = (picture) => ({ unseen: { subjective: { Counting: [{ slot: 'g1.maths.A.Q3', picture }, { slot: 'g1.maths.A.Q1' }] } } });

  test('an allowed, drawable picture is not short', () => {
    expect(Prompt.pictureShortfall(paper({ kind: 'count', name: 'apple', n: 3 }), P)).toEqual([]);
    expect(Prompt.pictureShortfall(paper({ kind: 'dots', n: 7 }), P)).toEqual([]);
  });

  test('no picture, a kind the slot does not list, or a picture missing what it needs is short', () => {
    expect(Prompt.pictureShortfall(paper(undefined), P)).toEqual([{ slot: 'g1.maths.A.Q3', reason: 'picture' }]);
    expect(Prompt.pictureShortfall(paper({ kind: 'scene', describe: 'a park' }), P)).toHaveLength(1);
    expect(Prompt.pictureShortfall(paper({ kind: 'count', name: 'apple' }), P)).toHaveLength(1);
  });

  test('an item in a slot with no picture is never short of one', () => {
    expect(Prompt.pictureShortfall({ unseen: { s: { T: [{ slot: 'g1.maths.A.Q1' }] } } }, P)).toEqual([]);
  });
});

// Amena, 23 Oct 2026: "For grade 1, its the same pictures in the whole paper, we know that is
// never how a teacher sets up a paper" (bd-5jmnfj.4.27).
describe('repeatedPictures', () => {
  const P = g1('english');
  const obj = (slot, name) => ({ slot, picture: { kind: 'object', name } });
  const paper = (...items) => ({ unseen: { subjective: { T: items } } });

  test('a picture shown in two questions flags the later question only', () => {
    const out = Prompt.repeatedPictures(paper(obj('g1.english.C.Q11', 'cat'), obj('g1.english.A.Q1', 'Cat'), obj('g1.english.A.Q1', 'dog')), P);
    expect(out).toEqual([{ slot: 'g1.english.C.Q11', reason: 'repeat', pictures: ['cat'] }]);
  });

  test('the same thing named with an article or as a plural is still a repeat; different things are not', () => {
    expect(Prompt.repeatedPictures(paper(obj('g1.english.A.Q1', 'a hat'), obj('g1.english.A.Q4', 'hats')), P)).toHaveLength(1);
    expect(Prompt.repeatedPictures(paper(obj('g1.english.A.Q1', 'bus'), obj('g1.english.A.Q4', 'bat')), P)).toEqual([]);
  });

  test('two items of one question showing the same thing flag that question', () => {
    expect(Prompt.repeatedPictures(paper(obj('g1.english.B.Q7', 'cup'), obj('g1.english.B.Q7', 'cup')), P))
      .toEqual([{ slot: 'g1.english.B.Q7', reason: 'repeat', pictures: ['cup'] }]);
  });

  test('scenes, counts, dots and shapes are never repeats', () => {
    const scene = { slot: 'g1.english.B.Q8', picture: { kind: 'scene', describe: 'a child runs' } };
    const count = { slot: 'g1.english.B.Q8', picture: { kind: 'count', name: 'apple', n: 3 } };
    expect(Prompt.repeatedPictures(paper(scene, { ...scene }, count, { ...count }), P)).toEqual([]);
  });
});

describe('takenPicturesNote', () => {
  const tree = (...names) => ({ unseen: { subjective: { T: names.map((name) => ({ slot: 's', picture: { kind: 'object', name } })) } } });

  test('names every object picture in the other sections, once each', () => {
    const note = Prompt.takenPicturesNote([tree('cat', 'dog'), tree('Cat', 'sun')]);
    expect(note).toMatch(/cat, dog, sun/);
    expect(note).toMatch(/same thing/i);
  });

  test('is null when the other sections show no object', () => {
    expect(Prompt.takenPicturesNote([{ unseen: { subjective: {} } }])).toBeNull();
  });
});
