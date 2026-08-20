'use strict';
/**
 * bd-9hzdn.1/.3 (observe parity) — after an /observe transcription:
 *   flag OFF  → legacy: analysis queued directly, no prompts.
 *   flag ON   → the COACH gets the photo gate: prompt to the coach's phone in the
 *               OBSERVER's language; session moves to awaiting_photo; analysis NOT queued.
 * And the LP list-tap reply language is observer-aware for leader observations.
 */
const Processor = require('../../bot/shared/services/coaching/transcription-processor.service');
const { handleLpListSelection } = require('../../bot/shared/services/coaching/lp-coaching/lp-list-selection.handler');

const SID = '0b5e11e0-1111-2222-3333-444444444444';
const OBS_SESSION = { observation_type: 'leader_observation', user_id: 'teacher-id', observer_user_id: 'coach-id' };

function deps(env) {
  const calls = { queued: [], sent: [], cs: [], status: [], langLookups: [] };
  return {
    calls,
    env,
    queueAnalysis: async (sid, p) => calls.queued.push({ sid, p }),
    sendButtons: async (to, prompt) => calls.sent.push({ to, prompt }),
    buildPhotoPrompt: (sid, lang) => ({ body: `photo? [${lang}]`, buttons: [], _sid: sid }),
    getLanguage: async (uid) => { calls.langLookups.push(uid); return uid === 'coach-id' ? 'ur' : 'en'; },
    updateConversationState: async (sid, cs) => calls.cs.push(cs),
    updateStatus: async (sid, st) => calls.status.push(st),
  };
}

describe('observePostTranscription (bd-9hzdn.1)', () => {
  test('flag OFF → analysis queued directly, nothing sent (legacy FEAT-102 behaviour)', async () => {
    const d = deps({});
    const r = await Processor.observePostTranscription(SID, OBS_SESSION, '92coach', d);
    expect(r.action).toBe('queued_analysis');
    expect(d.calls.queued).toEqual([{ sid: SID, p: { from: '92coach' } }]);
    expect(d.calls.sent).toHaveLength(0);
  });

  test("flag ON → photo prompt to the coach in the OBSERVER's language, awaiting_photo, NO analysis", async () => {
    const d = deps({ OBSERVE_CAPTURE_GATES_ENABLED: 'true' });
    const r = await Processor.observePostTranscription(SID, OBS_SESSION, '92coach', d);
    expect(r).toEqual({ action: 'photo_gate', observerLanguage: 'ur' });
    expect(d.calls.langLookups).toEqual(['coach-id']); // observer, NOT the teacher
    expect(d.calls.sent).toEqual([{ to: '92coach', prompt: { body: 'photo? [ur]', buttons: [], _sid: SID } }]);
    expect(d.calls.cs).toEqual([{ current_state: 'AWAITING_PHOTO' }]);
    expect(d.calls.status).toEqual(['awaiting_photo']);
    expect(d.calls.queued).toHaveLength(0);
  });

  test('flag ON, unbound observation (no observer id) → falls back to the owner for language', async () => {
    const d = deps({ OBSERVE_CAPTURE_GATES_ENABLED: 'true' });
    await Processor.observePostTranscription(SID, { observation_type: 'leader_observation', user_id: 'teacher-id' }, '92coach', d);
    expect(d.calls.langLookups).toEqual(['teacher-id']);
  });
});

describe('LP list-tap reply language is observer-aware (bd-9hzdn.3)', () => {
  test('leader observation → replies in the OBSERVER language via injected resolver contract', async () => {
    // The built-in resolver prefers the observer row for leader observations; here we
    // lock the HANDLER's use of the resolved language end-to-end via injection.
    const sent = [];
    const d = {
      linker: { handleLPSelection: async () => ({ lesson_plan_link_method: 'none', awaiting_upload: false }) },
      sendMessage: async (to, text) => sent.push(text),
      queueAnalysis: async () => {},
      resolveLanguage: async () => 'ur',
      messages: { getCoachingMessage: (key, lang) => `${key}:${lang}` },
    };
    await handleLpListSelection('lp_none_0b5e11e0-1111-2222-3333-444444444444', '92coach', d);
    expect(sent).toEqual(['lessonPlan_skip:ur']);
  });
});

describe('reapplyFidelitySectionB — measured Section B survives observer edits (bd-9hzdn.5)', () => {
  // Require lazily so the observe-draft module (supabase etc.) loads under test env.
  const { reapplyFidelitySectionB } = require('../../bot/shared/services/observe/observe-draft.service');
  const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

  function ficoV2(sectionBScore) {
    const mk = (n, per) => Array.from({ length: n }, (_, i) => ({ id: `x${i}`, score: per }));
    const a = {
      framework: 'fico',
      lp_fidelity: { status: 'ok', fidelity_pct: 60, band: 'partial' },
      domains: {
        lesson_plan_fidelity: { indicators: mk(10, 2), domain_score: sectionBScore, domain_max: 40 },
        high_leverage_practices: { indicators: mk(12, 3), domain_score: 36, domain_max: 48 },
        student_engagement: { indicators: mk(7, 3), domain_score: 21, domain_max: 28 },
        teacher_subject_knowledge: { indicators: mk(8, 2), domain_score: 16, domain_max: 32 },
      },
      scores: {},
    };
    return a;
  }

  test('after computeScores re-summed B from edited indicators, fidelity is re-derived (60% → 24/40)', () => {
    const v2 = fico.computeScores(ficoV2(20)); // observer edits re-summed B to 20
    expect(v2.domains.lesson_plan_fidelity.domain_score).toBe(20);
    reapplyFidelitySectionB(v2, 'sid');
    expect(v2.domains.lesson_plan_fidelity.domain_score).toBe(24); // round(0.60×40)
    expect(v2.domains.lesson_plan_fidelity.fidelity_derived).toBe(true);
  });

  test('no lp_fidelity / non-fico → untouched, never throws', () => {
    const plain = { framework: 'fico', domains: { lesson_plan_fidelity: { domain_score: 20 } } };
    expect(() => reapplyFidelitySectionB(plain, 'sid')).not.toThrow();
    expect(plain.domains.lesson_plan_fidelity.domain_score).toBe(20);
    expect(() => reapplyFidelitySectionB(null, 'sid')).not.toThrow();
  });
});
