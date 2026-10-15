/**
 * Composition criteria for the marking scheme.
 *
 * Compositions (applications, letters, paragraphs, stories, picture
 * descriptions, mind maps, flow charts, dialogues) are not marked from model
 * output: their criteria are fixed templates, scaled to the question's marks in
 * halves, so they are reviewed once and never invented per paper.
 *
 * Pure functions, no I/O.
 */

const {
  criteriaFor,
  kindFor,
} = require('../../bot/shared/services/assessment/composition-criteria');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027');

function slot(subject, id) {
  return P.subjects[subject].sections.flatMap((s) => s.slots).find((s) => s.slot === id);
}

function sum(rows) {
  return rows.reduce((t, r) => t + r.marks, 0);
}

const KINDS = ['application', 'letter', 'paragraph', 'story_outline', 'story_title', 'story_opening',
  'picture_description', 'mind_map', 'flow_chart', 'dialogue'];

describe('criteriaFor', () => {
  test('criteria for Q7 summing to 10', () => {
    const q7 = slot('english', 'english.C.Q7');
    const application = criteriaFor(kindFor(q7, 0), q7.marks_each, 'en');
    expect(application.map((r) => r.name)).toEqual(['Format', 'Content', 'Language', 'Neatness and length']);
    expect(application.map((r) => r.marks)).toEqual([3, 4, 2, 1]);
    expect(sum(application)).toBe(10);

    const letter = criteriaFor(kindFor(q7, 1), q7.marks_each, 'en');
    expect(letter.map((r) => r.marks)).toEqual([3, 4, 2, 1]);
    expect(sum(letter)).toBe(10);
    for (const r of [...application, ...letter]) expect(Object.keys(r).sort()).toEqual(['look_for', 'marks', 'name']);
  });

  test('scales a 10-mark template to 6 in halves and sums exactly', () => {
    const paragraph = criteriaFor('paragraph', 6, 'en');
    expect(paragraph.map((r) => r.marks)).toEqual([0.5, 3, 2, 0.5]);
    expect(sum(paragraph)).toBe(6);

    // 1.2 + 3 + 1.2 + 0.6 rounds to 5.5; the missing half goes on مواد.
    const dialogue = criteriaFor('dialogue', 6, 'ur');
    expect(dialogue.map((r) => r.marks)).toEqual([1, 3.5, 1, 0.5]);
    expect(dialogue[1].name.startsWith('مواد')).toBe(true);
    expect(sum(dialogue)).toBe(6);

    for (const kind of KINDS) {
      for (const lang of ['en', 'ur']) {
        for (const marks of [3, 5, 6, 7, 10]) {
          const rows = criteriaFor(kind, marks, lang);
          expect(sum(rows)).toBe(marks);
          for (const r of rows) expect(Number.isInteger(r.marks * 2)).toBe(true);
        }
      }
    }
  });

  test('story outline 5 is title 1 · outline 2 · moral 1 · language 1', () => {
    const q9 = slot('english', 'english.C.Q9');
    const rows = criteriaFor(kindFor(q9, 0), q9.marks_each, 'en');
    expect(rows.map((r) => r.marks)).toEqual([1, 2, 1, 1]);
    expect(rows[0].name).toBe('Title');
    expect(rows[1].name).toMatch(/outline/i);
    expect(rows[2].name).toBe('Moral');
    expect(rows[3].name).toBe('Language');
  });

  test('urdu picture description uses the Urdu rows', () => {
    const q7 = slot('urdu', 'urdu.C.Q7');
    const rows = criteriaFor(kindFor(q7, 0), q7.marks_each, 'ur');
    expect(rows.map((r) => r.marks)).toEqual([1, 4, 3, 1, 1]);
    expect(rows[0].name).toBe('عنوان');
    for (const r of rows) expect(r.name).toMatch(/[؀-ۿ]/);
    expect(rows.every((r) => !/[A-Za-z]/.test(r.name))).toBe(true);

    // English picture description stays English.
    const en = criteriaFor('picture_description', 6, 'en');
    expect(en.map((r) => r.marks)).toEqual([1, 2, 2, 1]);
    expect(en[0].name).toBe('Title');
  });

  test('mind map is one row of the question\'s marks', () => {
    const q6 = slot('english', 'english.C.Q6');
    const en = criteriaFor(kindFor(q6, 0), q6.marks_each, 'en');
    expect(en).toHaveLength(1);
    expect(en[0].marks).toBe(5);

    const q4 = slot('social_studies', 'social_studies.B.Q4');
    const ur = criteriaFor(kindFor(q4, 0), q4.marks_each, 'ur');
    expect(ur).toHaveLength(1);
    expect(ur[0].marks).toBe(6);
  });

  test('language_scale is expanded', () => {
    const rows = criteriaFor('paragraph', 10, 'en');
    const language = rows.find((r) => r.name === 'Language');
    expect(language.look_for).toMatch(/^Full marks = /);
    for (const kind of KINDS) {
      for (const lang of ['en', 'ur']) {
        for (const r of criteriaFor(kind, 10, lang)) expect(r.look_for).not.toBe('language_scale');
      }
    }
  });

  test('no org name in any row', () => {
    for (const kind of KINDS) {
      for (const lang of ['en', 'ur']) {
        for (const r of criteriaFor(kind, 10, lang)) {
          const text = `${r.name} ${r.look_for || ''}`;
          // No acronym of four or more capitals (FDE, the board, is three and allowed).
          expect(text).not.toMatch(/\b[A-Z]{4,}\b/);
          // Every suggestion is "a suggestion", never someone's.
          for (const m of text.matchAll(/(\S+)\s+suggestion/g)) expect(m[1]).toMatch(/^\(?a$/);
        }
      }
    }
    expect(criteriaFor('application', 10, 'en')[3].look_for).toMatch(/\(a suggestion; FDE sets no length\)/);
  });

  test('unknown kind is empty', () => {
    expect(criteriaFor('essay', 10, 'en')).toEqual([]);
    expect(criteriaFor(undefined, 10, 'en')).toEqual([]);
    expect(criteriaFor('toString', 10, 'en')).toEqual([]);
    expect(criteriaFor('paragraph', 'ten', 'en')).toEqual([]);
    expect(criteriaFor('paragraph', -2, 'en')).toEqual([]);
    expect(() => criteriaFor({}, null, 7)).not.toThrow();
  });
});

describe('kindFor', () => {
  test('kindFor reads slot.kinds by index then the type', () => {
    const q7 = slot('english', 'english.C.Q7');
    expect(kindFor(q7, 0)).toBe('application');
    expect(kindFor(q7, 1)).toBe('letter');
    expect(kindFor(slot('urdu', 'urdu.C.Q9'), 1)).toBe('story_opening');
    expect(kindFor(slot('urdu', 'urdu.C.Q8'), 1)).toBe('dialogue');
    expect(kindFor(slot('social_studies', 'social_studies.B.Q3'), 0)).toBe('flow_chart');
    expect(kindFor(slot('social_studies', 'social_studies.B.Q4'), 0)).toBe('mind_map');
    expect(kindFor(slot('english', 'english.C.Q6'), 0)).toBe('mind_map');

    // Past the end of kinds, the type decides.
    expect(kindFor(slot('english', 'english.C.Q8'), 3)).toBe('paragraph');
    expect(kindFor({ type: 'Story Writing', kinds: null }, 0)).toBe('story_outline');
    expect(kindFor({ type: 'Application Writing' })).toBe('application');
    expect(kindFor({ type: 'Letter Writing' }, 2)).toBe('letter');
    expect(kindFor({ type: 'Picture Description' }, 0)).toBe('picture_description');

    expect(kindFor(slot('maths', 'maths.B.Q2'), 0)).toBeNull();
    expect(kindFor(null, 0)).toBeNull();
    expect(kindFor('x', 0)).toBeNull();
  });
});

describe('Urdu rows for the Social Studies drawings', () => {
  it('urdu flow chart and mind map rows are Urdu and sum to the marks', () => {
    for (const [kind, marks] of [['flow_chart', 10], ['mind_map', 6]]) {
      const rows = criteriaFor(kind, marks, 'ur');
      expect(rows.reduce((t, r) => t + r.marks, 0)).toBe(marks);
      rows.forEach((r) => expect(r.name).toMatch(/[؀-ۿ]/));
    }
  });
});
