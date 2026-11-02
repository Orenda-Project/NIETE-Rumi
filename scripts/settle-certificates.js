#!/usr/bin/env node
/**
 * bd-arghnv.1 — issue every certificate a teacher has already earned and does not hold.
 *
 * The level list now fetches-or-issues (teacher-training-endpoint.js settleCertificates): a level that
 * qualifies and holds no certificate is certified the next time she looks. This runs that same step for
 * every teacher who has such a level, so the ones who do not open the app (and the reports, which count
 * certificate rows) catch up too. The decision is the guard's (maybeIssueQuizScoreCertificate), never this
 * script's: it only finds teachers worth asking about.
 *
 * Who is asked: a teacher with a level and NO certificate for it where she has
 *   a passed level exam (NIETE grand quiz, Beacon House capstone), or
 *   every active per-module exam passed (I-SAPS), or
 *   no exam on the level and every active unit done (Oxbridge).
 *
 *   node scripts/settle-certificates.js --target staging --env-file NIETE-Rumi/.env.stage            # dry run
 *   node scripts/settle-certificates.js --target prod --env-file <prod env> --apply [--out file.json]
 *
 *   --target sandbox|staging|prod   REQUIRED; SUPABASE_URL (and the service key) must be that project.
 *   --apply                         issue. Without it: count the candidates, write nothing.
 *   --only-users a,b                limit to these user ids.
 *
 * A production run needs the operator's go (root CLAUDE.md Rule 7). It sends nothing: the app's ready
 * notice tells her (bd-arghnv.6).
 */
const fs = require('fs');
const path = require('path');

const TARGET_REFS = {
  sandbox: 'olvritwoqujtjvwfulbh',
  staging: 'rpqkekcfvumypldbejhp',
  prod: 'ihzciabopbttygxxgrkm',
};
const PER_MODULE_SOURCE_BASE = 900;
const PAGE = 1000;

function parseArgs(argv) {
  const out = { target: null, apply: false, envFile: null, out: null, onlyUsers: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--env-file') out.envFile = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--only-users') out.onlyUsers = String(argv[++i] || '').split(',').map(x => x.trim()).filter(Boolean);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.target || !Object.prototype.hasOwnProperty.call(TARGET_REFS, out.target)) {
    throw new Error(`--target is required and must be one of: ${Object.keys(TARGET_REFS).join(', ')}`);
  }
  return out;
}

function refOfUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)\b/i.exec(String(url || ''));
  return m ? m[1] : null;
}

/** Abort unless SUPABASE_URL and the service key are the target's project. Runs before anything connects. */
function assertTarget(target) {
  const want = TARGET_REFS[target];
  const got = refOfUrl(process.env.SUPABASE_URL);
  if (got !== want) throw new Error(`REF MISMATCH: --target ${target} expects ${want}, SUPABASE_URL is ${got || '(unset)'}. Aborting.`);
  const parts = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').split('.');
  if (parts.length === 3) {
    let ref = null;
    try { ref = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).ref || null; } catch (_) { /* not a JWT */ }
    if (ref && ref !== want) throw new Error(`REF MISMATCH: the service key belongs to ${ref}, not ${want}. Aborting.`);
  }
  return got;
}

function loadEnvFile(file) {
  const dotenv = require(require.resolve('dotenv', { paths: [path.join(__dirname, '..', 'bot'), path.join(__dirname, '..')] }));
  Object.assign(process.env, dotenv.parse(fs.readFileSync(file)));
}

async function readAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** (user, level) pairs worth asking the guard about, with the vendor key for the summary. */
async function findCandidates(supabase, onlyUsers) {
  const [levels, vendors, quizzes, courses, modules, certs] = await Promise.all([
    readAll(() => supabase.from('training_levels').select('id, vendor_id').eq('is_active', true)),
    readAll(() => supabase.from('training_vendors').select('id, key')),
    readAll(() => supabase.from('training_grand_quizzes').select('id, level_id, quiz_type, source_quiz_id')
      .in('quiz_type', ['grand_quiz', 'capstone']).eq('is_active', true)),
    readAll(() => supabase.from('training_courses').select('id, level_id').eq('is_active', true)),
    readAll(() => supabase.from('training_modules').select('id, course_id').eq('is_active', true)),
    readAll(() => supabase.from('training_certificates').select('user_id, level_id')),
  ]);
  const vendorKey = new Map(vendors.map(v => [v.id, v.key]));
  const levelVendor = new Map(levels.map(l => [l.id, vendorKey.get(l.vendor_id)]));
  const held = new Set(certs.map(c => `${c.user_id}:${c.level_id}`));
  const isLevelExam = q => q.source_quiz_id == null || q.source_quiz_id < PER_MODULE_SOURCE_BASE;
  const levelExamIds = new Set(quizzes.filter(isLevelExam).map(q => q.id));
  const perModuleByLevel = new Map();
  for (const q of quizzes.filter(q => !isLevelExam(q))) {
    if (!perModuleByLevel.has(q.level_id)) perModuleByLevel.set(q.level_id, new Set());
    perModuleByLevel.get(q.level_id).add(q.id);
  }
  const levelsWithExam = new Set(quizzes.map(q => q.level_id));
  const pairs = new Map();
  const add = (userId, levelId) => {
    if (!levelVendor.has(levelId) || held.has(`${userId}:${levelId}`)) return;
    if (onlyUsers && !onlyUsers.includes(userId)) return;
    pairs.set(`${userId}:${levelId}`, { userId, levelId, vendor: levelVendor.get(levelId) });
  };

  // Exams: a passed level exam, or every per-module exam of a level.
  const passes = await readAll(() => supabase.from('training_assessment_attempts')
    .select('user_id, level_id, grand_quiz_id, quiz_kind')
    .eq('is_passed', true).in('quiz_kind', ['grand', 'capstone']));
  const perModulePassed = new Map();
  for (const a of passes) {
    if (a.grand_quiz_id == null || levelExamIds.has(a.grand_quiz_id)) { add(a.user_id, a.level_id); continue; }
    const set = perModuleByLevel.get(a.level_id);
    if (!set || !set.has(a.grand_quiz_id)) continue;
    const k = `${a.user_id}:${a.level_id}`;
    if (!perModulePassed.has(k)) perModulePassed.set(k, new Set());
    perModulePassed.get(k).add(a.grand_quiz_id);
  }
  for (const [k, got] of perModulePassed) {
    const [userId, levelId] = [k.slice(0, k.lastIndexOf(':')), Number(k.slice(k.lastIndexOf(':') + 1))];
    if (got.size === perModuleByLevel.get(levelId).size) add(userId, levelId);
  }

  // No exam on the level: every active unit done.
  const courseLevel = new Map(courses.map(c => [c.id, c.level_id]));
  const unitsByLevel = new Map();
  for (const m of modules) {
    const lv = courseLevel.get(m.course_id);
    if (lv == null || levelsWithExam.has(lv)) continue;
    if (!unitsByLevel.has(lv)) unitsByLevel.set(lv, new Set());
    unitsByLevel.get(lv).add(m.id);
  }
  const examlessUnits = [...unitsByLevel.values()].flatMap(s => [...s]);
  if (examlessUnits.length) {
    const unitLevel = new Map();
    for (const [lv, set] of unitsByLevel) for (const id of set) unitLevel.set(id, lv);
    const progress = await readAll(() => supabase.from('teacher_training_progress')
      .select('user_id, module_id').in('module_id', examlessUnits));
    const done = new Map();
    for (const p of progress) {
      const k = `${p.user_id}:${unitLevel.get(p.module_id)}`;
      if (!done.has(k)) done.set(k, new Set());
      done.get(k).add(p.module_id);
    }
    for (const [k, got] of done) {
      const levelId = Number(k.slice(k.lastIndexOf(':') + 1));
      if (got.size === unitsByLevel.get(levelId).size) add(k.slice(0, k.lastIndexOf(':')), levelId);
    }
  }
  return [...pairs.values()];
}

function summarise(rows) {
  const byVendor = {};
  for (const r of rows) byVendor[r.vendor] = (byVendor[r.vendor] || 0) + 1;
  return { levels: rows.length, teachers: new Set(rows.map(r => r.userId)).size, byVendor };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.envFile) loadEnvFile(args.envFile);
  const ref = assertTarget(args.target);
  process.stderr.write(`[settle-certificates] target=${args.target} ref=${ref} mode=${args.apply ? 'APPLY' : 'dry-run'}\n`);

  const supabase = require('../bot/shared/config/supabase');
  // The bot's config loads a .env of its own; it must not have moved us to another project.
  assertTarget(args.target);
  const candidates = await findCandidates(supabase, args.onlyUsers);
  const report = { target: args.target, ref, at: new Date().toISOString(), candidates: summarise(candidates) };

  if (args.apply) {
    // The level list's own step, per teacher: the guard decides each level, in level order.
    const { loadVisibleLevelsWithProgress } = require('../bot/shared/routes/teacher-training-endpoint');
    const users = [...new Set(candidates.map(c => c.userId))];
    const before = new Set((await readAll(() => supabase.from('training_certificates').select('user_id, level_id')
      .in('user_id', users.length ? users : ['00000000-0000-0000-0000-000000000000']))).map(c => `${c.user_id}:${c.level_id}`));
    const errors = [];
    for (const userId of users) {
      try { await loadVisibleLevelsWithProgress(userId); } catch (e) { errors.push({ userId, error: e.message }); }
    }
    const after = await readAll(() => supabase.from('training_certificates').select('user_id, level_id, certificate_code')
      .in('user_id', users.length ? users : ['00000000-0000-0000-0000-000000000000']));
    const issued = after.filter(c => !before.has(`${c.user_id}:${c.level_id}`));
    const vendorOf = new Map(candidates.map(c => [`${c.userId}:${c.levelId}`, c.vendor]));
    report.issued = summarise(issued.map(c => ({ userId: c.user_id, levelId: c.level_id, vendor: vendorOf.get(`${c.user_id}:${c.level_id}`) || 'other' })));
    report.notIssued = candidates.filter(c => !issued.some(i => i.user_id === c.userId && i.level_id === c.levelId))
      .map(c => ({ userId: c.userId, levelId: c.levelId, vendor: c.vendor }));
    report.errors = errors;
    if (errors.length) process.exitCode = 2;
  }

  const json = JSON.stringify(report, null, 2);
  if (args.out) fs.writeFileSync(args.out, json);
  console.log(json);
  return report;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(process.exitCode || 0))
    .catch(e => { console.error(`[settle-certificates] ABORTED: ${e.message}`); process.exit(1); });
}

module.exports = { findCandidates, parseArgs, assertTarget };
