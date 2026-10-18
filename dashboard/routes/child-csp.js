'use strict';
/**
 * A content security policy for the child pages the portal draws itself (app_settings web_quiz_child_csp, default OFF).
 *
 * Report-only first: with the switch ON, the hub (/h), the quiz (/q, its class and schools views), the join page
 * (/quiz/join), the challenge (/c), the shared finish card (/k) and the standing class link (/j) — and the closed pages
 * those routes answer with — carry
 *   Content-Security-Policy-Report-Only: <policy below>   (a violation is reported, nothing is blocked)
 *   X-Content-Type-Options: nosniff
 * Scripts: this site's files, the page's own constant inline scripts by their sha256, and a fresh per-request nonce for
 * the one inline line whose text depends on the bot's answer (the streamed hub's/quiz's fixes, sent after the head and
 * its headers already went). Connects: this site only. Never framed. Reports go to POST /api/wq/csp-report, which logs
 * one line per report: the directive, the blocked origin (or its keyword) and the script's file:line (reportLine) —
 * never the page's address (a child's link carries their token), a path, a query, a referrer or a script sample. Its
 * body is capped (REPORT_BODY_LIMIT; over it, nothing is read) and so is its rate per address (REPORTS_PER_MIN).
 *
 * ON only when the stored value is the JSON boolean true: the string 'true', '"true"', 1, {}, no row, no database
 * client or a failed read are all OFF. Read through the web quiz's switch reader (web-quiz-brotli-flag.js): never per
 * request, at most one background read per 30 s per process. OFF: every page's headers and bytes are exactly today's
 * (no nonce attribute is written), and the report path answers today's 404.
 */
const crypto = require('crypto');
const { createBrotliFlag } = require('./web-quiz-brotli-flag');

const KEY = 'web_quiz_child_csp';
const REPORT_PATH = '/api/wq/csp-report';
const HEADER = 'Content-Security-Policy-Report-Only';
const REPORT_BODY_LIMIT = '8kb';
const REPORTS_PER_MIN = 120;

/** The CSP source for an inline `<script>…</script>` (the first one in `html`): 'sha256-<base64>'. */
function scriptHash(html) {
  const m = /<script>([\s\S]*?)<\/script>/.exec(String(html));
  if (!m) throw new Error('no inline script');
  return `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`;
}

/** The policy for one response: `nonce` this request's, `hashes` the page family's constant inline scripts. */
function policy({ nonce, hashes = [] }) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${hashes.length ? ` ${hashes.join(' ')}` : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${REPORT_PATH}`,
  ].join('; ');
}

/**
 * createChildCsp({ on, hashes }) → apply(res): with the switch on, sets the two headers and returns this request's
 * nonce; off (or the switch reader failing) sets nothing and returns null.
 */
function createChildCsp({ on, hashes = [] }) {
  return function apply(res) {
    let yes = false;
    try { yes = typeof on === 'function' && on() === true; } catch (_) { yes = false; }
    if (!yes) return null;
    const nonce = crypto.randomBytes(16).toString('base64');
    res.set({ [HEADER]: policy({ nonce, hashes }), 'X-Content-Type-Options': 'nosniff' });
    return nonce;
  };
}

const DIRECTIVE_RX = /^[a-z][a-z-]{1,39}$/;
/** The violated directive of a report (report-uri's {"csp-report":{…}} or a Reporting API list), else null. */
function directiveOf(body) {
  const one = (r) => {
    if (!r || typeof r !== 'object') return null;
    const d = r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || r.violatedDirective;
    const word = typeof d === 'string' ? d.trim().split(/\s+/)[0] : '';
    return DIRECTIVE_RX.test(word) ? word : null;
  };
  if (Array.isArray(body)) return one(body[0] && body[0].body);
  return body && typeof body === 'object' ? one(body['csp-report']) : null;
}

// blocked-uri keywords a browser sends instead of an address; kept as they are
const BLOCKED_WORDS = new Set(['inline', 'eval', 'wasm-eval', 'self', 'trusted-types-policy', 'trusted-types-sink']);
// an address scheme with no origin to name: kept as the bare scheme
const BLOCKED_SCHEMES = new Set(['data', 'blob', 'filesystem', 'mediastream']);
// the child pages' own addresses (a report from an inline script names the page): never logged, only "page"
const PAGE_PATH_RX = /^\/(?:h|q|c|k|j|lib|quiz\/join)\//;
const SCRIPT_PATH_RX = /^\/wq\/((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]{1,80}\.js)$/;

/** The one report's fields: report-uri's {"csp-report":{…}} or the first of a Reporting API list. */
function reportOf(body) {
  if (Array.isArray(body)) return body[0] && typeof body[0] === 'object' && body[0].body && typeof body[0].body === 'object' ? body[0].body : null;
  return body && typeof body === 'object' && body['csp-report'] && typeof body['csp-report'] === 'object' ? body['csp-report'] : null;
}

const urlOf = (v) => { try { return typeof v === 'string' && v.length <= 4096 ? new URL(v) : null; } catch (_) { return null; } };

/** The blocked thing: its keyword, its scheme (data, blob…) or its http(s) origin — never a path or a query. */
function blockedOf(r) {
  const v = r && (r['blocked-uri'] !== undefined ? r['blocked-uri'] : r.blockedURL);
  if (typeof v !== 'string') return 'unknown';
  const word = v.trim().toLowerCase();
  if (BLOCKED_WORDS.has(word)) return word;
  const scheme = /^([a-z][a-z0-9+.-]{0,20}):/.exec(word);
  if (scheme && BLOCKED_SCHEMES.has(scheme[1])) return scheme[1];
  const u = urlOf(v.trim());
  return u && (u.protocol === 'https:' || u.protocol === 'http:') ? u.origin : 'unknown';
}

/** The script's file:line: a file of this site's /wq/ by its name, a child page as "page", anything else "other". */
function sourceOf(r) {
  const f = r && (r['source-file'] !== undefined ? r['source-file'] : r.sourceFile);
  if (typeof f !== 'string') return 'unknown';
  const lineRaw = r['line-number'] !== undefined ? r['line-number'] : r.lineNumber;
  const line = Number.isInteger(lineRaw) && lineRaw > 0 && lineRaw < 1e7 ? `:${lineRaw}` : '';
  const u = urlOf(f);
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return 'unknown';
  const m = SCRIPT_PATH_RX.exec(u.pathname);
  if (m) return `${m[1]}${line}`;
  return `${PAGE_PATH_RX.test(u.pathname) ? 'page' : 'other'}${line}`;
}

/** The log line of one report body: { directive, blocked, source }, each 'unknown' when it cannot be read. */
function reportLine(body) {
  const r = reportOf(body);
  return { directive: directiveOf(body) || 'unknown', blocked: r ? blockedOf(r) : 'unknown', source: r ? sourceOf(r) : 'unknown' };
}

/** The switch reader for web_quiz_child_csp, on the web quiz's rule and cache (tests pass db/now). */
function createChildCspFlag(opts = {}) {
  return createBrotliFlag({ ...opts, key: KEY });
}

let shared = null;
/** The process's one switch (the web quiz router's and the join page's). */
function childCspOn() {
  if (!shared) shared = createChildCspFlag();
  return shared();
}

module.exports = {
  KEY, REPORT_PATH, HEADER, REPORT_BODY_LIMIT, REPORTS_PER_MIN, scriptHash, policy, createChildCsp, directiveOf, reportLine, createChildCspFlag, childCspOn,
};
