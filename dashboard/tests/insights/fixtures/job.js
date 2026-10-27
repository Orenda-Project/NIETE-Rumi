'use strict';
/**
 * A fictional tier for the end-to-end job tests: one sector (Urban-I), three roster coaches with two schools each,
 * four teachers per school, four graded self-recordings per teacher in the window 28 Sep-25 Oct 2026, plus one coach
 * visit per school and one FICO v3 recording without a plan per teacher. UUIDs follow FIXTURES v2's fake pattern.
 */
const F = require('./analysis');

const uid = (kind, n) => `00000000-0000-4000-8000-${kind}${n.toString(16).padStart(10, '0')}`;

function ipMoves(i) {
  // Every other lesson skips independent practice; one in four also skips the exit check near the end of the recording.
  const skipIp = i % 2 === 0;
  return [
    F.move('m1', 'hook', 'executed', { at: '01:00' }),
    F.move('m2', 'explain', 'executed', { at: '04:00' }),
    F.move('m3', 'guided', i % 5 === 0 ? 'not_done' : 'executed', i % 5 === 0 ? {} : { at: '09:00' }),
    F.move('m4', 'independent', skipIp ? 'not_done' : 'executed', { ...(skipIp ? {} : { at: '13:00' }), tot: { prescribed_minutes: 6 } }),
    F.move('m5', 'exit', i % 4 === 0 ? 'not_done' : 'executed', i % 4 === 0 ? {} : { at: '18:30' }),
    F.move('m6', 'homework', 'executed', { at: '19:10' }),
  ];
}

function build({ forbidden = false, proxy = false } = {}) {
  const schools = []; const users = []; const leaderSchools = []; const sessions = [];
  const coaches = [1, 2, 3].map((c) => uid('07', c));
  let sid = 0; let tn = 0;
  coaches.forEach((coach, ci) => {
    for (let k = 0; k < 2; k += 1) {
      const school = uid('01', ci * 2 + k + 1);
      schools.push({ id: school, region: 'Urban-I', is_probable_test: false, name: `Govt. Primary School Fictional-${ci * 2 + k + 1}` });
      leaderSchools.push({ leader_user_id: coach, school_id: school });
      for (let t = 0; t < 4; t += 1) {
        tn += 1;
        const teacher = uid('02', tn);
        users.push({ id: teacher, role: 'teacher', school_id: school, is_test_user: false, deleted_at: null });
        for (let r = 0; r < 4; r += 1) {
          sid += 1;
          const day = 1 + ((sid * 3) % 24); // 1..24 Oct
          let ad = { lp_fidelity: F.lp(ipMoves(sid), { audio_s: 1200, last_stamp_s: sid % 4 === 0 ? 1180 : 1150, ends_at: '20:00' }), ...F.v3({ C1: sid % 3 === 0 ? 2 : 3, C3: 3 }) };
          if (forbidden) ad = F.withForbidden(ad);
          sessions.push({ id: uid('03', sid), user_id: teacher, observer_user_id: null, observation_type: null, status: 'completed',
            created_at: `2026-10-${String(day).padStart(2, '0')}T05:00:00.000Z`, audio_url: `/fictional-bucket/classroom_audio/${sid}.ogg`,
            audio_duration_seconds: 1200 + sid, audio_hash: `h${sid}`, duplicate_of_session_id: null, has_lesson_plan: true,
            analysis_data: proxy ? F.trap(ad) : ad });
        }
      }
    }
  });
  // One duplicate (same audio hash as session 1) and one mismatch, so the exclusions have something to count.
  sessions.push({ ...sessions[0], id: uid('03', 9001), created_at: '2026-10-02T06:00:00.000Z' });
  const mm = { lp_fidelity: F.lp([F.move('m1', 'independent', 'not_done')], { note: 'lesson_mismatch' }) };
  sessions.push({ ...sessions[1], id: uid('03', 9002), audio_hash: 'hmm', created_at: '2026-10-03T06:00:00.000Z', analysis_data: forbidden ? F.withForbidden(mm) : mm });
  return {
    tables: {
      schools,
      users: [...users, { id: uid('09', 1), role: 'coach', school_id: null, is_test_user: true, deleted_at: null }],
      leader_schools: leaderSchools,
      app_settings: [{ key: 'analytics_rdf_coaches', value: { coaches: coaches.map((c, i) => ({ name: `C-0${i + 1}`, sector: 'Urban-I', userIds: [c] })) } }],
      coaching_sessions: sessions,
      observation_schedules: [],
      student_lists: [], students: [],
    },
    coaches, uid,
  };
}

module.exports = { build, uid };
