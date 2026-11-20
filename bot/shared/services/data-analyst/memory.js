'use strict';
/**
 * What one WhatsApp data conversation already established: a port of the data team's
 * slackbot/thread_memory.py ThreadQueries, made to round-trip through JSON (it lives in Redis with
 * the session, so a follow-up on another web replica still has it).
 *
 * - The queries already run and their results: a follow-up that re-runs one gets the figures the
 *   colleague was already given (their "figures already given are the record" rule).
 * - The rule fetches that returned real rules: fetched again before the next answer, so a follow-up
 *   does not spend its first steps re-reading them.
 * - The clarifying question the last reply asked, so the next message is read against it.
 */

// Their cap per result (60,000): a compiled answer carries its SQL, notes and companions, and measured
// 20,298 characters for one ICT figure (20 Nov 2026). Eight entries keep a session's Redis value under ~0.5 MB.
const MAX_ENTRIES = 8;
const MAX_RESULT_CHARS = 60000;
const MAX_RULE_FETCHES = 4;
const CONTEXT_ROWS = 12;
const CONTEXT_CHARS = 12000;
const METRIC_KEY_PREFIX = 'query_metric:';
const TELEMETRY_ARGS = new Set(['asked_by', 'surface', 'turn_id', 'question', 'rule_version', 'caller_email']);
const RULE_ARGS = ['region', 'domain', 'path'];
const METRIC_ARG_ORDER = ['metric', 'definition', 'from_date', 'to_date', 'compare_from', 'compare_to', 'filters', 'by'];

const normaliseSql = (sql) => String(sql || '').trim().replace(/\s+/g, ' ').replace(/;+$/, '').trim();
const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** Python's json.dumps(sort_keys=True) shape, so a key is stable whatever order the args came in. */
function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(', ')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}: ${stableStringify(v[k])}`).join(', ')}}`;
  }
  return JSON.stringify(v);
}

/** The memory key of one query_metric call: every blank it was asked with, telemetry left out. */
function metricKey(args) {
  const blanks = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (!TELEMETRY_ARGS.has(k) && !isEmpty(v)) blanks[k] = v;
  }
  return METRIC_KEY_PREFIX + stableStringify(blanks);
}

function metricBlanks(key) {
  if (typeof key !== 'string' || !key.startsWith(METRIC_KEY_PREFIX)) return null;
  try {
    const b = JSON.parse(key.slice(METRIC_KEY_PREFIX.length));
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch (_) { return null; }
}

const keyOf = (query) => (metricBlanks(query) !== null ? query : normaliseSql(query));

function cacheable(result) {
  try {
    const p = JSON.parse(result);
    return !!p && typeof p === 'object' && p.status === 'ok' && !p.query_shape_warnings;
  } catch (_) { return false; }
}

/** [{sql, export}] for a query_metric answer and each companion that ran (their export_parts). */
function exportParts(result) {
  let p;
  try { p = JSON.parse(result); } catch (_) { return []; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return [];
  const parts = Array.isArray(p.served_with) ? [p, ...p.served_with.filter((c) => c && typeof c === 'object')] : [p];
  return parts.filter((x) => typeof x.sql === 'string' && x.sql.trim()).map((x) => ({ sql: x.sql, export: x.export }));
}

function ruleFetch(args) {
  const out = {};
  for (const k of RULE_ARGS) {
    const v = String((args && args[k]) || '').trim();
    if (v) out[k] = v;
  }
  return out;
}
const ruleKey = (f) => stableStringify(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.toLowerCase()])));

function metricCallLine(key, payload) {
  const blanks = metricBlanks(key) || {};
  const names = METRIC_ARG_ORDER.filter((k) => k in blanks).concat(Object.keys(blanks).filter((k) => !METRIC_ARG_ORDER.includes(k)).sort());
  const args = names.map((n) => (typeof blanks[n] === 'string' ? `${n}=${blanks[n]}` : `${n}=${JSON.stringify(blanks[n])}`)).join(', ');
  let line = `Call: query_metric(${args})`;
  if (payload && payload.period) {
    line += ` — period: ${payload.period}`;
    if (payload.compare_period) line += `, compared with ${payload.compare_period}`;
  }
  return `${line}\n`;
}

class ConversationMemory {
  constructor(state = {}) {
    this.entries = Array.isArray(state.entries) ? state.entries : []; // oldest first
    this.ruleFetches = Array.isArray(state.ruleFetches) ? state.ruleFetches : [];
    this.openQuestionId = state.openQuestionId || null;
  }

  static fromJSON(state) { return new ConversationMemory(state || {}); }

  toJSON() { return { entries: this.entries, ruleFetches: this.ruleFetches, openQuestionId: this.openQuestionId }; }

  setOpenQuestion(id) { this.openQuestionId = id || null; }

  openQuestion() { return this.openQuestionId; }

  rememberRules(args) {
    const f = ruleFetch(args);
    if (!Object.keys(f).length) return;
    const k = ruleKey(f);
    this.ruleFetches = this.ruleFetches.filter((x) => ruleKey(x) !== k).concat([f]).slice(-MAX_RULE_FETCHES);
  }

  rules() { return this.ruleFetches.map((f) => ({ ...f })); }

  lookup(query, asker) {
    const e = this.entries.find((x) => x.key === keyOf(query));
    return e && e.result !== null && e.asker === asker ? e.result : null;
  }

  remember(query, asker, question, result) {
    if (!cacheable(result)) return;
    const key = keyOf(query);
    const parts = metricBlanks(key) !== null ? exportParts(result) : [];
    const entry = { key, asker, question, result: result.length <= MAX_RESULT_CHARS ? result : null, exports: parts.length ? parts : null };
    this.entries = this.entries.filter((x) => x.key !== key).concat([entry]).slice(-MAX_ENTRIES);
  }

  exports() { return this.entries.flatMap((e) => e.exports || []); }

  /** The "Queries already run in this thread" block, newest kept when the size cap bites. */
  context() {
    if (!this.entries.length) return '';
    const blocks = [];
    let size = 0;
    for (const e of [...this.entries].reverse()) {
      const compiled = metricBlanks(e.key) !== null;
      let payload = null;
      if (e.result !== null) { try { payload = JSON.parse(e.result); } catch (_) { payload = null; } }
      let block = `Asked: ${e.question || '(not recorded)'}\n`;
      block += compiled ? metricCallLine(e.key, payload) : `SQL: ${e.key}\n`;
      if (payload) {
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        block += `Result: ${payload.total_rows ?? rows.length} rows; first rows: ${JSON.stringify(rows.slice(0, CONTEXT_ROWS))}\n`;
      } else {
        block += `Result: too large to keep — re-run this ${compiled ? 'call' : 'SQL'} if you need it.\n`;
      }
      if (size + block.length > CONTEXT_CHARS) break;
      blocks.push(block);
      size += block.length;
    }
    blocks.reverse();
    return `## Queries already run in this thread — their figures are the record\n\n${blocks.join('\n')}`;
  }
}

module.exports = { ConversationMemory, metricKey, normaliseSql, exportParts, stableStringify };
