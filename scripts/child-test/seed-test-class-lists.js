#!/usr/bin/env node
'use strict';

/**
 * Give TEST schools realistic class lists, so a coach's Learning assessment (EGRA/EGMA) and a teacher's class list have
 * children to show. Sandbox (or a local stack) only. The plan is test-class-lists.js (pure, tested in
 * tests/scripts/seed-test-class-lists.test.js); the write is ClassService.importRoster, the same writer a coach's
 * /roster save uses: the class (or the existing empty one), its class teacher, the legacy student_lists mirror, then
 * the children in one idempotent RPC keyed by a run id per class.
 *
 *   # whose schools: a coach's (leader_schools), or named by EMIS (repeat --school)
 *   NODE_PATH=bot/node_modules node scripts/child-test/seed-test-class-lists.js --env-file <sandbox env> --coach-phone-file <file>
 *   NODE_PATH=bot/node_modules node scripts/child-test/seed-test-class-lists.js --env-file <sandbox env> --school SCDEMO-0001 --school 8801
 *   ... --yes-write [--manifest <file>]          # writes; the manifest lists every row it made, for --undo
 *   ... --undo <manifest> [--yes-write]          # removes exactly those rows (a list a coach already drew from stays)
 *
 * Options: --grades 1,2,3,4,5 (default; a teacher's own 6-12 grade is added) · --min 20 --max 35 (children per class) ·
 * --max-sections 2 · --created-by <users.id> (who "imported" a list with no class teacher; default the coach).
 *
 * GUARDS. Refuses before the database client loads unless SUPABASE_URL is the sandbox project or a local stack; refuses
 * any school not marked is_probable_test; never links a teacher whose number can reach a real phone; never adds to a
 * class that already has children. Children get invented "<Name> Testwala" names and no phone. Without --yes-write it
 * only prints the plan. Prints ids, class labels and teacher names; never a phone number.
 */

const fs = require('fs');
const path = require('path');
const plan = require('./test-class-lists');

// The bot's logger takes over console.log once its modules load (structured JSON, shipped to the log backend): print plainly.
const say = (s) => process.stdout.write(`${s}\n`);

function args(argv) {
  const out = { schools: [], grades: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => { i += 1; return argv[i]; };
    if (a === '--env-file') out.envFile = v();
    else if (a === '--school') out.schools.push(v());
    else if (a === '--coach-phone-file') out.coachPhoneFile = v();
    else if (a === '--coach-id') out.coachId = v();
    else if (a === '--created-by') out.createdBy = v();
    else if (a === '--grades') out.grades = v().split(',').map(Number);
    else if (a === '--min') out.min = Number(v());
    else if (a === '--max') out.max = Number(v());
    else if (a === '--max-sections') out.maxSections = Number(v());
    else if (a === '--manifest') out.manifest = v();
    else if (a === '--undo') out.undo = v();
    else if (a === '--yes-write') out.write = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

function loadEnv(file) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function rows(q, what) {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data || [];
}

async function chunked(ids, fn) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...(await fn(ids.slice(i, i + 200))));
  return out;
}

async function resolveSchools(sb, o) {
  let coachId = o.coachId || null;
  if (o.coachPhoneFile) {
    const phone = fs.readFileSync(o.coachPhoneFile, 'utf8').trim();
    const found = await rows(sb.from('users').select('id, role').eq('phone_number', phone).is('deleted_at', null), 'find coach');
    if (found.length !== 1) throw new Error(`coach: ${found.length} live users have that number`);
    coachId = found[0].id;
  }
  let schoolIds = [];
  if (coachId) {
    const links = await rows(sb.from('leader_schools').select('school_id').eq('leader_user_id', coachId).not('school_id', 'is', null), 'leader_schools');
    schoolIds = links.map((l) => l.school_id);
  }
  if (o.schools.length) {
    const named = await rows(sb.from('schools').select('id, emis').in('emis', o.schools), 'schools by emis');
    const missing = o.schools.filter((e) => !named.some((s) => s.emis === e));
    if (missing.length) throw new Error(`no school with EMIS ${missing.join(', ')}`);
    schoolIds.push(...named.map((s) => s.id));
  }
  schoolIds = [...new Set(schoolIds)];
  if (!schoolIds.length) throw new Error('no schools: pass --school <EMIS> or a coach with linked schools');
  const schools = await rows(sb.from('schools').select('id, name, emis, is_probable_test, is_active').in('id', schoolIds), 'schools');
  return { coachId, schools: schools.sort((a, b) => String(a.emis).localeCompare(String(b.emis))) };
}

async function loadSchool(sb, school, sessionCode) {
  const teachers = await rows(sb.from('users').select('id, name, role, phone_number, grades_taught, deleted_at').eq('school_id', school.id).is('deleted_at', null), 'teachers');
  const classes = await rows(sb.from('classes').select('id, grade_code, section, shift_code, session_code, is_active')
    .eq('school_id', school.id).eq('session_code', sessionCode).eq('is_active', true), 'classes');
  const ids = classes.map((c) => c.id);
  const enrol = ids.length ? await chunked(ids, (part) => rows(sb.from('class_enrollments').select('class_id').in('class_id', part).eq('is_active', true).is('left_on', null), 'enrolments')) : [];
  const links = ids.length ? await rows(sb.from('class_teachers').select('class_id, teacher_user_id, is_class_teacher').in('class_id', ids).eq('is_active', true), 'class_teachers') : [];
  for (const c of classes) {
    c.enrolled = enrol.filter((e) => e.class_id === c.id).length;
    const ct = links.find((l) => l.class_id === c.id && l.is_class_teacher);
    c.classTeacherId = ct ? ct.teacher_user_id : null;
  }
  return { teachers, classes };
}

const label = (c) => `Grade ${c.grade}${c.section ? ` - ${c.section}` : ''}`;

function printPlan(p) {
  say(`\n${p.school.name} (${p.school.emis || p.school.id}) · ${p.gender} · session ${p.sessionCode}`);
  for (const c of p.classes) {
    const who = c.classTeacher ? c.classTeacher.name : '(no class teacher: imported by the coach)';
    const what = c.students ? `${c.students.length} children (${c.students.filter((s) => s.gender === 'girl').length} girls)` : `left alone (${c.skip})`;
    say(`  ${label(c).padEnd(13)} ${c.existingClassId ? 'existing' : 'new     '}  ${what.padEnd(26)} ${who}`);
  }
  if (p.unassignedTeachers.length) say(`  not a class teacher: ${p.unassignedTeachers.map((t) => t.name).join(', ')}`);
  if (p.skippedTeachers.length) say(`  never linked (a number that reaches a real phone): ${p.skippedTeachers.length}`);
}

async function idsOf(sb, table, classId) {
  return (await rows(sb.from(table).select('id').eq('class_id', classId), table)).map((r) => r.id);
}

async function seed(o) {
  const sb = require('../../bot/shared/config/supabase'); // eslint-disable-line global-require
  const ClassService = require('../../bot/shared/services/classes/class.service'); // eslint-disable-line global-require
  const { sessionCodeFor } = require('../../bot/shared/services/child-test/draw/cycle'); // eslint-disable-line global-require
  const sessionCode = sessionCodeFor(new Date());
  const { coachId, schools } = await resolveSchools(sb, o);
  const createdBy = o.createdBy || coachId || null;
  const manifest = { made_at: new Date().toISOString(), target: plan.assertTarget(process.env).ref, sessionCode, createdBy, classes: [] };

  const plans = [];
  for (const school of schools) {
    const { teachers, classes } = await loadSchool(sb, school, sessionCode);
    const p = plan.planSchool({ school, teachers, classes, sessionCode, grades: o.grades || undefined, minSize: o.min || undefined, maxSize: o.max || undefined, maxSections: o.maxSections || undefined });
    plans.push(p);
    printPlan(p);
  }
  if (!o.write) { say('\nDry run: nothing written. Add --yes-write to write.'); return; }

  for (const p of plans) {
    for (const c of p.classes.filter((x) => x.students)) {
      const owner = createdBy || (c.classTeacher && c.classTeacher.id);
      if (!owner) { say(`  ${p.school.emis} ${label(c)}: skipped, no class teacher and no --created-by`); continue; }
      const before = c.existingClassId ? { lists: await idsOf(sb, 'student_lists', c.existingClassId), links: await idsOf(sb, 'class_teachers', c.existingClassId) } : { lists: [], links: [] };
      const out = await ClassService.importRoster({
        runId: c.runId, schoolId: p.school.id, gradeCode: c.gradeCode, section: c.section, shiftCode: c.shiftCode, sessionCode,
        classTeacherUserId: c.classTeacher ? c.classTeacher.id : null, createdByUserId: owner,
        students: c.students.map((s) => ({ roll_number: s.roll_number, student_name: s.student_name, father_name: s.father_name })),
      });
      if (!out.classId) throw new Error(`${p.school.emis} ${label(c)}: ${out.error || 'no class'}`);
      const lists = (await idsOf(sb, 'student_lists', out.classId)).filter((id) => !before.lists.includes(id));
      const links = (await idsOf(sb, 'class_teachers', out.classId)).filter((id) => !before.links.includes(id));
      manifest.classes.push({ school: p.school.emis, schoolId: p.school.id, label: label(c), classId: out.classId, createdClass: !c.existingClassId,
        runId: c.runId, added: out.added, replay: !!out.replay, studentLists: lists, classTeachers: links, error: out.error || null });
      say(`  ${p.school.emis} ${label(c)}: ${out.replay ? 'already seeded' : `${out.added} children added`}${out.error ? ` (${out.error})` : ''}`);
    }
  }
  const file = o.manifest || path.resolve(`seed-test-class-lists-${manifest.made_at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 1));
  say(`\nManifest (for --undo): ${file}`);
}

async function undo(o) {
  const sb = require('../../bot/shared/config/supabase'); // eslint-disable-line global-require
  const m = JSON.parse(fs.readFileSync(o.undo, 'utf8'));
  for (const c of m.classes) {
    const students = (await rows(sb.from('students').select('id').eq('import_run_id', c.runId), 'students')).map((s) => s.id);
    say(`${c.school} ${c.label}: ${students.length} children, ${c.classTeachers.length} teacher links, ${c.studentLists.length} lists${c.createdClass ? ', the class' : ''}`);
    if (!o.write) continue;
    const step = async (what, q) => { const { error } = await q; if (error) say(`  kept ${what}: ${error.message}`); return !error; };
    if (students.length) {
      await chunked(students, async (part) => { await step('enrolments', sb.from('class_enrollments').delete().in('student_id', part).eq('class_id', c.classId)); return []; });
      await chunked(students, async (part) => { await step('children', sb.from('students').delete().in('id', part).eq('import_run_id', c.runId)); return []; });
    }
    if (c.classTeachers.length) await step('teacher links', sb.from('class_teachers').delete().in('id', c.classTeachers));
    if (c.studentLists.length) await step('lists', sb.from('student_lists').delete().in('id', c.studentLists));
    if (c.createdClass) await step('class', sb.from('classes').delete().eq('id', c.classId));
  }
  if (!o.write) say('\nDry run: nothing removed. Add --yes-write to remove.');
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.envFile) loadEnv(o.envFile);
  plan.assertTarget(process.env); // before any database client is loaded
  if (o.undo) await undo(o);
  else await seed(o);
}

if (require.main === module) {
  main().catch((e) => { console.error(`seed-test-class-lists: ${e.message}`); process.exit(1); });
}

module.exports = { args };
