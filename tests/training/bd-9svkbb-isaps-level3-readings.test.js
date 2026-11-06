/**
 * bd-9svkbb — I-SAPS Level 3 (Advanced) reading list reaches the teacher.
 *
 * I-SAPS shared "Advance Level reading list final.docx" with the Level 3 content on
 * 2026-11-05: 18 readings, two per module, each with a citation, a link and a rationale.
 * Unlike Levels 1 and 2 there is no "Teachers will be able to …" outcome line, so
 * `outcome` is empty; where the partner says what to read, that sentence is the `section`.
 *
 * Matched on vendor KEY + level order_index 2 + "Module N" in the course title, as
 * Levels 1 and 2 are (bd-gbf8ix).
 */

const { readingsForCourse } = require('../../bot/shared/services/training/isaps-readings.rules');

const l3 = (m) => readingsForCourse({ vendorKey: 'ISAPS', levelOrderIndex: 2, courseTitle: `Module ${m} - X` });
const MODULES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('readingsForCourse — Level 3 (bd-9svkbb)', () => {
  test('two readings in each of the nine modules, every one linked, with a rationale and what to read', () => {
    expect(MODULES.map((m) => (l3(m) ? l3(m).available.length : 0))).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2]);
    for (const m of MODULES) {
      expect(l3(m).unavailable).toHaveLength(0);
      for (const it of l3(m).available) {
        expect(it.url).toMatch(/^https:\/\//);
        expect(it.url).not.toMatch(/utm_source=chatgpt/);
        expect(it.rationale.trim()).not.toBe('');
        expect(it.section.trim()).not.toBe('');
        expect(it.description).toBe(it.rationale);
        expect(it.outcome).toBe('');
      }
    }
  });

  test('Module 1 opens with Biesta (2009); Module 8 is Rosenshine on aft.org then Soderstrom & Bjork', () => {
    const [biesta] = l3(1).available;
    expect(biesta).toMatchObject({ author: 'Biesta, G.', title: 'Good education in an age of measurement: On the need to reconnect with the question of purpose in education (2009)' });
    const [rosenshine, soderstrom] = l3(8).available;
    expect(rosenshine.url).toBe('https://www.aft.org/sites/default/files/Rosenshine.pdf');
    expect(rosenshine.title).toBe('Principles of instruction: Research-based strategies that all teachers should know (2012)');
    expect(soderstrom.section).toBe('The introduction, selected examples and educational implications');
  });

  test('a title with a question keeps its subtitle', () => {
    expect(l3(1).available[1].title).toBe('What is education for? On good education, teacher judgement, and educational professionalism (2015)');
    expect(l3(7).available[0].title).toBe('Critical thinking: Why is it so hard to teach? (2007)');
  });

  test('Levels 1 and 2 are unchanged by adding Level 3', () => {
    const at = (lv) => MODULES.map((m) => readingsForCourse({ vendorKey: 'ISAPS', levelOrderIndex: lv, courseTitle: `Module ${m} - X` }).available.length);
    expect(at(0)).toEqual([2, 2, 2, 1, 2, 1, 1, 1, 1]);
    expect(at(1)).toEqual([1, 3, 1, 1, 2, 1, 1, 2, 1]);
  });

  test('another vendor never gets them, and a level with no list is still null', () => {
    expect(readingsForCourse({ vendorKey: 'BEACONHOUSE', levelOrderIndex: 2, courseTitle: 'Module 1 - X' })).toBeNull();
    expect(readingsForCourse({ vendorKey: 'ISAPS', levelOrderIndex: 3, courseTitle: 'Module 1 - X' })).toBeNull();
  });
});
