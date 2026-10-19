/**
 * A reply that is already valid JSON is parsed as it is: the repairs run only when it does not parse.
 *
 * repairJson's "quote loose after a number" pattern also matched INSIDE a string, so a valid Maths
 * scheme line ending in ": 39" lost its closing quote and the whole section failed BAD_JSON (4 of 80
 * valid recorded replies, all Maths Section B). Mocked at nothing: the util is pure.
 */
const { extractJsonFromResponse } = require('../../bot/shared/services/assessment/assessment-json.util');

test('a valid reply whose string value ends in ": <number>" parses unchanged', () => {
  const body = { points: [{ text: 'Rounds to the nearest whole number: 39', marks: 1, kind: 'A' }] };
  expect(extractJsonFromResponse(JSON.stringify(body))).toEqual(body);
});

test('the same reply inside a fence and with prose around it parses unchanged', () => {
  const body = { a: 'Total: 12', b: [1, 2] };
  expect(extractJsonFromResponse(`Here it is:\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``)).toEqual(body);
});

test('a reply that does not parse is still repaired as before (missing comma, loose quote)', () => {
  expect(extractJsonFromResponse('{"marks": 2", "b": 1}')).toEqual({ marks: 2, b: 1 });
  expect(extractJsonFromResponse('{"a": 1\n"b": 2}')).toEqual({ a: 1, b: 2 });
  expect(extractJsonFromResponse('{"a": "x"\n"b": [1]}')).toEqual({ a: 'x', b: [1] });
});

test('raw newlines inside a string are still escaped', () => {
  expect(extractJsonFromResponse('{"passage": "line one\nline two"}')).toEqual({ passage: 'line one\nline two' });
});
