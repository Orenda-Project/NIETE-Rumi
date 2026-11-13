'use strict';
/**
 * bd-8kxvg5 — add a tester to NIETE SANDBOX in one command (bot/scripts/onboarding/sandbox-tester.js).
 *
 * Operator, 9-10 Nov: "i want ppl to test it on the sandbox". The portal already signs in with number + password,
 * so a shared login is just a sandbox teacher with a known password; the WhatsApp door (Make my own in the lesson-plan
 * Flow) needs the tester's OWN number, because the bot answers whoever wrote to it. Both are this one step:
 *
 *   a registered ICT teacher (grades 3 and 6-8, the sandbox test school, a Grade 3 and a Grade 6 class),
 *   is_test_user (so nudges and broadcasts skip her), her id added to portal_lp_make_own,
 *   and, with --password, a portal password (bcrypt, as the portal's own setup writes it).
 *
 * SANDBOX ONLY, and not by convention: assertSandbox refuses unless the deployment is named "sandbox" AND the
 * database is the NIETE sandbox Supabase project. Run it through `railway run -e sandbox`; anywhere else it throws
 * before a single read.
 */

const SANDBOX_REF = 'olvritwoqujtjvwfulbh'; // NIETE sandbox Supabase (docs/environments.md); prod/staging differ
const FLAG_KEY = 'portal_lp_make_own';
const SCHOOL_ID = '8e35cffb-358d-4fa9-bb36-b5717fb53eb0'; // "SIM — Child Test School (simulation)", region ict
const SCHOOL_NAME = 'SIM — Child Test School (simulation)';
const SESSION = '2026-2027';
const GRADES = ['grade_3', 'grade_6', 'grade_7', 'grade_8'];
const CLASSES = [
  { gradeCode: 'grade_3', subjectCodes: ['maths', 'urdu', 'english'] },
  { gradeCode: 'grade_6', subjectCodes: ['english', 'maths', 'general_science'] },
];

function refusal(why) {
  return new Error(`sandbox only: ${why}. Run it with: railway run -e sandbox -s bot node bot/scripts/onboarding/sandbox-tester.js …`);
}

/** Throws unless this is the NIETE sandbox deployment AND its database. */
function assertSandbox(env = process.env) {
  const name = String(env.RAILWAY_ENVIRONMENT_NAME || '');
  if (name !== 'sandbox') throw refusal(`RAILWAY_ENVIRONMENT_NAME is "${name || 'unset'}"`);
  let host = '';
  try { host = new URL(String(env.SUPABASE_URL || '')).hostname; } catch (_) { host = ''; }
  if (host !== `${SANDBOX_REF}.supabase.co`) throw refusal(`SUPABASE_URL is not the sandbox database (${host || 'unset'})`);
}

/** Any Pakistani mobile form → the stored 923XXXXXXXXX (the portal's sanitizePhoneNumber rule). */
function toStoredPhone(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = `92${d.slice(1)}`;
  else if (d.startsWith('3') && d.length === 10) d = `92${d}`;
  if (!/^923\d{9}$/.test(d)) throw new Error(`--phone must be a Pakistani mobile (03XX XXXXXXX), got "${raw || ''}"`);
  return d;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--phone' || k === '--name' || k === '--password') { out[k.slice(2)] = argv[i + 1]; i += 1; }
    else throw new Error(`unknown argument ${k}`);
  }
  if (!out.phone) throw new Error('--phone is required');
  // The portal's validatePassword: at least 8 characters and one number.
  if (out.password !== undefined && !(String(out.password).length >= 8 && /\d/.test(out.password))) {
    throw new Error('--password needs at least 8 characters and one number');
  }
  return out;
}

function profile(name) {
  return {
    ...(name ? { name } : {}),
    role: 'teacher',
    region: 'ict',
    organization: 'niete',
    country: 'PK',
    school_id: SCHOOL_ID,
    school_name: SCHOOL_NAME,
    grades_taught: JSON.stringify(GRADES),
    subjects_taught: ['english', 'maths', 'general_science', 'urdu'],
    teacher_level: ['PRIMARY', 'MIDDLE'],
    registration_state: 'completed',
    registration_completed: true,
    is_test_user: true,
  };
}

function check(res, what) {
  if (res && res.error) throw new Error(`${what}: ${res.error.message || res.error}`);
  return res ? res.data : null;
}

async function upsertUser(db, phone, name) {
  const found = check(await db.from('users').select('id').eq('phone_number', phone).maybeSingle(), 'users read');
  if (found) {
    check(await db.from('users').update(profile(name)).eq('id', found.id), 'users update');
    return { userId: found.id, created: false };
  }
  const now = new Date().toISOString();
  const row = check(await db.from('users').insert({
    phone_number: phone, name: name || 'Sandbox Tester', preferred_language: 'en', language_locked: true,
    registration_completed_at: now, ...profile(name || 'Sandbox Tester'),
  }).select('id').single(), 'users insert');
  return { userId: row.id, created: true };
}

const decode = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (_) { return v; } };

/** Adds her id to portal_lp_make_own unless it is already on for every teacher. */
async function switchOn(db, userId) {
  const row = check(await db.from('app_settings').select('key, value').eq('key', FLAG_KEY).maybeSingle(), 'flag read');
  if (!row) {
    check(await db.from('app_settings').insert({ key: FLAG_KEY, value: [userId] }), 'flag insert');
    return 'added';
  }
  const v = decode(row.value);
  if (v === true || (typeof v === 'string' && ['true', 'teachers'].includes(v.trim().toLowerCase()))) return 'already_on';
  const list = Array.isArray(v) ? v : [];
  if (list.includes(userId)) return 'already_listed';
  check(await db.from('app_settings').update({ value: [...list, userId] }).eq('key', FLAG_KEY), 'flag update');
  return 'added';
}

async function addClasses(classes, userId) {
  for (const c of CLASSES) {
    const made = await classes.createClass({ schoolId: SCHOOL_ID, gradeCode: c.gradeCode, sessionCode: SESSION, teacherUserId: userId });
    if (!made || made.error || !made.class) throw new Error(`class ${c.gradeCode}: ${(made && made.error) || 'not made'}`);
    const res = await classes.assignTeacher({
      classId: made.class.id, teacherUserId: userId, isClassTeacher: false, subjectCodes: c.subjectCodes,
    });
    if (res && res.error) throw new Error(`class ${c.gradeCode} assign: ${res.error}`);
  }
}

/**
 * deps = { db (supabase client), classes ({ createClass, assignTeacher }), hash(pw) → bcrypt hash, env }.
 * Returns { userId, phone, created, flag, password }.
 */
async function addTester({ phone, name, password }, { db, classes, hash, env = process.env }) {
  assertSandbox(env);
  const stored = toStoredPhone(phone);
  const { userId, created } = await upsertUser(db, stored, name);
  await addClasses(classes, userId);
  const flag = await switchOn(db, userId);
  let pw = 'unchanged';
  if (password !== undefined) {
    const portalPasswordHash = await hash(password);
    check(await db.from('users').update({ portal_password_hash: portalPasswordHash, portal_activated: true }).eq('id', userId), 'password');
    pw = 'set';
  }
  return { userId, phone: stored, created, flag, password: pw };
}

module.exports = { SANDBOX_REF, FLAG_KEY, assertSandbox, toStoredPhone, parseArgs, addTester };
