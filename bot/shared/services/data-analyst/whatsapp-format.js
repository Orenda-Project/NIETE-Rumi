'use strict';
/**
 * One governed answer as WhatsApp messages.
 *
 * The data team's answering.py says it plainly: the model's prose is not yet safe to show, and a
 * second surface must add what their Slack renderer adds from the transcript. So here, from the tool
 * results and never from the prose: links the model made up are removed, the disclosures their
 * formatting.disclosures() computes (truncation, a LIMIT, the serving policy word for word, data-rule
 * warnings, a compiled figure's notes) are appended, and an incomplete answer says so.
 *
 * Then what WhatsApp needs: *single-asterisk* bold, no headings or tables, a footer (NIETE data ·
 * the window the queries asked about · the rules version get_rules reported), the NEXT line and any
 * ASK lines as numbered choices a reply of 1, 2, 3 can pick, and messages under 4,096 characters.
 */

const { identifiers_note: IDENTIFIERS_NOTE } = require('./vendor/data-mcp-contract.json');

const MAX_MESSAGE = 4096;
const MAX_NEXT = 3;
const MAX_NEXT_CHARS = 200;
const NEXT_LOOKBACK = 3;
const SHOWN_ROWS = 100;
const NARROWER = 'Ask for a narrower breakdown or filter to see the rest.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BEYOND_IDENTIFIERS = ['redacted_columns', 'newly_detected', 'minor_pii_tables', 'free_text_columns', 'dropped_columns', 'redacted_cells'];
const KIND_STEMS = [['investigat', 'investigate'], ['predict', 'predict'], ['forecast', 'predict'], ['analy', 'analyze'], ['detect', 'detect']];

const NEXT_LINE = /^\W*next\W*:\s*(.+)$/i;
const TAG = /^\[\s*([a-z]+)\s*\]\s*(.+)$/i;
// The same kind written without brackets, as a model does on a live run ("analyze Does it …", "(detect) …",
// "predict: …", "**investigate** …"): only the five kind words themselves, so "Detected gaps" stays a question.
const LOOSE_TAG = /^[(*_`]*\s*(investigate|predict|forecast|analy[sz]e|detect)\s*[)*_`]*\s*[:—–-]?\s+(.+)$/i;
const SUGGESTION_SHAPE = /^\W*\[\s*[a-z]+\s*\]|\|/i;
const UNSAFE = /[<>]|https?:|www\.|@/i;
const ASK = /^[\s`*_>-]*ask[*_]*\s*:\s*(.+?)[\s`]*$/i;
const URL_RE = /https?:\/\/[^\s<>|)"'\]]+/g;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const parse = (t) => { try { return JSON.parse(t); } catch (_) { return undefined; } };
const strip = (s, chars) => { let x = s; while (x && chars.includes(x[0])) x = x.slice(1); while (x && chars.includes(x[x.length - 1])) x = x.slice(0, -1); return x; };
const fmt = (n) => Number(n).toLocaleString('en-US');

// ---- the NEXT line (their next_questions.split_suggestions) and ASK lines (their clarify.split_asks)

function nextLineAt(lines) {
  const filled = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  if (!filled.length) return null;
  const last = filled[filled.length - 1];
  if (NEXT_LINE.test(lines[last].trim())) return last;
  for (const i of filled.slice(-1 - NEXT_LOOKBACK, -1).reverse()) {
    const m = lines[i].trim().match(NEXT_LINE);
    if (m && SUGGESTION_SHAPE.test(m[1])) return i;
  }
  return null;
}

function kindOf(tag) {
  const t = tag.toLowerCase();
  const hit = KIND_STEMS.find(([stem]) => t.startsWith(stem));
  return hit ? hit[1] : '';
}

/** {body, next: [{kind, question}]}: the answer without its NEXT line, and the suggestions on it. */
function splitNext(text) {
  const lines = String(text || '').replace(/\s+$/, '').split('\n');
  const at = nextLineAt(lines);
  if (at === null) return { body: text, next: [] };
  const rest = lines[at].trim().match(NEXT_LINE)[1];
  const body = lines.slice(0, at).concat(lines.slice(at + 1)).join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  const next = [];
  for (const raw of rest.split('|')) {
    const item = strip(raw.trim(), ' \t*_`"\'');
    const tagged = item.match(TAG) || item.match(LOOSE_TAG);
    const kind = tagged ? kindOf(tagged[1]) : '';
    const q = strip((tagged ? tagged[2] : item).trim(), ' \t*_`"\'');
    if (q) next.push({ kind, question: q });
  }
  return { body, next };
}

/** {body, asks: [{question, options}]}: an ASK line names at least two options, else it stays prose. */
function splitAsks(text) {
  const keep = [];
  const asks = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(ASK);
    const parts = m ? m[1].split('|').map((p) => strip(p.trim(), ' `*_')) : [];
    const options = parts.slice(1).filter(Boolean).map((o) => o.slice(0, 90));
    if (options.length < 2) { keep.push(line); continue; }
    if (asks.length < 4) asks.push({ question: parts[0].slice(0, 160), options: [...new Set(options)].slice(0, 6) });
  }
  return { body: keep.join('\n').trim(), asks };
}

function cleanNext(next, asked) {
  const norm = (t) => String(t || '').toLowerCase().replace(/[^0-9a-z]+/g, ' ').trim();
  const seen = new Set([norm(asked)]);
  const out = [];
  for (const n of next) {
    const key = norm(n.question);
    if (!key || seen.has(key) || n.question.length > MAX_NEXT_CHARS || UNSAFE.test(n.question)) continue;
    seen.add(key);
    out.push(n);
    if (out.length === MAX_NEXT) break;
  }
  return out;
}

// ---- WhatsApp text --------------------------------------------------------------------------------

function urlsIn(text) { return new Set(String(text || '').match(URL_RE) || []); }

function urlsInResults(calls) {
  const out = new Set();
  for (const c of calls || []) for (const u of urlsIn(c && c.result)) out.add(u);
  return out;
}

/** Slack/GitHub markup to WhatsApp's; a link the model composed (not from a tool or the asker) goes. */
function toWhatsApp(text, knownUrls = new Set()) {
  const keepLink = (url, label) => {
    const l = (label || '').trim();
    if (!knownUrls.has(url)) return l;
    return l && l !== url ? `${l}: ${url}` : url;
  };
  let t = String(text || '');
  t = t.split('\n').filter((line) => !/^\s*\|.*\|\s*$/.test(line)).join('\n');
  t = t.replace(/<(https?:\/\/[^|>\s]+)\|([^>]*)>/g, (_, url, label) => keepLink(url, label));
  t = t.replace(/<(https?:\/\/[^|>\s]+)>/g, (_, url) => keepLink(url, ''));
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => keepLink(url, label));
  t = t.replace(URL_RE, (url) => (knownUrls.has(url) ? url : ''));
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '*$1*');
  t = t.replace(/__([^_\n]+)__/g, '_$1_');
  t = t.replace(/^#{1,6}\s+(.+?)\s*#*\s*$/gm, '*$1*');
  t = t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

// ---- disclosures (their formatting.disclosures, without the CSV offers WhatsApp cannot keep) -----

function served(calls) {
  const out = [];
  for (const c of calls || []) {
    if (c.name !== 'execute_query' && c.name !== 'query_metric') continue;
    const p = parse(c.result || '');
    if (!isObj(p)) continue;
    out.push({ tool: c.name, label: null, payload: p });
    if (c.name === 'query_metric' && Array.isArray(p.served_with)) {
      for (const e of p.served_with) {
        if (isObj(e) && e.status !== 'skipped' && e.status !== undefined && e.status !== null) {
          const label = e.label || e.metric;
          out.push({ tool: c.name, label: label ? String(label) : '', payload: e });
        }
      }
    }
  }
  return out;
}

const texts = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);

function compiledWords(results) {
  const said = new Set(results.filter((r) => r.tool === 'query_metric' && r.label === null).flatMap((r) => texts(r.payload.notes)));
  const lines = [];
  for (const { tool, label, payload } of results) {
    if (tool !== 'query_metric') continue;
    const what = payload.what_was_counted;
    if (payload.must_state_which === true && typeof what === 'string' && what.trim()) {
      const w = what.trim().replace(/\.+$/, '');
      lines.push(label === null ? `What this counts: ${w}.` : `What ${label} counts: ${w}.`);
    }
    for (const note of texts(payload.notes)) {
      if (label === null) lines.push(note);
      else if (!said.has(note)) lines.push(label ? `${label}: ${note}` : note);
    }
  }
  return lines;
}

/** Their "this contains real people" sentence (engine/serving_policy.identifiers_note), from the vendored contract. */
function identifiersNote(columns) {
  const shown = columns.slice(0, 6).join(', ');
  const more = columns.length <= 6 ? '' : ` +${columns.length - 6} more`;
  return IDENTIFIERS_NOTE.replace('{columns}', () => `${shown}${more}`);
}

function disclosures(calls) {
  const notes = [];
  const identifiers = [];
  const results = served(calls);
  for (const { tool, label, payload } of results) {
    const blocked = payload.message;
    if (tool === 'query_metric' && payload.error_class === 'POLICY_BLOCKED' && typeof blocked === 'string' && blocked.trim()) {
      notes.push(label ? `🔒 ${label}: ${blocked.trim()}` : `🔒 ${blocked.trim()}`);
    }
    const total = payload.total_rows;
    if (payload.truncated && Number.isInteger(total)) {
      const shown = Number.isInteger(payload.rows_shown) ? payload.rows_shown : SHOWN_ROWS;
      const exp = payload.export;
      const why = tool === 'query_metric' && isObj(exp) && exp.allowed !== true && typeof exp.why === 'string' && exp.why.trim() ? exp.why.trim() : NARROWER;
      notes.push(`⚠️ Showing the first ${fmt(shown)} of ${fmt(total)} rows (preview). ${why}`);
    }
    if (payload.sql_limit !== undefined && payload.sql_limit !== null) {
      notes.push(`⚠️ This query was capped by a LIMIT of ${fmt(payload.sql_limit)} — not the complete dataset.`);
    }
    const policy = payload.policy;
    if (isObj(policy) && policy.must_disclose) {
      const note = policy.note || 'a data-serving policy filter was applied to this result.';
      const onlyIdentifiers = !!(policy.identifiers_served && policy.identifiers_served.length) && !BEYOND_IDENTIFIERS.some((f) => {
        const v = policy[f]; return Array.isArray(v) ? v.length > 0 : !!v;
      });
      if (onlyIdentifiers) identifiers.push(...policy.identifiers_served);
      else notes.push(`🔒 ${note}`);
    }
    if (Array.isArray(payload.governance_warnings)) {
      for (const w of payload.governance_warnings) notes.push(`⚠️ Data rule: ${w}`);
    }
    if (payload.warning) notes.push(`⚠️ ${payload.warning}`);
  }
  notes.push(...compiledWords(results));
  if (identifiers.length) notes.push(`🔒 ${identifiersNote([...new Set(identifiers)])}`);
  return [...new Set(notes)];
}

// ---- footer ---------------------------------------------------------------------------------------

// A date after a strict "<" is the first day NOT counted (`created_at < '2026-11-21'` ends on the 20th).
const EXCLUSIVE_END = /<(?!=)\s*(?:(?:DATE|TIMESTAMP|DATETIME)\s*\(?\s*)?'(\d{4}-\d{2}-\d{2})/gi;
const dayBefore = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** The absolute dates one query asked about (their tools.query_dates), or null for a non-query. A strict "<" end
 *  date counts as the day before it, for the footer's window. */
function queryDates(call) {
  const args = (call && call.arguments) || {};
  if (call.name === 'execute_query') {
    if (typeof args.sql !== 'string') return null;
    const exclusive = new Set([...args.sql.matchAll(EXCLUSIVE_END)].map((m) => m[1]));
    return (args.sql.match(ISO_DATE) || []).map((d) => (exclusive.has(d) ? dayBefore(d) : d));
  }
  if (call.name === 'query_metric') {
    return ['from_date', 'to_date', 'compare_from', 'compare_to'].map((k) => args[k]).filter((d) => typeof d === 'string' && ISO_DATE_ONLY.test(d));
  }
  return null;
}

function humanWindow(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (from === to) return `${fd} ${MONTHS[fm - 1]} ${fy}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy === ty) return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${fd} ${MONTHS[fm - 1]} ${fy} – ${td} ${MONTHS[tm - 1]} ${ty}`;
}

function rulesVersion(calls) {
  let v = '';
  for (const c of calls || []) {
    if (c.name !== 'get_rules') continue;
    const p = parse(c.result || '');
    if (isObj(p) && typeof p.rule_version === 'string' && p.rule_version.trim()) v = p.rule_version.trim();
  }
  return v;
}

const karachiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** `_NIETE data · 7–13 Nov 2026 · rules v0.42.5_`, or '' when no query ran. Nothing runs past today. */
function footer(calls, { today = karachiToday() } = {}) {
  const dated = (calls || []).map((c) => (c ? queryDates(c) : null)).filter((d) => d !== null);
  if (!dated.length) return '';
  const dates = [...new Set(dated.flat().map((d) => (d > today ? today : d)))].sort();
  const parts = ['NIETE data'];
  if (dates.length) parts.push(humanWindow(dates[0], dates[dates.length - 1]));
  const v = rulesVersion(calls);
  if (v) parts.push(`rules ${v}`);
  return `_${parts.join(' · ')}_`;
}

// ---- messages ---------------------------------------------------------------------------------------

function chunk(text, limit = MAX_MESSAGE) {
  const out = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let at = -1;
    for (const sep of ['\n\n', '\n', ' ']) {
      at = window.lastIndexOf(sep);
      if (at > limit / 2) break;
      at = -1;
    }
    if (at <= 0) at = limit;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

const INCOMPLETE = '⚠️ This answer is incomplete: I stopped before I finished looking.';

/**
 * @param {{text: string, calls: object[], stoppedEarly?: boolean, knownText?: string, asked?: string}} a
 * @returns {{messages: string[], choices: string[], body: string}}
 */
function renderAnswer({ text, calls = [], stoppedEarly = false, knownText = '', asked = '' }) {
  const { body: withoutAsks, asks } = splitAsks(text);
  const { body: raw, next } = splitNext(withoutAsks);
  const known = new Set([...urlsInResults(calls), ...urlsIn(knownText)]);
  const body = toWhatsApp(raw, known);
  const sections = [];
  if (stoppedEarly) sections.push(INCOMPLETE);
  if (body) sections.push(body);
  const notes = disclosures(calls);
  if (notes.length) sections.push(notes.join('\n'));
  const foot = footer(calls);
  if (foot) sections.push(foot);

  const choices = [];
  if (asks.length) {
    for (const a of asks) {
      const lines = a.question ? [`*${a.question}*`] : [];
      const q = a.question.replace(/[?:\s]+$/, '').trim();
      for (const o of a.options) {
        choices.push(q ? `${q}: ${o}` : o);
        lines.push(`${choices.length}. ${o}`);
      }
      sections.push(lines.join('\n'));
    }
  } else {
    const picked = stoppedEarly ? [] : cleanNext(next, asked);
    if (picked.length) {
      const lines = ['Ask next (reply with a number):'];
      for (const n of picked) { choices.push(n.question); lines.push(`${choices.length}. ${n.question}`); }
      sections.push(lines.join('\n'));
    }
  }
  return { messages: chunk(sections.join('\n\n')), choices, body };
}

const MAX_BODY = 1024; // an interactive message's body (buttons, image header) refuses anything longer
const NEXT_STEP = 'Ask another question, or go back to the main menu.';

/**
 * Round 2 (the operator, 21 Nov): one answer bubble with buttons. With a chart, its caption is the headline and
 * at most one more line (the chart carries the breakdown), then the disclosures and the footer; without one, the
 * whole answer. Anything longer than one bubble goes first as plain text, and the buttons get a short line.
 * A clarifying question returns its options for the caller to offer as taps.
 * @returns {{caption: string, before: string[], asks: object[], body: string}}
 */
function composeReply({ text, calls = [], stoppedEarly = false, knownText = '', hasChart = false, rest = [] }) {
  const { body: withoutAsks, asks } = splitAsks(text);
  const { body: raw } = splitNext(withoutAsks);
  const known = new Set([...urlsInResults(calls), ...urlsIn(knownText)]);
  const body = toWhatsApp(raw, known);
  if (asks.length) return { caption: body.slice(0, MAX_BODY), before: [], asks, body };
  // Beside a chart: the headline and one more line, never the model's own bullets (the chart is the breakdown).
  const lead = hasChart ? body.split('\n').filter((l) => l.trim() && !/^\s*(?:[•·\-–]|\d+[.)])\s/.test(l) && !/:\s*$/.test(l)).slice(0, 2).join('\n') : body;
  // bd-bhgw20.4: beside a chart, the measures it leaves out; with no chart, every row of the breakdown.
  // One line per row under the text, from the data itself, never dropped.
  const listed = Array.isArray(rest) ? rest.filter((l) => typeof l === 'string' && l.trim()) : [];
  const shown = listed.length ? `${lead}\n\n${listed.join('\n')}` : lead;
  const head = [stoppedEarly ? INCOMPLETE : '', shown].filter(Boolean);
  const notes = disclosures(calls);
  const foot = footer(calls);
  const all = [...head, notes.length ? notes.join('\n') : '', foot].filter(Boolean).join('\n\n');
  if (all.length <= MAX_BODY) return { caption: all, before: [], asks: [], body };
  const opening = [...head, notes.length ? notes.join('\n') : ''].filter(Boolean).join('\n\n');
  return { caption: (foot ? `${foot}\n\n${NEXT_STEP}` : NEXT_STEP).slice(0, MAX_BODY), before: chunk(opening), asks: [], body };
}

module.exports = { splitNext, splitAsks, toWhatsApp, disclosures, footer, renderAnswer, composeReply, chunk, queryDates };
