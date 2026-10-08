/**
 * I-SAPS Level 1 reading — which list belongs to which course.
 *
 * The partner's reading list is per MODULE of Level 1. A course is matched by
 * vendor name + level order + the "Module N" in its title, because the numeric
 * ids differ between sandbox, staging and production databases.
 *
 * bd-klecr.9 (2026-10-08): I-SAPS, after FDE's feedback, replaced the 95-item
 * recommended list with a MANDATORY list of 13 readings, each with the section
 * to read, a rationale and what the teacher will be able to do after it. The
 * supplementary readings go to teachers as a separate Word document, not here.
 */
const {
  readingsForCourse,
} = require('../../bot/shared/services/training/isaps-readings.rules');

const L1 = { vendorName: 'I-SAPS', levelOrderIndex: 0 };
const mod = (m) => readingsForCourse({ ...L1, courseTitle: `Module ${m} - X` });

describe('readingsForCourse', () => {
  test('13 mandatory readings across the nine modules, every one linked', () => {
    const perModule = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => mod(m).available.length);
    expect(perModule).toEqual([2, 2, 2, 1, 2, 1, 1, 1, 1]);
    for (let m = 1; m <= 9; m += 1) expect(mod(m).unavailable).toHaveLength(0);
  });

  test('every reading has a title, an http(s) link and what the teacher will be able to do', () => {
    for (let m = 1; m <= 9; m += 1) {
      for (const it of mod(m).available) {
        expect(it.title.trim()).not.toBe('');
        expect(it.url).toMatch(/^https?:\/\//);
        expect(it.outcome.trim()).not.toBe('');
        expect(it.rationale.trim()).not.toBe('');
      }
    }
  });

  test('Module 1: Robinson (watch) and Fullan (two targeted sections)', () => {
    const [robinson, fullan] = mod(1).available;
    expect(robinson).toMatchObject({ author: 'Sir Ken Robinson', url: 'https://www.ted.com/talks/sir_ken_robinson_changing_education_paradigms' });
    expect(fullan.author).toBe('Michael Fullan');
    expect(fullan.section).toBe('Chapter 2: Shared Meaning and Program Coherence (pp. 37–40); Chapter 3: Capacity Building (pp. 58–61)');
  });

  test('Module 3: Kounin and Marzano — Marzano\'s link is the Drive file in the document', () => {
    const [kounin, marzano] = mod(3).available;
    expect(kounin.section).toBe('"Withitness and Overlapping", Chapter 4 (pp. 79–91)');
    expect(marzano.author).toBe('Robert Marzano');
    expect(marzano.url).toBe('https://drive.google.com/file/d/1cwjW6r3pO3G8eLSmLzdFdIHgEzyjMgPW/view?usp=drive_link');
  });

  test('the old recommended list is gone', () => {
    const titles = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((m) => mod(m).available.map((r) => r.title));
    expect(titles.some((t) => /Shalini Gupta/.test(t))).toBe(false);
    expect(mod(3).available.map((r) => r.author)).not.toContain('Shalini Gupta and Harikrishnan M');
  });

  test('description stays filled (older screens read it): it is the rationale', () => {
    for (const it of mod(2).available) expect(it.description).toBe(it.rationale);
  });

  test('another vendor, another level, or a title with no module number → null', () => {
    expect(readingsForCourse({ vendorName: 'Beacon House', levelOrderIndex: 0, courseTitle: 'Module 1 - X' })).toBeNull();
    expect(readingsForCourse({ ...L1, levelOrderIndex: 1, courseTitle: 'Module 1 - X' })).toBeNull();
    expect(readingsForCourse({ ...L1, courseTitle: 'Introduction' })).toBeNull();
    expect(readingsForCourse({ ...L1, courseTitle: 'Module 12 - X' })).toBeNull();
    expect(readingsForCourse({})).toBeNull();
  });
});
