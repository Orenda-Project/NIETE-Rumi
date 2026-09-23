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
  test('Module 3 of Level 1 → its 13 items, split into linked and not-yet-online', () => {
    const r = readingsForCourse({ ...L1, courseTitle: 'Module 3 - Classroom Management' });
    expect(r.available).toHaveLength(9);
    expect(r.unavailable).toHaveLength(4);
    expect(r.available[0]).toMatchObject({ author: 'Shalini Gupta and Harikrishnan M' });
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

  test('Module 8 has nothing online yet — the list is still returned, all unavailable', () => {
    const r = readingsForCourse({ ...L1, courseTitle: 'Module 8 - Instructional Design' });
    expect(r.available).toHaveLength(0);
    expect(r.unavailable).toHaveLength(3);
  });

  test('95 items across the nine modules, 72 of them linked', () => {
    let all = 0; let linked = 0;
    for (let m = 1; m <= 9; m += 1) {
      const r = readingsForCourse({ ...L1, courseTitle: `Module ${m} - X` });
      all += r.available.length + r.unavailable.length;
      linked += r.available.length;
    }
    expect(all).toBe(95);
    expect(linked).toBe(72);
  });

  test('another vendor, another level, or a title with no module number → null', () => {
    expect(readingsForCourse({ vendorName: 'Beacon House', levelOrderIndex: 0, courseTitle: 'Module 1 - X' })).toBeNull();
    expect(readingsForCourse({ ...L1, levelOrderIndex: 1, courseTitle: 'Module 1 - X' })).toBeNull();
    expect(readingsForCourse({ ...L1, courseTitle: 'Introduction' })).toBeNull();
    expect(readingsForCourse({ ...L1, courseTitle: 'Module 12 - X' })).toBeNull();
    expect(readingsForCourse({})).toBeNull();
  });
});
