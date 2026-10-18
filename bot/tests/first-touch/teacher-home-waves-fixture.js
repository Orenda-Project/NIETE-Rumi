'use strict';
/**
 * The teacher home's round-trip fixture: a teacher with a long history (52 recorded lessons, 128 quizzes of their own,
 * most of them sent and played), seeded into the in-memory Supabase, where every read takes READ_MS and is given a
 * WAVE: 1 + the highest wave of the reads already finished when it started. The home's answer waits for its highest
 * wave, and on the real database one wave costs one round trip, so the count is the home's serial cost.
 *
 * Each read keeps its caller (file:line), so a failing count prints the wave list. The test file declares the same
 * boundary mocks as teacher-home.routes.test.js before requiring this file.
 */
const { seedMaker, TEACHER } = require('./maker-fixture');

const READ_MS = 20; // long against the CPU between reads, so a busy machine cannot reorder two waves
const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 14, 6, 0, 0);
const hex = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESS = (n) => hex('e1000000', n);
const QZ = (n) => hex('c1000000', n);
const CODE = (n) => hex('f1000000', n);
const KID = (n) => hex('a2000000', n);
const iso = (ms) => new Date(ms).toISOString();

/**
 * `sessions` recorded lessons (one transcript quiz each for the first `quizzed`), the rest of `quizzes` lesson-plan
 * quizzes; every quiz but the newest few sent, each to its own code, played by a few children.
 */
function history({ sessions = 52, quizzes = 128, quizzed = 40, now = NOW } = {}) {
  const coaching_sessions = [];
  const qs = [];
  const codes = [];
  const plays = [];
  for (let i = 0; i < sessions; i += 1) {
    coaching_sessions.push({
      id: SESS(i + 1), user_id: TEACHER.id, status: 'completed', observation_type: null, created_at: iso(now - (i * 2 + 1) * DAY),
      transcript_text: 'w '.repeat(1000), transcript_language: 'en', analysis_data: { topic: `Lesson ${i + 1}`, subject: 'Science' },
    });
  }
  for (let i = 0; i < quizzes; i += 1) {
    const fromSession = i < quizzed;
    const at = now - (i + 1) * 9 * 3600000;
    const status = i % 17 === 3 ? 'generating' : 'sent';
    const id = QZ(i + 1);
    qs.push({
      id, teacher_id: TEACHER.id, quiz_source: fromSession ? 'transcript' : 'lp_v8', status, topic: `Quiz ${i + 1}`, subject: 'Science',
      grade: '4', language: 'en', coaching_session_id: fromSession ? SESS(i + 1) : null, created_at: iso(at),
      meta: status === 'sent' ? { student_message: `Class, play quiz ${i + 1}`, share_code_id: CODE(i + 1), share_code: `C${String(i + 1).padStart(5, '0')}`, lesson_date: iso(at) } : {},
    });
    if (status !== 'sent') continue;
    codes.push({ id: CODE(i + 1), code: `C${String(i + 1).padStart(5, '0')}`, quiz_id: id, teacher_user_id: TEACHER.id, active: true, expires_at: iso(now + 30 * DAY),
      created_at: iso(at), parent_share_code_id: null, invited_by_student_id: null, class_id: null, topic: `Quiz ${i + 1}`, language: 'en' });
    for (let k = 0; k < (i % 4); k += 1) {
      plays.push({ id: hex('d2000000', i * 10 + k), share_code_id: CODE(i + 1), quiz_id: id, student_id: KID(k + 1), user_id: null, status: 'completed',
        correct_answers: 3, total_questions_answered: 5, completed_at: iso(at + 3600000), created_at: iso(at + 1800000), invited_by_student_id: null, student_class: '4' });
    }
  }
  return { coaching_sessions, quizzes: qs, quiz_share_codes: codes, quiz_sessions: plays };
}

const S = { reads: [], doneMax: 0, on: false, queries: [] };
const callerOf = () => (new Error().stack.split('\n').slice(2).find((l) => /services\/(quiz|first-touch)\//.test(l)) || '').trim().replace(/.*\/(\S+:\d+):\d+\)?$/, '$1');

/** Seeds the fake with the history and wraps every read with its wave. → the fake. */
function seed(supabase, opts = {}) {
  const fake = seedMaker(supabase, { on: true });
  const h = history(opts);
  fake.db.coaching_sessions = h.coaching_sessions;
  fake.db.quizzes = [...fake.db.quizzes, ...h.quizzes];
  fake.db.quiz_share_codes = h.quiz_share_codes;
  fake.db.quiz_sessions = h.quiz_sessions;
  fake.db.app_settings = [...fake.db.app_settings, { key: 'quiz_teacher_home', value: true }, ...(opts.settings || [])];
  const from0 = supabase.from;
  supabase.from = (t) => {
    const b = from0(t);
    const q = { t, select: null, likes: [], limit: null };
    S.queries.push(q);
    const select = b.select;
    b.select = (cols, o) => { q.select = cols; return select.call(b, cols, o); };
    const limit = b.limit;
    b.limit = (n) => { q.limit = n; return q.keep ? b : limit.call(b, n); }; // after a LIKE: the fixture slices after its filter
    // PostgREST LIKE (case-sensitive): _ is one character, % any run; applied to the rows the fake answers
    b.like = (c, pat) => {
      q.likes.push([c, pat]);
      const rx = new RegExp(`^${String(pat).split('').map((ch) => (ch === '_' ? '.' : ch === '%' ? '.*' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`, 's');
      q.keep = (r) => r[c] != null && rx.test(String(r[c]));
      return b;
    };
    const then0 = b.then;
    const answer = () => new Promise((r) => then0.call(b, r)).then((out) => {
      if (!q.keep || !out || !Array.isArray(out.data)) return out;
      const kept = out.data.filter(q.keep);
      return { ...out, data: q.limit == null ? kept : kept.slice(0, q.limit) };
    });
    b.then = (res, rej) => {
      if (!S.on) return answer().then(res, rej);
      const rec = { t, wave: S.doneMax + 1, at: callerOf() };
      S.reads.push(rec);
      return new Promise((r) => setTimeout(r, READ_MS)).then(() => { S.doneMax = Math.max(S.doneMax, rec.wave); return answer(); }).then(res, rej);
    };
    return b;
  };
  const rpc0 = supabase.rpc;
  supabase.rpc = (...a) => {
    if (!S.on) return rpc0(...a);
    const rec = { t: `rpc:${a[0]}`, wave: S.doneMax + 1, at: callerOf() };
    S.reads.push(rec);
    return new Promise((r) => setTimeout(r, READ_MS)).then(() => { S.doneMax = Math.max(S.doneMax, rec.wave); return rpc0(...a); });
  };
  return fake;
}

/** Runs `fn` with the counter on → { value, waves, reads, list }. */
async function measure(fn) {
  S.reads = []; S.doneMax = 0; S.on = true;
  try {
    const value = await fn();
    return { value, waves: S.doneMax, reads: S.reads.length, list: waveList(S.reads) };
  } finally { S.on = false; }
}

const waveList = (rs) => {
  const by = new Map();
  rs.forEach((r) => { if (!by.has(r.wave)) by.set(r.wave, []); by.get(r.wave).push(`${r.t} (${r.at || '?'})`); });
  return [...by.keys()].sort((x, y) => x - y).map((w) => `  wave ${w}: ${by.get(w).join(', ')}`).join('\n');
};

module.exports = { S, seed, measure, history, NOW, READ_MS, SESS, QZ, CODE, TEACHER };
