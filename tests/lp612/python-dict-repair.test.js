/**
 * The rescue for a reply that comes back as a PYTHON dict, not JSON.
 *
 * Upstream carries this repair because that exact failure once cost a pilot its
 * whole revision ladder: the model answered with single-quoted strings and
 * `True`/`False`/`None`, every round failed to parse, and the run burned its
 * budget producing nothing. Upstream fixes it with `ast.literal_eval` behind a
 * round-trip guard. Node has no `literal_eval`, and `eval` is not an option on a
 * string a model wrote — so this is a strict scanner that rewrites quote
 * DELIMITERS and bare literals only, and never touches the inside of a string.
 *
 * The tests below are mostly about that last clause. A repair that corrupts
 * string bodies is worse than no repair: it turns a loud parse failure into a
 * lesson plan with silently mangled content.
 */

const fs = require('fs');
const path = require('path');

const Author = require('../../bot/shared/services/lp612-author.service');
const { pythonDictToJson } = Author;

const roundTrip = (src) => JSON.parse(pythonDictToJson(src));

describe('it rescues the shape upstream rescues', () => {
  test('a single-quoted Python dict becomes parseable JSON', () => {
    expect(roundTrip("{'lesson_id': 'g9_chem_01', 'period_minutes': 40}"))
      .toEqual({ lesson_id: 'g9_chem_01', period_minutes: 40 });
  });

  test('Python literals become JSON literals', () => {
    expect(roundTrip("{'a': True, 'b': False, 'c': None}"))
      .toEqual({ a: true, b: false, c: null });
  });

  test('nested structures survive', () => {
    expect(roundTrip("{'sections': [{'id': 'introduction', 'minutes': 5, 'blocks': []}]}"))
      .toEqual({ sections: [{ id: 'introduction', minutes: 5, blocks: [] }] });
  });
});

describe('it never touches the inside of a string', () => {
  test("an apostrophe inside a DOUBLE-quoted string is left alone", () => {
    expect(roundTrip(`{"note": "the teacher's board"}`))
      .toEqual({ note: "the teacher's board" });
  });

  test('a double quote inside a single-quoted string is escaped, not dropped', () => {
    expect(roundTrip(`{'note': 'she said "hello" clearly'}`))
      .toEqual({ note: 'she said "hello" clearly' });
  });

  test('an escaped single quote inside a single-quoted string is unescaped', () => {
    expect(roundTrip(`{'note': 'it\\'s a right angle'}`))
      .toEqual({ note: "it's a right angle" });
  });

  test('the WORDS True/False/None inside a string are not rewritten', () => {
    // This is the whole reason for a scanner rather than a regex. A naive
    // /\bNone\b/ replace turns a real sentence into "null of the above".
    expect(roundTrip("{'q': 'None of the above', 'a': 'True or False?', 'ok': True}"))
      .toEqual({ q: 'None of the above', a: 'True or False?', ok: true });
  });

  test('a brace or bracket inside a string does not confuse the scan', () => {
    expect(roundTrip("{'latex': 'x_{1} + y_{2}', 'n': 2}"))
      .toEqual({ latex: 'x_{1} + y_{2}', n: 2 });
  });

  test('LaTeX backslash escapes survive the conversion intact', () => {
    expect(roundTrip(`{'latex': '\\\\frac{1}{2}'}`)).toEqual({ latex: '\\frac{1}{2}' });
  });

  test('a newline escape stays a newline, not a literal backslash-n', () => {
    expect(roundTrip(`{'t': 'line\\nbreak'}`)).toEqual({ t: 'line\nbreak' });
  });

  test('Urdu and other non-ASCII content is carried through byte-for-byte', () => {
    expect(roundTrip("{'ur': 'کیمیا کی تعریف', 'n': 1}"))
      .toEqual({ ur: 'کیمیا کی تعریف', n: 1 });
  });
});

describe('the round-trip guard', () => {
  test('already-valid JSON is returned unchanged in meaning', () => {
    const valid = '{"a": 1, "b": "two", "c": true, "d": null}';
    expect(roundTrip(valid)).toEqual({ a: 1, b: 'two', c: true, d: null });
  });

  test('a Python LIST is refused — the author must return an object', () => {
    // Upstream guards with a dict check before json.dumps. Same guard: a list
    // that parses is still not an lp_doc.
    expect(pythonDictToJson("['a', 'b']")).toBeNull();
  });

  test('junk that cannot be made into an object returns null, never a throw', () => {
    for (const junk of ['', 'not json at all', '{unclosed', "{'a': ", '42', 'null']) {
      expect(pythonDictToJson(junk)).toBeNull();
    }
  });
});

describe('it is wired into the author parse path', () => {
  test('extractJson rescues a single-quoted reply instead of failing the round', () => {
    const doc = Author.__extractJsonForTests("{'lesson_id': 'x', 'ok': True, 'n': None}");
    expect(doc).toEqual({ lesson_id: 'x', ok: true, n: null });
  });

  test('a genuinely unparseable reply still fails loudly', () => {
    expect(() => Author.__extractJsonForTests('there is no object here'))
      .toThrow();
  });
});

describe('safety', () => {
  test('the repair uses no eval, no Function constructor and no subprocess', () => {
    // Stated as a test because the obvious implementations of this repair are
    // all of them, and every one executes text a model wrote.
    const src = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/services/lp612-author.service.js'), 'utf8',
    );
    expect(src).not.toMatch(/\beval\s*\(/);
    expect(src).not.toMatch(/new\s+Function\s*\(/);
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bvm\b\s*\)/);
  });
});
