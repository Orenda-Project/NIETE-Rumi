'use strict';
/**
 * Shared kit for the G1-5 goldens (golden-g1-5*.test.js): the byte comparer, an in-memory database,
 * and the replay model that answers a board-pattern section prompt from a recorded reply.
 *
 * Nothing here is a test. Every edge a paper crosses is faked (database, queue, storage, PDF
 * engine, book text, model); everything between the teacher's tap and the stored files is real.
 * The model is replay-strict: a section with no recorded items gets an empty reply, never a
 * made-up one, so a cell without a recording pins its prompts and its failure path, not a paper.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'fixtures', 'golden');
const FIX = path.join(__dirname, '..', 'fixtures');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/** Each embedded font or image payload replaced by its digest; every other byte untouched. */
function digests(text) {
  return String(text).replace(/base64,([A-Za-z0-9+/=]+)/g,
    (_, data) => `base64,<sha256:${crypto.createHash('sha256').update(data).digest('hex')}>`);
}

function firstDifference(actual, expected) {
  const a = actual.split('\n');
  const e = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, e.length); i += 1) {
    if (a[i] !== e[i]) return `line ${i + 1}\n  expected: ${JSON.stringify(e[i])}\n  actual:   ${JSON.stringify(a[i])}`;
  }
  return null;
}

/** Byte-compare `actual` with fixtures/golden/<name>. UPDATE_GOLDEN=1 writes ONLY files that do not exist yet. */
function golden(name, actual) {
  const file = path.join(DIR, name);
  if (UPDATE && !fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, actual);
  }
  if (!fs.existsSync(file)) throw new Error(`no golden ${name}: capture it with UPDATE_GOLDEN=1`);
  const expected = fs.readFileSync(file, 'utf8');
  if (actual !== expected) throw new Error(`${name} differs from its golden at ${firstDifference(actual, expected)}`);
}

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** An in-memory PostgREST over `state.rows` (written), `state.tables` (seed rows) and `state.settings`. */
function fakeDb(state) {
  function from(table) {
    const st = { op: 'select', payload: null, eq: {}, in: {} };
    const rows = () => (state.rows[table] ||= []);
    // An embedded-resource filter (`assessment_papers.status`) is the seed's job to satisfy, so it is not checked.
    const match = (r) => Object.entries(st.eq).every(([k, v]) => k.includes('.') || r[k] === v)
      && Object.entries(st.in).every(([k, vs]) => vs.includes(r[k]));
    const run = (single) => {
      if (st.op === 'insert') {
        state.seq += 1;
        const row = { id: `${table}-${state.seq}`, attempt: 1, edited_from: null, created_at: 'T', ...st.payload };
        rows().push(row);
        return { data: row, error: null };
      }
      if (st.op === 'update') {
        state.updates.push({ table, payload: st.payload });
        rows().filter(match).forEach((r) => Object.assign(r, JSON.parse(JSON.stringify(st.payload))));
        return { data: null, error: null };
      }
      if (table === 'app_settings') {
        const v = state.settings[st.eq.key];
        return { data: v === undefined ? null : { key: st.eq.key, value: v }, error: null };
      }
      const seed = (state.tables && state.tables[table]) || [];
      let found = [...seed, ...rows()].filter(match);
      const total = found.length;
      if (st.order) {
        const [col, asc] = st.order;
        found = [...found].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (st.range) found = found.slice(st.range[0], st.range[1] + 1);
      return { data: single ? (found[0] || null) : found, error: null, count: total };
    };
    const b = {
      select: () => b,
      insert: (p) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p) => { st.op = 'update'; st.payload = p; return b; },
      eq: (k, v) => { st.eq[k] = v; return b; },
      in: (k, vs) => { st.in[k] = vs; return b; },
      is: () => b, neq: () => b, gte: () => b, lte: () => b, gt: () => b, lt: () => b,
      order: (col, o = {}) => { st.order = [col, o.ascending !== false]; return b; },
      range: (a, z) => { st.range = [a, z]; return b; }, limit: () => b, not: () => b, or: () => b, filter: () => b,
      single: async () => run(true), maybeSingle: async () => run(true),
      then: (ok, ko) => Promise.resolve(run(false)).then(ok, ko),
    };
    return b;
  }
  return { from };
}

/** Pattern cell -> recorded reply file under fixtures/. A cell absent here has no recording. */
const RECORDINGS = {
  'fde_g1_2026.maths': 'fde-v34-g1-maths.json',
  'fde_g1_2026.english': 'fde-v34-g1-english.json',
  'fde_g1_2026.urdu': 'early/g1-urdu-exam.json',
  'fde_g1_2026.general_knowledge': 'early/g1-general_knowledge-exam.json',
  'fde_g2_2026.maths': 'fde-v34-g2-maths.json',
  'fde_g2_2026.english': 'fde-v34-g2-english.json',
  'fde_g3_2026.general_knowledge': 'mid/g3-general_knowledge-ch3-exam.json',
  'fde_g5_2027.maths': 'fde/maths.json',
  'fde_g5_2027.science': 'fde/science.json',
  'fde_g5_2027.english': 'fde-v29-g5-english.json',
  'fde_g5_2027.urdu': 'fde/urdu.json',
};
function recording(cell) {
  const f = RECORDINGS[cell];
  return f ? JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')) : null;
}

/**
 * The oral part has no recording anywhere in fixtures/, so its reply is a fictional, fixed one built from
 * the pattern's own oral tasks (the shape early-writer-harness.js oralTree uses). File names say `oralfix`.
 */
function oralReply(oral) {
  return { oral: ((oral && oral.tasks) || []).map((t) => ({
    id: t.id, script: 'Ali and Sara walk to the park. They see a red kite in the tall tree.',
    items: Array.from({ length: t.n }, (_, i) => ({ ask: `Question ${i + 1} about the kite?`, answer: `Answer ${i + 1}` })),
  })) };
}

const ORAL_PROMPT = /^Write the oral part of /m;

/** The replay reply for one prompt: the oral fixture for the oral prompt, else the recorded items whose slot it names. */
function replayReply(rec, prompt, oral) {
  if (ORAL_PROMPT.test(prompt)) {
    return { choices: [{ message: { content: JSON.stringify(oralReply(oral)) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
  }
  const tree = {};
  for (const [cat, types] of Object.entries((rec && rec.unseen) || {})) {
    for (const [type, items] of Object.entries(types)) {
      const kept = (items || []).filter((q) => q && q.slot && prompt.includes(q.slot));
      if (kept.length) ((tree[cat] ||= {})[type] = kept);
    }
  }
  return { choices: [{ message: { content: JSON.stringify({ unseen: tree }) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
}

const fakePdf = (pages) => Buffer.from(`%PDF-1.7\n1 0 obj <</Type /Pages /Count ${pages}>>\n${'<</Type /Page /Parent 1 0 R>>\n'.repeat(pages)}%%EOF`, 'latin1');

/** Calls a route's last handler directly; requireInternalKey is the only middleware before it. */
async function callRoute(router, p, body, key) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let statusCode = 200; let payload;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  await handler({ body, headers: { 'x-api-key': key } }, res);
  return { statusCode, payload };
}

module.exports = { DIR, FIX, golden, json, digests, fakeDb, recording, replayReply, fakePdf, callRoute, RECORDINGS };
