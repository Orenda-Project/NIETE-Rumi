'use strict';
/**
 * bd-o15qnr.51 (queue #255) — the portal's debrief notes (coach and principal: the visit page's talk, and Debrief's notes)
 * for a FICO 6-12 visit carry no lesson plan check, even when the notes were written before the change with one
 * (production b4f6f109, 24 Nov). A FICO17 v6 (grades 1-5) visit's notes are served exactly as stored.
 */

const SVC = '../../bot/shared/services/observe/portal-observe.service';

const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const TEACHER_UID = '7eac0000-0000-4000-8000-000000000003';
const SID = 'cs-obs-612';

function fakeSupabase(answer) {
  const from = (table) => {
    const q = { table, filters: {} };
    const self = new Proxy(q, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'eq') return (c, v) => { target.filters[c] = v; return self; };
        if (prop === 'single' || prop === 'maybeSingle') {
          return async () => {
            const fn = answer[table];
            const data = typeof fn === 'function' ? fn(target.filters) : (fn ?? null);
            return { data: Array.isArray(data) ? (data[0] || null) : data, error: null };
          };
        }
        if (prop === 'then') {
          return (res, rej) => {
            const fn = answer[table];
            const data = typeof fn === 'function' ? fn(target.filters) : (fn ?? null);
            return Promise.resolve({ data, error: null }).then(res, rej);
          };
        }
        return () => self;
      },
    });
    return self;
  };
  return { from };
}

const NOTES = { intro: 'Open with what worked.', conversation: ['1', '2', '3', '4', '5', '6'] };
const LP_CHECK = { v: 1, state: 'ok', done: 1, total: 2, steps: [], lines: ['a', 'b', 'c', 'd', 'e'] };

const STAMPS = {
  ficoS: { framework: 'fico_s_v1_2', framework_selection_reason: 'fico_s_dc', analysis: { framework: 'fico_s_v1_2', obs612: { tool: 'ficos' } } },
  v6: { framework: 'fico17_v6', framework_selection_reason: 'coach_rubric_switch', analysis: { framework: 'fico17_v6' } },
};

function obsRow(stamp, over = {}) {
  return {
    id: SID,
    user_id: TEACHER_UID,
    observer_user_id: COACH,
    observation_type: 'leader_observation',
    audio_url: 'https://r2.example/bucket/classroom_audio/x/portal_1.webm',
    status: 'observer_review_complete',
    debrief_status: 'pending',
    created_at: '2026-11-24T05:11:58Z',
    framework: stamp.framework,
    framework_selection_reason: stamp.framework_selection_reason,
    analysis_data: { ...stamp.analysis, observer_debrief: { guide_snapshot: { ...NOTES, lp_check: LP_CHECK } } },
    users: { name: 'Test Teacher', phone_number: '923990000001' },
    ...over,
  };
}

function deps(row) {
  return {
    supabase: fakeSupabase({ users: () => ({ id: COACH, role: 'coach', name: 'Coach', preferred_language: 'en' }), coaching_sessions: () => row }),
    debrief: { buildDebriefGuide: jest.fn(), mergeObserverDebrief: jest.fn() },
    people: { teacherOf: jest.fn().mockResolvedValue({ name: 'Test Teacher', phone: null }) },
    r2: { getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`), buildR2PublicUrl: (k) => `https://r2.example/bucket/${k}` },
    state: { getState: jest.fn().mockResolvedValue(null) },
    languageFor: jest.fn().mockResolvedValue('en'),
    log: jest.fn(),
    now: () => new Date('2026-11-24T08:00:00Z'),
  };
}

let Svc;
beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

describe('Debrief\'s notes (talkGuide)', () => {
  test('6-12: the stored notes without the lesson plan check; nothing rewritten, no model call', async () => {
    const d = deps(obsRow(STAMPS.ficoS));
    const out = await Svc.talkGuide({ userId: COACH, coachingSessionId: SID }, d);
    expect(out).toEqual({ status: 'ok', guide: NOTES });
    expect(d.debrief.buildDebriefGuide).not.toHaveBeenCalled();
    expect(d.debrief.mergeObserverDebrief).not.toHaveBeenCalled();
  });

  test('1-5: the stored notes as they are, check included', async () => {
    const out = await Svc.talkGuide({ userId: COACH, coachingSessionId: SID }, deps(obsRow(STAMPS.v6)));
    expect(out).toEqual({ status: 'ok', guide: { ...NOTES, lp_check: LP_CHECK } });
  });
});

describe('the visit page (observationView)', () => {
  test('6-12: talk.guide has no lesson plan check', async () => {
    const out = await Svc.observationView({ userId: COACH, coachingSessionId: SID }, deps(obsRow(STAMPS.ficoS)));
    expect(out.status).toBe('ok');
    expect(out.talk.guide).toEqual(NOTES);
  });

  test('1-5: talk.guide is the stored notes, check included', async () => {
    const out = await Svc.observationView({ userId: COACH, coachingSessionId: SID }, deps(obsRow(STAMPS.v6)));
    expect(out.talk.guide).toEqual({ ...NOTES, lp_check: LP_CHECK });
  });
});
