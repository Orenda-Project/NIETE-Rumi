#!/usr/bin/env node
'use strict';

/**
 * bd-qix9oh.6 — FICO17 v6 replay on real lessons (deploy spec §10.3, RULINGS Q3 and R14).
 *
 * Reads completed ICT /observe2 visits from production, READ-ONLY, scores each transcript twice with the production
 * models and settings, and compares both with the coach's final levels:
 *   DC prompt         the real fico17-v6-framework through shadow.scoreV6 (coaching.pedagogy, gpt-5-mini)
 *   moments + rules   the real /observe2 v3 moments prompt (observe2.moments, routed as production's llm_per_job says),
 *                     the quote and label checks, then rules.addUp with rubric 'fico17_v6'. No coach confirmation:
 *                     every moment Rumi found counts.
 * Both run after the transcript quality gate (observe/transcript-quality.js) with the visit's period.
 *
 * Lessons: the ten fixed ids of §10.3, then the next 20 completed /observe2 visits by md5(id) that are v5 visits
 * in a programme school, by no test account, with a transcript of at least 8,000 characters. In SQL:
 *
 *   SELECT cs.id FROM coaching_sessions cs
 *   JOIN observation_field_forms f ON f.coaching_session_id = cs.id
 *   JOIN users o ON o.id = f.observer_user_id
 *   JOIN users t ON t.id = f.teacher_user_id
 *   JOIN schools s ON s.id = t.school_id
 *   WHERE cs.observation_type = 'leader_observation' AND cs.status IN ('completed', 'observer_review_complete')
 *     AND f.checked_at IS NOT NULL AND f.rubric_version = 'fico-ict-17-2026-09'
 *     AND cs.analysis_data->'observe2'->'final_levels' IS NOT NULL
 *     AND NOT COALESCE(o.is_test_user, false) AND NOT COALESCE(t.is_test_user, false)
 *     AND s.region IN ('B.K', 'Sihala', 'Urban-I', 'Urban-II', 'Nilore', 'Tarnol')
 *     AND NOT s.is_probable_test AND s.is_active
 *     AND length(cs.transcript_text) >= 8000
 *     AND cs.id NOT IN (<the ten fixed ids>)
 *   ORDER BY md5(cs.id::text) LIMIT 20;
 *
 * The database is reached only through readOnly(): a query builder with select and filters and no write method,
 * checked by assertReadOnly() before anything is read. On top of that, every outgoing request is fenced: GET to the
 * database host, POST to the model provider, nothing else. What leaves the script is the session id, the date,
 * the levels and the transcript status (publicRow): no transcript, no quote, no name.
 *
 * Usage (from a directory with no .env, so dotenv adds nothing):
 *   REPLAY_DB_URL=<read replica> REPLAY_DB_KEY=<key> REPLAY_OPENROUTER_KEY=<key> \
 *     node <repo>/bot/scripts/fico17-v6-replay.js --out <dir> [--max-usd 15] [--concurrency 3] [--limit n] [--select-only]
 * Writes <dir>/selection.json, <dir>/results.json, <dir>/calls.jsonl (model, tokens, US$ per call), <dir>/REPLAY.md.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FIXED_IDS = [
  '764a92ad-5cf3-4a20-afec-33cd150af3b4', '433d8977-6861-41da-b6b5-3516df5f1d4b', '13f55e61-7feb-40cd-9232-0d8759633aad',
  'bb4f164c-d633-47fb-aefa-cfa7a6928fb3', 'f575a5a7-591e-4df8-b331-5a51e56ff3b0', '39f3b6d9-5636-4853-93a4-7fb73b77fda4',
  '1df6c9a7-0acf-4b17-84e1-5c4ec18f7090', '120893f3-6673-40d2-84e6-4e858af12429', '8947ec66-45bf-45e0-87b7-936271a58627',
  '6c65966e-c3e7-48d6-812a-5956ac64d9fa',
];
const EXTRA = 20;
const MIN_CHARS = 8000;
const DC_CODES = ['C1', 'C2', 'C4', 'C6', 'C8', 'D1', 'D5', 'F1', 'F2', 'F3', 'F4'];
const COMPLETE = ['completed', 'observer_review_complete'];
const V5_RUBRIC_VERSION = 'fico-ict-17-2026-09';
// The six ICT sectors of the programme (schools.region); Gilgit-Baltistan, Durbeen and unplaced schools are not.
const PROGRAMME_REGIONS = ['B.K', 'Sihala', 'Urban-I', 'Urban-II', 'Nilore', 'Tarnol'];
// The four known problem transcripts are among the fixed ten (§10.3: one loops, two stop early, one starts late).
const KNOWN_PROBLEMS = 4;

const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex');

// ---------------------------------------------------------------- the database, read-only

const WRITES = ['insert', 'update', 'upsert', 'delete'];
const READS = ['select', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'order', 'limit', 'range'];

/** A client that can only read: from(table) gives a builder with select and filters, and nothing that writes. */
function readOnly(db) {
  const wrap = (q) => {
    const out = {};
    for (const m of READS) if (typeof q[m] === 'function') out[m] = (...a) => wrap(q[m](...a));
    if (typeof q.single === 'function') out.single = () => q.single();
    if (typeof q.maybeSingle === 'function') out.maybeSingle = () => q.maybeSingle();
    out.then = (resolve, reject) => q.then(resolve, reject);
    return out;
  };
  return { from: (table) => wrap(db.from(table)) };
}

/** Throws when any write is reachable on the client or on a query from it. */
function assertReadOnly(db) {
  if (typeof db.rpc === 'function') throw new Error('write method reachable: rpc');
  const q = db.from('coaching_sessions');
  const chained = typeof q.select === 'function' ? q.select('id') : {};
  for (const target of [q, chained]) {
    for (const m of WRITES) if (typeof target[m] === 'function') throw new Error(`write method reachable: ${m}`);
  }
  return true;
}

/** A PostgREST client that only ever sends GET: the replica, or any key, can be handed to it safely. */
function restGet({ url, key, fetchImpl = fetch }) {
  const base = String(url).replace(/\/+$/, '');
  const enc = encodeURIComponent;
  const builder = (table) => {
    const params = [];
    let mode = 'many';
    const add = (k, v) => { params.push(`${enc(k)}=${v}`); return api; };
    const run = async () => {
      const res = await fetchImpl(`${base}/rest/v1/${table}${params.length ? `?${params.join('&')}` : ''}`, {
        method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      });
      if (!res.ok) return { data: null, error: { message: `GET ${table} ${res.status}` } };
      const rows = await res.json();
      if (mode === 'maybe') return { data: rows[0] || null, error: null };
      if (mode === 'single') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected one row, got ${rows.length}` } };
      return { data: rows, error: null };
    };
    const api = {
      select: (cols = '*') => add('select', enc(String(cols).replace(/\s+/g, ''))),
      eq: (c, v) => add(c, `eq.${enc(v)}`),
      neq: (c, v) => add(c, `neq.${enc(v)}`),
      in: (c, vals) => add(c, `in.(${(vals || []).map((v) => enc(v)).join(enc(','))})`),
      is: (c, v) => add(c, `is.${v}`),
      not: (c, op, v) => add(c, `not.${op}.${enc(v)}`),
      gte: (c, v) => add(c, `gte.${enc(v)}`),
      lte: (c, v) => add(c, `lte.${enc(v)}`),
      order: (c, o = {}) => add('order', `${enc(c)}.${o.ascending === false ? 'desc' : 'asc'}`),
      limit: (n) => add('limit', Number(n)),
      single: () => { mode = 'single'; return run(); },
      maybeSingle: () => { mode = 'maybe'; return run(); },
      then: (resolve, reject) => run().then(resolve, reject),
    };
    return api;
  };
  return { from: builder };
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function selectIn(db, table, cols, col, ids) {
  const out = [];
  for (const part of chunks([...new Set(ids.filter(Boolean))], 40)) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await db.from(table).select(cols).in(col, part);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

/** Every /observe2 visit that has a recording: its session, form, observer, teacher and school. */
async function fetchLessons(db) {
  const { data: forms, error } = await db.from('observation_field_forms')
    .select('id,coaching_session_id,checked_at,period_minutes,rubric_version,observer_user_id,teacher_user_id,answers');
  if (error) throw new Error(`observation_field_forms: ${error.message}`);
  const linked = (forms || []).filter((f) => f.coaching_session_id);
  const sessions = await selectIn(db, 'coaching_sessions',
    'id,created_at,status,observation_type,audio_duration_seconds,transcript_text,final_levels:analysis_data->observe2->final_levels',
    'id', linked.map((f) => f.coaching_session_id));
  const users = await selectIn(db, 'users', 'id,is_test_user,school_id,preferred_language', 'id',
    linked.flatMap((f) => [f.observer_user_id, f.teacher_user_id]));
  const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
  const U = byId(users);
  const S = byId(await selectIn(db, 'schools', 'id,region,is_probable_test,is_active', 'id', users.map((u) => u.school_id)));
  const F = new Map(linked.map((f) => [f.coaching_session_id, f]));
  return sessions.map((session) => {
    const form = F.get(session.id);
    const teacher = U.get(form.teacher_user_id) || null;
    return {
      session, form, observer: U.get(form.observer_user_id) || null, teacher,
      school: (teacher && S.get(teacher.school_id)) || null, finalLevels: session.final_levels || null,
    };
  });
}

// ---------------------------------------------------------------- which lessons

/** Why a visit is not in the replay pool, or null when it is. */
function ineligibleBecause(l) {
  const { session: s, form: f, observer: o, teacher: t, school: sc } = l;
  if (!s || !f || s.observation_type !== 'leader_observation' || !COMPLETE.includes(s.status) || !f.checked_at
    || !l.finalLevels || !Object.keys(l.finalLevels).length) return 'not_completed';
  if (f.rubric_version !== V5_RUBRIC_VERSION) return 'not_v5';
  if (!o || !t || o.is_test_user || t.is_test_user) return 'test_account';
  if (!sc || !PROGRAMME_REGIONS.includes(sc.region) || sc.is_probable_test || sc.is_active === false) return 'not_programme_school';
  if (String(s.transcript_text || '').length < MIN_CHARS) return 'short_transcript';
  return null;
}

/** The fixed ids in their order (whatever they are), then the next `extra` eligible visits by md5(id). */
function pickLessons(pool, { fixed = FIXED_IDS, extra = EXTRA } = {}) {
  const byId = new Map(pool.map((l) => [l.session.id, l]));
  const found = fixed.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const rest = pool.filter((l) => !fixed.includes(l.session.id) && !ineligibleBecause(l))
    .sort((a, b) => md5(a.session.id).localeCompare(md5(b.session.id)))
    .slice(0, extra);
  const out = [...found, ...rest];
  out.missingFixed = fixed.filter((id) => !byId.has(id));
  return out;
}

// ---------------------------------------------------------------- the maths

/** A level 1-4 from a stored string or a number; NA, IE, blanks and anything else are not a level. */
function level(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 4 ? v : null;
  return /^[1-4]$/.test(String(v == null ? '' : v)) ? Number(v) : null;
}

const pct = (k, n) => (n ? Math.round((1000 * k) / n) / 10 : null);

/**
 * rows: [{ id, status, coach: { code: stored level }, model: { code: result } }]. Agreement counts a pair only when
 * both are levels (NA and IE are left out, §10.3). `above` = the model higher than the coach.
 */
function agreement(rows, codes = DC_CODES) {
  const zero = () => ({ n: 0, exact: 0, within1: 0, above: 0, below: 0 });
  const byCode = Object.fromEntries(codes.map((c) => [c, zero()]));
  const pooled = zero();
  const ie = { all: 0, onOk: 0, resultsOnOk: 0 };
  for (const r of rows) {
    for (const code of codes) {
      const m = r.model ? r.model[code] : undefined;
      if (r.status === 'ok' && m !== undefined && m !== null) ie.resultsOnOk += 1;
      if (m === 'IE') { ie.all += 1; if (r.status === 'ok') ie.onOk += 1; }
      const a = level(m);
      const c = level(r.coach ? r.coach[code] : null);
      if (a == null || c == null) continue;
      for (const t of [byCode[code], pooled]) {
        t.n += 1;
        if (a === c) t.exact += 1;
        if (Math.abs(a - c) <= 1) t.within1 += 1;
        if (a > c) t.above += 1;
        if (a < c) t.below += 1;
      }
    }
  }
  return { byCode, pooled, ie };
}

/** Lessons whose model result for `code` is level `lvl`, over lessons with a level for it. */
function levelShare(rows, code, lvl) {
  const levels = rows.map((r) => level(r.model ? r.model[code] : null)).filter((v) => v != null);
  return { k: levels.filter((v) => v === lvl).length, n: levels.length };
}

/** The spec's targets (§10.3, unchanged by RULINGS Q3), each with pass or fail. */
function targets(s) {
  const share = (x) => (x.n ? x.k / x.n : null);
  return [
    { key: 'exact', check: 'Exact match, 11 DC indicators pooled', target: '≥ 51%', value: pct(s.pooled.exact, s.pooled.n), pass: pct(s.pooled.exact, s.pooled.n) >= 51 },
    { key: 'within1', check: 'Within 1 level, pooled', target: '≥ 85%', value: pct(s.pooled.within1, s.pooled.n), pass: pct(s.pooled.within1, s.pooled.n) >= 85 },
    ...['C1', 'D1'].map((c) => ({ key: `above_${c}`, check: `${c}: above coach, fixed ten`, target: '≤ 3 of 10', value: `${s.aboveFixed[c].k} of ${s.aboveFixed[c].n}`, pass: s.aboveFixed[c].k <= 3 })),
    ...['C1', 'C6'].map((c) => ({ key: `share2_${c}`, check: `${c}: lessons at level 2`, target: '< 60%', value: pct(s.share2[c].k, s.share2[c].n), pass: share(s.share2[c]) != null && share(s.share2[c]) < 0.6 })),
    { key: 'problems', check: 'Known problem transcripts flagged partial/broken', target: `${s.problems.expected} of the fixed ten`, value: `${s.problems.flagged} flagged`, pass: s.problems.flagged >= s.problems.expected },
    { key: 'ie_ok', check: 'IE rate on ok transcripts', target: '< 5%', value: pct(s.ie.onOk, s.ie.resultsOnOk), pass: s.ie.resultsOnOk > 0 && s.ie.onOk / s.ie.resultsOnOk < 0.05 },
  ];
}

/** What may leave the script for one lesson. */
function publicRow(r) {
  const { id, date, status, issues, coach, dc, rules } = r;
  return { id, date, status, issues, coach, dc, rules };
}

// ---------------------------------------------------------------- the report

const fmt = (v) => (v == null ? '–' : `${v}%`);

function table(rows, codes, title) {
  const t = agreement(rows, codes);
  const line = (name, x) => `| ${name} | ${x.n} | ${fmt(pct(x.exact, x.n))} | ${fmt(pct(x.within1, x.n))} | ${x.above} | ${x.below} |`;
  return {
    t,
    md: [
      `### ${title}`, '',
      '| Indicator | n | Exact | Within 1 | Above coach | Below coach |', '|---|---:|---:|---:|---:|---:|',
      ...codes.map((c) => line(c, t.byCode[c])), line('**Pooled**', t.pooled), '',
      `\`IE\` results: ${t.ie.all} in all; ${t.ie.onOk} of ${t.ie.resultsOnOk} indicator results on \`ok\` transcripts (${fmt(pct(t.ie.onOk, t.ie.resultsOnOk))}).`, '',
    ].join('\n'),
  };
}

function targetRows(rows, fixedIds, t) {
  const fixed = rows.filter((r) => fixedIds.includes(r.id));
  const above = (c) => ({ k: fixed.filter((r) => level(r.model[c]) != null && level(r.coach[c]) != null && level(r.model[c]) > level(r.coach[c])).length, n: fixed.length });
  return targets({
    pooled: t.pooled, ie: t.ie,
    aboveFixed: { C1: above('C1'), D1: above('D1') },
    share2: { C1: levelShare(rows, 'C1', 2), C6: levelShare(rows, 'C6', 2) },
    problems: { flagged: fixed.filter((r) => r.status === 'partial' || r.status === 'broken').length, expected: KNOWN_PROBLEMS },
  });
}

function renderReport({ results, selection, spend, models }) {
  const dcRows = results.map((r) => ({ id: r.id, status: r.status, coach: r.coach, model: r.dc || {} }));
  const ruleRows = results.map((r) => ({ id: r.id, status: r.status, coach: r.coach, model: r.rules || {} }));
  const A = table(dcRows, DC_CODES, 'Table 1 · DC prompt (fico17-v6-framework, shadow.scoreV6) vs coach');
  const B = table(ruleRows, DC_CODES, 'Table 2 · moments v3 + v6 rules (rules.addUp, no coach confirmation) vs coach');
  const tgt = (rows, t) => targetRows(rows, FIXED_IDS, t);
  const ta = tgt(dcRows, A.t);
  const tb = tgt(ruleRows, B.t);
  const shortId = (id) => id.slice(0, 8);
  const issues = (r) => (r.issues || []).map((i) => `${i.type}${i.from ? ` from ${i.from}` : ''}${i.to ? ` to ${i.to}` : ''}`).join('; ') || '–';
  const ieOf = (m) => Object.values(m || {}).filter((v) => v === 'IE').length;
  return [
    '## Targets (spec §10.3; RULINGS Q3: the spec\'s, unchanged)', '',
    '| Check | Target | DC prompt | | moments + rules | |', '|---|---|---:|---|---:|---|',
    ...ta.map((a, i) => `| ${a.check} | ${a.target} | ${a.value == null ? '–' : a.value}${typeof a.value === 'number' ? '%' : ''} | ${a.pass ? 'pass' : '**fail**'} | ${tb[i].value == null ? '–' : tb[i].value}${typeof tb[i].value === 'number' ? '%' : ''} | ${tb[i].pass ? 'pass' : '**fail**'} |`),
    '', A.md, B.md,
    '## Per lesson', '',
    'F = one of the ten fixed lessons. Status = the transcript quality gate on the visit\'s period (the same reading both scorers used). DC = the DC call\'s status; IE = how many of the 11 results were `IE`.', '',
    '| Session | Date | | Gate status | Issues | DC call | DC IE | Rules IE |', '|---|---|---|---|---|---|---:|---:|',
    ...results.map((r) => `| ${shortId(r.id)} | ${r.date} | ${FIXED_IDS.includes(r.id) ? 'F' : ''} | ${r.status} | ${issues(r)} | ${r.dc_status} | ${ieOf(r.dc)} | ${ieOf(r.rules)} |`),
    '',
    '## Selection', '',
    `Fixed ids found: ${selection.fixedFound} of ${FIXED_IDS.length}${selection.missingFixed.length ? ` (missing: ${selection.missingFixed.join(', ')})` : ''}. Fixed ids that the pool filters would have left out: ${selection.fixedIneligible.map((x) => `${shortId(x.id)} (${x.why})`).join(', ') || 'none'}.`,
    `Pool: ${selection.pool} /observe2 visits with a recording; eligible ${selection.eligible}; left out by reason: ${Object.entries(selection.excluded).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`,
    '',
    `Models: ${models}. Spend this run: US$${spend.usd.toFixed(2)} over ${spend.calls} calls.`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- the run

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

/** Only GET to the database and POST to the model provider leave this process; every model reply's usage is kept. */
function fenceNetwork({ dbHost, prices, maxUsd, calls }) {
  const realFetch = global.fetch;
  const spend = { usd: 0, calls: 0 };
  global.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    const toDb = url.host === dbHost && method === 'GET';
    const toModel = url.host === 'openrouter.ai' && (method === 'GET' || url.pathname.endsWith('/chat/completions'));
    if (!toDb && !toModel) throw new Error(`replay: blocked ${method} ${url.host}${url.pathname}`);
    if (toModel && method === 'POST' && spend.usd >= maxUsd) throw new Error(`replay: spend cap US$${maxUsd} reached`);
    const res = await realFetch(input, init);
    if (toModel && method === 'POST') {
      try {
        const body = await res.clone().json();
        const u = body.usage || {};
        const p = prices[body.model] || prices[String(body.model).replace(/-\d{4}-\d{2}-\d{2}$/, '')] || null;
        const usd = p ? (u.prompt_tokens || 0) * p.prompt + (u.completion_tokens || 0) * p.completion : 0;
        spend.usd += usd;
        spend.calls += 1;
        calls.push({ model: body.model, prompt_tokens: u.prompt_tokens || 0, completion_tokens: u.completion_tokens || 0, usd: Number(usd.toFixed(5)), priced: Boolean(p) });
      } catch (_) { /* a reply that is not JSON is the caller's error to handle */ }
    }
    return res;
  };
  return spend;
}

async function scoreLesson(l, { gate, shadow, moments, rules, quotes, labels, reply, completeJson }) {
  const s = l.session;
  const transcript = s.transcript_text || '';
  const quality = gate.assess({ transcript, periodMinutes: l.form.period_minutes });
  const stored = gate.stored(quality);
  const out = { id: s.id, date: String(s.created_at).slice(0, 10), status: stored.status, issues: stored.issues, coach: {} };
  for (const c of DC_CODES) out.coach[c] = l.finalLevels[c] == null ? '' : String(l.finalLevels[c]);

  const dcBlob = await shadow.scoreV6(transcript, { coachingSessionId: s.id, duration: s.audio_duration_seconds }, quality)
    .catch((e) => ({ status: 'failed', error: String(e.message).slice(0, 200) }));
  out.dc_status = dcBlob.status;
  out.dc = dcBlob.levels ? Object.fromEntries(DC_CODES.map((c) => [c, dcBlob.levels[c] ? dcBlob.levels[c].result : null])) : {};

  const V6 = 'fico17_v6';
  const form = { ...l.form, rubric_version: V6 };
  let found = [];
  let counts = {};
  out.rules_status = 'broken';
  if (quality.status !== 'broken') {
    try {
      const lang = (l.observer && l.observer.preferred_language) || 'en';
      const llm = (p, o = {}) => completeJson(p, { maxTokens: o.maxTokens || 16000, label: 'observe2.moments.replay', job: reply.JOB });
      const prompt = moments.buildPrompt(transcript, form, { lang, rubric: V6, gaps: gate.promptGaps(quality) });
      let r = reply.unwrap(await llm(prompt));
      if (reply.cutOff(r, 16000)) r = reply.unwrap(await llm(prompt)); // as readMoments: once more on a cut-off
      if (reply.cutOff(r, 16000)) throw new Error('moments reply cut off twice');
      const raw = r.result;
      const groupOf = require('../shared/services/observe/observe2/moment-types').groupOfFor(V6);
      const known = (Array.isArray(raw && raw.moments) ? raw.moments : []).filter((m) => m && groupOf[m.type]);
      const checked = quotes.checkQuotes(known, transcript);
      const labelled = await labels.checkLabels(checked.moments, { transcript, lang, llm, rubric: V6 });
      ({ moments: found, counts } = moments.normalise({ ...(raw || {}), moments: labelled.moments }, { rubric: V6 }));
      out.rules_status = 'ok';
      // How many moments survived each step (counts only): returned, known type, quote found, label kept, slots.
      out.moments = {
        returned: Array.isArray(raw && raw.moments) ? raw.moments.length : 0, known: known.length,
        quoted: checked.moments.length, labelled: labelled.moments.length, kept: found.length,
      };
    } catch (e) {
      out.rules_status = 'failed';
      out.rules_error = String(e.message).slice(0, 200);
    }
  }
  if (out.rules_status !== 'failed') {
    const levels = rules.addUp({ form: l.form.answers || {}, confirmed: found, heardCounts: counts, rubric: V6, transcriptQuality: stored });
    out.rules = Object.fromEntries(DC_CODES.map((c) => [c, levels[c] ? levels[c].level : null]));
  } else out.rules = {};
  return out;
}

async function main() {
  const outDir = path.resolve(arg('out', 'replay-out'));
  const maxUsd = Number(arg('max-usd', 15));
  const concurrency = Number(arg('concurrency', 3));
  const { REPLAY_DB_URL, REPLAY_DB_KEY, REPLAY_OPENROUTER_KEY } = process.env;
  if (!REPLAY_DB_URL || !REPLAY_DB_KEY) throw new Error('REPLAY_DB_URL and REPLAY_DB_KEY are required');
  fs.mkdirSync(outDir, { recursive: true });

  const db = readOnly(restGet({ url: REPLAY_DB_URL, key: REPLAY_DB_KEY }));
  assertReadOnly(db);
  const calls = [];
  const prices = {};
  const spend = fenceNetwork({ dbHost: new URL(REPLAY_DB_URL).host, prices, maxUsd, calls });

  const pool = await fetchLessons(db);
  const picked = pickLessons(pool);
  const excluded = {};
  for (const l of pool) { const why = ineligibleBecause(l); if (why) excluded[why] = (excluded[why] || 0) + 1; }
  const selection = {
    pool: pool.length, eligible: pool.filter((l) => !ineligibleBecause(l)).length, excluded,
    fixedFound: FIXED_IDS.length - picked.missingFixed.length, missingFixed: picked.missingFixed,
    fixedIneligible: picked.filter((l) => FIXED_IDS.includes(l.session.id) && ineligibleBecause(l)).map((l) => ({ id: l.session.id, why: ineligibleBecause(l) })),
    lessons: picked.map((l) => ({ id: l.session.id, date: String(l.session.created_at).slice(0, 10), fixed: FIXED_IDS.includes(l.session.id), chars: (l.session.transcript_text || '').length, period_minutes: l.form.period_minutes })),
  };
  fs.writeFileSync(path.join(outDir, 'selection.json'), JSON.stringify(selection, null, 2));
  if (arg('select-only', false)) return;
  if (!REPLAY_OPENROUTER_KEY) throw new Error('REPLAY_OPENROUTER_KEY is required to score');

  // The production route: OpenRouter, every job's model as production's app_settings say (read through `db`).
  process.env.LLM_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = REPLAY_OPENROUTER_KEY;
  process.env.LLM_JOB_MODELS = '';
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || REPLAY_DB_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'read-only-replay';
  // Every bot module that requires config/supabase gets the read-only client, never one that can write.
  const supaPath = require.resolve('../shared/config/supabase');
  require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: db };

  const priceList = await (await fetch('https://openrouter.ai/api/v1/models')).json();
  for (const m of priceList.data || []) prices[m.id] = { prompt: Number(m.pricing.prompt), completion: Number(m.pricing.completion) };

  const deps = {
    gate: require('../shared/services/observe/transcript-quality'),
    shadow: require('../shared/services/coaching/frameworks/fico17-v6/shadow'),
    moments: require('../shared/services/observe/observe2/moments'),
    rules: require('../shared/services/observe/observe2/rules'),
    quotes: require('../shared/services/observe/observe2/quote-check'),
    labels: require('../shared/services/observe/observe2/label-check'),
    reply: require('../shared/services/observe/observe2/llm-reply'),
  };
  const GPT5MiniService = require('../shared/services/gpt5-mini.service');
  deps.completeJson = (p, o) => GPT5MiniService.completeJson(p, o);
  const { modelInForce } = require('../shared/services/llm-client');
  await require('../shared/config/model-settings').ensureCurrent();
  const models = `DC ${modelInForce('coaching.pedagogy', require('../shared/config/model-registry').modelFor('coaching.pedagogy'))}; moments ${modelInForce('observe2.moments', require('../shared/config/model-registry').modelFor('observe2.moments'))}`;

  const todo = picked.slice(0, Number(arg('limit', picked.length)));
  const results = new Array(todo.length);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const i = next++;
      // eslint-disable-next-line no-await-in-loop
      results[i] = await scoreLesson(todo[i], deps);
      process.stdout.write(`${i + 1}/${todo.length} ${results[i].id.slice(0, 8)} gate=${results[i].status} dc=${results[i].dc_status} rules=${results[i].rules_status} US$${spend.usd.toFixed(2)}\n`);
      fs.writeFileSync(path.join(outDir, 'calls.jsonl'), calls.map((c) => JSON.stringify(c)).join('\n') + '\n');
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));

  const done = results.filter(Boolean);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ models, spend, rows: done.map((r) => ({ ...publicRow(r), dc_status: r.dc_status, rules_status: r.rules_status, moments: r.moments })) }, null, 2));
  fs.writeFileSync(path.join(outDir, 'REPLAY.md'), renderReport({ results: done, selection, spend, models }));
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(`replay failed: ${e.message}`); process.exit(1); });
}

module.exports = {
  FIXED_IDS, DC_CODES, PROGRAMME_REGIONS, md5, readOnly, assertReadOnly, restGet, fetchLessons, ineligibleBecause,
  pickLessons, level, pct, agreement, levelShare, targets, publicRow, renderReport, scoreLesson,
};
