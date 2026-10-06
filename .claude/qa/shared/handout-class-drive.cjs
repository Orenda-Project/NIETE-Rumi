#!/usr/bin/env node
/* handout-class-drive.cjs — the hand-out class scenarios (training.feature @T400–@T406), driven
 * through the bot's REAL modules in a child process.
 *
 * WHY IN-PROCESS. The question "which class is this quiz for?" follows a hand-out — a video share
 * (deliverClassLink) or a lesson/coaching quiz's first send (sendHandoff). Reaching either on the
 * mock stack needs a generated quiz (LLM), a multi-class roster for the driver and the class column
 * migrated on the lane DB; T406 needs that column ABSENT. None of that is a lever the mock lane has.
 * So this drives the real code — video-quiz-share, transcript-quiz-handoff, handout-class and the
 * real class resolver (web-quiz-identity.resolveQuizClass) — with only the network boundary faked,
 * the same boundary the neighbouring jest suites fake: supabase (a small table store), Redis (a Map
 * with TTLs and a movable clock), whatsapp.service (a recorder), the logs, R2 and the queue.
 * The tap goes to HandoutClass.handleTap, the exact call whatsapp-bot.js makes for a vq_wc_ id.
 *
 *   node handout-class-drive.cjs            → one JSON object { T400: {pass, ev}, … } on stdout
 *
 * A child process so the fakes never leak into the runner (or another feature's require cache).
 */
'use strict';
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const BOT = path.join(REPO, 'bot');
// Modules read these at require time; nothing here reaches a network.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-only';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-only';

// ── the boundary fakes (state swapped per scenario; the modules keep the same objects) ──────────
let S;   // { tables, inserts, updates, sends, events, store, clock, onInsert }
let seq = 0;
const uuid = () => `11111111-1111-4111-8111-${String(++seq).padStart(12, '0')}`;

function from(table) {
  const q = { op: 'select', payload: null, filters: [] };
  const match = (r) => q.filters.every(([op, c, v]) => (
    op === 'eq' ? r[c] === v
      : op === 'is' ? (r[c] === undefined ? null : r[c]) === v
        : op === 'in' ? (v || []).includes(r[c])
          : op === 'neq' ? r[c] !== v : true));
  const run = async (single) => {
    const rows = S.tables[table] || (S.tables[table] = []);
    if (q.op === 'insert' || q.op === 'upsert') {
      const list = Array.isArray(q.payload) ? q.payload : [q.payload];
      const err = S.onInsert && S.onInsert(table, list[0]);
      S.inserts.push({ table, payload: { ...list[0] }, refused: err ? err.code : null });
      if (err) return { data: null, error: err };
      const out = list.map((p) => ({ id: p.id || uuid(), ...p }));
      rows.push(...out);
      return { data: single ? out[0] : out, error: null };
    }
    if (q.op === 'update') {
      const hit = rows.filter(match);
      hit.forEach((r) => Object.assign(r, q.payload));
      S.updates.push({ table, payload: { ...q.payload }, filters: q.filters.slice(), n: hit.length });
      return { data: single ? (hit[0] || null) : hit, error: null };
    }
    if (q.op === 'delete') { S.tables[table] = rows.filter((r) => !match(r)); return { data: null, error: null }; }
    const hit = rows.filter(match);
    return { data: single ? (hit[0] || null) : hit, error: null, count: hit.length };
  };
  const p = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res, rej) => run(false).then(res, rej);
      if (prop === 'single' || prop === 'maybeSingle') return () => run(true);
      if (prop === 'insert' || prop === 'upsert' || prop === 'update') return (v) => { q.op = prop; q.payload = v; return p; };
      if (prop === 'delete') return () => { q.op = 'delete'; return p; };
      if (prop === 'eq' || prop === 'is' || prop === 'in' || prop === 'neq') return (c, v) => { q.filters.push([prop, c, v]); return p; };
      return () => p;   // select / order / limit / range / gte … — not filters this drive depends on
    },
  });
  return p;
}
const supabaseFake = { from: (t) => from(t), rpc: async () => ({ data: null, error: null }) };

const redisFake = {
  async get(k) { const e = S.store.get(k); if (!e) return null; if (e.exp && S.clock() >= e.exp) { S.store.delete(k); return null; } return e.v; },
  async set(k, v, ttl) { S.store.set(k, { v, exp: ttl ? S.clock() + ttl * 1000 : 0 }); return true; },
  async delete(k) { S.store.delete(k); return true; },
  async setNX(k, v, ttl) { if (await redisFake.get(k)) return false; return redisFake.set(k, v, ttl); },
};
const recorder = (sink) => new Proxy({}, { get: (_, m) => async (...a) => { S[sink].push({ m: String(m), a }); return true; } });
const syncRecorder = (sink) => new Proxy({}, { get: (_, m) => (...a) => { S[sink].push({ m: String(m), a }); } });

function inject(rel, exports) {
  const file = require.resolve(path.join(BOT, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
}
inject('shared/config/supabase', supabaseFake);
inject('shared/services/cache/railway-redis.service', redisFake);
inject('shared/services/whatsapp.service', recorder('sends'));
inject('shared/utils/logger', syncRecorder('logs'));
inject('shared/utils/structured-logger', syncRecorder('events'));
inject('shared/storage/r2', { downloadFromR2: async () => Buffer.from('%PDF-1.4 drive'), uploadBuffer: async () => 'r2://drive' });
inject('shared/services/queue', { queueJob: async () => 'mid' });
inject('shared/services/queue/sqs-queue.service', { queueJob: async () => 'mid' });

const share = require(path.join(BOT, 'shared/services/quiz/video-quiz-share.service'));
const Handoff = require(path.join(BOT, 'shared/services/quiz/transcript-quiz-handoff.service'));
const HandoutClass = require(path.join(BOT, 'shared/services/quiz/handout-class.service'));
const { resolveUx } = require(path.join(BOT, 'shared/config/ux-strings'));
Handoff.sleep = async () => {};   // sendHandoff paces through module.exports.sleep

// ── the world ─────────────────────────────────────────────────────────────────────────────────
const PHONE = '923009900400';
const TEACHER = '00000000-0000-4000-8000-0000000004a0';
const QUIZ = '00000000-0000-4000-8000-0000000004b0';
const QUIZ2 = '00000000-0000-4000-8000-0000000004b1';
const K = {
  '4-A': '00000000-0000-4000-8000-00000000044a', '4-B': '00000000-0000-4000-8000-00000000044b',
  '5-A': '00000000-0000-4000-8000-00000000045a', '3-B': '00000000-0000-4000-8000-00000000043b',
};
const CLASS_ROWS = Object.entries(K).map(([label, id]) => ({
  id, grade_code: 'grade_' + label.split('-')[0], section: label.split('-')[1], shift_code: null, is_active: true,
}));

function world({ teaches, grade = '4', source = 'video', quizzes = [QUIZ] }) {
  let now = Date.now();
  S = {
    tables: {
      users: [{ id: TEACHER, name: 'Teacher Testwala', preferred_language: 'en' }],
      quizzes: quizzes.map((id) => ({ id, topic: 'Fractions', grade, list_id: null, quiz_source: source, teacher_id: TEACHER, language: 'en' })),
      classes: CLASS_ROWS.map((r) => ({ ...r })),
      class_teachers: teaches.map((l) => ({ teacher_user_id: TEACHER, class_id: K[l], is_active: true })),
      student_lists: [], quiz_share_codes: [], app_settings: [],
    },
    inserts: [], updates: [], sends: [], events: [], logs: [], store: new Map(),
    clock: () => now, advance: (ms) => { now += ms; }, onInsert: null,
  };
  HandoutClass._resetForTests();
}
const ctx = (quizId = QUIZ) => ({ quizId, videoId: null, userId: TEACHER, language: 'en' });
const codes = () => S.tables.quiz_share_codes;
const texts = () => S.sends.filter((s) => s.m === 'sendMessage').map((s) => String(s.a[1]));
const asks = () => S.sends.filter((s) => s.m === 'sendInteractiveButtons' || s.m === 'sendInteractiveMessage');
const askShape = (s) => (s.m === 'sendInteractiveButtons'
  ? { kind: 'buttons', body: s.a[1].body, options: s.a[1].buttons.map((b) => b.title), ids: s.a[1].buttons.map((b) => b.id) }
  : { kind: 'list', body: s.a[1].body.text, button: s.a[1].action.button,
    options: s.a[1].action.sections.flatMap((x) => x.rows).map((r) => r.title), ids: s.a[1].action.sections.flatMap((x) => x.rows).map((r) => r.id) });
const order = () => S.sends.map((s) => s.m);
const ANY = resolveUx('vqWhichClassAny', { language: 'en' });
const ASK = resolveUx('vqWhichClass', { language: 'en' });
const BOUND = (cls) => resolveUx('vqWhichClassBound', { language: 'en', params: { cls } });
const ANY_DONE = resolveUx('vqWhichClassAnyDone', { language: 'en' });
const isClassMsg = (t) => /QUIZ-|https?:\/\//.test(t);

const out = {};
const scenario = async (id, fn) => {
  try { const [pass, ev] = await fn(); out[id] = { pass: Boolean(pass), ev }; } catch (e) { out[id] = { pass: false, ev: { threw: String(e && e.stack || e).slice(0, 400) } }; }
};

(async () => {
  // T400 — one class matching the quiz: bound at mint, no question (a graded quiz and an ungraded one)
  await scenario('T400', async () => {
    const runs = [];
    for (const grade of ['4', null]) {
      world({ teaches: ['4-A'], grade });
      await share.deliverClassLink(ctx(), PHONE);
      runs.push({ grade, minted: codes().length, classId: codes()[0] && codes()[0].class_id, boundTo4A: codes()[0] && codes()[0].class_id === K['4-A'],
        classMessages: texts().length, lastIsClassMessage: isClassMsg(texts()[texts().length - 1] || ''), questions: asks().length });
    }
    return [runs.every((r) => r.minted === 1 && r.boundTo4A && r.classMessages === 2 && r.lastIsClassMessage && r.questions === 0), { runs }];
  });

  // T401 — two sections: link first (unbound), then ONE button question; a tap on 4-B binds that code
  await scenario('T401', async () => {
    world({ teaches: ['4-A', '4-B'] });
    await share.deliverClassLink(ctx(), PHONE);
    const a = asks()[0] && askShape(asks()[0]);
    const seqBefore = order();
    const unbound = codes().length === 1 && !codes()[0].class_id;
    const tapId = a && a.ids[a.options.indexOf('4-B')];
    S.sends = [];
    const claimed = tapId ? await HandoutClass.handleTap(tapId, PHONE) : false;
    const ev = { sendOrder: seqBefore, unboundAtSend: unbound, ask: a, tapped: tapId, claimed,
      confirmation: texts(), boundTo: codes()[0] && codes()[0].class_id, codesMinted: codes().length };
    return [unbound && a && a.kind === 'buttons' && a.body === ASK && JSON.stringify(a.options) === JSON.stringify(['4-A', '4-B', ANY])
      && seqBefore.join() === 'sendMessage,sendMessage,sendInteractiveButtons'
      && claimed && JSON.stringify(texts()) === JSON.stringify([BOUND('4-B')]) && ev.boundTo === K['4-B'] && ev.codesMinted === 1, ev];
  });

  // T402 — three matching classes (grades 3-5): a list; "All / not sure" leaves it unbound and answers the tap in one line
  await scenario('T402', async () => {
    world({ teaches: ['4-A', '4-B', '5-A'], grade: '3-5' });
    await share.deliverClassLink(ctx(), PHONE);
    const a = asks()[0] && askShape(asks()[0]);
    const anyId = a && a.ids[a.options.indexOf(ANY)];
    S.sends = [];
    const claimed = anyId ? await HandoutClass.handleTap(anyId, PHONE) : false;
    const ev = { ask: a, tappedAny: anyId, claimed, sentAfterTap: S.sends.length, reply: texts(), classId: codes()[0] && codes()[0].class_id,
      binds: S.updates.filter((u) => u.table === 'quiz_share_codes').length, questionKept: S.store.size };
    return [a && a.kind === 'list' && a.body === ASK && JSON.stringify(a.options) === JSON.stringify(['4-A', '4-B', '5-A', ANY])
      && claimed && ev.sentAfterTap === 1 && JSON.stringify(ev.reply) === JSON.stringify([ANY_DONE]) && !ev.classId && ev.binds === 0, ev];
  });

  // T403 — the only class (3-B) is outside the quiz grade (5): asked, not bound
  await scenario('T403', async () => {
    world({ teaches: ['3-B'], grade: '5' });
    await share.deliverClassLink(ctx(), PHONE);
    const a = asks()[0] && askShape(asks()[0]);
    const ev = { classId: codes()[0] && codes()[0].class_id, classMessages: texts().length, ask: a, sendOrder: order() };
    return [!ev.classId && ev.classMessages === 2 && a && a.kind === 'buttons' && JSON.stringify(a.options) === JSON.stringify(['3-B', ANY])
      && ev.sendOrder[ev.sendOrder.length - 1] === 'sendInteractiveButtons', ev];
  });

  // T404 — two hand-outs, two questions; a tap on the FIRST binds only the first; a week-old tap binds nothing
  await scenario('T404', async () => {
    world({ teaches: ['4-A', '4-B'], quizzes: [QUIZ, QUIZ2] });
    await share.deliverClassLink(ctx(QUIZ), PHONE);
    await share.deliverClassLink(ctx(QUIZ2), PHONE);
    const [q1, q2] = asks().map(askShape);
    const [c1, c2] = codes();
    await HandoutClass.handleTap(q1.ids[q1.options.indexOf('4-A')], PHONE);
    const afterFirst = { first: c1.class_id, second: c2.class_id || null, secondStillOpen: S.store.has(HandoutClass.ASK_KEY(c2.id)) };
    S.advance(7 * 24 * 60 * 60 * 1000 + 60 * 1000);
    const claimedLate = await HandoutClass.handleTap(q2.ids[q2.options.indexOf('4-B')], PHONE);
    const ev = { codes: 2, distinctQuestions: q1.ids[0] !== q2.ids[0], afterFirst, lateTapClaimed: claimedLate,
      secondAfterWeek: c2.class_id || null, expiredLogged: S.events.some((e) => e.a[0] === 'web_quiz.class_ask_expired') };
    return [ev.distinctQuestions && afterFirst.first === K['4-A'] && afterFirst.second === null && afterFirst.secondStillOpen
      && claimedLate && ev.secondAfterWeek === null && ev.expiredLogged, ev];
  });

  // T405 — a coaching quiz (no grade): PDF + link first, then the question; a tap binds 4-A and fills grade 4
  await scenario('T405', async () => {
    world({ teaches: ['4-A', '4-B'], grade: null, source: 'transcript' });
    const quiz = S.tables.quizzes[0];
    Object.assign(quiz, { status: 'ready', coaching_session_id: 'sess-1', meta: { pdf_key: 'transcript_quizzes/x.pdf', cost_usd: 0.01 } });
    const digest = { topic: 'Fractions', subject: 'maths', grade_band: null, language_of_instruction: 'en', slos: [{ id: 'S1', statement: 'a' }] };
    const r = await Handoff.sendHandoff(QUIZ, PHONE, { firstSend: true, prepared: {
      quiz: { ...quiz }, session: { id: 'sess-1', created_at: '2026-10-06T05:00:00Z' }, questions: null,
      qRows: [{ external_id: 'tq:1', question_text: 'q', option_a: 'a', option_b: 'b', correct_option: 'A', sort_order: 0 }],
      digest, meta: quiz.meta, language: 'en', teacherLang: 'en', teacherName: 'Teacher Testwala' } });
    const seqSent = order();
    const a = asks()[0] && askShape(asks()[0]);
    const unbound = codes().length === 1 && !codes()[0].class_id;
    S.sends = [];
    await HandoutClass.handleTap(a.ids[a.options.indexOf('4-A')], PHONE);
    const ev = { result: r, sendOrder: seqSent, unboundAtSend: unbound, ask: a, confirmation: texts(),
      boundTo: codes()[0].class_id, gradeAfter: S.tables.quizzes[0].grade };
    return [r && r.ok && seqSent[0] === 'sendDocument' && seqSent[seqSent.length - 1] === 'sendInteractiveButtons'
      && seqSent.filter((m) => m === 'sendMessage').length >= 1 && unbound && a.body === ASK
      && JSON.stringify(texts()) === JSON.stringify([BOUND('4-A')]) && ev.boundTo === K['4-A'] && ev.gradeAfter === '4', ev];
  });

  // T406 — no class_id column on this environment: a KNOWN class still mints (unbound), sends, logs once
  await scenario('T406', async () => {
    world({ teaches: ['4-A'] });
    S.onInsert = (table, row) => (table === 'quiz_share_codes' && 'class_id' in row
      ? { code: '42703', message: 'column "class_id" of relation "quiz_share_codes" does not exist' } : null);
    await share.deliverClassLink(ctx(), PHONE);
    await share.deliverClassLink(ctx(), PHONE);
    const unavailable = S.events.filter((e) => e.a[0] === 'web_quiz.class_bind_unavailable').length;
    const ev = { insertsTried: S.inserts.filter((i) => i.table === 'quiz_share_codes').map((i) => ({ classId: i.payload.class_id || null, refused: i.refused })),
      minted: codes().length, unboundAll: codes().every((c) => !c.class_id), classMessages: texts().length, questions: asks().length, unavailableLogged: unavailable };
    return [ev.minted === 2 && ev.unboundAll && ev.classMessages === 4 && ev.questions === 0 && unavailable === 1, ev];
  });

  process.stdout.write(JSON.stringify(out));
})().catch((e) => { process.stdout.write(JSON.stringify({ _error: String(e && e.stack || e).slice(0, 600) })); process.exitCode = 1; });
