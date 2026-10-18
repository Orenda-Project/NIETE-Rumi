#!/usr/bin/env node
'use strict';
/**
 * counts/web_quiz_videos_v3 — READ-ONLY. What the video library lists in each (grade, subject) for an English and an
 * Urdu child: `all` (every current video), `off` (listed with web_quiz_videos_v3 off) and `on en` / `on ur` (listed
 * with it on: the same language filter the library runs, applied in this process only; no switch is read or written).
 *
 *   node scripts/web-quiz/counts/web_quiz_videos_v3.js --expect-ref <supabase ref>
 *
 * stdout: one line per (grade, subject), then one JSON line of totals. Never an id or a title.
 * Exit 0; 1 = a subject listed with the switch off lists nothing for a child with it on; 2 = refused or failed.
 * Refuses ("REFUSED: not sandbox") unless SUPABASE_URL carries --expect-ref.
 */
const path = require('path');

const BOT = path.join(__dirname, '..', '..', '..', 'bot');

function arg(argv, name) { const i = argv.indexOf(name); return i === -1 ? null : (argv[i + 1] || ''); }

/** Rows of {grade, subject, all, off, on: {en, ur}}, in grade then subject order. */
async function table() {
  const supabase = require(path.join(BOT, 'shared/config/supabase'));
  const Bank = require(path.join(BOT, 'shared/services/quiz/web-quiz-bank'));
  const Lib = require(path.join(BOT, 'shared/services/quiz/web-quiz-library'));
  const Order = require(path.join(BOT, 'shared/services/quiz/video-bank-order'));
  const key = (r) => `${r.grade}|${r.subject}`;
  const cells = new Map();
  const cell = (r) => {
    if (!cells.has(key(r))) cells.set(key(r), { grade: String(r.grade), subject: r.subject, all: 0, off: 0, on: { en: 0, ur: 0 } });
    return cells.get(key(r));
  };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('student_videos').select('id, grade, subject')
      .eq('migration_status', 'done').is('superseded_by', null).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message || 'read failed');
    for (const r of data || []) cell(r).all += 1;
    if (!data || data.length < 1000) break;
  }
  const ix = await Bank.bank();
  for (const r of ix.rows) cell(r).off += 1;
  for (const lang of ['en', 'ur']) {
    const seen = await Lib.inLanguage(ix, lang);
    for (const r of seen.rows) cell(r).on[lang] += 1;
  }
  return [...cells.values()].sort((a, b) => Order.gradeRank(a.grade) - Order.gradeRank(b.grade) || Order.compareSubjects(a.subject, b.subject));
}

async function main({ argv = process.argv.slice(2), env = process.env, io = process } = {}) {
  const ref = arg(argv, '--expect-ref');
  if (!ref || !env.SUPABASE_URL || !String(env.SUPABASE_URL).includes(ref)) { io.stderr.write('REFUSED: not sandbox\n'); return 2; }
  const rows = await table();
  const emptied = rows.filter((r) => r.off > 0 && (r.on.en === 0 || r.on.ur === 0));
  io.stdout.write('grade | subject | all | off | on en | on ur\n');
  for (const r of rows) io.stdout.write(`${r.grade} | ${r.subject} | ${r.all} | ${r.off} | ${r.on.en} | ${r.on.ur}${emptied.includes(r) ? ' | EMPTIED' : ''}\n`);
  const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
  io.stdout.write(`${JSON.stringify({ subjects: rows.length, all: sum((r) => r.all), off: sum((r) => r.off), on_en: sum((r) => r.on.en), on_ur: sum((r) => r.on.ur), emptied: emptied.length })}\n`);
  return emptied.length ? 1 : 0;
}

if (require.main === module) {
  main().then((c) => { process.exitCode = c; }, (e) => { process.stderr.write(`web_quiz_videos_v3 counts: ${e && e.message}\n`); process.exitCode = 2; })
    .finally(() => setTimeout(() => process.exit(), 50).unref());
}

module.exports = { main, table };
