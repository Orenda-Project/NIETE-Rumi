'use strict';
/**
 * Read-only: how GB grade 1-5 lessons fare as class quizzes (bd-97daxo.34, queue #216).
 * Counts GB K-5 deliveries in the 6-12 ledger since a date, the teachers, the lp612 quizzes made from
 * them and how each ended, and (with --r2) whether each delivered lesson's document is in GB's lane.
 *
 *   node bot/scripts/quiz/gb-quiz-readiness.js [--since 2026-11-11] [--r2]
 * Writes nothing. Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ R2 keys for --r2) in the env.
 */
const { createClient } = require('@supabase/supabase-js');

async function all(q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

function summarise({ segments, deliveries, quizzes }) {
  const gb = new Set(segments.filter((s) => (s.curriculum || 'ict') !== 'ict' && s.grade >= 1 && s.grade <= 5).map((s) => s.segment_id));
  const d = deliveries.filter((r) => gb.has(r.segment_id));
  const q = quizzes.filter((x) => gb.has((((x.meta || {}).lessons || [])[0] || {}).segment_id));
  const tally = (rows, f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    gbK5Deliveries: d.length,
    gbK5Teachers: new Set(d.map((r) => r.user_id)).size,
    byTemplateVersion: tally(d, (r) => r.template_version || 'none'),
    gbK5Quizzes: q.length,
    gbK5QuizTeachers: new Set(q.map((x) => x.teacher_id)).size,
    quizOutcomes: tally(q, (x) => `${x.status}${(x.meta || {}).failure_reason ? `/${x.meta.failure_reason}` : ''}`),
    distinctLessons: [...new Map(d.map((r) => [`${r.segment_id}|${r.lang}|${r.template_version}`, r])).values()],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : '2026-11-11';
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const segments = await all(() => db.from('niete_lp612_segments').select('segment_id, grade, curriculum').neq('curriculum', 'ict'));
  const deliveries = await all(() => db.from('niete_lp612_deliveries').select('user_id, segment_id, lang, template_version, delivered_at').gte('delivered_at', since));
  const quizzes = await all(() => db.from('quizzes').select('id, teacher_id, status, meta').eq('quiz_source', 'lp612').gte('created_at', since));
  const s = summarise({ segments, deliveries, quizzes });
  if (args.includes('--r2')) {
    const { listKeys } = require('../../shared/storage/r2');
    const GbLane = require('../../shared/services/gb-lp-serving.service');
    const tvs = [...new Set(s.distinctLessons.map((l) => l.template_version))];
    const keys = new Set();
    for (const tv of tvs) (await listKeys(`gb-lp/${tv}/`)).forEach((k) => keys.add(k));
    const has = (l) => keys.has(GbLane.keyFor(l.segment_id, l.lang, l.template_version, 'lp.json'));
    const found = s.distinctLessons.filter(has).length;
    const missing = s.distinctLessons.length - found;
    s.lessonDocs = { found, missing };
  }
  s.distinctLessons = s.distinctLessons.length;
  console.log(JSON.stringify({ since, ...s }, null, 2));
}

module.exports = { summarise };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
