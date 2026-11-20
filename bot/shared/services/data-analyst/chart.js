'use strict';
/**
 * An answer's chart, as a PNG for WhatsApp (the operator, 21 Nov: "show visualizations rather than
 * char msgs for actual data").
 *
 * Nothing here is new design. WHICH result is drawn follows the data team's own rules
 * (charting/select.py and slackbot/charts.py: refusals, column roles, the total-row backstop, the
 * shape table, trend first); HOW it is drawn is their Data Studio's SVG (studio/svg.py, the
 * house theme: a trend is a line with halftone dots under it, a breakdown is a row of track
 * bars each ending in a station). Every number on the picture came from a query payload. The card
 * around it is rendered by the bot's own htmlToImage (Chromium, base64 fonts, as the observe and
 * quiz cards are). Every path here returns "no chart" rather than throw: a chart is never worth an
 * answer.
 */

const fs = require('fs');
const path = require('path');

const MAX_BAR_ROWS = 12;
const MIN_BAR_ROWS = 2;
const MAX_GROUPED_ROWS = 8;
const MAX_GROUPED_SERIES = 3;
const MIN_TREND_ROWS = 3;
const MAX_TREND_SERIES = 3;
const KIND_RANK = { trend: 0, bar_h: 1, grouped_bar: 2 };

const PERSON_ENTITIES = ['teacher', 'student', 'user', 'father', 'mother', 'parent', 'guardian', 'child', 'coach',
  'observer', 'assessor', 'enumerator', 'head_teacher', 'person', 'employee', 'staff', 'principal', 'respondent',
  'member', 'asker', 'leader', 'mentor', 'supervisor', 'pupil', 'applicant'];
const PERSON_NAME_COLUMNS = new Set(['name', 'full_name', 'first_name', 'last_name', 'teacher_name_urdu',
  ...PERSON_ENTITIES.map((e) => `${e}_name`)]);
const CONTACT_TOKENS = ['phone', 'mobile', 'cnic', 'nic_no', 'email', 'whatsapp', 'b_form', 'bform', 'roll_number',
  'contact', 'password', 'token', 'user_key', 'aeo_id_taleemhub', 'registration_no'];
const ID_EXACT = new Set(['id', 'emis', 'cnic', 'uuid', 'event_id', 'session_id', 'task_id', 'emis_code', 'school_emis',
  'user_key', 'pefsis_student_id']);
const ID_SUFFIXES = ['_id', '_uuid', '_emis', '_key'];
const DATE_NAME = /(^|_)(date|day|days|week|weeks|month|months|quarter|year|years|period|bucket|ts|timestamp|at)$/;
const DATE_VALUE = /^\d{4}-\d{2}(-\d{2})?([T ].*)?$/;
const MASKED_VALUE = /(•{2,}\d{2,}|<redacted)/i;
const TOTAL_LABELS = new Set(['total', 'all', 'overall', 'combined', 'sum', 'any', 'everything', 'all paths',
  'all sectors', 'all types', 'grand total', '-', '—', '*', '']);
const CHANGE_COLUMNS = new Set(['change', 'change_pct']);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- selection (their charting/select.py) --------------------------------------------------------

function refusal(payload) {
  if (payload.truncated) return 'truncated';
  if (payload.sql_limit !== undefined && payload.sql_limit !== null) return 'sql_limit';
  const p = payload.policy;
  if (isObj(p)) {
    const cells = Number(p.redacted_cells || 0);
    if ((p.redacted_columns || []).length || (p.newly_detected || []).length || cells || Number.isNaN(cells)) return 'policy_redaction';
  }
  return null;
}

function columnsOf(rows) {
  if (!Array.isArray(rows) || !rows.length || !rows.every((r) => isObj(r) && Object.keys(r).length)) return null;
  const first = Object.keys(rows[0]);
  const keys = new Set(first);
  if (rows.some((r) => Object.keys(r).length !== keys.size || Object.keys(r).some((k) => !keys.has(k)))) return null;
  return first;
}

const isPersonColumn = (c) => { const l = c.trim().toLowerCase(); return PERSON_NAME_COLUMNS.has(l) || CONTACT_TOKENS.some((t) => l.includes(t)); };
const isIdColumn = (c) => { const l = c.trim().toLowerCase(); return ID_EXACT.has(l) || ID_SUFFIXES.some((s) => l.endsWith(s)); };
const isDateColumn = (c, rows) => DATE_NAME.test(c.trim().toLowerCase())
  || rows.every((r) => typeof r[c] === 'string' && DATE_VALUE.test(r[c]));

function classifyColumns(columns, rows) {
  if (columns.some(isPersonColumn) || columns.some(isIdColumn)) return null;
  const labels = [];
  const numeric = [];
  for (const c of columns) {
    if (isDateColumn(c, rows)) labels.push([c, true]);
    else if (rows.every((r) => isNumber(r[c]))) numeric.push(c);
    else labels.push([c, false]);
  }
  if (labels.length > 1 || !numeric.length) return null;
  return labels.length ? { label: labels[0][0], isDate: labels[0][1], numeric } : { label: null, isDate: false, numeric };
}

function withoutTotalRow(rows, label, isDate, numeric) {
  if (isDate || !label || rows.length < 3 || !numeric.length) return rows;
  const candidates = [];
  rows.forEach((row, i) => {
    const others = numeric.map((c) => rows.reduce((s, r, j) => (j === i ? s : s + Number(r[c])), 0));
    const mine = numeric.map((c) => Number(row[c]));
    if (mine.every((v, k) => v === others[k])) candidates.push(i);
  });
  return candidates.length === 1 ? rows.filter((_, j) => j !== candidates[0]) : rows;
}

function kindOf(n, hasLabel, isDate, nSeries) {
  if (n === 1 || !hasLabel) return null;
  if (isDate && n >= MIN_TREND_ROWS && nSeries >= 1 && nSeries <= MAX_TREND_SERIES) return 'trend';
  if (nSeries === 1 && n >= MIN_BAR_ROWS && n <= MAX_BAR_ROWS) return 'bar_h';
  if (nSeries >= 2 && nSeries <= MAX_GROUPED_SERIES && n >= MIN_BAR_ROWS && n <= MAX_GROUPED_ROWS) return 'grouped_bar';
  return null;
}

const ACRONYMS = new Set(['fico', 'dc', 'hitl', 'ict', 'lp', 'lps', 'niete', 'ai']);

/** A column name as a reader says it: dc_pct → "DC %", fico_score → "FICO score". */
function humanise(name) {
  const words = String(name).replace(/_/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : (/^(pct|percent)$/i.test(w) ? '%' : w)));
  const t = words.join(' ');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** A query_metric payload as a chart reads it (their _chart_form): measures under their labels, no change columns. */
function chartForm(payload) {
  if (!Array.isArray(payload.rows)) return payload;
  const labels = {};
  for (const m of Array.isArray(payload.measures) ? payload.measures : []) {
    if (isObj(m) && typeof m.name === 'string' && typeof m.label === 'string' && m.label.trim()) labels[m.name] = m.label.trim();
  }
  const names = {};
  for (const [n, l] of Object.entries(labels)) {
    if (payload.compare_period) {
      names[n] = `${l}, ${payload.period || 'this period'}`;
      names[`${n}_compare`] = `${l}, ${payload.compare_period}`;
    } else names[n] = l;
  }
  const rows = payload.rows.map((row) => {
    if (!isObj(row)) return row;
    const kept = Object.keys(row).filter((k) => !CHANGE_COLUMNS.has(k));
    const renamed = kept.map((k) => names[k] || k);
    const use = new Set(renamed).size < renamed.length ? kept : renamed;
    return Object.fromEntries(kept.map((k, i) => [use[i], row[k]]));
  });
  return { ...payload, rows };
}

function titleFor(question, numeric, label) {
  const q = String(question || '').trim();
  if (q.split(/\s+/).length >= 4 && q.length <= 110) return q.replace(/[?.!]+$/, '');
  const measures = numeric.map((n) => humanise(n).toLowerCase()).join(' and ');
  const t = label ? `${measures} by ${humanise(label).toLowerCase()}` : measures;
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

const SCORE_NAME = /(pct|percent|percentage|rate|score|share|avg|average|mean)/i;

/**
 * Ours, not theirs: a trend the model wrote in LONG form (a date, a kind, a measure: FICO by month and coaching
 * kind) is one line per kind. Narrow on purpose: exactly two label columns, one of them a date; at most three
 * kinds; every (date, kind) present exactly once, so nothing is invented; one measure, or the one score-like
 * measure among several (a share drawn beside a count reads as a count). Anything else is left as text.
 */
function pivotLong(columns, rows, question) {
  const labels = [];
  const numeric = [];
  for (const c of columns) {
    if (isDateColumn(c, rows)) labels.push([c, true]);
    else if (rows.every((r) => isNumber(r[c]))) numeric.push(c);
    else labels.push([c, false]);
  }
  if (labels.length !== 2 || labels.filter((l) => l[1]).length !== 1 || !numeric.length) return null;
  if (columns.some(isPersonColumn) || columns.some(isIdColumn)) return null;
  const dateCol = labels.find((l) => l[1])[0];
  const kindCol = labels.find((l) => !l[1])[0];
  const measure = numeric.length === 1 ? numeric[0] : (numeric.filter((c) => SCORE_NAME.test(c)).length === 1 ? numeric.find((c) => SCORE_NAME.test(c)) : null);
  if (!measure) return null;
  const dates = [...new Set(rows.map((r) => String(r[dateCol])))].sort();
  const kinds = [...new Set(rows.map((r) => String(r[kindCol])))];
  if (kinds.length < 2 || kinds.length > MAX_TREND_SERIES || dates.length < MIN_TREND_ROWS) return null;
  if (rows.length !== dates.length * kinds.length) return null;
  const cell = new Map(rows.map((r) => [`${r[dateCol]}\u0000${r[kindCol]}`, Number(r[measure])]));
  if (cell.size !== rows.length) return null;
  const series = kinds.map((k) => [k, dates.map((d) => cell.get(`${d}\u0000${k}`))]);
  if (series.some(([, v]) => v.some((x) => !Number.isFinite(x)))) return null;
  return { kind: 'trend', title: titleFor(question, [measure], dateCol), labels: dates, series, subtitle: humanise(measure) };
}

function selectChart(payload, question) {
  try {
    if (!isObj(payload) || (payload.status !== undefined && payload.status !== 'ok')) return null;
    if (refusal(payload)) return null;
    let rows = payload.rows;
    let columns = columnsOf(rows);
    if (!columns) return null;
    const roles = classifyColumns(columns, rows);
    if (!roles) return pivotLong(columns, rows, question);
    rows = withoutTotalRow(rows, roles.label, roles.isDate, roles.numeric);
    columns = columnsOf(rows);
    if (!columns) return null;
    const labels = roles.label ? rows.map((r) => (r[roles.label] === null || r[roles.label] === undefined ? '' : String(r[roles.label]))) : [];
    if (labels.some((t) => MASKED_VALUE.test(t))) return null;
    const kind = kindOf(rows.length, Boolean(roles.label), roles.isDate, roles.numeric.length);
    if (!kind) return null;
    return {
      kind,
      title: titleFor(question, roles.numeric, roles.label),
      labels,
      series: roles.numeric.map((c) => [humanise(c), rows.map((r) => Number(r[c]))]),
      subtitle: [payload.period, payload.what_was_counted].filter((x) => typeof x === 'string' && x.trim()).join(' · '),
    };
  } catch (_) {
    return null;
  }
}

/** Every chartable result of an answer's queries, trend first (their chart_specs ranking). */
function chartSpecs(calls, question) {
  const specs = [];
  for (const c of calls || []) {
    if (!c || (c.name !== 'execute_query' && c.name !== 'query_metric')) continue;
    let p;
    try { p = JSON.parse(c.result || ''); } catch (_) { continue; }
    if (!isObj(p)) continue;
    const spec = selectChart(c.name === 'query_metric' ? chartForm(p) : p, question);
    if (spec) specs.push(spec);
  }
  return specs.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

// ---- drawing (their studio/svg.py, house theme) ---------------------------------------------------

const INK = '#1A1A1A';
const MUTE = '#767676';
const PANE = '#FFFFFF';
const COLOUR = '#3C62B4'; // the theme's "V" line: the logo's blue
const LATEST = '#1DC263';
const OTHERS = ['#A3A29C', '#C9C8C2', '#DDDCD6'];
const FONT = 'font-family="Lexend, Arial, sans-serif"';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = (n) => n.toFixed(1);

function fmt(v) {
  const n = Number(v);
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return Math.abs(n) < 1 ? n.toFixed(2) : n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function axisLabel(label) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(label || '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return label;
  return m[3] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * The y range of a trend. Their Studio draws every trend from zero, which flattens a score that
 * moves between 62 and 66 into one line at the top (seen on the FICO answer, 21 Nov). When every
 * value is positive and the spread is under half the peak, the axis is zoomed to the spread with
 * room for the labels; otherwise it is zero to the peak, as theirs.
 */
function trendRange(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  const peak = Math.max(...nums, 0) || 1;
  const low = Math.min(...nums);
  const spread = peak - low;
  if (!(low > 0) || spread >= peak / 2) return [0, peak];
  const pad = spread || peak * 0.05;
  return [Math.max(0, low - pad * 0.8), peak + pad * 0.35];
}

/** Every point of the first line is labelled (first and last only past eight); other lines, the last point. */
function labelled(k, i, n) {
  if (k === 0) return n <= 8 || i === 0 || i === n - 1;
  return i === n - 1;
}

function trendSvg(spec) {
  const labels = spec.labels.map(String);
  const series = spec.series.filter((s) => s[1].length);
  if (!series.length || series[0][1].length < 2) return '';
  const width = 720; const height = 260; const top = 18; const bottom = 30;
  const n = series[0][1].length;
  const [lo, hi] = trendRange(series.flatMap((s) => s[1]));
  const x = (i) => 16 + (i / (n - 1)) * (width - 32);
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (height - top - bottom);
  const first = series[0][1];
  const area = `M${f1(x(0))},${height - bottom} ${first.map((v, i) => `L${f1(x(i))},${f1(y(v))}`).join(' ')} L${f1(x(n - 1))},${height - bottom} Z`;
  const dots = [];
  for (let row = 0; row <= Math.floor((height - bottom - top) / 7); row += 1) {
    const cy = top - 4 + row * 7;
    const r = Math.max(0.3, 2.3 * (1 - (cy - top) / (height - bottom - top)));
    for (let cx = 8; cx < width - 8; cx += 7) dots.push(`<circle cx="${cx}" cy="${f1(cy)}" r="${f1(r)}"/>`);
  }
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(spec.title || '')}">`,
    `<defs><clipPath id="area"><path d="${area}"/></clipPath></defs><g clip-path="url(#area)" fill="${COLOUR}" fill-opacity=".55">${dots.join('')}</g>`];
  series.forEach(([, values], k) => {
    const stroke = k === 0 ? COLOUR : OTHERS[Math.min(k - 1, OTHERS.length - 1)];
    parts.push(`<polyline points="${values.slice(0, n).map((v, i) => `${f1(x(i))},${f1(y(v))}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`);
    values.slice(0, n).forEach((v, i) => {
      const last = i === n - 1 && k === 0;
      parts.push(`<circle cx="${f1(x(i))}" cy="${f1(y(v))}" r="${last ? 5.5 : 4}" fill="${last ? LATEST : PANE}" stroke="${INK}" stroke-width="1.8"/>`);
      if (!labelled(k, i, n)) return;
      const above = series.every(([, o], j) => j === k || !(i < o.length) || v >= o[i]);
      parts.push(`<text x="${f1(x(i))}" y="${f1(above ? y(v) - 11 : y(v) + 22)}" text-anchor="${i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle')}" ${FONT} font-weight="600" font-size="13" fill="${k === 0 ? INK : MUTE}">${esc(fmt(v))}</text>`);
    });
  });
  const ticks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  for (const i of ticks) {
    if (i < labels.length) parts.push(`<text x="${f1(x(i))}" y="${height - 8}" text-anchor="${i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle')}" ${FONT} font-weight="600" font-size="12.5" fill="${MUTE}">${esc(axisLabel(labels[i]))}</text>`);
  }
  if (series.length > 1) {
    let x0 = 16;
    series.forEach(([name], k) => {
      const fill = k === 0 ? COLOUR : OTHERS[Math.min(k - 1, OTHERS.length - 1)];
      parts.splice(1, 0, `<rect x="${x0}" y="0" width="10" height="10" rx="5" fill="${fill}"/><text x="${x0 + 15}" y="9" ${FONT} font-size="12" fill="${MUTE}">${esc(name)}</text>`);
      x0 += 26 + 7.5 * name.length;
    });
  }
  parts.push('</svg>');
  return parts.join('');
}

function barsSvg(spec) {
  const labels = spec.labels.map(String);
  const series = spec.series.filter((s) => s[1].length);
  if (!series.length || !labels.length) return '';
  const groups = series.length;
  const rowH = 24 + 14 * groups;
  const width = 720; const left = 150; const right = 70;
  const offset = groups > 1 ? 22 : 0;
  const height = rowH * labels.length + 10 + offset;
  const peak = Math.max(...series.flatMap((s) => s[1])) || 1;
  const span = width - left - right;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(spec.title || '')}">`];
  if (groups > 1) {
    let x0 = left;
    series.forEach(([name], k) => {
      const fill = k === 0 ? COLOUR : OTHERS[Math.min(k - 1, OTHERS.length - 1)];
      parts.push(`<rect x="${x0}" y="3" width="10" height="10" rx="5" fill="${fill}"/><text x="${x0 + 15}" y="12" ${FONT} font-size="12" fill="${MUTE}">${esc(name)}</text>`);
      x0 += 26 + 7.5 * name.length;
    });
  }
  labels.forEach((label, r) => {
    const base = offset + r * rowH + 16;
    parts.push(`<text x="0" y="${base + 5 + 7 * (groups - 1)}" ${FONT} font-weight="600" font-size="14" fill="${INK}">${esc(label)}</text>`);
    series.forEach(([, values], k) => {
      if (r >= values.length) return;
      const v = values[r];
      const fill = k === 0 ? COLOUR : OTHERS[Math.min(k - 1, OTHERS.length - 1)];
      const length = Math.max(2, (v / peak) * span);
      const cy = base + k * 14;
      parts.push(`<rect class="bar" x="${left}" y="${f1(cy - 3.5)}" width="${f1(length)}" height="7" rx="3.5" fill="${fill}"/>`);
      if (k === 0) parts.push(`<circle cx="${f1(left + length)}" cy="${f1(cy)}" r="7" fill="${PANE}" stroke="${INK}" stroke-width="2"/>`);
      parts.push(`<text x="${width}" y="${f1(cy + 5)}" text-anchor="end" ${FONT} font-weight="${k === 0 ? 600 : 400}" font-size="13.5" fill="${k === 0 ? INK : MUTE}">${esc(fmt(v))}</text>`);
    });
  });
  parts.push('</svg>');
  return parts.join('');
}

/** One chart as SVG, or '' when there is nothing drawable. */
function chartSvg(spec) {
  try {
    if (!spec) return '';
    if (spec.kind === 'trend') return trendSvg(spec);
    if (spec.kind === 'bar_h' || spec.kind === 'grouped_bar') return barsSvg(spec);
  } catch (_) { /* nothing drawable */ }
  return '';
}

// ---- the card, rendered (the bot's own htmlToImage) -----------------------------------------------

let fontCss = null;
function fonts() {
  if (fontCss !== null) return fontCss;
  const read = (f) => { try { return fs.readFileSync(path.join(__dirname, '..', '..', 'fonts', f)).toString('base64'); } catch (_) { return ''; } };
  const r = read('Lexend-Regular.ttf'); const b = read('Lexend-Bold.ttf');
  fontCss = [r && `@font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${r})}`,
    b && `@font-face{font-family:'Lexend';font-weight:600 700;src:url(data:font/ttf;base64,${b})}`].filter(Boolean).join('');
  return fontCss;
}

function chartCardHtml(spec, { footer = '' } = {}) {
  const svg = chartSvg(spec);
  if (!svg) return '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts()}
*{box-sizing:border-box;margin:0}body{background:#fff}
.card{width:760px;padding:28px 20px 18px;background:#fff;font-family:Lexend,Arial,sans-serif;color:${INK};border-top:6px solid ${COLOUR}}
h1{font-size:24px;font-weight:700;line-height:1.25;margin-bottom:6px}
.sub{font-size:15px;color:${MUTE};margin-bottom:18px}
.chart svg{width:100%;height:auto;display:block}
.foot{margin-top:14px;font-size:13px;color:${MUTE};border-top:1px solid #E6E4DE;padding-top:10px}
</style></head><body><div class="card"><h1>${esc(spec.title || '')}</h1>${spec.subtitle ? `<div class="sub">${esc(spec.subtitle)}</div>` : ''}<div class="chart">${svg}</div>${footer ? `<div class="foot">${esc(footer)}</div>` : ''}</div></body></html>`;
}

/**
 * @param {object} spec from chartSpecs
 * @param {{footer?: string, render?: (html: string, opts: object) => Promise<Buffer>}} [opts]
 * @returns {Promise<Buffer|null>} the PNG, or null when there is no chart to send
 */
async function renderChartPng(spec, { footer = '', render } = {}) {
  try {
    const html = chartCardHtml(spec, { footer });
    if (!html) return null;
    const draw = render || require('../../utils/html-to-pdf').htmlToImage;
    const png = await draw(html, { width: 800, selector: '.card', deviceScaleFactor: 2 });
    return Buffer.isBuffer(png) && png.length ? png : null;
  } catch (_) {
    return null;
  }
}

module.exports = { chartSpecs, selectChart, chartSvg, chartCardHtml, renderChartPng, fmt, trendRange };
