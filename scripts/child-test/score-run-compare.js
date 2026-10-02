#!/usr/bin/env node
'use strict';
/**
 * Child test L14 (bd-s1oo0.18) — one simulation run's marks against the fixture keys.
 *
 * The comparisons are L5's (eval-compare.js); this file is only the glue that feeds them a session's
 * ai_marks and coach_marks, and the per-field summary sim/score_run.py prints. No database, no network:
 * score_run.py reads the sandbox DB and pipes the rows in.
 *
 *   node scripts/child-test/score-run-compare.js < in.json > out.json
 *   in:  { sessions: [{ session: {id, grade, form}, blocks: {urdu: {ai_marks, coach_marks}, …}, key, strip_key? }] }
 *   out: { per_session: [compareSession(…)], summary: summarise(…) }
 *
 * The fixture key is the enumerator's (real) or the script's (synthetic) marks in the ai-marks shape;
 * the strip photo the driver sent has its own key, merged into maths. A session whose grade is not the
 * fixture's was scored against a different passage, so it is kept out of every accuracy number.
 */

const { storyRow, itemRows, stats, agreement } = require('./eval-compare');

const BLOCKS = ['urdu', 'english', 'maths'];
const ITEM_FIELDS = ['questions', 'first_sounds', 'nonwords'];

function mergeStripKey(key, strip) {
  const k = JSON.parse(JSON.stringify(key));
  if (!strip) return k;
  k.blocks.maths = k.blocks.maths || {};
  k.blocks.maths.maths = k.blocks.maths.maths || {};
  k.blocks.maths.maths.written = (strip.written || []).map((w) => ({ id: w.id, verdict: w.verdict, written: w.written }));
  if (strip.word_problem) k.blocks.maths.maths.word_problem = { id: strip.word_problem.id, verdict: strip.word_problem.verdict };
  k.strip_id = strip.strip_id;
  return k;
}

/** Fields the coach saw on one block's screen, in the vocabulary of coach_marks.meta.shown_empty. */
function prefillOf(coach) {
  if (!coach) return { fields: 0, shown_empty: 0, prefilled: 0 };
  const empty = (coach.meta && coach.meta.shown_empty) || [];
  let fields = 0;
  if (coach.story) fields += 2;
  if (coach.fallback) fields += 1;
  for (const f of ITEM_FIELDS) fields += (coach[f] || []).length;
  if (coach.maths) {
    const m = coach.maths;
    fields += (m.numbers || []).length + (m.quick_sums ? 1 : 0) + (m.written || []).length + (m.word_problem ? 1 : 0);
  }
  // a lone flagged word is a radio of its own; it is a field only on the screens that showed it
  fields += empty.filter((p) => p.startsWith('story.flagged[')).length;
  return { fields, shown_empty: empty.length, prefilled: fields - empty.length };
}

/** Bank items only: a `may-…` key item (the May test's own item) has no twin among the items the bot scores. */
const bankOnly = (list) => (Array.isArray(list) ? list.filter((x) => !String(x.id).startsWith('may-')) : list);

/**
 * A quick-sums key the bot's count can be compared with: its items are bank items. A real fixture's
 * key is the May test's level-1 sums ("1+4 = 5", …, no bank ids), a different answer list from the
 * bank's m3A sums the bot scores against, so the two counts are not comparable (bd-s1oo0.20).
 */
const bankQuickSums = (qs) => !!qs && !(qs.items || []).some((x) => typeof x !== 'object' || String(x.id || '').startsWith('may-'));

const wpKey = (m) => (m && m.word_problem && m.word_problem.verdict
  ? [{ id: 'word_problem', verdict: m.word_problem.verdict === 'correct' ? 'correct' : 'wrong' }] : null);

function compareSession({ session, blocks, key }) {
  const out = { session_id: session.id, fixture_id: key.fixture_id, kind: key.kind, strip_id: key.strip_id || null,
    grade: session.grade, key_grade: key.grade, grade_ok: Number(session.grade) === Number(key.grade) && String(session.form || 'A') === String(key.form || 'A'),
    story: [], items: [], quick_sums: [], fallback: [], prefill: { fields: 0, shown_empty: 0, prefilled: 0 }, cost_usd: 0, ai_status: {} };
  for (const b of BLOCKS) {
    const row = blocks[b] || {};
    out.ai_status[b] = row.ai_status || (row.ai_marks ? 'scored' : 'missing');
    const cost = row.ai_marks && row.ai_marks.meta && row.ai_marks.meta.cost_usd;
    if (Number.isFinite(cost)) out.cost_usd += cost;
    const p = prefillOf(row.coach_marks);
    for (const k of Object.keys(out.prefill)) out.prefill[k] += p[k];
  }
  out.cost_usd = Math.round(out.cost_usd * 100000) / 100000;
  if (!out.grade_ok) return out;

  for (const b of BLOCKS) {
    const row = blocks[b] || {};
    const kb = (key.blocks || {})[b] || {};
    for (const [source, marks] of [['ai', row.ai_marks], ['coach', row.coach_marks]]) {
      if (!marks) continue;
      const rec = { id: key.fixture_id, block: b, aiMarks: marks, res: { aiStatus: row.ai_status } };
      const kind = key.kind || 'real';
      const cut = (key.cut_quality || {})[b] || null;
      if (b === 'maths') {
        const km = kb.maths || {};
        out.items.push(...itemRows(rec, bankOnly(km.numbers), 'numbers', kind).map((r) => ({ ...r, source, cut })));
        out.items.push(...itemRows(rec, bankOnly(km.written), 'written', kind).map((r) => ({ ...r, source, cut })));
        out.items.push(...itemRows(rec, wpKey(km), 'word_problem', kind).map((r) => ({ ...r, source, cut })));
        const qs = (marks.maths || {}).quick_sums;
        if (qs && bankQuickSums(km.quick_sums)) out.quick_sums.push({ source, ai: qs.correct, key: km.quick_sums.correct, conf: source === 'ai' && qs.confidence != null ? qs.confidence : null });
        continue;
      }
      const s = storyRow(rec, marks.story ? kb.story : null, kind);
      if (s) out.story.push({ ...s, source, cut });
      for (const f of ITEM_FIELDS) out.items.push(...itemRows(rec, bankOnly(kb[f]), f, kind).map((r) => ({ ...r, source, cut })));
      if (marks.fallback && kb.fallback) {
        for (const part of ['letters', 'words']) {
          if (!kb.fallback[part]) continue;   // no cut of this part in the note: nothing to compare with
          out.fallback.push({ source, block: b, part, ai: marks.fallback[part] && marks.fallback[part].correct, key: kb.fallback[part] && kb.fallback[part].correct });
        }
      }
    }
  }
  return out;
}

const pairs = (rows, a, k) => rows.map((r) => ({ ai: r[a], key: r[k] }));

/** Per field: AI vs key and coach vs key, with L5's stats/agreement. */
function summarise(perSession) {
  const ok = perSession.filter((s) => s.grade_ok);
  const by = (rows, source) => rows.filter((r) => r.source === source);
  const story = {};
  for (const b of ['urdu', 'english']) {
    // a contested key (the recording contradicts the enumerator's count) is listed, not scored
    const all = ok.flatMap((s) => s.story).filter((r) => r.block === b);
    const rows = all.filter((r) => r.key_quality !== 'contested');
    story[b] = { contested: [...new Set(all.filter((r) => r.key_quality === 'contested').map((r) => r.id))] };
    for (const src of ['ai', 'coach']) {
      const sel = by(rows, src);
      story[b][src] = stats(pairs(sel, 'ai_correct', 'key_correct'));
      story[b][`${src}_cut_ok`] = stats(pairs(sel.filter((r) => r.cut === 'ok'), 'ai_correct', 'key_correct'));
      const tp = sel.reduce((a, r) => a + (r.tp || 0), 0); const fp = sel.reduce((a, r) => a + (r.fp || 0), 0); const fn = sel.reduce((a, r) => a + (r.fn || 0), 0);
      story[b][`${src}_words`] = { flags: tp + fp, precision: tp + fp ? Math.round(100 * tp / (tp + fp)) / 100 : null, recall: tp + fn ? Math.round(100 * tp / (tp + fn)) / 100 : null };
    }
  }
  const items = {};
  for (const f of [...ITEM_FIELDS, 'numbers', 'written', 'word_problem']) {
    const rows = ok.flatMap((s) => s.items).filter((r) => r.field === f);
    if (!rows.length) continue;
    items[f] = { ai: agreement(by(rows, 'ai')), coach: agreement(by(rows, 'coach')) };
  }
  const qs = ok.flatMap((s) => s.quick_sums);
  const fb = ok.flatMap((s) => s.fallback);
  const pre = perSession.reduce((a, s) => ({ fields: a.fields + s.prefill.fields, shown_empty: a.shown_empty + s.prefill.shown_empty, prefilled: a.prefilled + s.prefill.prefilled }), { fields: 0, shown_empty: 0, prefilled: 0 });
  const costs = perSession.map((s) => s.cost_usd).filter((c) => c > 0);
  return {
    sessions: perSession.length, grade_ok: ok.length,
    story, items,
    quick_sums: { ai: stats(pairs(by(qs, 'ai'), 'ai', 'key')), coach: stats(pairs(by(qs, 'coach'), 'ai', 'key')) },
    fallback: Object.fromEntries(['letters', 'words'].map((p) => [p, { ai: stats(pairs(by(fb, 'ai').filter((r) => r.part === p), 'ai', 'key')), coach: stats(pairs(by(fb, 'coach').filter((r) => r.part === p), 'ai', 'key')) }])),
    prefill: { ...pre, rate: pre.fields ? Math.round(100 * pre.prefilled / pre.fields) / 100 : null },
    cost_usd_per_child: costs.length ? Math.round(10000 * costs.reduce((a, c) => a + c, 0) / costs.length) / 10000 : null,
  };
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const per = input.sessions.map((s) => compareSession({ session: s.session, blocks: s.blocks, key: mergeStripKey(s.key, s.strip_key) }));
  process.stdout.write(JSON.stringify({ per_session: per, summary: summarise(per) }, null, 1));
}

if (require.main === module) main().catch((e) => { console.error('score-run-compare: ' + e.message); process.exit(1); });

module.exports = { compareSession, mergeStripKey, prefillOf, summarise };
