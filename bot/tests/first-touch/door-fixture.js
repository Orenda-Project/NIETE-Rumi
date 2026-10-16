'use strict';
/**
 * The first-touch door's test fixture: a synthetic unknown phone, the switch maps, and an in-memory Supabase
 * (the sister's fake, which APPLIES filters) with the one table the door writes, `user_feature_first_use`,
 * UNIQUE on (user_id, feature) and an `upsert` the fake does not carry. Only the network boundary is faked.
 */
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');

const TABLE = 'user_feature_first_use';
const SISTER_ON = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true };
const GUEST_ON = { ...SISTER_ON, web_quiz_guest_home: true };
const OURS_ON = { quiz_maker_page: true, quiz_first_door: true };
const settings = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));

const UNKNOWN_USER = Object.freeze({
  id: 'u-unknown', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en',
});
const PHONE = fixturePhone(901);
const PHONE_PLUS = `+${PHONE}`;
const KID = 'e0000000-0000-4000-8000-000000000901';
const iso = (d) => new Date(d).toISOString();
const daysAgo = (n, now = Date.now()) => iso(now - n * 86400000);

/** A `user_feature_first_use` row as the table holds it. */
const firstUse = (feature, { userId = UNKNOWN_USER.id, usedAt = daysAgo(1), count = 0 } = {}) => ({
  id: `fu-${feature}-${userId}`, user_id: userId, feature, video_shown_at: usedAt, feature_used_at: usedAt, intro_shown_count: count,
});

function seedDb(supabase, { settings: s = {}, rows = [], students = [], bindings = [], sessions = [], counts = {}, throwOn = null } = {}) {
  const db = {
    app_settings: settings(s), [TABLE]: rows, students, child_phone_bindings: bindings, quiz_sessions: sessions,
    users: [{ ...UNKNOWN_USER }], quizzes: [], coaching_sessions: [], lesson_plans: [], student_lists: [],
    training_assessment_attempts: [], assessment_requests: [], class_teachers: [], message_ledger: [],
  };
  for (const [t, n] of Object.entries(counts)) {
    db[t] = Array.from({ length: n }, (_, i) => ({ id: `${t}-${i}`, teacher_id: UNKNOWN_USER.id, user_id: UNKNOWN_USER.id, is_active: true }));
  }
  const fake = makeFake(db, { uniques: { [TABLE]: ['user_id', 'feature'] } });
  const inLists = [];
  supabase.from = (t) => {
    if (throwOn && t === throwOn) throw new Error(`${t} down`);
    const b = fake.from(t);
    b.or = () => b;
    const realIn = b.in;
    b.in = (c, vs) => { inLists.push({ table: t, column: c, values: vs }); return realIn(c, vs); };
    b.upsert = (row, opts = {}) => {
      fake.calls.push({ table: t, op: 'upsert', payload: row, onConflict: opts.onConflict });
      const list = (fake.db[t] = fake.db[t] || []);
      const keys = String(opts.onConflict || '').split(',').map((k) => k.trim()).filter(Boolean);
      const hit = keys.length ? list.find((r) => keys.every((k) => r[k] === row[k])) : null;
      if (hit) Object.assign(hit, row);
      else list.push({ id: `${t}-${list.length + 1}`, intro_shown_count: 0, feature_used_at: null, ...row });
      return { then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej) };
    };
    return b;
  };
  supabase.rpc = fake.rpc;
  fake.inLists = inLists;
  return fake;
}

const reads = (fake, table) => fake.calls.filter((c) => c.table === table && c.op === 'select').length;
const firstUseReads = (fake) => reads(fake, TABLE);
const writes = (fake) => fake.calls.filter((c) => c.op !== 'select').map((c) => `${c.op}:${c.table}`);
/** Every table call except the two switch reads (which both tiers make today). */
const trace = (fake) => fake.calls.filter((c) => c.table !== 'app_settings').map((c) => `${c.op}:${c.table}`);

module.exports = {
  TABLE, SISTER_ON, GUEST_ON, OURS_ON, UNKNOWN_USER, PHONE, PHONE_PLUS, KID,
  settings, firstUse, daysAgo, iso, seedDb, reads, firstUseReads, writes, trace, fixturePhone,
};
