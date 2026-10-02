#!/usr/bin/env node
'use strict';

/**
 * Seed the NIETE SANDBOX for the child-test simulation (bd-s1oo0.3): one clearly-marked test school
 * ("SIM — …", is_probable_test = true) with a Grade 3 and a Grade 5 class of 25 children each (roll
 * numbers 1-25, placeholder names "Child 3A-07"), and one test coach (is_test_user = true) assigned
 * to it through leader_schools — the link /observe2 and the child-test draw read — plus one test
 * teacher per class (users.school_id + class_teachers), so the observe2 visit planner lists them and
 * the observed class's grade can be read from class_teachers → classes.grade_code.
 *
 * Idempotent: re-running finds what is there and fills only what is missing. Prints the ids.
 *
 *   set -a; . ~/.childtest-golive/sandbox.env; set +a
 *   NODE_PATH=bot/node_modules node scripts/child-test/seed-sandbox.js --yes-write [--coach-phone 923009990301]
 *
 * GUARD. Refuses, before the database client is even loaded, when SUPABASE_URL or DATABASE_URL
 * names a production project (NIETE ihzciabopbttygxxgrkm, Rumi jlpenspfdcwxkopaidys), when
 * SUPABASE_URL is missing, or without --yes-write.
 */

const PROD_REFS = ['ihzciabopbttygxxgrkm', 'jlpenspfdcwxkopaidys'];
const SIM_PREFIX = 'SIM —';
const SCHOOL_EMIS = 'SIM-CT-0001';
const SCHOOL_NAME = `${SIM_PREFIX} Child Test School (simulation)`;
// The form /observe2 and the coach's patch use (leader_schools.school_ext_id = 'niete:' || emis).
const SCHOOL_EXT_ID = `niete:${SCHOOL_EMIS}`;
const DEFAULT_COACH_PHONE = '923009990301';
const TEACHER_PHONES = { 3: '923009990302', 5: '923009990303' };
const CLASS_SIZE = 25;

function assertSandbox(env, argv) {
  const url = env.SUPABASE_URL || '';
  const db = env.DATABASE_URL || '';
  if (!url) throw new Error('refusing: SUPABASE_URL is not set');
  for (const ref of PROD_REFS) {
    if (url.includes(ref) || db.includes(ref)) throw new Error(`refusing: ${ref} is a PRODUCTION project`);
  }
  if (!argv.includes('--yes-write')) throw new Error('refusing to write without --yes-write');
  const m = url.match(/https?:\/\/([a-z0-9]{20})\./);
  return { ref: m ? m[1] : url };
}

function argValue(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

/** What the seed writes, as data (no ids). */
function planSeed({ sessionCode, coachPhone = DEFAULT_COACH_PHONE }) {
  const classes = [3, 5].map((grade) => ({
    grade_code: `grade_${grade}`,
    section: 'A',
    session_code: sessionCode,
    shift_code: 'morning',
    is_active: true,
    children: Array.from({ length: CLASS_SIZE }, (_, i) => ({
      roll_number: i + 1,
      student_name: `Child ${grade}A-${String(i + 1).padStart(2, '0')}`,
    })),
  }));
  const teachers = [3, 5].map((grade) => ({
    grade_code: `grade_${grade}`,
    phone_number: TEACHER_PHONES[grade],
    name: `${SIM_PREFIX} Teacher ${grade}A`,
    role: 'teacher',
    region: 'ICT',
    is_test_user: true,
    registration_completed: true,
    preferred_language: 'ur',
  }));
  return {
    school: { name: SCHOOL_NAME, region: 'ict', emis: SCHOOL_EMIS, is_active: true, is_probable_test: true },
    schoolExtId: SCHOOL_EXT_ID,
    classes,
    teachers,
    coach: {
      phone_number: coachPhone,
      name: `${SIM_PREFIX} Coach (child test)`,
      role: 'coach',
      region: 'ICT',
      is_test_user: true,
      registration_completed: true,
      preferred_language: 'ur',
    },
  };
}

async function one(q, what) {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function seed(supabase, plan) {
  // School
  let school = (await one(supabase.from('schools').select('id, name, is_probable_test').eq('emis', SCHOOL_EMIS).limit(1), 'find school'))[0];
  if (!school) school = (await one(supabase.from('schools').insert(plan.school).select('id, name, is_probable_test'), 'insert school'))[0];
  if (!school.is_probable_test) throw new Error(`school ${school.id} exists but is not marked is_probable_test — refusing to seed into it`);

  // Coach
  let coach = (await one(supabase.from('users').select('id, role, is_test_user').eq('phone_number', plan.coach.phone_number).limit(1), 'find coach'))[0];
  if (!coach) coach = (await one(supabase.from('users').insert({ ...plan.coach, school_id: school.id }).select('id, role, is_test_user'), 'insert coach'))[0];
  if (!coach.is_test_user) throw new Error(`user with phone ${plan.coach.phone_number.slice(-4)} exists and is not a test user — refusing`);

  let link = (await one(supabase.from('leader_schools').select('id, school_ext_id').eq('leader_user_id', coach.id).eq('source', 'niete_ict').eq('school_id', school.id).limit(1), 'find leader_schools'))[0];
  if (!link) {
    link = (await one(supabase.from('leader_schools').insert({
      leader_user_id: coach.id, source: 'niete_ict', school_ext_id: plan.schoolExtId, school_name: plan.school.name, emis: SCHOOL_EMIS, school_id: school.id, name_match_quality: 'exact',
    }).select('id, school_ext_id'), 'insert leader_schools'))[0];
  } else if (link.school_ext_id !== plan.schoolExtId) {
    // An earlier seed wrote the bare emis; observe2 uses 'niete:' || emis.
    await one(supabase.from('leader_schools').update({ school_ext_id: plan.schoolExtId }).eq('id', link.id).select('id'), 'fix leader_schools ext id');
  }

  const out = { schoolId: school.id, schoolExtId: plan.schoolExtId, coachUserId: coach.id, leaderSchoolsId: link.id, classes: [] };
  for (const c of plan.classes) {
    let cls = (await one(supabase.from('classes').select('id').eq('school_id', school.id).eq('grade_code', c.grade_code)
      .eq('section', c.section).eq('session_code', c.session_code).eq('shift_code', c.shift_code).eq('is_active', true).limit(1), 'find class'))[0];
    if (!cls) {
      const { children, ...row } = c;
      cls = (await one(supabase.from('classes').insert({ ...row, school_id: school.id, created_by_user_id: coach.id }).select('id'), 'insert class'))[0];
    }
    const enrolled = await one(supabase.from('class_enrollments').select('student_id, roll_number').eq('class_id', cls.id).eq('is_active', true), 'find enrolments');
    const haveRoll = new Set(enrolled.map((e) => e.roll_number));
    for (const k of c.children) {
      if (haveRoll.has(k.roll_number)) continue;
      const st = (await one(supabase.from('students').insert({
        school_id: school.id, roll_number: k.roll_number, student_name: k.student_name, status: 'active', is_active: true, enrolled_by_user_id: coach.id,
      }).select('id'), 'insert student'))[0];
      await one(supabase.from('class_enrollments').insert({
        class_id: cls.id, student_id: st.id, roll_number: k.roll_number, enrolled_on: new Date().toISOString().slice(0, 10), is_active: true,
      }).select('id'), 'insert enrolment');
    }
    const finalCount = (await one(supabase.from('class_enrollments').select('id').eq('class_id', cls.id).eq('is_active', true), 'count enrolments')).length;

    const t = plan.teachers.find((x) => x.grade_code === c.grade_code);
    const { grade_code: _g, ...teacherRow } = t;
    let teacher = (await one(supabase.from('users').select('id, is_test_user').eq('phone_number', t.phone_number).limit(1), 'find teacher'))[0];
    if (!teacher) teacher = (await one(supabase.from('users').insert({ ...teacherRow, school_id: school.id }).select('id, is_test_user'), 'insert teacher'))[0];
    if (!teacher.is_test_user) throw new Error(`user with phone ${t.phone_number.slice(-4)} exists and is not a test user — refusing`);
    const ct = (await one(supabase.from('class_teachers').select('id').eq('class_id', cls.id).eq('teacher_user_id', teacher.id).eq('is_active', true).limit(1), 'find class_teachers'))[0]
      || (await one(supabase.from('class_teachers').insert({ class_id: cls.id, teacher_user_id: teacher.id, is_class_teacher: true, is_active: true }).select('id'), 'insert class_teachers'))[0];
    out.classes.push({ grade: c.grade_code, section: c.section, classId: cls.id, enrolled: finalCount, teacherUserId: teacher.id, classTeacherId: ct.id });
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const { ref } = assertSandbox(process.env, argv);
  const { sessionCodeFor } = require('../../bot/shared/services/child-test/draw/cycle');
  const supabase = require('../../bot/shared/config/supabase');
  const plan = planSeed({ sessionCode: sessionCodeFor(new Date()), coachPhone: argValue(argv, '--coach-phone', DEFAULT_COACH_PHONE) });
  console.log(`[seed] sandbox project ${ref}`);
  const out = await seed(supabase, plan);
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main().catch((e) => { console.error(`[seed] ${e.message}`); process.exit(1); });
}

module.exports = { assertSandbox, planSeed, seed, SIM_PREFIX, SCHOOL_EMIS, SCHOOL_EXT_ID, PROD_REFS };
