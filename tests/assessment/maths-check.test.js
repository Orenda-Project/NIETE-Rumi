/**
 * The maths key check.
 *
 * A model writing a marking scheme gets the arithmetic wrong often enough to
 * matter, and a wrong key in a teacher's hands marks every right child wrong.
 * The check recomputes what it can recognise in exact integers and fractions
 * and, where the key disagrees, replaces the key's number and leaves a note.
 *
 * Pure functions, no I/O.
 */

const {
  mathsCheck,
  parseForm,
  lastNumber,
} = require('../../bot/shared/services/assessment/maths-check');

function q(question, answer, extra = {}) {
  return {
    slot: 'maths.B.Q2',
    n: 'iv',
    question,
    answer,
    marks: 5,
    scheme: {
      points: [
        { text: 'a correct method', marks: 3, kind: 'M' },
        { text: answer, marks: 2, kind: 'A' },
      ],
    },
    ...extra,
  };
}

function paper(questions, layout = { subject: 'maths', notes: [] }) {
  return { _layout: layout, unseen: { subjective: { short: questions } } };
}

function only(result) {
  return result.examJson.unseen.subjective.short[0];
}

function checkOne(question, answer) {
  const result = mathsCheck(paper([q(question, answer)]));
  return { result, item: only(result) };
}

const R = (num, den = 1n) => ({ num, den });

describe('parseForm', () => {
  it('a × b with commas is ok', () => {
    expect(parseForm('Solve: 30,571 × 4')).toMatchObject({ form: 'multiply', value: R(122284n) });
    expect(parseForm('6 x 4 =')).toMatchObject({ form: 'multiply', value: R(24n) });
    expect(parseForm('12 * 3')).toMatchObject({ form: 'multiply', value: R(36n) });

    const { result, item } = checkOne('Solve: 30,571 × 4', '30,571 × 4 = 122,284');
    expect(item.scheme.checked).toBe('ok');
    expect(result.checked).toBe(1);
  });

  it('a ÷ b exact is ok', () => {
    expect(parseForm('Divide: 23,856 ÷ 24')).toMatchObject({ form: 'divide', value: R(994n) });
    // A spaced slash between whole numbers divides; an unspaced one is a fraction.
    expect(parseForm('84 / 7')).toMatchObject({ form: 'divide', value: R(12n) });
    expect(parseForm('Write 84/7')).toBeNull();

    const { item } = checkOne('Divide: 23,856 ÷ 24', 'Quotient = 994');
    expect(item.scheme.checked).toBe('ok');
  });

  it('a + b and a − b with Pakistani grouping are ok', () => {
    expect(parseForm('3,56,123 + 1,20,000')).toMatchObject({ form: 'add', value: R(476123n) });
    expect(parseForm('4,567,098 − 1,234,567')).toMatchObject({ form: 'subtract', value: R(3332531n) });
    expect(parseForm('4,567,098 - 1,234,567')).toMatchObject({ form: 'subtract', value: R(3332531n) });
    expect(parseForm('4,567,098 – 1,234,567')).toMatchObject({ form: 'subtract', value: R(3332531n) });

    const { item } = checkOne('Add: 3,56,123 + 1,20,000', '4,76,123');
    expect(item.scheme.checked).toBe('ok');
  });

  it('a chain or a negative difference is unparsed', () => {
    expect(parseForm('45 + 23 − 12')).toBeNull();
    expect(parseForm('Read pages 12-40')).toBeNull();
  });

  it('HCF of 8 and 12 is 4', () => {
    expect(parseForm('Find the HCF of 8 and 12.')).toMatchObject({ form: 'hcf', value: R(4n) });
    expect(parseForm('Find the H.C.F. of 18 and 24')).toMatchObject({ form: 'hcf', value: R(6n) });
    expect(parseForm('the highest common factor of 12 and 20')).toMatchObject({ form: 'hcf', value: R(4n) });
    // Both asked at once: the last number cannot say which it is.
    expect(parseForm('Find the HCF and LCM of 8 and 12.')).toBeNull();

    const { item } = checkOne('Find the HCF of 8 and 12.', 'Common factors 1, 2, 4. HCF = 4');
    expect(item.scheme.checked).toBe('ok');
  });

  it('LCM by three numbers', () => {
    expect(parseForm('Find the LCM of 12, 18 and 30 by the division method.'))
      .toMatchObject({ form: 'lcm', value: R(180n) });
    expect(parseForm('L.C.M. of 4 and 6')).toMatchObject({ form: 'lcm', value: R(12n) });
    expect(parseForm('the least common multiple of 4 and 6')).toMatchObject({ form: 'lcm', value: R(12n) });
    expect(parseForm('the lowest common multiple of 4, 6 and 8')).toMatchObject({ form: 'lcm', value: R(24n) });

    const { item } = checkOne('Find the LCM of 12, 18 and 30 by the division method.', '2 × 2 × 3 × 3 × 5 = 180');
    expect(item.scheme.checked).toBe('ok');
  });

  it('average of five values', () => {
    expect(parseForm('Find the average of 12, 15, 18, 21 and 24.'))
      .toMatchObject({ form: 'average', value: R(18n) });
    expect(parseForm('the mean of 2.5, 3.5 and 4')).toMatchObject({ form: 'average', value: R(10n, 3n) });

    const { item } = checkOne('Find the average of 12, 15, 18, 21 and 24.', 'Sum = 90, 90 ÷ 5 = 18');
    expect(item.scheme.checked).toBe('ok');
  });

  it('18% into decimal', () => {
    expect(parseForm('Change 18% into decimal')).toMatchObject({ form: 'percent-decimal', value: R(9n, 50n) });
    expect(parseForm('Write 18% as a decimal.')).toMatchObject({ form: 'percent-decimal', value: R(9n, 50n) });
    expect(parseForm('Convert 18% to a decimal')).toMatchObject({ form: 'percent-decimal', value: R(9n, 50n) });
    expect(parseForm('Change 3/8 into a decimal.')).toMatchObject({ form: 'fraction-decimal', value: R(3n, 8n) });
    expect(parseForm('Write 3/8 as a decimal')).toMatchObject({ form: 'fraction-decimal', value: R(3n, 8n) });

    expect(checkOne('Write 18% as a decimal.', '18 ÷ 100 = 0.18').item.scheme.checked).toBe('ok');
    expect(checkOne('Change 3/8 into a decimal.', '0.375').item.scheme.checked).toBe('ok');
  });

  it('1/3 + 2/5 as a fraction', () => {
    expect(parseForm('Add: 1/3 + 2/5')).toMatchObject({ form: 'add', value: R(11n, 15n) });
    expect(parseForm('Multiply: 2/3 × 3/5')).toMatchObject({ form: 'multiply', value: R(2n, 5n) });
    expect(parseForm('2/3 ÷ 4/5')).toMatchObject({ form: 'divide', value: R(5n, 6n) });
    expect(parseForm('Subtract: 3 ⁄ 4 − 1 ⁄ 3')).toMatchObject({ form: 'subtract', value: R(5n, 12n) });

    const { item } = checkOne('Add: 1/3 + 2/5', '5/15 + 6/15 = 11/15');
    expect(item.scheme.checked).toBe('ok');
  });

  it('7 1/3 − 3 1/5 mixed', () => {
    expect(parseForm('Subtract: 7 1/3 − 3 1/5')).toMatchObject({ form: 'subtract', value: R(62n, 15n) });
    expect(parseForm('7⅓ − 3⅕')).toMatchObject({ form: 'subtract', value: R(62n, 15n) });
    expect(parseForm('2½ + ¼')).toMatchObject({ form: 'add', value: R(11n, 4n) });

    expect(checkOne('Subtract: 7 1/3 − 3 1/5', '22/3 − 16/5 = 62/15 = 4 2/15').item.scheme.checked).toBe('ok');

    const { item } = checkOne('Subtract: 7 1/3 − 3 1/5', '4 1/15');
    expect(item.scheme.checked).toBe('replaced');
    expect(item.answer).toBe('4 2/15');
  });

  it('expanded form of 4,205,316', () => {
    const form = parseForm('Write 4,205,316 in expanded form.');
    expect(form).toMatchObject({ form: 'expanded', value: R(4205316n) });
    expect(form.expected).toBe('4,000,000 + 200,000 + 5,000 + 300 + 10 + 6');
    expect(parseForm('the expanded form of 4,205,316')).toMatchObject({ form: 'expanded' });

    // Order and commas do not matter; the place-value-times-digit form counts too.
    expect(checkOne('Write 4,205,316 in expanded form.', '6 + 10 + 300 + 5000 + 200000 + 4000000')
      .item.scheme.checked).toBe('ok');
    expect(checkOne('Write 4,205,316 in expanded form.',
      '4 × 1,000,000 + 2 × 100,000 + 0 × 10,000 + 5 × 1,000 + 3 × 100 + 1 × 10 + 6 × 1')
      .item.scheme.checked).toBe('ok');

    const { item, result } = checkOne('Write 4,205,316 in expanded form.',
      '4,205,316 = 4,000,000 + 200,000 + 50,000 + 300 + 10 + 6');
    expect(item.scheme.checked).toBe('replaced');
    expect(item.answer).toBe('4,205,316 = 4,000,000 + 200,000 + 5,000 + 300 + 10 + 6');
    expect(result.examJson._layout.notes[0].computed).toBe('4,000,000 + 200,000 + 5,000 + 300 + 10 + 6');
  });
});

describe('percentages (panel C9)', () => {
  it('a decimal or fraction as a percentage', () => {
    expect(parseForm('Write 0.45 as a percentage.')).toMatchObject({ form: 'to-percent', value: R(45n) });
    expect(parseForm('Change 0.45 into a percentage')).toMatchObject({ form: 'to-percent', value: R(45n) });
    expect(parseForm('Express 0.45 as a percent.')).toMatchObject({ form: 'to-percent', value: R(45n) });
    expect(parseForm('Write 3/4 as a percentage.')).toMatchObject({ form: 'to-percent', value: R(75n) });
    // Another number in the question means it is not this one sum.
    expect(parseForm('Write 0.45 and 0.3 as percentages.')).toBeNull();
  });

  it('a percentage key agrees whichever way it is written', () => {
    expect(checkOne('Write 0.45 as a percentage.', '45%').item.scheme.checked).toBe('ok');
    expect(checkOne('Write 0.45 as a percentage.', '45 %').item.scheme.checked).toBe('ok');
    expect(checkOne('Write 0.45 as a percentage.', '45 percent').item.scheme.checked).toBe('ok');
    expect(checkOne('Write 0.45 as a percentage.', '0.45 × 100 = 45%').item.scheme.checked).toBe('ok');
    expect(checkOne('Write 3/4 as a percentage.', '3/4 × 100 = 75%').item.scheme.checked).toBe('ok');
  });

  it('a wrong percentage key is replaced, keeping its % form, with a note', () => {
    const { item, result } = checkOne('Write 0.45 as a percentage.', '4.5%');
    expect(item.scheme.checked).toBe('replaced');
    expect(item.answer).toBe('45%');
    expect(item.scheme.points[1].text).toBe('45%');
    expect(result.examJson._layout.notes[0]).toMatchObject({ computed: '45', model: '4.5' });

    expect(checkOne('Write 3/4 as a percentage.', '3/4 × 100 = 70%').item.answer).toBe('3/4 × 100 = 75%');
    expect(checkOne('Change 0.45 into a percentage', '0.45 × 100 = 4.5 percent').item.answer)
      .toBe('0.45 × 100 = 45 percent');
  });

  it('a percentage as a decimal keeps the key\'s decimal places', () => {
    expect(parseForm('Write 45% as a decimal')).toMatchObject({ form: 'percent-decimal', value: R(9n, 20n) });
    expect(parseForm('Change 45% into a decimal')).toMatchObject({ form: 'percent-decimal', value: R(9n, 20n) });
    expect(checkOne('Write 45% as a decimal', '0.45').item.scheme.checked).toBe('ok');
    const { item } = checkOne('Change 45% into a decimal', '45 ÷ 100 = 4.5');
    expect(item.scheme.checked).toBe('replaced');
    expect(item.answer).toBe('45 ÷ 100 = 0.45');
  });

  it('a percentage of a number', () => {
    expect(parseForm('What is 20% of 150?')).toMatchObject({ form: 'percent-of', value: R(30n) });
    expect(parseForm('Find 20% of 150.')).toMatchObject({ form: 'percent-of', value: R(30n) });
    expect(parseForm('Find 12.5% of 80')).toMatchObject({ form: 'percent-of', value: R(10n) });
    expect(parseForm('Find 20% of 150 and add 5.')).toBeNull();

    expect(checkOne('What is 20% of 150?', '20/100 × 150 = 30').item.scheme.checked).toBe('ok');
    const { item } = checkOne('Find 20% of 150.', '20/100 × 150 = 35');
    expect(item.scheme.checked).toBe('replaced');
    expect(item.answer).toBe('20/100 × 150 = 30');
  });
});

describe('verb wordings', () => {
  it('Divide 23,856 by 24 = 994 is ok', () => {
    expect(parseForm('Divide 23,856 by 24.')).toMatchObject({ form: 'divide', value: R(994n) });
    expect(parseForm('Divide 52.8 by 1.2.')).toMatchObject({ form: 'divide', value: R(44n) });
    expect(checkOne('Divide 23,856 by 24.', '23,856 ÷ 24 = 994').item.scheme.checked).toBe('ok');
  });

  it('Divide: a÷b', () => {
    expect(parseForm('Divide: 23,856÷24')).toMatchObject({ form: 'divide', value: R(994n) });
  });

  it('Multiply a by b', () => {
    expect(parseForm('Multiply 4,768 by 65.')).toMatchObject({ form: 'multiply', value: R(309920n) });
    const { item } = checkOne('Multiply 4,768 by 65.', '4,768 × 65 = 309,820');
    expect(item.scheme.checked).toBe('replaced');
    expect(item.answer).toBe('4,768 × 65 = 309,920');
  });

  it('Multiply: a x b', () => {
    expect(parseForm('Multiply: 2,345 x 7')).toMatchObject({ form: 'multiply', value: R(16415n) });
  });

  it('Subtract 3/4 from 8 2/5', () => {
    expect(parseForm('Subtract 3/4 from 8 2/5.')).toMatchObject({ form: 'subtract', value: R(153n, 20n) });
    expect(parseForm('Subtract 135,800 from 750,000')).toMatchObject({ form: 'subtract', value: R(614200n) });
    expect(parseForm('Subtract 9 from 4')).toBeNull();

    expect(checkOne('Subtract 3/4 from 8 2/5.', '7 13/20').item.scheme.checked).toBe('ok');
    const { item } = checkOne('Subtract 3/4 from 8 2/5.', '7 3/20');
    expect(item.scheme.checked).toBe('replaced');
    expect(item.answer).toBe('7 13/20');
  });

  it('Add a and b', () => {
    expect(parseForm('Add 3,56,123 and 1,20,000.')).toMatchObject({ form: 'add', value: R(476123n) });
    expect(checkOne('Add 3,56,123 and 1,20,000.', '4,76,123').item.scheme.checked).toBe('ok');
  });

  it('Find the sum of a and b', () => {
    expect(parseForm('Find the sum of 286,450 and 135,800.')).toMatchObject({ form: 'add', value: R(422250n) });
  });

  it('Find the product of a and b', () => {
    expect(parseForm('Find the product of 67,840 and 56.')).toMatchObject({ form: 'multiply', value: R(3799040n) });
  });

  it('Find the difference between a and b (larger − smaller)', () => {
    expect(parseForm('Find the difference between 1,234,567 and 4,567,098.'))
      .toMatchObject({ form: 'subtract', value: R(3332531n) });
    expect(parseForm('Find the difference between 4,567,098 and 1,234,567.'))
      .toMatchObject({ form: 'subtract', value: R(3332531n) });
  });

  it('a verb wording with another number or a further step is unparsed', () => {
    expect(parseForm('Divide 23,856 by 24 and multiply the answer by 2.')).toBeNull();
    expect(parseForm('Add 45 and 23, then double the answer.')).toBeNull();
  });
});

describe('lastNumber', () => {
  it.each([
    ['Rs. 327,750 left', '327,750', R(327750n), 4],
    ['= 4,76,123', '4,76,123', R(476123n), 2],
    ['22/3 − 16/5 = 4 2/15', '4 2/15', R(62n, 15n), 14],
    ['= 4⅓', '4⅓', R(13n, 3n), 2],
    ['0.18.', '0.18', R(9n, 50n), 0],
    ['18', '18', R(18n), 0],
  ])('reads %s', (text, raw, value, index) => {
    expect(lastNumber(text)).toMatchObject({ raw, value, index });
  });

  it('returns null when there is no number', () => {
    expect(lastNumber('no number here')).toBeNull();
    expect(lastNumber('')).toBeNull();
    expect(lastNumber(null)).toBeNull();
  });
});

describe('mathsCheck', () => {
  it('a written item the model gave no scheme is still checked, and a wrong key replaced', () => {
    const bare = q('Multiply 25 by 4.', '90');
    delete bare.scheme;
    const result = mathsCheck(paper([bare]));
    const item = only(result);
    expect(result.replaced).toBe(1);
    expect(item.answer).toBe('100');
    expect(item.scheme.checked).toBe('replaced');
    expect(result.examJson._layout.notes[0]).toMatchObject({ model: '90', computed: '100' });
  });

  it('52.8 ÷ 1.2 = 44 is ok (no float false alarm)', () => {
    expect(parseForm('52.8 ÷ 1.2')).toMatchObject({ form: 'divide', value: R(44n) });
    const { item, result } = checkOne('Solve: 52.8 ÷ 1.2', '528 ÷ 12 = 44');
    expect(item.scheme.checked).toBe('ok');
    expect(result.replaced).toBe(0);
  });

  it('0.1 + 0.2 = 0.3 is ok', () => {
    const { item } = checkOne('0.1 + 0.2', '0.3');
    expect(item.scheme.checked).toBe('ok');
  });

  it('a wrong product is replaced and a note is appended', () => {
    const result = mathsCheck(paper([q('Multiply: 2,345 × 7', '2,345 × 7 = 16,405')]));
    const item = only(result);

    expect(result.replaced).toBe(1);
    expect(item.scheme.checked).toBe('replaced');
    expect(item.answer).toBe('2,345 × 7 = 16,415');
    expect(item.scheme.points[1].text).toBe('2,345 × 7 = 16,415');
    expect(item.scheme.points[0].text).toBe('a correct method');

    const note = result.examJson._layout.notes[0];
    expect(note).toMatchObject({
      slot: 'maths.B.Q2',
      n: 'iv',
      text_en: 'key corrected by code; the model wrote 16,405',
      computed: '16,415',
      model: '16,405',
    });
    expect(note.text_ur).toContain('16,405');
  });

  it('a wrong decimal keeps the answer’s places; a recurring one is compared by three places', () => {
    expect(checkOne('Add: 15.75 + 24.6', '40.25').item.answer).toBe('40.35');
    expect(checkOne('Change 1/3 into a decimal.', '0.333').item.scheme.checked).toBe('ok');
    expect(checkOne('Change 1/3 into a decimal.', '0.33').item.scheme.checked).toBe('ok');
    const wrong = checkOne('Change 1/3 into a decimal.', '0.334').item;
    expect(wrong.scheme.checked).toBe('replaced');
    expect(wrong.answer).toBe('0.333');
  });

  it('a wrong decimal key 44.5 for 52.8 ÷ 1.2 becomes 44', () => {
    const { item, result } = checkOne('Solve: 52.8 ÷ 1.2', '528 ÷ 12 = 44.5');
    expect(item.scheme.checked).toBe('replaced');
    expect(item.answer).toBe('528 ÷ 12 = 44');
    expect(result.examJson._layout.notes[0]).toMatchObject({ computed: '44', model: '44.5' });
  });

  it('a number restated after the answer is not mistaken for the answer', () => {
    expect(checkOne('Find the HCF of 8 and 12.', '4 is the HCF of 8 and 12').item.scheme.checked).toBe('ok');
    const { item } = checkOne('Find the HCF of 8 and 12.', '6 is the HCF of 8 and 12');
    expect(item.scheme.checked).toBe('replaced');
    expect(item.answer).toBe('4 is the HCF of 8 and 12');
  });

  it('replaced never changes the question text', () => {
    const question = 'Multiply: 2,345 × 7';
    const result = mathsCheck(paper([q(question, '16,405')]));
    expect(only(result).scheme.checked).toBe('replaced');
    expect(only(result).question).toBe(question);
  });

  it('an unrecognised question is checked null', () => {
    const result = mathsCheck(paper([
      q('A school had Rs. 750,000. It spent Rs. 286,450 on furniture. How much is left?', 'Rs. 463,550'),
      q('Multiply: 2,345 × 7', 'see working'),
    ]));
    const [a, b] = result.examJson.unseen.subjective.short;
    expect(a.scheme.checked).toBeNull();
    expect(b.scheme.checked).toBeNull();
    expect(result.unparsed).toBe(2);
    expect(a.answer).toBe('Rs. 463,550');
  });

  it('a non-maths paper is untouched', () => {
    const input = paper([q('Multiply: 2,345 × 7', '16,405')], { subject: 'science', notes: [] });
    const result = mathsCheck(input);
    expect(result.examJson).toEqual(input);
    expect(result).toMatchObject({ checked: 0, replaced: 0, unparsed: 0 });

    const viaOption = mathsCheck(paper([q('Multiply: 2,345 × 7', '16,405')], {}), { subject: 'English' });
    expect(only(viaOption).scheme.checked).toBeUndefined();

    const mathsByOption = mathsCheck(paper([q('Multiply: 2,345 × 7', '16,405')], {}), { subject: 'Mathematics' });
    expect(only(mathsByOption).scheme.checked).toBe('replaced');
  });

  it('an MCQ and a removed question are skipped; a written item with no scheme is not', () => {
    const input = {
      _layout: { subject: 'maths', notes: [] },
      unseen: {
        objective: {
          mcq: [q('9,000 × 100 =', '90,000', { options: ['90,000', '9,000,000', '900', '900,000'] })],
        },
        subjective: { short: [q('Multiply: 2,345 × 7', '16,405', { removed: true })] },
      },
      seen: { subjective: { short: [q('Multiply: 2,345 × 7', '16,415', { scheme: undefined })] } },
    };
    const result = mathsCheck(input);
    expect(result).toMatchObject({ checked: 1, replaced: 0, unparsed: 0 });
    expect(result.examJson.seen.subjective.short[0].scheme.checked).toBe('ok');
    expect(result.examJson.unseen.objective.mcq[0].scheme.checked).toBeUndefined();
    expect(result.examJson.unseen.subjective.short[0].answer).toBe('16,405');
  });

  it('checks the seen tree too', () => {
    const input = { _layout: { subject: 'maths' }, seen: { subjective: { short: [q('6 x 4', '25')] } } };
    const result = mathsCheck(input);
    expect(result.examJson.seen.subjective.short[0].answer).toBe('24');
    expect(result.examJson._layout.notes).toHaveLength(1);
  });

  it('never throws on garbage', () => {
    const huge = '9'.repeat(40);
    const input = paper([
      q(null, '44'),
      q('Multiply: 2,345 × 7', 'no number at all'),
      q(`${huge} × ${huge}`, huge),
      q('Multiply: 2,345 × 7', { not: 'a string' }),
      q(12345, '12345'),
      q('2/0 + 1/3', '1'),
      q('10 ÷ 0', '0'),
      { ...q('6 x 4', '25'), scheme: { points: 'not an array' } },
      null,
      'a string where a question belongs',
    ]);
    input.seen = { subjective: 'not an object', objective: { short: 'not an array' } };

    let result;
    expect(() => { result = mathsCheck(input); }).not.toThrow();
    expect(result.unparsed).toBe(7);
    expect(result.replaced).toBe(1);

    expect(() => mathsCheck(null)).not.toThrow();
    expect(() => mathsCheck(undefined)).not.toThrow();
    expect(() => mathsCheck('a string')).not.toThrow();
    expect(() => parseForm({})).not.toThrow();
    expect(parseForm(undefined)).toBeNull();
  });

  it('the input object is not mutated', () => {
    const input = paper([q('Multiply: 2,345 × 7', '2,345 × 7 = 16,405')]);
    const before = JSON.stringify(input);
    const result = mathsCheck(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.examJson).not.toBe(input);
    expect(only(result).answer).toBe('2,345 × 7 = 16,415');
  });
});

describe('notes point back at the question', () => {
  it('a note records the item\'s position within its slot, removed items counted', () => {
    const exam = {
      _layout: { subject: 'maths', notes: [] },
      unseen: { subjective: { 'Word Problems': [
        { question: 'Divide 52.8 by 1.2.', answer: '44', marks: 5, slot: 'maths.B.Q2', scheme: { points: [] }, removed: true },
        { question: 'Multiply 12 by 12.', answer: '144', marks: 5, slot: 'maths.B.Q2', scheme: { points: [] } },
        { question: 'Divide 52.8 by 1.2.', answer: '44.5', marks: 5, slot: 'maths.B.Q2', scheme: { points: [] } },
      ] } },
    };
    const { examJson } = mathsCheck(exam);
    expect(examJson._layout.notes).toHaveLength(1);
    expect(examJson._layout.notes[0]).toEqual(expect.objectContaining({ slot: 'maths.B.Q2', index: 2, model: '44.5', computed: '44' }));
  });
});
