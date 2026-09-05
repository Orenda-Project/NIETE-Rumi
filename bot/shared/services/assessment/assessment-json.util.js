'use strict';
/**
 * Recovering JSON from a model that mostly returns JSON.
 *
 * Asked for a JSON object, a model usually obliges. When it does not, the
 * failures are few and repetitive: a markdown fence around the payload, a
 * missing comma, a raw newline inside a string where an escape belonged, a
 * response cut off mid-object at the token limit. Each function here undoes one
 * of those, and `extractJsonFromResponse` runs them in the order that works —
 * locate, then de-control, then repair, then parse.
 *
 * Ported from the Python service this replaces, deliberately behaviour-for-
 * behaviour: its edge cases were paid for in production, and its test suite
 * came across with it.
 */

/**
 * Undo the punctuation mistakes a model makes when it is writing JSON by hand.
 * Each pattern is one observed failure, not a general-purpose JSON fixer —
 * anything cleverer starts guessing at intent.
 */
function repairJson(jsonStr) {
  let s = jsonStr;

  // "marks": 2"   →   "marks": 2
  s = s.replace(/("marks":\s*\d+)"/g, '$1');

  // A quote loose after any number, before a comma or a closing brace.
  s = s.replace(/:\s*(\d+)"\s*([,}])/g, ': $1$2');

  // A missing comma between two properties, across a line break.
  s = s.replace(/(\d+|"[^"]*"|true|false|null)\s*\n\s*("[\w_]+":)/g, '$1,\n$2');

  // The same, on one line.
  s = s.replace(/(\d+|"[^"]*"|true|false|null)\s+("[\w_]+"\s*:)/g, '$1,\n$2');

  // A missing comma after a nested object or array closes.
  s = s.replace(/(\}|\])\s*\n\s*("[\w_]+":)/g, '$1,\n$2');

  return s;
}

/**
 * Escape control characters that appear RAW inside string values.
 *
 * A model writing a comprehension passage will happily press enter inside the
 * string. JSON says that byte must be \n; the model sent 0x0A. Parsing fails
 * with "Invalid control character", which reads like a bug in us.
 *
 * Walks the text tracking whether it is inside a string, because the same byte
 * outside a string is ordinary formatting and must survive untouched.
 */
function fixControlCharsInStrings(jsonStr) {
  // A null byte is invalid everywhere in JSON, in a string or out of one.
  const src = jsonStr.replace(/\0/g, '');

  const out = [];
  let inString = false;
  let escapeNext = false;

  for (const ch of src) {
    if (escapeNext) {
      // Whatever follows a backslash is already spoken for — including another
      // backslash, which is why this branch comes first and consumes it.
      out.push(ch);
      escapeNext = false;
    } else if (ch === '\\' && inString) {
      out.push(ch);
      escapeNext = true;
    } else if (ch === '"') {
      inString = !inString;
      out.push(ch);
    } else if (inString && ch.charCodeAt(0) < 0x20) {
      if (ch === '\n') out.push('\\n');
      else if (ch === '\r') out.push('\\r');
      else if (ch === '\t') out.push('\\t');
      else out.push(`\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
    } else {
      out.push(ch);
    }
  }

  return out.join('');
}

/**
 * Pull the JSON payload out of whatever the model actually sent, and parse it.
 *
 * Throws if there is no recoverable JSON — a caller that cannot show a paper
 * needs to say so, not proceed on a half-parsed object.
 */
function extractJsonFromResponse(response) {
  let jsonStr;

  const fenced = response.match(/```(?:json)?\s*([[{][\s\S]*[\]}])\s*```/);
  if (fenced) {
    jsonStr = fenced[1];
  } else {
    const stripped = response.trim();
    const firstObj = stripped.indexOf('{');
    const firstArr = stripped.indexOf('[');
    const candidates = [firstObj, firstArr].filter((i) => i !== -1);

    if (candidates.length === 0) {
      jsonStr = response;
    } else {
      const start = Math.min(...candidates);
      const opener = stripped[start];
      const closer = opener === '{' ? '}' : ']';

      // Count depth forward to the MATCHING closer. Searching backwards from the
      // end finds the right character on a complete response and the wrong one on
      // a truncated one; counting forward is wrong in neither case.
      let depth = 0;
      let end = -1;
      for (let i = start; i < stripped.length; i += 1) {
        if (stripped[i] === opener) depth += 1;
        else if (stripped[i] === closer) {
          depth -= 1;
          if (depth === 0) { end = i; break; }
        }
      }
      jsonStr = end !== -1 ? stripped.slice(start, end + 1) : stripped.slice(start);
    }
  }

  // Order matters: control characters have to go before the repair patterns
  // run, or a raw newline inside a string looks like a line break between
  // properties and earns itself a comma it should never have had.
  jsonStr = fixControlCharsInStrings(jsonStr);
  jsonStr = repairJson(jsonStr);

  return JSON.parse(jsonStr);
}

module.exports = { repairJson, fixControlCharsInStrings, extractJsonFromResponse };
