/**
 * Raw person ids and phone numbers on log lines: the pure scanner behind log-raw-ids.test.js.
 *
 * A log line may carry a person's keyed reference (`tk` for a teacher, `kid` for a child, from
 * bot/shared/services/quiz/web-quiz-kid.js) or a masked phone (`phone.slice(-4)`), never the raw value. A hit is one
 * property of a log call's arguments whose key names a person or a phone and whose value is not a keyed or masked form:
 *   logEvent('x', { userId: user.id })      → 1 hit (userId: user.id)
 *   logToFile('y', { phone, tk: tk(id) })   → 1 hit (phone, shorthand)
 *   logEvent('x', { tk: tk(user.id), phone: phone.slice(-4), from: 'list' }) → 0
 * Log calls: logEvent, logToFile, logError, logWarn, logInfo, logDebug, console.log/warn/error/info/debug.
 * Comments are stripped; string contents are blanked before keys are read (a key named inside a message is no hit).
 */

const KEYS = ['userId', 'user_id', 'teacherId', 'teacher_id', 'teacherUserId', 'teacher_user_id', 'studentId', 'student_id',
  'childId', 'child_id', 'canonicalId', 'canonical_id', 'phone', 'phoneNumber', 'phone_number', 'phoneNorm', 'phone_norm',
  'parentPhone', 'parent_phone', 'waId', 'wa_id', 'from'];
const KEY = `(?:${KEYS.join('|')})`;
const CALL = /(?<![\w$.])(?:logEvent|logToFile|logError|logWarn|logInfo|logDebug|console\.(?:log|warn|error|info|debug))\s*\(/g;
const PAIR = new RegExp(`(?:^|[{,\\s])(${KEY})\\s*:\\s*([^,}\\n]+)|[{,]\\s*(${KEY})\\s*(?=[,}])`, 'g');
// A value that is not a raw id or phone: a literal, a boolean or count, or a keyed / masked / hashed form.
const SAFE = new RegExp([
  String.raw`^\s*(?:null|undefined|true|false|!|Boolean\(|Number\(|typeof\b|[\d'"\x60])`,
  String.raw`\b(?:tk|tkOf|kid|kidOf|mask\w*|redact\w*|hash\w*|sha\w*|hmac\w*|last4|tail4)\s*\(`,
  String.raw`\.length\b`,
  String.raw`\.slice\(\s*-\s*[1-4]\s*\)`,
  String.raw`\?\s*['"]`,
].join('|'), 'i');

// comments out, their newlines kept (a hit's line number is the source's)
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const blankStrings = (s) => s.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, '""');

/** The text inside a call's parentheses, from just after `(` to its matching `)` (strings and nesting respected). */
function callArgs(src, from) {
  let depth = 1;
  let quote = null;
  let i = from;
  for (; i < src.length && depth > 0; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
  }
  return src.slice(from, depth === 0 ? i - 1 : i);
}

/** Every raw-id hit in one file's source, as "<line> <key>: <value>" (or "<line> <key> (shorthand)"). */
function rawIdHits(src) {
  const code = stripComments(src);
  const out = [];
  for (const m of code.matchAll(CALL)) {
    const start = m.index + m[0].length;
    const line = code.slice(0, m.index).split('\n').length;
    const args = blankStrings(callArgs(code, start));
    for (const p of args.matchAll(PAIR)) {
      if (p[3]) out.push(`${line} ${p[3]} (shorthand)`);
      else if (!SAFE.test(p[2])) out.push(`${line} ${p[1]}: ${p[2].trim()}`);
    }
  }
  return out;
}

/** The product files the gate reads: tracked .js under bot/ and dashboard/, never tests, browser files or vendored code. */
const isProductFile = (f) => f.endsWith('.js') && !/(^|\/)(tests?|__tests__|__mocks__|node_modules|public)\//.test(f) && !/\.test\.js$/.test(f);

module.exports = { rawIdHits, isProductFile, KEYS };
