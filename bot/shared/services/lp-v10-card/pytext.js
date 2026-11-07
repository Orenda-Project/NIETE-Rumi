/**
 * Python string semantics the v10 card port relies on (re word boundaries, html.escape, html.unescape, len,
 * truthiness, repr of a string list). Pure: no I/O, no vendor imports.
 *
 * `unesc` is a subset of Python's html.unescape: numeric references with Python's U+FFFD and invalid-codepoint
 * rules, plus the common named references (all the legacy no-semicolon ones that matter, and the typographic set).
 * The real v9 video blocks only ever carry &amp;.
 */

// Python \w in a str pattern is any Unicode letter, number or underscore (marks are not \w, as in Python).
const W = '[\\p{L}\\p{N}_]';
/** Start of a word (Python \b before a word character). */
const BS = `(?<!${W})`;
/** End of a word (Python \b after a word character). */
const BE = `(?!${W})`;
/** Python \b in general. */
const WB = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;

/** Python html.escape. */
function esc(s, quote = true) {
  let o = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (quote) o = o.replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  return o;
}

const NAMED = {
  amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>', quot: '"', QUOT: '"', apos: "'", nbsp: ' ',
  copy: '©', COPY: '©', reg: '®', REG: '®', middot: '·', laquo: '«', raquo: '»',
  times: '×', divide: '÷', deg: '°', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', rarr: '→', larr: '←',
};
// the names Python also decodes with no trailing semicolon
const LEGACY = new Set(['amp', 'AMP', 'lt', 'LT', 'gt', 'GT', 'quot', 'QUOT', 'nbsp', 'copy', 'COPY', 'reg', 'REG',
  'middot', 'laquo', 'raquo', 'times', 'divide', 'deg']);
const CP1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d,
  0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d,
  0x17e, 0x178];

function codepoint(n) {
  if (n === 0) return '�';
  if (n >= 0x80 && n <= 0x9f) return String.fromCodePoint(CP1252[n - 0x80]);
  if ((n >= 0xd800 && n <= 0xdfff) || n > 0x10ffff) return '�';
  if ((n >= 0x1 && n <= 0x8) || (n >= 0xe && n <= 0x1f) || (n >= 0x7f && n <= 0x9f) || (n >= 0xfdd0 && n <= 0xfdef)
    || n === 0xb || (n & 0xfffe) === 0xfffe) return '';
  return String.fromCodePoint(n);
}

/** Python html.unescape (subset, see header). */
function unesc(s) {
  return String(s).replace(/&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/g, (all, g) => {
    if (g[0] === '#') {
      const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return codepoint(n);
    }
    const semi = g.endsWith(';');
    const name = semi ? g.slice(0, -1) : g;
    if (Object.prototype.hasOwnProperty.call(NAMED, name) && (semi || LEGACY.has(name))) return NAMED[name];
    for (let x = g.length - 1; x > 1; x -= 1) {
      const p = g.slice(0, x);
      if (LEGACY.has(p)) return NAMED[p] + g.slice(x);
    }
    return `&${g}`;
  });
}

/** Python len: code points, not UTF-16 units. */
const cpLen = (s) => Array.from(s).length;

/** Python truthiness. */
function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/** Python str() for the values the card carries (strings and ints). */
const str = (v) => String(v);

/** Python repr of a list of plain strings, as f"{list}" prints it. */
const pyList = (a) => `[${a.map((x) => `'${x}'`).join(', ')}]`;

module.exports = { esc, unesc, cpLen, truthy, str, pyList, BS, BE, WB, W };
