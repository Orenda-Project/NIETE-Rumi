'use strict';
/**
 * WHAT THE LESSON DREW — the lp_v8 slide script's manipulatives, parsed.
 *
 * A grade 1-5 maths slide script draws its counters, bundles and tiles as token
 * rows in its `diagram` fields ("whole (9): [counter][counter]…"). The quiz
 * digest used to drop every one of them ("worked.diagram is ASCII … noise"), so
 * the author drew apples for a lesson that counted counters, or drew nothing.
 * The parser lives in the ONE field picker (`carry()`), so it inherits that
 * function's red-team rules: the exit options are never read.
 *
 * Fixtures are short synthetic excerpts in the slide scripts' own format.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');

const COLUMN_SUM = [
  'COLUMN SUM (unworked — the child does it)',
  '| | H | T | O',
  '▲ | | 4 | 5 | 2',
  '▼ | − | 1 | 3 | 7',
  '═ | | · | · | ·',
  'Row marks, NEVER printed: ▲ upper number · ▼ number beneath · ═ empty result row.',
].join('\n');

describe('parseDiagram — one diagram string', () => {
  test('token rows: label, token and count per row, the groups-of-four spaces ignored', () => {
    const d = LpDigest.parseDiagram('whole (9): [counter][counter][counter][counter] [counter][counter][counter][counter] [counter]\nhad (5): [counter][counter][counter][counter] [counter]');
    expect(d.kind).toBe('rows');
    expect(d.rows).toEqual([
      { label: 'whole (9)', token: 'counter', count: 9 },
      { label: 'had (5)', token: 'counter', count: 5 },
    ]);
  });

  test('the design\'s own shapes: top/bottom rows, groups, a cut-off count', () => {
    expect(LpDigest.parseDiagram('top row: [counter][counter][counter]\nbottom row: [counter]').rows)
      .toEqual([{ label: 'top row', token: 'counter', count: 3 }, { label: 'bottom row', token: 'counter', count: 1 }]);
    expect(LpDigest.parseDiagram('group 1: [dot][dot][dot]\ngroup 2: [dot][dot][dot]').rows.map((r) => r.token))
      .toEqual(['dot', 'dot']);
    expect(LpDigest.parseDiagram('10 counters: [counter][counter][counter][counter] [counter][counter][counter][counter] [counter][counter]\n3 cut off: [counter][counter][counter]').rows.map((r) => r.count))
      .toEqual([10, 3]);
  });

  test('a token is normalised: case, spaces and hyphens', () => {
    const d = LpDigest.parseDiagram('Rows: [Big-Bundle][Big-Bundle]');
    expect(d.rows[0].token).toBe('bigbundle');
  });

  test('a column sum is recognised and carries no rows — it is not a manipulative', () => {
    expect(LpDigest.parseDiagram(COLUMN_SUM)).toEqual({ kind: 'column_sum', rows: [], placeValue: [] });
  });

  test('a hundred-chart piece, a blank box and ruler art are not manipulatives', () => {
    expect(LpDigest.parseDiagram('[28]\n[37] [38] [39]\narrows: up −10, down +10').rows).toEqual([]);
    expect(LpDigest.parseDiagram('|~~~~~~~~| 3 cm <== pin\n+--------+ 0 cm').rows).toEqual([]);
    expect(LpDigest.parseDiagram('')).toBeNull();
    expect(LpDigest.parseDiagram(null)).toBeNull();
  });

  test('place value is read from the row\'s PLACE WORD, whatever token the lesson drew', () => {
    // the scripts write "2 ones: [bundle][bundle]" — the token is not the place
    const d = LpDigest.parseDiagram('342 —\n3 hundreds: [bundle][bundle][bundle]\n4 tens: [bundle][bundle][bundle][bundle]\n2 ones: [bundle][bundle]');
    expect(d.placeValue).toEqual([{ hundreds: 3, tens: 4, ones: 2, model: 'bundles' }]);
  });

  test('two numbers in one diagram are two place-value pictures', () => {
    const d = LpDigest.parseDiagram('25 —\n2 tens: [circle-of-10][circle-of-10]\n5 ones: [circle-of-10][circle-of-10][circle-of-10][circle-of-10][circle-of-10]\n61 —\n6 tens: [circle-of-10][circle-of-10][circle-of-10][circle-of-10][circle-of-10][circle-of-10]\n1 one: [circle-of-10]');
    expect(d.placeValue).toEqual([
      { hundreds: 0, tens: 2, ones: 5, model: 'bundles' },
      { hundreds: 0, tens: 6, ones: 1, model: 'bundles' },
    ]);
  });

  test('an empty place is a zero, and flats/rods/cubes are the blocks model', () => {
    expect(LpDigest.parseDiagram('20 tens: [flat][flat]\n9 ones: [flat][flat][flat][flat][flat][flat][flat][flat][flat]\n209 tens: 0 bundles (empty column)').placeValue[0])
      .toMatchObject({ tens: 2, ones: 9, model: 'blocks' });
    expect(LpDigest.parseDiagram('1986: [cube] / [flat][flat][flat][flat] [flat][flat][flat][flat] [flat] / [rod][rod][rod][rod] [rod][rod][rod][rod] / [dot][dot][dot][dot] [dot][dot]').placeValue[0])
      .toEqual({ thousands: 1, hundreds: 9, tens: 8, ones: 6, model: 'blocks' });
  });
});

describe('the manipulatives of a whole slide script — carry(), the ONE field picker', () => {
  const script = {
    meta: { grade: 1, subject: 'maths', topic: 'Take away within 10' },
    iDo: { worked: { problem: 'Count the counters, take 3 away.', work: [], answer: '6', diagram: 'whole (9): [counter][counter][counter][counter] [counter][counter][counter][counter] [counter]\ntaken (3): [counter][counter][counter]' } },
    weDo: { modelled: { diagram: 'mangoes: [mango][mango][mango][mango] [mango]\nsweets: [sweet][sweet][sweet]' } },
    youDo: {
      problems: [{ prompt: 'Take 2 from 8.', diagram: '8 marbles: [marble][marble][marble][marble] [marble][marble][marble][marble]' }, { prompt: 'Column subtraction.', diagram: COLUMN_SUM }],
      behind: { diagram: '342 —\n3 hundreds: [bundle][bundle][bundle]\n4 tens: [bundle][bundle][bundle][bundle]\n2 ones: [stick][stick]' },
    },
    // the exit MCQ the class answered at the end of the period: never read
    wrap: { exitOptions: [{ text: 'A', diagram: 'exit only: [samosa][samosa][samosa]' }] },
  };

  test('lists each object once, resolved to a pictogram, and never reads the exit options', () => {
    const m = LpDigest.carry(script).manipulatives;
    const byToken = Object.fromEntries(m.objects.map((o) => [o.token, o]));
    expect(byToken.counter.picto).toBe('counter');
    expect(byToken.marble.picto).toBe('counter');   // the lesson's word for a counter
    expect(byToken.mango.picto).toBe('mango');
    expect(byToken.sweet.picto).toBeNull();          // the set has no sweet
    expect(byToken.samosa).toBeUndefined();          // exit options are never forwarded
    expect(m.maxCount).toBe(9);
    expect(m.columnSums).toBe(1);
    expect(m.placeValue).toMatchObject({ model: 'bundles' });
  });

  test('the worked example\'s own place-value picture is the one quoted; a practice number never is', () => {
    const withWorked = { ...script, iDo: { worked: { diagram: '47 —\n4 tens: [bundle][bundle][bundle][bundle]\n7 ones: [stick][stick][stick][stick] [stick][stick][stick]' } } };
    expect(LpDigest.carry(withWorked).manipulatives.placeValue.example).toEqual({ hundreds: 0, tens: 4, ones: 7 });
    // in `script` the only place-value picture is in support work, not the worked example
    expect(LpDigest.carry(script).manipulatives.placeValue.example).toBeNull();
  });

  test('bundles or rods counted on their own still mean place value; halves are fractions; a "group" is not an object', () => {
    const m = LpDigest.carry({
      iDo: { worked: { diagram: '3 bundles: [bundle][bundle][bundle]\nrods: [rod][rod]' } },
      weDo: { modelled: { diagram: 'pieces: [half][half]\ngroups: [group][group][group]' } },
    }).manipulatives;
    expect(m.objects.map((o) => o.token)).toEqual([]);
    expect(m.placeValue).toMatchObject({ model: 'blocks', example: null });
    expect(m.fractions).toBe(true);
  });

  test('measuring blocks are a unit of length, not place value — drawn as tiles', () => {
    const m = LpDigest.carry({ iDo: { worked: { diagram: '4 blocks: [block][block][block][block]' } } }).manipulatives;
    expect(m.placeValue).toBeNull();
    expect(m.objects).toEqual([expect.objectContaining({ token: 'block', picto: 'tile' })]);
  });

  test('a script with no diagrams carries no manipulatives', () => {
    expect(LpDigest.carry({ meta: {}, goal: 'x' }).manipulatives).toEqual({ objects: [], placeValue: null, fractions: false, tally: false, money: false, maxCount: 0, columnSums: 0 });
  });
});

describe('lessonDrewBlock — what the author is shown', () => {
  const script = {
    meta: { grade: 1, subject: 'maths' },
    iDo: { worked: { diagram: 'whole (9): [counter][counter][counter][counter] [counter][counter][counter][counter] [counter]\ntaken (3): [counter][counter][counter]' } },
    weDo: { modelled: { diagram: 'sweets: [sweet][sweet][sweet]\nLilies (1/3): [shaded][blank][blank]' } },
    youDo: { behind: { diagram: '47 —\n4 tens: [bundle][bundle][bundle][bundle]\n7 ones: [stick][stick][stick][stick] [stick][stick][stick]' } },
    wrap: { exitOptions: [{ diagram: 'exit: [samosa][samosa]' }] },
  };
  const block = LpDigest.lessonDrewBlock(script);

  test('names the objects and the spec that draws each, and asks for the SAME objects', () => {
    expect(block).toMatch(/WHAT THE LESSON DREW/);
    expect(block).toMatch(/SAME objects/);
    expect(block).toMatch(/counter[^\n]*"picto":"counter"/);
    expect(block).toMatch(/sweet[^\n]*no[^\n]*"counter"/i);          // a missing pictogram falls back to a counter
    expect(block).toMatch(/"type":"base_ten"/);
    expect(block).toMatch(/fraction_bar/);                           // shaded parts are fractions
    expect(block).not.toMatch(/samosa/);
  });

  test('carries the lesson\'s row names without their numbers, and the size of its counts', () => {
    expect(block).toMatch(/whole/);
    expect(block).toMatch(/taken/);
    expect(block).not.toMatch(/whole \(9\)/);
    expect(block).toMatch(/up to 9/);
  });

  test('is empty when the lesson drew nothing', () => {
    expect(LpDigest.lessonDrewBlock({ meta: {}, goal: 'x' })).toBe('');
    expect(LpDigest.lessonDrewBlock({ iDo: { worked: { diagram: COLUMN_SUM } } })).toBe('');
  });
});
