/**
 * What the model returns is not yet a roster. This is the deterministic pass
 * between the two.
 *
 * TWO FIELD DEFECTS, 2026-08-30, both from the same real run.
 *
 * 1. INVENTED ROLL NUMBERS. Three children whose roll numbers sat behind a
 *    drawing came back as 10, 11, 12 on a page that numbers them 35, 36, 37 —
 *    the model completed the sequence rather than abstaining. A wrong roll number
 *    silently corrupts panel identity, which is the one thing the assessment
 *    design cannot tolerate, and self-reported confidence does not separate right
 *    from wrong here (five of six wrong names came back at confidence 1.0). So the
 *    guard has to be structural, not probabilistic: a register is an ordered list,
 *    so roll numbers down a page increase. Anything that breaks that is not a roll
 *    number we read.
 *
 * 2. FATHER NAMES ALL NULL. All 16 saved rows had father_name null, because that
 *    register uses one combined "Name of Student & Father" column and the prompt
 *    told the model to leave the split alone when it was not unambiguous. But
 *    "Minahil d/o Asif" and "منہال ولد آصف" ARE unambiguous — there is a marker in
 *    the string. Father's name is the only discriminator when a class holds four
 *    Minahils, so the markers are split here, deterministically, after the model.
 */

const {
  sanitizeRows, splitCombinedName, normalizeParentPhone,
} = require('../../bot/shared/services/roster/roster-extraction.service');

const row = (roll, name, father) => ({
  roll_number: roll, student_name: name, father_name: father || null, notes: null,
});

describe('sanitizeRows — a roll number we did not read is null, never inferred', () => {
  it('keeps roll numbers that run up the page', () => {
    const { students } = sanitizeRows([row('1', 'A'), row('2', 'B'), row('3', 'C')]);
    expect(students.map((s) => s.roll_number)).toEqual(['1', '2', '3']);
  });

  it('nulls a roll that goes BACKWARDS — the 35/36/37 read as 10/11/12', () => {
    const { students, problems } = sanitizeRows([
      row('33', 'A'), row('34', 'B'), row('10', 'C'), row('11', 'D'), row('12', 'E'),
    ]);
    expect(students.map((s) => s.roll_number)).toEqual(['33', '34', null, null, null]);
    expect(problems.join(' ')).toMatch(/roll/i);
  });

  it('nulls a duplicated roll rather than enrolling two children at one number', () => {
    const { students } = sanitizeRows([row('7', 'A'), row('7', 'B')]);
    expect(students.map((s) => s.roll_number)).toEqual(['7', null]);
  });

  it('nulls a roll the students table could never hold, instead of throwing on write', () => {
    // students.roll_number is INTEGER. "A-12" is not a number, and a register that
    // uses one leaves the coach to type the roll in rather than losing the child.
    const { students } = sanitizeRows([row('A-12', 'A')]);
    expect(students[0].roll_number).toBeNull();
    expect(students[0].student_name).toBe('A');
  });

  it('never drops a child just because its roll was unreadable', () => {
    const { students } = sanitizeRows([row('5', 'A'), row(null, 'B'), row('2', 'C')]);
    expect(students.map((s) => s.student_name)).toEqual(['A', 'B', 'C']);
  });
});

describe('splitCombinedName — pulling the father out of a combined column', () => {
  it.each([
    ['Minahil d/o Asif Mehmood', 'Minahil', 'Asif Mehmood'],
    ['Ahmed s/o Kamran', 'Ahmed', 'Kamran'],
    ['Ahmed S/O Kamran', 'Ahmed', 'Kamran'],
    ['Bilal bin Tariq', 'Bilal', 'Tariq'],
    ['منہال ولد آصف', 'منہال', 'آصف'],
    ['سارہ بنت کامران', 'سارہ', 'کامران'],
  ])('splits %s', (input, name, father) => {
    expect(splitCombinedName(input)).toEqual({ student_name: name, father_name: father });
  });

  it('leaves a plain name alone rather than guessing at a split', () => {
    expect(splitCombinedName('Ayesha Bilal')).toEqual({
      student_name: 'Ayesha Bilal', father_name: null,
    });
  });

  it('runs over the rows the model left combined', () => {
    const { students } = sanitizeRows([row('1', 'Minahil d/o Asif', null)]);
    expect(students[0]).toMatchObject({ student_name: 'Minahil', father_name: 'Asif' });
  });

  it('does not overwrite a father name the model already read from its own column', () => {
    const { students } = sanitizeRows([row('1', 'Minahil d/o Asif', 'Asif Mehmood')]);
    expect(students[0].father_name).toBe('Asif Mehmood');
  });
});

describe('normalizeParentPhone — registers that DO carry a number', () => {
  it.each([
    ['0300-1234567', '923001234567'],
    ['+92 300 1234567', '923001234567'],
    ['03001234567', '923001234567'],
  ])('normalises %s', (raw, want) => {
    expect(normalizeParentPhone(raw)).toBe(want);
  });

  it('refuses anything that is not a plausible number, rather than storing noise', () => {
    expect(normalizeParentPhone('n/a')).toBeNull();
    expect(normalizeParentPhone('12')).toBeNull();
    expect(normalizeParentPhone(null)).toBeNull();
  });

  it('carries a parent phone through the row pass when the register has one', () => {
    const { students } = sanitizeRows([
      { roll_number: '1', student_name: 'A', father_name: null, parent_phone: '0300-1234567' },
    ]);
    expect(students[0].parent_phone).toBe('923001234567');
  });
});
