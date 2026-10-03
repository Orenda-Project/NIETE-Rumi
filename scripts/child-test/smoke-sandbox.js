#!/usr/bin/env node
'use strict';

/**
 * Live smoke of the child-test draw and store against the NIETE SANDBOX database (bd-s1oo0.3):
 * the real supabase-js client, the real V1.5.9 tables, triggers and unique keys — what the unit
 * tests' fake cannot prove. Since V1.6.0 (bd-s1oo0.11) it also draws two visits with no observe2
 * field form, named by visit key (day:… for /egra with no visit, cs:… after classic /observe). Runs on the SIM school from seed-sandbox.js, with a throwaway draw
 * secret, and deletes every row it wrote (its visit, frames, sessions, blocks) at the end, so the
 * simulation later draws the SIM school fresh with the real secret.
 *
 *   set -a; . ~/.childtest-golive/sandbox.env; set +a
 *   NODE_PATH=bot/node_modules node scripts/child-test/smoke-sandbox.js --yes-write
 *
 * Refuses on a production project, without --yes-write, or when the SIM school already has draws
 * (it would otherwise delete a simulation's data).
 */

const assert = require('assert');
const crypto = require('crypto');
const { assertSandbox, SCHOOL_EMIS, SCHOOL_EXT_ID } = require('./seed-sandbox');

async function main() {
  const argv = process.argv.slice(2);
  const { ref } = assertSandbox(process.env, argv);
  process.env.CHILD_TEST_DRAW_SECRET = `smoke-${Date.now()}`;
  const supabase = require('../../bot/shared/config/supabase');
  const draw = require('../../bot/shared/services/child-test/draw');
  const store = require('../../bot/shared/services/child-test/store');
  const { visitKeyFor } = require('../../bot/shared/services/child-test/draw/visit-key');
  console.log(`[smoke] sandbox project ${ref}`);

  const { data: schools, error: se } = await supabase.from('schools').select('id').eq('emis', SCHOOL_EMIS);
  if (se || !schools || schools.length !== 1) throw new Error('SIM school not found — run seed-sandbox.js first');
  const schoolId = schools[0].id;
  const { data: link } = await supabase.from('leader_schools').select('leader_user_id').eq('school_id', schoolId).limit(1);
  const coachUserId = link[0].leader_user_id;
  const { data: already } = await supabase.from('child_test_draws').select('id').eq('school_id', schoolId).limit(1);
  if (already && already.length) throw new Error('the SIM school already has draws — refusing (would delete simulation data)');

  const { data: visit, error: ve } = await supabase.from('observation_field_forms')
    .insert({ observer_user_id: coachUserId, visit_context: { school_ext_id: SCHOOL_EXT_ID }, rubric_version: 'child-test-smoke' })
    .select('id').single();
  if (ve) throw new Error(`visit insert: ${ve.message}`);
  const visitId = visit.id;
  const results = [];
  const check = (name, cond) => { assert.ok(cond, name); results.push(name); };

  try {
    const school = await draw.resolveVisitSchool({ coachUserId, visitId });
    check('resolveVisitSchool → the SIM school', school.ok && school.schoolId === schoolId);

    const a = await draw.todaysList({ coachUserId, schoolId, visitId, observedGrade: 3 });
    check('todaysList ok, Grade 3, 5 children + 2 alternates', a.ok && a.grade === 3 && a.children.length === 5 && a.alternates.length === 2);
    // L25: no roll is carried; each child carries the roster's class label (Form A = this term's set, CHILD_TEST_FORM_POLICY=term).
    check('all new, Form A, class label and no roll', a.children.every((k) => k.role === 'new' && k.form === 'A' && k.classLabel && !('rollNumber' in k)));
    const { data: frame } = await supabase.from('child_test_draws').select('draw_rank, frame_size').eq('school_id', schoolId).eq('grade', 3);
    check('frame of 25 written with ranks 1..25', frame.length === 25 && new Set(frame.map((r) => r.draw_rank)).size === 25 && frame.every((r) => r.frame_size === 25));

    const b = await draw.todaysList({ coachUserId, schoolId, visitId, observedGrade: 5 });
    check('reopen: same list, reused', b.ok && b.reused && JSON.stringify(b.children.map((k) => k.drawId)) === JSON.stringify(a.children.map((k) => k.drawId)));

    const absent = await draw.markOutcome({ drawId: a.children[1].drawId, outcome: 'absent', note: 'smoke' });
    check('absent: alternate promoted, alternates topped up to 2', absent.ok
      && absent.list.children.filter((k) => k.status === 'listed').length === 5 && absent.list.alternates.length === 2);

    const present = await draw.markOutcome({ drawId: a.children[0].drawId, outcome: 'present' });
    check('present → tested', present.ok && present.list.children[0].status === 'tested');
    const again = await draw.markOutcome({ drawId: a.children[0].drawId, outcome: 'absent' });
    check('second outcome refused', !again.ok && again.reason === 'already_marked');

    const s = await store.createSession({ drawId: a.children[0].drawId, coachUserId, visitId, itemBankVersion: 'child-test-items-v1' });
    check('session created from the draw', s.ok && s.created && s.session.frame_size === 25 && s.session.form === 'A');
    const s2 = await store.createSession({ drawId: a.children[0].drawId, coachUserId, visitId });
    check('one session per draw', s2.ok && !s2.created && s2.session.id === s.session.id);
    await store.recordTiming(s.session.id, 'urdu.card_sent');
    const media = await store.attachBlockMedia({ sessionId: s.session.id, block: 'urdu', audioR2Key: 'child-test/sandbox/smoke/urdu.ogg' });
    check('block media attached', media.ok && media.block.audio_r2_key);
    const ai = await store.saveAiMarks({ sessionId: s.session.id, block: 'urdu', aiMarks: { version: 'ai-marks-v1', story: { words_correct: 40 } }, modelVersions: { counts: 'smoke' } });
    check('ai marks saved', ai.ok && ai.block.ai_status === 'scored');
    const ai2 = await store.saveAiMarks({ sessionId: s.session.id, block: 'urdu', aiMarks: { version: 'ai-marks-v1', story: { words_correct: 99 } } });
    check('ai marks written once', !ai2.ok && ai2.alreadyScored && ai2.block.ai_marks.story.words_correct === 40);
    const { error: trig } = await supabase.from('child_test_blocks').update({ ai_marks: { tampered: true } }).eq('id', ai.block.id);
    check('database trigger refuses a direct change to ai_marks', trig && /written once/.test(trig.message));
    const coach = await store.saveCoachMarks({ sessionId: s.session.id, block: 'urdu', coachMarks: { version: 'ai-marks-v1', story: { words_correct: 42 } }, coachEdits: [{ path: 'story.words_correct', ai: 40, coach: 42 }] });
    check('coach marks saved next to the AI marks', coach.ok && coach.block.ai_marks.story.words_correct === 40 && coach.block.coach_marks.story.words_correct === 42);
    const { error: rankTrig } = await supabase.from('child_test_draws').update({ draw_rank: 999 }).eq('id', a.children[2].drawId);
    check('database trigger refuses a rank change (no redraw)', rankTrig && /cannot change/.test(rankTrig.message));

    // ── V1.6.0: visits with no observe2 field form, named by key ──
    const dayKey = visitKeyFor({ coachUserId, schoolId });
    const d1 = await draw.todaysList({ coachUserId, schoolId, visitKey: dayKey, observedGrade: 5 });
    check('day key: todaysList ok, Grade 5, 5 children + 2 alternates', d1.ok && d1.grade === 5 && d1.children.length === 5 && d1.alternates.length === 2 && !d1.reused);
    const { data: keyed } = await supabase.from('child_test_draws').select('visit_key, last_listed_visit_id').eq('school_id', schoolId).eq('visit_key', dayKey);
    check('day key: the 7 rows carry visit_key and no visit id', keyed.length === 7 && keyed.every((r) => r.last_listed_visit_id === null));
    const d2 = await draw.todaysList({ coachUserId, schoolId, visitKey: dayKey, observedGrade: 5 });
    check('day key: reopen gives the same list', d2.ok && d2.reused && JSON.stringify(d2.children.map((k) => k.drawId)) === JSON.stringify(d1.children.map((k) => k.drawId)));
    const bad = await draw.todaysList({ coachUserId, schoolId, visitKey: 'day:not-a-key', observedGrade: 5 });
    check('malformed key refused', !bad.ok && bad.reason === 'bad_visit_key');
    const dp = await draw.markOutcome({ drawId: d1.children[0].drawId, outcome: 'present', visitKey: dayKey });
    check('day key: present → tested', dp.ok && dp.list.children.find((k) => k.drawId === d1.children[0].drawId).status === 'tested');
    const ks = await store.createSession({ drawId: d1.children[0].drawId, coachUserId });
    check('day key: session stores visit_key, no visit_id', ks.ok && ks.created && ks.session.visit_key === dayKey && ks.session.visit_id === null);
    const kl = await store.listSessionsForVisit(dayKey);
    check('day key: listSessionsForVisit finds it', kl.ok && kl.sessions.length === 1 && kl.sessions[0].id === ks.session.id);
    const csKey = visitKeyFor({ coachingSessionId: crypto.randomUUID() });
    const c1 = await draw.todaysList({ coachUserId, schoolId, visitKey: csKey, observedGrade: 5 });
    check('cs key: a separate visit, its own list', c1.ok && !c1.reused && c1.children.length === 5
      && !c1.children.some((k) => k.drawId === d1.children[0].drawId));
    const { error: fmt } = await supabase.from('child_test_draws').update({ visit_key: 'cs:nope' }).eq('id', c1.children[0].drawId);
    check('database refuses a malformed visit_key', fmt && /visit_key_format/.test(fmt.message));
    const { error: both } = await supabase.from('child_test_draws').update({ last_listed_visit_id: visitId }).eq('id', c1.children[0].drawId);
    check('database refuses a row naming two visits', both && /one_visit/.test(both.message));
    const { error: none } = await supabase.from('child_test_draws').update({ visit_key: null }).eq('id', c1.children[0].drawId);
    check('database refuses a listed row naming no visit', none && /must name its visit/.test(none.message));

    console.log(`[smoke] PASS ${results.length}/${results.length}`);
    for (const r of results) console.log(`  ✓ ${r}`);
  } finally {
    const { data: sessions } = await supabase.from('child_test_sessions').select('id').eq('school_id', schoolId);
    const sids = (sessions || []).map((x) => x.id);
    if (sids.length) await supabase.from('child_test_blocks').delete().in('session_id', sids);
    await supabase.from('child_test_sessions').delete().eq('school_id', schoolId);
    await supabase.from('child_test_draws').delete().eq('school_id', schoolId).eq('sample_role', 'returning');
    await supabase.from('child_test_draws').delete().eq('school_id', schoolId);
    await supabase.from('observation_field_forms').delete().eq('id', visitId);
    const { data: left } = await supabase.from('child_test_draws').select('id').eq('school_id', schoolId);
    console.log(`[smoke] cleaned up: ${left ? left.length : '?'} draw rows left for the SIM school`);
  }
}

main().catch((e) => { console.error(`[smoke] FAIL: ${e.message}`); process.exit(1); });
