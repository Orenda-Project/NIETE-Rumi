/**
 * bd-6clakk.12 — the question stems a teacher can tick under each question type of a topic paper,
 * taken from the FDE model papers, per subject, grade band (1-2, 3-5) and type.
 */
const { stemsFor, withStems, resolveStems } = require('../../../bot/shared/services/assessment/topics/stems');
const { forSubject } = require('../../../bot/shared/services/assessment/question-types');

const texts = (list) => list.map((s) => s.text);
const URDU = /[؀-ۿ]/;

describe('stemsFor', () => {
  test('G1 English Fill in the Blanks offers the FDE is/am/are stem', () => {
    expect(texts(stemsFor('english', 1, 'Fill in the Blanks'))).toContain('Fill in the blanks with is, am or are.');
  });

  test('G4 English Rewrite Sentences offers Do as directed', () => {
    expect(stemsFor('English', 4, 'Rewrite Sentences').map((s) => s.id)).toContain('do-as-directed');
  });

  test('the two bands differ: G2 and G3 English Fill in the Blanks are not the same list', () => {
    expect(stemsFor('english', 2, 'Fill in the Blanks')).not.toEqual(stemsFor('english', 3, 'Fill in the Blanks'));
  });

  test('Urdu stems are written in Urdu', () => {
    const list = stemsFor('urdu', 4, 'MCQs');
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) expect(s.text).toMatch(URDU);
  });

  test('English, Maths and Science stems are English', () => {
    for (const [subject, type] of [['english', 'MCQs'], ['maths', 'Word Problems'], ['science', 'Brief Answers']]) {
      const list = stemsFor(subject, 3, type);
      expect(list.length).toBeGreaterThan(0);
      for (const s of list) expect(s.text).not.toMatch(URDU);
    }
  });

  test('aliases resolve: math is maths, gensci is science', () => {
    expect(stemsFor('math', 3, 'Word Problems')).toEqual(stemsFor('maths', 3, 'Word Problems'));
    expect(stemsFor('mathematics', 3, 'Word Problems')).toEqual(stemsFor('maths', 3, 'Word Problems'));
    expect(stemsFor('gensci', 4, 'MCQs')).toEqual(stemsFor('science', 4, 'MCQs'));
  });

  test('nothing outside grades 1-5, an unknown type or subject', () => {
    expect(stemsFor('english', 6, 'MCQs')).toEqual([]);
    expect(stemsFor('english', 0, 'MCQs')).toEqual([]);
    expect(stemsFor('english', 3, 'Nonsense')).toEqual([]);
    expect(stemsFor('islamiat', 3, 'MCQs')).toEqual([]);
  });

  test('a returned list is a copy: changing it leaves the bank alone', () => {
    stemsFor('english', 3, 'MCQs').push({ id: 'x', text: 'x' });
    expect(stemsFor('english', 3, 'MCQs').map((s) => s.id)).not.toContain('x');
  });

  test.each(['english', 'urdu', 'maths', 'science'])(
    '%s: every stem sits on a type the grade offers, with unique ids and a full stop', (subject) => {
      for (let grade = 1; grade <= 5; grade++) {
        const offered = forSubject(subject, grade).map((t) => t.id);
        for (const id of offered) {
          const list = stemsFor(subject, grade, id);
          expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
          for (const s of list) expect(s.text).toMatch(/[.۔?]$/);
        }
        const withAny = offered.filter((id) => stemsFor(subject, grade, id).length);
        expect(withAny.length).toBeGreaterThanOrEqual(4);
      }
    },
  );
});

describe('withStems', () => {
  test('adds stems to the types that have them and leaves the rest as they were', () => {
    const types = [{ id: 'MCQs', category: 'objective' }, { id: 'Listening', category: 'objective' }];
    const out = withStems(types, 'english', 3);
    expect(out[0].stems.length).toBeGreaterThan(0);
    expect(out[1]).toEqual({ id: 'Listening', category: 'objective' });
    expect(types[0].stems).toBeUndefined();
  });
});

describe('resolveStems', () => {
  test('ticked ids come back as their text, in the order ticked, once each', () => {
    const r = resolveStems('english', 1, 'Fill in the Blanks', ['has-have', 'is-am-are', 'has-have']);
    expect(r).toEqual({ stems: ['Fill in the blanks with has or have.', 'Fill in the blanks with is, am or are.'] });
  });

  test('nothing ticked is Rumi chooses: an empty list', () => {
    expect(resolveStems('english', 1, 'MCQs', [])).toEqual({ stems: [] });
    expect(resolveStems('english', 1, 'MCQs', undefined)).toEqual({ stems: [] });
  });

  test('an id the bank does not hold for that type is refused, naming it', () => {
    const r = resolveStems('english', 1, 'MCQs', ['is-am-are']);
    expect(r.error).toMatch(/is-am-are/);
    expect(r.stems).toBeUndefined();
  });

  test('a list that is not an array of strings is refused', () => {
    expect(resolveStems('english', 1, 'MCQs', 'choose').error).toBeTruthy();
    expect(resolveStems('english', 1, 'MCQs', [{ id: 'choose' }]).error).toBeTruthy();
  });
});

describe('the edges (bd-6clakk.13)', () => {
  test('eng is english, and a subject is read past its spaces and case', () => {
    const english = stemsFor('english', 1, 'Fill in the Blanks');
    expect(english.length).toBeGreaterThan(0);
    expect(stemsFor('eng', 1, 'Fill in the Blanks')).toEqual(english);
    expect(stemsFor(' English ', 1, 'Fill in the Blanks')).toEqual(english);
  });

  test('no types is no types', () => {
    expect(withStems(undefined, 'english', 3)).toEqual([]);
  });

  test('a list holding something other than an id is refused with the list message', () => {
    expect(resolveStems('english', 1, 'Fill in the Blanks', ['is-am-are', 3]))
      .toEqual({ error: 'stems for Fill in the Blanks must be a list of stem ids' });
    expect(resolveStems('english', 1, 'MCQs', 'choose'))
      .toEqual({ error: 'stems for MCQs must be a list of stem ids' });
  });
});

describe('the bank (bd-6clakk.13)', () => {
  const { BANK } = require('../../../bot/shared/services/assessment/topics/stem-bank');
  const lists = Object.entries(BANK).flatMap(([subject, bands]) => Object.entries(bands)
    .flatMap(([band, types]) => Object.entries(types).map(([type, list]) => ({ where: `${subject} ${band} ${type}`, band, list }))));

  test('every subject has its bands: English and Urdu 1-2 and 3-5, Maths and Science 1-5', () => {
    expect(Object.keys(BANK).sort()).toEqual(['english', 'maths', 'science', 'urdu']);
    expect(Object.keys(BANK.english).sort()).toEqual(['1-2', '3-5']);
    expect(Object.keys(BANK.urdu).sort()).toEqual(['1-2', '3-5']);
    expect(Object.keys(BANK.maths)).toEqual(['1-5']);
    expect(Object.keys(BANK.science)).toEqual(['1-5']);
  });

  test('every stem is an [id, text] pair, ids unique within their type, text a full instruction', () => {
    for (const { where, list } of lists) {
      expect([where, list.length > 0]).toEqual([where, true]);
      for (const pair of list) {
        expect([where, pair.length, /^[a-z0-9-]+$/.test(pair[0]), pair[1].trim().length > 3]).toEqual([where, 2, true, true]);
      }
      expect([where, new Set(list.map(([id]) => id)).size]).toEqual([where, list.length]);
    }
  });
});
