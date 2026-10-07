/**
 * How a child-facing surface names the teacher (quiz-teacher-label.js). The label is "Teacher <name>" /
 * «استاد <name>»; a stored name that already starts with an honorific ("Mr …", "Teacher …", «استانی …»)
 * printed "Teacher Mr …" on the web quiz page and in the forwarded message. The honorific is dropped
 * before the prefix, so every teacher is named the same way, without a gendered title.
 */
const { teacherLabel } = require('../../../shared/services/quiz/quiz-teacher-label');

describe('a stored name that already carries an honorific', () => {
  test.each([
    ['Mr Kamran Afzal', 'Teacher Kamran Afzal'],
    ['Ms. Amna', 'Teacher Amna'],
    ['mrs Sadia Khan', 'Teacher Sadia Khan'],
    ['Teacher Rifat', 'Teacher Rifat'],
    ['Sir Bilal', 'Teacher Bilal'],
    ['Miss Hina', 'Teacher Hina'],
    ['Madam Noreen', 'Teacher Noreen'],
  ])('en: %s -> %s', (stored, shown) => {
    expect(teacherLabel(stored, 'en')).toBe(shown);
  });

  test.each([
    ['استانی رفعت', 'استاد رفعت'],
    ['استاد رفعت', 'استاد رفعت'],
    ['سر بلال', 'استاد بلال'],
    ['مس ہنا', 'استاد ہنا'],
    ['رفعت صاحبہ', 'استاد رفعت'],
    ['کامران صاحب', 'استاد کامران'],
  ])('ur: %s -> %s', (stored, shown) => {
    expect(teacherLabel(stored, 'ur')).toBe(shown);
  });

  test('a name that only starts with the same letters is left alone', () => {
    expect(teacherLabel('Mrinal Shah', 'en')).toBe('Teacher Mrinal Shah');
    expect(teacherLabel('Sirajuddin', 'en')).toBe('Teacher Sirajuddin');
    expect(teacherLabel('Missbah Ali', 'en')).toBe('Teacher Missbah Ali');
  });

  test('a name that is only an honorific reads as "your teacher"', () => {
    expect(teacherLabel('Mr.', 'en')).toBe('Your teacher');
    expect(teacherLabel('Teacher', 'en')).toBe('Your teacher');
    expect(teacherLabel('استانی', 'ur')).toBe('آپ کے استاد');
    expect(teacherLabel('', 'ur')).toBe('آپ کے استاد');
  });
});
