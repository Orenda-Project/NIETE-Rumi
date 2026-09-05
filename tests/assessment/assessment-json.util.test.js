/**
 * Defensive parsing of imperfect model output.
 *
 * A model asked for JSON mostly returns JSON. The rest of the time it wraps it
 * in a fence, drops a comma, emits a raw newline inside a string, or stops
 * mid-object because it hit a token limit. Every case below was met in
 * production by the Python service this replaces; the cases are its own test
 * suite, ported, so the two implementations can be compared rather than
 * trusted.
 *
 * Pure functions, no I/O.
 */

const {
  repairJson,
  fixControlCharsInStrings,
  extractJsonFromResponse,
} = require('../../bot/shared/services/assessment/assessment-json.util');

describe('repairJson', () => {
  it.each([
    ['a trailing quote after a marks integer', '{"marks": 2"}', { marks: 2 }],
    ['a trailing quote before a closing brace', '{"a": 5"}', { a: 5 }],
    ['a trailing quote before a comma', '{"a": 5", "b": 6}', { a: 5, b: 6 }],
    ['a missing comma across a newline', '{"a": 1\n"b": 2}', { a: 1, b: 2 }],
    ['a missing comma on one line', '{"a": 1 "b": 2}', { a: 1, b: 2 }],
    ['a missing comma after a nested object', '{"a": {"x": 1}\n"b": 2}', { a: { x: 1 }, b: 2 }],
    ['a missing comma after a string value', '{"a": "one" "b": "two"}', { a: 'one', b: 'two' }],
  ])('recovers %s', (_label, malformed, expected) => {
    expect(JSON.parse(repairJson(malformed))).toEqual(expected);
  });

  it('leaves already-valid JSON meaning what it meant', () => {
    const valid = '{"a": 1, "b": "two", "c": true, "d": null}';
    expect(JSON.parse(repairJson(valid))).toEqual(JSON.parse(valid));
  });

  it('is idempotent — repairing a repair changes nothing', () => {
    const once = repairJson('{"a": 1\n"b": 2}');
    expect(repairJson(once)).toBe(once);
  });
});

describe('fixControlCharsInStrings', () => {
  it('escapes a raw newline and tab inside a string value', () => {
    const raw = '{"a": "line one\nline two\tend"}';
    expect(JSON.parse(fixControlCharsInStrings(raw))).toEqual({ a: 'line one\nline two\tend' });
  });

  it('escapes a raw carriage return', () => {
    expect(JSON.parse(fixControlCharsInStrings('{"a": "x\ry"}'))).toEqual({ a: 'x\ry' });
  });

  it('escapes an exotic control character rather than dropping it', () => {
    // \u0001 has no shorthand escape, so it becomes \u0001 and SURVIVES.
    // Dropping it would quietly alter a teacher's question text.
    const raw = `{"b": "z${String.fromCharCode(1)}w"}`;
    expect(JSON.parse(fixControlCharsInStrings(raw))).toEqual({ b: `z${String.fromCharCode(1)}w` });
  });

  it('strips null bytes, which are invalid anywhere in JSON', () => {
    expect(fixControlCharsInStrings(`{"a"${String.fromCharCode(0)}: 1}`)).toBe('{"a": 1}');
  });

  it('leaves structural whitespace outside strings alone', () => {
    const raw = '{\n  "a": 1\n}';
    expect(fixControlCharsInStrings(raw)).toBe(raw);
  });

  it('does not double-escape a sequence the model escaped correctly', () => {
    const raw = '{"a": "one\\ntwo"}';
    expect(fixControlCharsInStrings(raw)).toBe(raw);
  });

  it('survives a backslash immediately before the closing quote', () => {
    const raw = '{"a": "ends with a backslash\\\\", "b": 2}';
    expect(JSON.parse(fixControlCharsInStrings(raw))).toEqual({ a: 'ends with a backslash\\', b: 2 });
  });
});

describe('extractJsonFromResponse', () => {
  it('unwraps a ```json fence', () => {
    expect(extractJsonFromResponse('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('unwraps a bare fence with no language tag', () => {
    expect(extractJsonFromResponse('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('finds an object buried in chat', () => {
    expect(extractJsonFromResponse('Sure, here you go: {"a": 1} - done!')).toEqual({ a: 1 });
  });

  it('handles a top-level array', () => {
    expect(extractJsonFromResponse('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('walks bracket depth to the OUTER closing brace, not the first one', () => {
    // The bug this guards: scanning backwards from the end, or forwards to the
    // first '}', both mis-slice a nested object.
    expect(extractJsonFromResponse('noise {"a": {"b": 2}} trailing')).toEqual({ a: { b: 2 } });
  });

  it('repairs before parsing, not instead of it', () => {
    expect(extractJsonFromResponse('```json\n{"a": 1\n"b": 2}\n```')).toEqual({ a: 1, b: 2 });
  });

  it('recovers a question whose text contains a raw line break', () => {
    expect(extractJsonFromResponse('{"q": "line one\nline two"}')).toEqual({ q: 'line one\nline two' });
  });

  it('throws on a response truncated mid-object', () => {
    expect(() => extractJsonFromResponse('{"a": 1, "b":')).toThrow();
  });

  it('throws when the model returned prose and no JSON at all', () => {
    expect(() => extractJsonFromResponse('there is no json here at all')).toThrow();
  });
});
