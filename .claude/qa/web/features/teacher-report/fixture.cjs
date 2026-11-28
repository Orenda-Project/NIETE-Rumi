// teacher-report/fixture — a teacher of her OWN for each teacher-report / teacher-report-pdf scenario, made by SQL on
// THIS run's local database (never a shared one): her class lists and children, a sent quiz (the demo's "Parts of a
// Plant" questions copied), its class code, and children who finish it through the real child-quiz API (/api/wq). A
// fresh teacher per scenario keeps one scenario's finishes out of another's counts, and lets a scenario have two class
// lists of a grade, or none. Report tokens are minted with the bot's own token module from this run's bot tree.
'use strict';
const path = require('path');
const crypto = require('crypto');
const { expect } = require('../../lib.cjs');

const q = (s) => (s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'");
const uuid = () => crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function one(ctx, sql) { const out = await ctx.sql(sql); return out == null ? '' : String(out).split('\n')[0].trim(); }

// The bot's own modules, from this run's bot tree, signing with the stack's key.
function botModule(ctx, rel) {
  expect(ctx.runDir && ctx.internalKey, 'no run dir / internal key on ctx (e2e-web.sh passes WEB_RUN_DIR + WEB_INTERNAL_KEY)');
  if (!process.env.INTERNAL_API_KEY) process.env.INTERNAL_API_KEY = ctx.internalKey;
  return require(path.join(ctx.runDir, 'src', 'bot', rel));
}
const reportTokens = (ctx) => botModule(ctx, 'shared/services/quiz/teacher-report-token.js');
const quizTokens = (ctx) => botModule(ctx, 'shared/services/quiz/web-quiz-token.js');

// A code no other row has: 8 capitals/digits (the child page accepts 6–8).
const newCode = () => 'TR' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);

/**
 * teacher(ctx, { lists: [{ grade, section, kids: [name | [name, father]] }], lang, quiz: { grade, language, bound } })
 * → { teacherId, phone, lists: [{ id, label, kids: [{ id, name, first, roll }] }], quizId, code, shareCodeId }
 * The quiz copies the demo plant quiz's five questions (or the Urdu one's when language is 'ur').
 */
async function teacher(ctx, opts = {}) {
  const teacherId = uuid();
  const phone = '9230077' + String(Math.floor(Math.random() * 1e5)).padStart(5, '0');
  const lang = opts.lang || 'en';
  // a school of her own: classes are unique per school + grade + section, so two fixture teachers never collide
  const school = uuid();
  await ctx.sql('insert into schools (id, name, region, is_active, is_probable_test) values (' + [q(school), q('Report Fixture School ' + school.slice(0, 8)), q('ict'), 'true', 'true'].join(', ') + ')');
  await ctx.sql('insert into users (id, phone_number, name, role, school_id, country, region, organization, preferred_language, '
    + "registration_completed, registration_state, is_test_user, grades_taught, subjects_taught, subject) values ("
    + [q(teacherId), q(phone), q('Report Teacher'), q('teacher'), q(school || null), q('Pakistan'), q('ict'), q('niete'), q(lang),
      'true', q('completed'), 'false', q('5'), "'[\"science\"]'::jsonb", q('science')].join(', ') + ')');
  const lists = [];
  for (const L of opts.lists || []) {
    const listId = uuid(), classId = uuid(), ctId = uuid();
    // a class as the portal keeps it (classes + class_teachers + a mirrored student_lists row + enrolments), exactly as
    // the demo seed builds the science teacher's: the class pick ("Which class was this for?") binds the code to it
    await ctx.sql('insert into classes (id, school_id, grade_code, section, shift_code, session_code, is_active, created_by_user_id) values ('
      + [q(classId), q(school), q('grade_' + L.grade), q(L.section), q('morning'), q('2026-2027'), 'true', q(teacherId)].join(', ') + ')');
    await ctx.sql('insert into class_teachers (id, class_id, teacher_user_id, is_class_teacher, is_active) values (' + [q(ctId), q(classId), q(teacherId), 'false', 'true'].join(', ') + ')');
    await ctx.sql('insert into student_lists (id, user_id, class_id, class_name, section, academic_year, student_count, is_active) values ('
      + [q(listId), q(teacherId), q(classId), q('Grade ' + L.grade + '-' + L.section), q(L.section), q('2026-2027'), String(L.kids.length), 'true'].join(', ') + ')');
    const kids = [];
    for (let i = 0; i < L.kids.length; i++) {
      const [name, father] = Array.isArray(L.kids[i]) ? L.kids[i] : [L.kids[i], null];
      const id = uuid(), roll = i + 1;
      await ctx.sql('insert into students (id, list_id, roll_number, student_name, father_name, school_id, enrolled_by_user_id, is_active, status) values ('
        + [q(id), q(listId), String(roll), q(name), q(father), q(school || null), q(teacherId), 'true', q('active')].join(', ') + ')');
      await ctx.sql('insert into class_enrollments (id, class_id, student_id, roll_number, enrolled_on, is_active) values ('
        + [q(uuid()), q(classId), q(id), String(roll), 'current_date', 'true'].join(', ') + ')');
      kids.push({ id, name, first: name.split(' ')[0], roll });
    }
    lists.push({ id: listId, classId, label: L.grade + '-' + L.section, grade: L.grade, kids });
  }
  const T = { teacherId, phone, school, lists };
  if (opts.quiz === false) return T;
  return { ...T, ...(await addQuiz(ctx, T, opts.quiz || {})) };
}

/** Another sent quiz of the same teacher (its own code): { quizId, code, shareCodeId, topic, language }. */
async function addQuiz(ctx, T, Q = {}) {
  const { teacherId, lists } = T;
  const quizId = uuid(), code = newCode(), shareCodeId = uuid();
  const language = Q.language || 'en';
  const src = language === 'ur' ? 'پودے کے حصے' : 'Parts of a Plant';
  const topic = Q.topic || (language === 'ur' ? 'پودے کے حصے' : 'Parts of a plant');
  const bound = Q.bound === undefined ? (lists[0] ? lists[0].id : null) : Q.bound;
  await ctx.sql('insert into quizzes (id, teacher_id, quiz_source, topic, grade, subject, status, language, total_students_sent, created_at, list_id, meta) values ('
    + [q(quizId), q(teacherId), q('lesson_plan'), q(topic), q(String(Q.grade || '5')), q('science'), q(Q.status || 'sent'), q(language), '0',
      "now() - interval '" + (Q.hoursAgo || 2) + " hours'", q(bound), q(JSON.stringify({ share_code_id: shareCodeId, ...(Q.meta || {}) })) + '::jsonb'].join(', ') + ')');
  // the source quiz's first five plain questions (the Urdu one has a sixth, picture, question: left out)
  await ctx.sql('insert into quiz_questions (id, quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty_level, sort_order) '
    + 'select gen_random_uuid(), ' + q(quizId) + ', question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty_level, sort_order '
    + 'from quiz_questions where quiz_id = (select id from quizzes where topic = ' + q(src) + ' order by created_at limit 1) and sort_order <= 5');
  await ctx.sql('insert into quiz_share_codes (id, code, quiz_id, teacher_user_id, teacher_name, topic, language, active, uses_count, expires_at, created_at) values ('
    + [q(shareCodeId), q(code), q(quizId), q(teacherId), q('Report Teacher'), q(topic), q(language), 'true', '0', 'null', "now() - interval '" + (Q.hoursAgo || 2) + " hours'"].join(', ') + ')');
  return { quizId, code, shareCodeId, topic, language };
}

// The child-quiz API, as the page calls it (the portal's /api/wq edge → the bot).
async function wq(ctx, method, p, body) {
  const r = await fetch(ctx.baseUrl + '/api/wq/' + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
  return { status: r.status, json };
}
/**
 * One child finishes the quiz on the real API: a class-list child by their chip, anyone else by a typed name.
 * `wrong`: question indexes answered wrong. `finish: false` starts and answers but never finishes.
 */
async function play(ctx, T, who, { wrong = [], finish = true } = {}) {
  const quiz = await wq(ctx, 'GET', 'quiz/' + T.code);
  expect(quiz.status === 200, 'GET quiz/' + T.code + ' -> ' + quiz.status);
  const qs = quiz.json.quiz.questions;
  const body = who.id
    ? { code: T.code, chip: quizTokens(ctx).chipId(T.shareCodeId, who.id) }
    : { code: T.code, new: { name: who.name, cls: String(quiz.json.quiz.grade || ''), force: true } };
  let s;
  for (let i = 0; i < 4; i++) {           // a parallel stack's local Postgres can be slow to answer the first start
    s = await wq(ctx, 'POST', 'session', body);
    if (s.status === 200) break;
    // a typed child on a quiz two class lists could be for: the page asks "Which class?" — answer with `who.cls` (a label)
    if (s.status === 409 && s.json && s.json.error === 'which_class') {
      const pick = s.json.classes.find((c) => c.label === who.cls) || s.json.classes[0];
      body.list = pick.key;
      continue;
    }
    await sleep(800);
  }
  expect(s.status === 200, 'POST session for ' + (who.name || who.first) + ' -> ' + s.status + ' ' + JSON.stringify(s.json).slice(0, 160));
  const wrongSlot = (x) => x.options.map((o) => o.slot).find((sl) => !String(x.correct_slot).split(',').includes(sl));
  const a = qs.map((x, i) => ({ qid: x.qid, slot: wrong.includes(i) ? wrongSlot(x) : String(x.correct_slot), ms: 1500 }));
  const ans = await wq(ctx, 'POST', 'answers', { st: s.json.st, a: finish ? a : a.slice(0, 2) });
  expect(ans.status === 200, 'POST answers -> ' + ans.status);
  if (!finish) return { st: s.json.st };
  const f = await wq(ctx, 'POST', 'finish', { st: s.json.st });
  expect(f.status === 200, 'POST finish -> ' + f.status + ' ' + JSON.stringify(f.json).slice(0, 160));
  return { st: s.json.st, result: f.json };
}

const reportUrl = (ctx, T, { quiz = true, ttlS, now, query = '' } = {}) => {
  const tok = reportTokens(ctx).signTeacherReport({ teacherId: T.teacherId, quizId: quiz ? T.quizId : null, ...(ttlS ? { ttlS } : {}), ...(now ? { now } : {}) });
  expect(tok, 'could not sign a report token');
  return { token: tok, url: ctx.baseUrl + '/r/' + tok + query };
};

// ── app switches the bot caches for 30 s (teacher-jugnu-flags, web-quiz-class-link-flags, web-quiz-class-week-flags,
// teacher-report-gate, web-quiz-identity-flags: TTL_MS constants, not the lane's 1 s APP_SETTINGS_FLAG_TTL_MS). A scenario
// names the switches it needs; only the ones whose stored value differs are written, and then the call waits until 31 s
// have passed since the LAST write of this run, so a scenario never reads a cached value from before its own write.
let lastWrite = 0;
async function switches(ctx, want) {
  let wrote = false;
  for (const [key, value] of Object.entries(want)) {
    const json = value === null ? null : JSON.stringify(value);
    const now = await one(ctx, 'select value::text from app_settings where key = ' + q(key));
    if (json === null ? now === '' : now === json) continue;
    if (json === null) await ctx.sql('delete from app_settings where key = ' + q(key));
    else await ctx.sql('insert into app_settings (key, value) values (' + q(key) + ', ' + q(json) + "::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()");
    wrote = true;
  }
  if (wrote) lastWrite = Date.now();
  const left = lastWrite + 31000 - Date.now();
  if (left > 0) await sleep(left);
}

// The schema the Jugnu tab and the class week card read (the child identity store, the Challenge v2 runs and rungs, the
// class link, the passage registry, the class draw): migrations the lane's database snapshot does not carry yet. Each file
// is CREATE … IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, applied to THIS run's database only, then PostgREST reloads.
const JUGNU_SCHEMA = ['child_identity.sql', 'child_phone_bindings_code.sql', 'child_identity_merge_tier.sql', 'web_quiz_challenge_runs_v2.sql', 'web_quiz_class_link.sql', 'web_quiz_challenge_registry.sql', 'web_quiz_class_round.sql'];
async function jugnuSchema(ctx) {
  const fs = require('fs');
  const dir = path.join(ctx.runDir, 'src', 'bot', 'database', 'migrations');
  for (const f of JUGNU_SCHEMA) await ctx.sql(fs.readFileSync(path.join(dir, f), 'utf8'));
  await ctx.sql("notify pgrst, 'reload schema'");
  await sleep(1500);
}

// The pdf text helper of the E2E engine (pages, bytes, text) — never eyeballed.
function pdfText(file) {
  const { execFileSync } = require('child_process');
  const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
  const out = execFileSync('python3', [path.join(ROOT, '.claude', 'qa', 'engine', 'bin', 'pdf_text.py'), file], { encoding: 'utf8' });
  const r = JSON.parse(out);
  expect(r.ok, 'pdf_text could not read ' + file + ': ' + out.slice(0, 160));
  return r;
}

// ── the scheduled class report (teacher-report-pdf) ─────────────────────────────────────────────────────────────────
// The report is the worker's job: quiz_video_report for one class code → video-quiz-report.service generate(), which
// renders the PDF, uploads it and sends it with its caption and the links text — here to the MOCK WhatsApp of this run.
// The job is put on this run's own queue (BullMQ on the run's private redis) by the bot's own queue module, in a child
// process started in the run's bot tree with its .env (exactly the producer the bot uses); the running worker takes it.
function enqueueReport(ctx, shareCodeId) {
  const { execFileSync } = require('child_process');
  const src = path.join(ctx.runDir, 'src');
  const js = "const m=require('module').createRequire(process.cwd()+'/bot/x.js');m('dotenv').config({path:process.cwd()+'/.env',quiet:true});"
    + "m('./shared/services/queue').queueJob(process.argv[1],'quiz_video_report',{shareCodeId:process.argv[1]},{deduplicationId:process.argv[1]+'-e2e-'+Date.now()})"
    + ".then(()=>process.exit(0),(e)=>{process.stderr.write('QUEUE_FAIL '+e.message);process.exit(1);});";
  execFileSync(process.execPath, ['-e', js, shareCodeId], { cwd: src, stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 });
}
async function mockGet(ctx, p) {
  expect(ctx.mockUrl, 'no mock WhatsApp for this run (WEB_MOCK_URL)');
  return (await fetch(ctx.mockUrl + p)).json();
}
/**
 * Send T's class report as the scheduler would, and wait for it on the mock WhatsApp:
 * → { doc (the document item: caption = doc.txt), after: [items sent to the teacher after it], pdf: { pages, text, bytes } }
 * or { none: true, items } when no document reached the teacher within `ms`.
 */
async function classReport(ctx, T, { ms = 60000 } = {}) {
  const { last } = await mockGet(ctx, '/outbox?to=' + T.phone);
  enqueueReport(ctx, T.shareCodeId);
  const until = Date.now() + ms;
  let items = [];
  while (Date.now() < until) {
    items = (await mockGet(ctx, '/outbox?to=' + T.phone + '&after=' + (last || 0))).items || [];
    const i = items.findIndex((x) => x.type === 'document');
    if (i >= 0) {
      await sleep(2500);                                                       // the links text follows the document
      items = (await mockGet(ctx, '/outbox?to=' + T.phone + '&after=' + (last || 0))).items || [];
      const doc = items.find((x) => x.type === 'document');
      const bytes = Buffer.from(await (await fetch(ctx.mockUrl + '/media/' + doc.media.id + '/bytes')).arrayBuffer());
      const file = path.join(require('os').tmpdir(), 'class-report-' + process.pid + '-' + Date.now() + '.pdf');
      require('fs').writeFileSync(file, bytes);
      try { return { doc, after: items.slice(items.indexOf(doc) + 1), pdf: pdfText(file) }; } finally { require('fs').rmSync(file, { force: true }); }
    }
    await sleep(1000);
  }
  return { none: true, items };
}

module.exports = { classReport, enqueueReport, addQuiz, switches, jugnuSchema, pdfText, q, one, uuid, sleep, teacher, play, wq, reportUrl, reportTokens, quizTokens, botModule };
