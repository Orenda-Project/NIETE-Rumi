/**
 * I-SAPS recommended reading — which list belongs to which course.
 *
 * The partner's reading list is per MODULE of Level 1. A course is matched by
 * vendor name + level order + the "Module N" in its title, because the numeric
 * ids differ between sandbox, staging and production databases.
 */
const {
  readingsForCourse,
} = require('../../bot/shared/services/training/isaps-readings.rules');

const L1 = { vendorName: 'I-SAPS', levelOrderIndex: 0 };

describe('readingsForCourse', () => {
  test('Module 3 of Level 1 → the 2 items of the partner\'s edited list (Oct 2026)', () => {
    const r = readingsForCourse({ ...L1, courseTitle: 'Module 3 - Classroom Management' });
    expect(r.available).toHaveLength(2);
    expect(r.unavailable).toHaveLength(0);
    expect(r.available[0]).toMatchObject({ author: 'Roselyn D. Ramo', url: 'https://uijrt.com/articles/v6/i7/UIJRTV6I70031.pdf' });
  });

  test('every linked item carries an http(s) url and a title', () => {
    for (let m = 1; m <= 9; m += 1) {
      const r = readingsForCourse({ ...L1, courseTitle: `Module ${m} - X` });
      for (const it of r.available) {
        expect(it.url).toMatch(/^https?:\/\//);
        expect(it.title.trim()).not.toBe('');
      }
      for (const it of r.unavailable) expect(it.url).toBeNull();
    }
  });

  test('Module 7 keeps the three books with no free copy, named but unlinked', () => {
    const r = readingsForCourse({ ...L1, courseTitle: 'Module 7 - X' });
    expect(r.available).toHaveLength(1);
    expect(r.unavailable.map(x => x.author)).toEqual(['Paulo Freire', 'Tony Wagner', 'Robert Gagné']);
  });

  test('a link the partner put in the description or title column is still the link', () => {
    const m2 = readingsForCourse({ ...L1, courseTitle: 'Module 2 - X' });
    const dweck = m2.available.find(x => x.author === 'Carol Dweck');
    expect(dweck.url).toBe('https://www.youtube.com/watch?v=J-swZaKN2Ic');
    expect(dweck.description).not.toMatch(/https?:/);
    const m8 = readingsForCourse({ ...L1, courseTitle: 'Module 8 - X' });
    expect(m8.available).toHaveLength(2);
  });

  test('29 items across the nine modules (3,5,2,3,3,4,4,2,3), 26 of them linked', () => {
    const per = []; let linked = 0;
    for (let m = 1; m <= 9; m += 1) {
      const r = readingsForCourse({ ...L1, courseTitle: `Module ${m} - X` });
      per.push(r.available.length + r.unavailable.length);
      linked += r.available.length;
    }
    expect(per).toEqual([3, 5, 2, 3, 3, 4, 4, 2, 3]);
    expect(linked).toBe(26);
  });

  test('another vendor, another level, or a title with no module number → null', () => {
    expect(readingsForCourse({ vendorName: 'Beacon House', levelOrderIndex: 0, courseTitle: 'Module 1 - X' })).toBeNull();
    expect(readingsForCourse({ ...L1, levelOrderIndex: 1, courseTitle: 'Module 1 - X' })).toBeNull();
    expect(readingsForCourse({ ...L1, courseTitle: 'Introduction' })).toBeNull();
    expect(readingsForCourse({ ...L1, courseTitle: 'Module 12 - X' })).toBeNull();
    expect(readingsForCourse({})).toBeNull();
  });
});
