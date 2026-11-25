#!/usr/bin/env node
/**
 * backfill-fln-lesson-keys — give PAST Reading Hour / Numeracy (FLN) plan opens and the quizzes made after them the
 * lesson + skill key that new rows now get when written (bd-chz35n.26). Only where the mapping is certain.
 *
 *   node scripts/backfill-fln-lesson-keys.js --env sandbox                       # dry run: counts, no write
 *   node scripts/backfill-fln-lesson-keys.js --env prod --commit --undo-file <path.json>
 *   … --versions v1-20261018-786b5bff,v2-20261019-25e4ae42   bundle versions live while the rows were written
 *                                                            (default: both shipped so far)
 *   … --env-file <path>   credentials elsewhere
 *
 * CERTAIN MEANS (pure, tested in tests/scripts/backfill-fln-lesson-keys.test.js):
 *   an open   opened after the live version's switch (app_settings updated_at + 1 h): that version keys it, `certain`.
 *             Earlier: every listed version keys it with the SAME certain key (fln-lesson-key.js). A plan that moved
 *             between versions, sits at different places in two grades, or is unknown: left NULL.
 *   a quiz    its teacher opened exactly ONE keyed FLN plan of the quiz's subject within 36 h before to 6 h after
 *             the recorded lesson — the rule the live quiz path uses (fln-lesson-hint.js). Transcript quizzes only.
 * Rows that already carry a key are never touched.
 *
 * WHAT IT WRITES (--commit): first the undo file (ids written), then niete_lp_opens.lesson_key per open and
 * quizzes.meta.fln_lesson per quiz (meta merged, nothing else in it changed). --env is required and the env file's
 * SUPABASE_URL must name that environment's project. Without --commit nothing is written.
 */
const fs = require('fs');
const path = require('path');
const { lessonKeyOf, bookForSubject, pickFlnLesson } = require('../bot/shared/services/fln-lesson-key');

const ENVS = Object.freeze({
  sandbox: { file: '.env.sandbox', ref: 'olvritwoqujtjvwfulbh' },
  staging: { file: '.env.stage', ref: 'rpqkekcfvumypldbejhp' },
  prod: { file: '.env.prod', ref: 'ihzciabopbttygxxgrkm' },
});
const VERSIONS = Object.freeze(['v1-20261018-786b5bff', 'v2-20261019-25e4ae42']);
const PAGE = 1000;
const SWITCH_MARGIN_MS = 60 * 60 * 1000;

/** planId → { key } when every bundle agrees on one certain key, else { reason }. */
function keyResolver(bundles) {
  const byId = bundles.map((b) => {
    const m = new Map();
    for (const r of (b && b.placement) || []) {
      const id = String(r.lp_id);
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(r);
    }
    return m;
  });
  return (planId) => {
    const keys = byId.map((m) => lessonKeyOf(String(planId), m.get(String(planId)) || []));
    if (keys.every((k) => !k)) return { reason: 'unknown' };
    if (keys.some((k) => !k) || new Set(keys.map((k) => k.key)).size > 1) return { reason: 'moved' };
    if (keys.some((k) => !k.certain)) return { reason: 'uncertain' };
    return { key: keys[0].key };
  };
}

/**
 * resolve decides every open by default. With { currentFrom, resolveCurrent }, an open at or after currentFrom (the
 * app_settings switch to the current bundle, plus a margin for the portal's 5-minute re-check) is decided by the
 * current bundle alone: it was the only one being served.
 */
function planOpens(opens, resolve, { currentFrom = null, resolveCurrent = null } = {}) {
  const counts = { fln_rows: 0, already_keyed: 0, to_key: 0, uncertain: 0, moved: 0, unknown: 0 };
  const updates = [];
  for (const o of opens || []) {
    if (o.plan_kind !== 'fln') continue;
    counts.fln_rows += 1;
    if (o.lesson_key) { counts.already_keyed += 1; continue; }
    const late = currentFrom && resolveCurrent && o.opened_at && new Date(o.opened_at) >= new Date(currentFrom);
    const r = (late ? resolveCurrent : resolve)(o.plan_ref);
    if (r.key) { counts.to_key += 1; updates.push({ id: o.id, lesson_key: r.key }); } else counts[r.reason] += 1;
  }
  return { updates, counts };
}

/** opens: keyed FLN opens (stored or planned) as { user_id, lesson_key, opened_at }. */
function planQuizzes(quizzes, opens) {
  const byUser = new Map();
  for (const o of opens || []) {
    if (!byUser.has(o.user_id)) byUser.set(o.user_id, []);
    byUser.get(o.user_id).push(o);
  }
  const counts = { quizzes: 0, already_set: 0, to_set: 0, ambiguous: 0, no_plan: 0, no_time: 0 };
  const updates = [];
  for (const q of quizzes || []) {
    counts.quizzes += 1;
    if (q.meta && q.meta.fln_lesson) { counts.already_set += 1; continue; }
    if (!q.session_at) { counts.no_time += 1; continue; }
    const book = bookForSubject(q.subject);
    const mine = byUser.get(q.teacher_id) || [];
    const pick = book ? pickFlnLesson(mine, { book, at: q.session_at }) : null;
    if (pick) { counts.to_set += 1; updates.push({ id: q.id, fln_lesson: pick }); continue; }
    // A plan of the subject in the window but no pick means two or more: "ambiguous". None at all: "no_plan".
    const seen = book && mine.some((o) => pickFlnLesson([o], { book, at: q.session_at }));
    counts[seen ? 'ambiguous' : 'no_plan'] += 1;
  }
  return { updates, counts };
}

// ─── I/O ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function pageAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

async function readRows(supabase) {
  const opens = await pageAll(() => supabase.from('niete_lp_opens')
    .select('id, user_id, plan_kind, plan_ref, lesson_key, opened_at').eq('plan_kind', 'fln').order('id'));
  const quizzes = await pageAll(() => supabase.from('quizzes')
    .select('id, teacher_id, subject, grade, meta, coaching_session_id, created_at').eq('quiz_source', 'transcript')
    .in('grade', ['1', '2', '1-2']).order('id'));
  const sessionIds = [...new Set(quizzes.map((q) => q.coaching_session_id).filter(Boolean))];
  const at = new Map();
  for (let i = 0; i < sessionIds.length; i += 200) {
    const { data, error } = await supabase.from('coaching_sessions').select('id, created_at').in('id', sessionIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const s of data || []) at.set(s.id, s.created_at);
  }
  return { opens, quizzes: quizzes.map((q) => ({ ...q, session_at: at.get(q.coaching_session_id) || null })) };
}

async function fetchBundle(base, ver) {
  const res = await fetch(`${base}/${ver}/corpus.json`);
  if (!res.ok) throw new Error(`bundle ${ver}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.version !== ver) throw new Error(`bundle ${ver}: body says ${body.version}`);
  return body;
}

async function main() {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const env = val('--env');
  const target = ENVS[env];
  if (!target) throw new Error(`--env is REQUIRED: one of ${Object.keys(ENVS).join(', ')}`);
  const commit = argv.includes('--commit');
  const undoFile = val('--undo-file');
  if (commit && !undoFile) throw new Error('--commit needs --undo-file <path.json>');
  const envPath = path.resolve(val('--env-file') || path.resolve(__dirname, '..', target.file));
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    process.env[s.slice(0, i)] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(String(process.env.SUPABASE_URL || ''));
  if (!m || m[1] !== target.ref) throw new Error(`ABORT: SUPABASE_URL is not ${env}'s project (${target.ref}); nothing done`);
  const base = String(process.env.FLN_CORPUS_BASE || `${process.env.CONTENT_R2_PUBLIC_URL || ''}/fln/corpus`).replace(/\/+$/, '');
  const versions = (val('--versions') || VERSIONS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const bundles = await Promise.all(versions.map((v) => fetchBundle(base, v)));
  const supabase = require('../bot/shared/config/supabase');
  const { opens, quizzes } = await readRows(supabase);
  const { data: setting } = await supabase.from('app_settings').select('value, updated_at').eq('key', 'fln_corpus_version').maybeSingle();
  const live = setting ? String(setting.value).replace(/"/g, '') : null;
  const current = bundles.find((b) => b.version === live);
  // The live version has been served since its row was last updated; an hour's margin covers the portal's re-check.
  const currentFrom = current && setting.updated_at ? new Date(new Date(setting.updated_at).getTime() + SWITCH_MARGIN_MS).toISOString() : null;
  const o = planOpens(opens, keyResolver(bundles), { currentFrom, resolveCurrent: current ? keyResolver([current]) : null });
  const planned = new Map(o.updates.map((u) => [u.id, u.lesson_key]));
  const keyed = opens.map((x) => ({ ...x, lesson_key: x.lesson_key || planned.get(x.id) || null })).filter((x) => x.lesson_key);
  const q = planQuizzes(quizzes, keyed);
  console.log(JSON.stringify({ env, versions, live, currentFrom, opens: o.counts, quizzes: q.counts, commit }, null, 2));
  if (!commit) { console.log('dry run: nothing written (add --commit --undo-file <path.json>)'); return; }
  fs.writeFileSync(undoFile, JSON.stringify({ opens: o.updates.map((u) => u.id), quizzes: q.updates.map((u) => u.id) }));
  for (const u of o.updates) {
    const { error } = await supabase.from('niete_lp_opens').update({ lesson_key: u.lesson_key }).eq('id', u.id).is('lesson_key', null);
    if (error) throw new Error(`open ${u.id}: ${error.message}`);
  }
  const metaOf = new Map(quizzes.map((x) => [x.id, x.meta || {}]));
  for (const u of q.updates) {
    const { error } = await supabase.from('quizzes').update({ meta: { ...metaOf.get(u.id), fln_lesson: u.fln_lesson } }).eq('id', u.id);
    if (error) throw new Error(`quiz ${u.id}: ${error.message}`);
  }
  console.log(`written: ${o.updates.length} opens, ${q.updates.length} quizzes; undo ids in ${undoFile}`);
}

if (require.main === module) main().catch((e) => { console.error(`\n  ${e.message}\n`); process.exit(1); });

module.exports = { keyResolver, planOpens, planQuizzes, VERSIONS };
