/**
 * The registers carry identity data — read it, but never trust its layout.
 *
 * Measured on the first live day's 48 pages: the full-record register has a
 * populated Admission No. column plus Date of Birth; one attendance register had
 * the printed "Admission/Register No. | Serial No." columns SWAPPED by the person
 * filling it (rolls 01-08 written under Admission, admission numbers 7831… under
 * Serial); another had the admission column entirely blank. So the numbers are
 * classified by their VALUES, not by the printed heading — a roll sequence is
 * small and climbs from ~1; admission numbers are larger and jump around.
 */

const {
  sanitizeRows,
  normalizeAdmission,
  normalizeDob,
} = require('../../bot/shared/services/roster/roster-extraction.service');

describe('admission number normalisation', () => {
  it('keeps a plausible admission number, stripped', () => {
    expect(normalizeAdmission(' 4818 ')).toBe('4818');
    expect(normalizeAdmission('78 31')).toBe('7831');
    expect(normalizeAdmission('A-1204')).toBe('A-1204');
  });
  it('refuses garbage — no digits, or absurd length', () => {
    expect(normalizeAdmission('—')).toBeNull();
    expect(normalizeAdmission('unreadable')).toBeNull();
    expect(normalizeAdmission('12345678901234567890')).toBeNull();
    expect(normalizeAdmission(null)).toBeNull();
  });
});

describe('date of birth normalisation', () => {
  it('parses the formats the registers use', () => {
    expect(normalizeDob('14-01-2014')).toBe('2014-01-14');
    expect(normalizeDob('2/8/2016')).toBe('2016-08-02');
    expect(normalizeDob('2015-11-30')).toBe('2015-11-30');
  });
  it('rejects an implausible school age rather than storing it', () => {
    expect(normalizeDob('01-01-1990')).toBeNull(); // a 36-year-old first grader
    expect(normalizeDob('01-01-2026')).toBeNull(); // an infant
    expect(normalizeDob('not a date')).toBeNull();
    expect(normalizeDob(null)).toBeNull();
  });
});

describe('the swapped-column register (run 5en7oc, page 1 — a real page)', () => {
  // What the filler wrote: rolls 01-08 under the printed Admission heading,
  // admission numbers under the printed Serial heading. A literal reading hands
  // us roll_number=7831 (fails the 1-3 digit rule → every roll abstained) and
  // admission_no=01 (a roll masquerading as an admission number).
  const SWAPPED = [
    { roll_number: '7831', student_name: 'Abdi Ayan', admission_no: '01' },
    { roll_number: '7832', student_name: 'Daim', admission_no: '02' },
    { roll_number: '7833', student_name: 'Umar', admission_no: '03' },
    { roll_number: '7933', student_name: 'Muhammad Sawan', admission_no: '04' },
    { roll_number: '7930', student_name: 'Murtaza', admission_no: '05' },
    { roll_number: '7931', student_name: 'Obaid-ur-Rehman Abbasi', admission_no: '06' },
    { roll_number: '8022', student_name: 'Ali Ahmed', admission_no: '07' },
    { roll_number: '8045', student_name: 'Syed Aqeel Abbas Kazmi', admission_no: '08' },
  ];

  it('recognises the swap by the values and undoes it', () => {
    const { students } = sanitizeRows(SWAPPED);
    expect(students.map((s) => s.roll_number)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(students.map((s) => s.admission_no)).toEqual(
      ['7831', '7832', '7833', '7933', '7930', '7931', '8022', '8045']);
  });

  it('a correctly-filled register is left exactly alone', () => {
    const normal = [
      { roll_number: '1', student_name: 'Abu Bakar', admission_no: '4818', date_of_birth: '14-01-2014' },
      { roll_number: '2', student_name: 'Zakariya', admission_no: '4828', date_of_birth: '12-03-2017' },
    ];
    const { students } = sanitizeRows(normal);
    expect(students[0]).toMatchObject({ roll_number: '1', admission_no: '4818', date_of_birth: '2014-01-14' });
    expect(students[1]).toMatchObject({ roll_number: '2', admission_no: '4828', date_of_birth: '2017-03-12' });
  });

  it('a blank admission column stays honestly null', () => {
    const { students } = sanitizeRows([
      { roll_number: '1', student_name: 'Anzala', admission_no: null },
      { roll_number: '2', student_name: 'M. Saad Raza Attari', admission_no: '' },
    ]);
    expect(students.map((s) => s.admission_no)).toEqual([null, null]);
    expect(students.map((s) => s.roll_number)).toEqual(['1', '2']);
  });
});
