'use strict';

/**
 * Queue #184 — a FICO 6-12 HITL visit goes to the Digital Coach, as a FICO17 v6 HITL visit does (operator 19 Nov ~11:20:
 * "yes, all HITL go to DC ... Starred indicators are the one that do not get sent to DC and are mandatorily filled by
 * the HITL"). obs612/fico-s-dc.js over a fake database; the form's endpoint, record and Flow run for real.
 *
 *   transcribed   the visit goes on to the photo/plan steps and the analysis (v6's path), not to "no model reads it"
 *   ready         Rumi's levels and evidence pre-fill the form (never over the observer's), the form row keeps Rumi's
 *                 reply, the visit opens for review, the form goes to the observer (not on a portal visit)
 *   review        Rumi's line on each screen; a changed level needs a reason (20+); E3 is starred, never pre-filled
 *   submit        each level set_by 'rumi' | 'coach' with Rumi's level beside it; the observer's evidence counts
 */

const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
const mockSendCoachSummary = jest.fn(() => Promise.resolve({ ok: true }));
jest.mock('../../bot/shared/services/observe/obs612/summary', () => ({
  ...jest.requireActual('../../bot/shared/services/observe/obs612/summary'),
  sendCoachSummary: (...a) => mockSendCoachSummary(...a),
}));

const S = require('../../bot/shared/services/coaching/frameworks/fico-s');
const FsDc = require('../../bot/shared/services/observe/obs612/fico-s-dc');
const FS = require('../../bot/shared/services/observe/obs612/fico-s-flow');
const Visit = require('../../bot/shared/services/observe/obs612/visit');
const Endpoint = require('../../bot/shared/routes/obs612-endpoint');
const WA = require('../../bot/shared/services/whatsapp.service');

const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };
const token = (formId) => `coach-1:obs612:${formId}:fs`;
const ex = (formId, screen, payload) => Endpoint.handleObs612DataExchange(token(formId), screen, { screen, ...payload });
const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const sessRow = (id) => mockFake.__tables.coaching_sessions.find((r) => r.id === id);

/** A DC reply: every non-starred indicator level 3 (C2 NA, D1 couldn't tell), each with one moment. */
function dcAnalysis() {
  const levels = {};
  for (const c of S.DC_CODES) levels[c] = { result: 3, because: `Rumi heard ${c} clearly in the lesson.`, evidence: [{ time: '01:05', quote: `Words for ${c}` }] };
  levels.C2 = { result: 'NA', because: 'No answer was wrong.', evidence: [] };
  levels.D1 = { result: 'IE', because: 'student answers were too garbled', evidence: [] };
  return { framework: 'fico_s_v1_1', rubric: 'fico_s_v1_1', prompt_version: 'fico-s-dc-1+test', levels };
}

const DC_SESSION = {
  id: 'sess-dc', status: 'analysis_complete', user_id: 'teacher-1', observer_user_id: 'coach-1', observation_type: 'leader_observation',
  framework: 'fico_s_v1_1', framework_selection_reason: 'fico_s_dc', analysis_data: dcAnalysis(), autofill_analysis_data: null,
  audio_url: null,
};

afterEach(flush);
beforeEach(() => {
  jest.clearAllMocks();
  process.env.FICO_S_FLOW_ID = 'F-FICOS';
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', name: 'Coach Amna', phone_number: '923000000001', preferred_language: 'en', region: 'Urban-I', role: 'coach' },
      { id: 'teacher-1', name: 'Rabia', school_name: 'IMSG I-8/1', phone_number: '923000000002' },
    ],
    observation_field_forms: [
      { id: 'form-dc', coaching_session_id: 'sess-dc', answers: {} },
      { id: 'form-typed', coaching_session_id: 'sess-typed', answers: { obs612: { A1: '1', ev_A1: 'The observer typed this before Rumi finished.' } } },
      { id: 'form-portal', coaching_session_id: 'sess-portal', answers: {} },
    ].map((f) => ({
      observer_user_id: 'coach-1', teacher_user_id: 'teacher-1', rubric_version: 'fico_s_v1_1', visit_context: { grade: 10, subject: 'science', via: 'observe' },
      photos: [], sealed_at: null, checked_at: null, final_levels: null, ...f,
    })),
    coaching_sessions: [
      { ...DC_SESSION },
      { ...DC_SESSION, id: 'sess-typed' },
      { ...DC_SESSION, id: 'sess-portal', audio_url: 'https://r2.example/classroom_audio/coach-1/2026-11/portal_abc-123.ogg' },
      { ...DC_SESSION, id: 'sess-plain', framework_selection_reason: 'fico_s_lesson', analysis_data: {} },
    ],
  });
});
afterAll(() => { delete process.env.FICO_S_FLOW_ID; });

describe('the pre-fill (pure)', () => {
  test('every non-starred level Rumi set, with its evidence; couldn\'t tell leaves the level blank; E3 never', () => {
    const { draft, dc } = FsDc.prefillDraft({}, dcAnalysis());
    expect(draft.A1).toBe('3');
    expect(draft.ev_A1).toBe('Rumi heard A1 clearly in the lesson. [01:05] "Words for A1"');
    expect(draft.C2).toBe('NA');
    expect(draft.D1).toBeUndefined();
    expect(draft.E3).toBeUndefined();
    expect(draft.ev_E3).toBeUndefined();
    expect(Object.keys(dc.levels)).toEqual(S.DC_CODES);
    expect(dc.prompt_version).toBe('fico-s-dc-1+test');
  });
  test('never over what the observer already wrote', () => {
    const { draft } = FsDc.prefillDraft({ A1: '1', ev_A1: 'Mine, written in the room before Rumi.' }, dcAnalysis());
    expect(draft.A1).toBe('1');
    expect(draft.ev_A1).toBe('Mine, written in the room before Rumi.');
    expect(draft.A2).toBe('3');
  });
  test('a starred level in a reply is never pre-filled', () => {
    const a = dcAnalysis();
    a.levels.E3 = { result: 4, because: 'should never be here', evidence: [] };
    expect(FsDc.prefillDraft({}, a).draft.E3).toBeUndefined();
  });
});

describe('after transcription: on to the analysis, as v6', () => {
  test('a Digital Coach visit is not stopped; a plain FICO 6-12 visit is (no model reads it)', async () => {
    await expect(Visit.afterTranscription('sess-dc', sessRow('sess-dc'))).resolves.toMatchObject({ handled: false, dc: true });
    await expect(Visit.afterTranscription('sess-plain', sessRow('sess-plain'))).resolves.toMatchObject({ handled: true });
  });
});

describe('the analysis landed: the form is pre-filled and sent', () => {
  test('WhatsApp: the form row keeps Rumi\'s reply, the draft is pre-filled, the visit opens, the form goes to the observer', async () => {
    const r = await FsDc.onAnalysisReady(sessRow('sess-dc'), { from: '923000000001' });
    expect(r).toMatchObject({ ok: true, sent: true });
    const f = formRow('form-dc');
    expect(f.answers.obs612.A1).toBe('3');
    expect(f.answers.fico_s_dc.levels.A1.result).toBe(3);
    expect(f.answers.fico_s_dc.levels.E3).toBeUndefined();
    expect(sessRow('sess-dc').status).toBe('obs612_form');
    expect(sessRow('sess-dc').autofill_analysis_data).toMatchObject({ prompt_version: 'fico-s-dc-1+test' });
    const flow = WA.sendFlow.mock.calls[0];
    expect(flow[0]).toBe('923000000001');
    expect(flow[1].flowId).toBe('F-FICOS');
    expect(flow[1].flowToken).toBe('coach-1:obs612:form-dc:fs');
    expect(flow[1].body).toMatch(/The NIETE Teaching Assistant has listened to the lesson/);
    expect(flow[1].body).toMatch(/★ E3: yours alone/);
    expect(flow[1].body).not.toMatch(/C3/);
  });
  test('what the observer typed first stays', async () => {
    await FsDc.onAnalysisReady(sessRow('sess-typed'), {});
    expect(formRow('form-typed').answers.obs612).toMatchObject({ A1: '1', ev_A1: 'The observer typed this before Rumi finished.', A2: '3' });
  });
  test('a portal visit: pre-filled, nothing sent on WhatsApp', async () => {
    const r = await FsDc.onAnalysisReady(sessRow('sess-portal'), {});
    expect(r).toMatchObject({ ok: true, sent: false, why: 'portal' });
    expect(formRow('form-portal').answers.obs612.B1).toBe('3');
    expect(WA.sendFlow).not.toHaveBeenCalled();
  });
  test('a visit cancelled while Rumi listened: nothing sent', async () => {
    sessRow('sess-dc').status = 'cancelled';
    const r = await FsDc.onAnalysisReady(sessRow('sess-dc'), {});
    expect(r.sent).toBeFalsy();
    expect(WA.sendFlow).not.toHaveBeenCalled();
  });
});

describe('the review: Rumi\'s line, a reason for a change, E3 starred', () => {
  beforeEach(async () => { await FsDc.onAnalysisReady(sessRow('sess-dc'), {}); jest.clearAllMocks(); });

  test('A1 opens on Rumi\'s level and evidence, says so, and shows the change box', async () => {
    const r = await ex('form-dc', 'FS_INTRO_A', {});
    expect(r.screen).toBe('FS_A_ONE');
    expect(r.data.init).toMatchObject({ lv_A1: '3', ev_A1: expect.stringMatching(/^Rumi heard A1/) });
    expect(r.data.rumi_v).toBe(true);
    expect(r.data.rumi_line).toMatch(/^The NIETE Teaching Assistant chose 3 · Proficient from the recording/);
    expect(r.data.chg_v).toBe(true);
  });

  test('a changed level with no reason is refused; with a reason of 20+ it goes on', async () => {
    const bad = await ex('form-dc', 'FS_A_ONE', { lv_A1: '2', ev_A1: 'Rumi heard A1 clearly in the lesson. [01:05] "Words for A1"', chg_A1: 'no' });
    expect(bad.screen).toBe('FS_A_ONE');
    expect(bad.data.error_messages).toEqual({ chg_A1: expect.stringMatching(/You changed the level from the recording/) });
    const ok = await ex('form-dc', 'FS_A_ONE', { lv_A1: '2', ev_A1: 'Rumi heard A1 clearly in the lesson. [01:05] "Words for A1"', chg_A1: 'The objective was on the board but never said aloud.' });
    expect(ok.screen).toBe('FS_A_TWO');
    const kept = await ex('form-dc', 'FS_A_TWO', { lv_A2: '3', ev_A2: 'Rumi heard A2 clearly in the lesson. [01:05] "Words for A2"', chg_A2: '' });
    expect(kept.screen).toBe('FS_A_THREE');
  });

  test('couldn\'t tell: the level is the observer\'s, Rumi says why', async () => {
    const r = await ex('form-dc', 'FS_C_EIGHT', { lv_C8: '3', ev_C8: 'Rumi heard C8 clearly in the lesson. [01:05] "Words for C8"', chg_C8: '' });
    expect(r.screen).toBe('FS_INTRO_D');
    const d1 = await ex('form-dc', 'FS_INTRO_D', {});
    expect(d1.data.init.lv_D1).toBe('');
    expect(d1.data.rumi_line).toMatch(/The NIETE Teaching Assistant could not set a level from the recording \(student answers were too garbled\)/);
  });

  test('E3 is starred: marked, never pre-filled, no change box; the form cannot go on without it', async () => {
    const e3 = await ex('form-dc', 'FS_E_TWO', { lv_E2: '3', ev_E2: 'Rumi heard E2 clearly in the lesson. [01:05] "Words for E2"', chg_E2: '' });
    expect(e3.screen).toBe('FS_E_THREE');
    expect(e3.data.heading).toBe('★ E3 · Notebooks & written feedback');
    expect(e3.data.star_v).toBe(true);
    expect(e3.data.star_line).toMatch(/The NIETE Teaching Assistant never scores this one/);
    expect(e3.data.rumi_v).toBe(false);
    expect(e3.data.init).toEqual({ lv_E3: '', ev_E3: '' });
    const stay = await ex('form-dc', 'FS_E_THREE', { lv_E3: '', ev_E3: '' });
    expect(stay.screen).toBe('FS_E_THREE');
    expect(Object.keys(stay.data.error_messages)).toEqual(['lv_E3', 'ev_E3']);
  });

  test('E3 alone is starred on a Digital Coach visit: ★, its line, never pre-filled, no change box', () => {
    const dc = FsDc.dcOf(formRow('form-dc'));
    const at = (code) => FS.screenData(FS.SCREENS.find((x) => x.code === code).id, formRow('form-dc').answers.obs612, 'en', { dc });
    const e3 = at('E3');
    expect(e3.heading).toMatch(/^★ /);
    expect(e3).toMatchObject({ star_v: true, rumi_v: false, chg_v: false });
    expect(e3.init.lv_E3).toBe('');
    // 19 Nov ~17:00: the six v6 combined ones (and E2) are not starred: Rumi's line, its level, the change box.
    for (const code of ['C3', 'C5', 'C7', 'D2', 'D3', 'E2']) {
      const d = at(code);
      expect(d.heading).not.toMatch(/^★ /);
      expect(d).toMatchObject({ star_v: false, rumi_v: true, chg_v: true });
    }
    const portal = FS.portalSections({}, 'en', { dc });
    expect(portal.find((x) => x.id === 'FS_E_THREE').parts[0].text).toMatch(/^★ E3/);
    expect(portal.find((x) => x.id === 'FS_C_THREE').parts[0].text).not.toMatch(/★/);
  });

  test('Urdu: Rumi\'s line and the starred line in Urdu', () => {
    const dc = FsDc.dcOf(formRow('form-dc'));
    const a1 = FS.screenData('FS_A_ONE', {}, 'ur', { dc });
    expect(a1.rumi_line).toMatch(/^\u2066NIETE\u2069 ٹیچنگ اسسٹنٹ نے ریکارڈنگ سے/);
    expect(a1.lbl_chg).toBe('تبدیلی کی وجہ');
    expect(FS.screenData('FS_E_THREE', {}, 'ur', { dc }).star_line).toMatch(/^★ ستارے والا اشاریہ/);
  });

  test('a visit Rumi did not fill: no Rumi line, no change box, no change check, and no star (the form as before)', () => {
    const d = FS.screenData('FS_A_ONE', {}, 'en', {});
    expect(d.rumi_v).toBe(false);
    expect(d.chg_v).toBe(false);
    const e3 = FS.screenData('FS_E_THREE', {}, 'en', {});
    expect(e3.heading).toBe('E3 · Notebooks & written feedback');
    expect(e3.star_v).toBe(false);
    const portal = FS.portalSections({}, 'en').find((x) => x.id === 'FS_E_THREE');
    expect(portal.parts[0].text).toBe('E3 · Notebooks & written feedback');
    expect(portal.parts.filter((p) => p.type === 'sub' && /★/.test(p.text || ''))).toEqual([]);
    expect(FS.checkScreen('FS_A_ONE', { A1: '2', ev_A1: 'Written by the observer in the room.' })).toEqual({});
  });
});

describe('the submitted record: who set each level, Rumi\'s beside it', () => {
  test('kept → set_by rumi; changed → coach with the reason; E3 → coach, starred; the evidence is the observer\'s', async () => {
    await FsDc.onAnalysisReady(sessRow('sess-dc'), {});
    const form = formRow('form-dc');
    const d = { ...form.answers.obs612, A1: '2', chg_A1: 'The objective was on the board but never said aloud.', ev_A1: 'Objective on the board only.', D1: '2', ev_D1: 'Answers were one word, the observer heard.', E3: '3', ev_E3: 'Three notebooks checked, comments in two.', fb_strengths: 'Good questions', fs_focus: 'A1', fs_action: 'Say the objective aloud' };
    const a = require('../../bot/shared/services/observe/obs612/record').buildAnalysis(form, d);
    const lv = a.obs612.dc.levels;
    expect(lv.A2).toEqual({ set_by: 'rumi', rumi_level: '3' });
    expect(lv.A1).toEqual({ set_by: 'coach', rumi_level: '3', because: 'The objective was on the board but never said aloud.' });
    expect(lv.D1).toEqual({ set_by: 'coach', rumi_level: null });
    expect(lv.E3).toEqual({ set_by: 'coach', rumi_level: null, starred: true });
    expect(a.obs612.dc.changed).toEqual(['A1']);
    expect(a.obs612.evidence.A1).toBe('Objective on the board only.');
    expect(a.obs612.answers.A1).toBe('2');
  });
  test('Submit is refused while a changed level has no reason', () => {
    const form = { ...formRow('form-dc'), answers: { fico_s_dc: { levels: { A1: { result: 3 } } } } };
    const missing = require('../../bot/shared/services/observe/obs612/record').whatIsMissing(form, { A1: '1' });
    expect(missing).toContain('chg_A1');
  });
});

// Found on the staging walk (19 Nov): a Digital Coach visit's form row is an /observe2-store form, so observe2's
// moments step claimed it ("obs612") and nothing queued the analysis. After transcription a DC visit goes straight to
// the portal step or the photo/plan gates or the analysis, as v6's does; observe2 is never asked.
describe('after transcription, the whole step: a Digital Coach visit reaches the analysis', () => {
  const T = () => require('../../bot/shared/services/coaching/transcription-processor.service');
  test('portal visit: observe2 is not asked; the portal step queues the analysis', async () => {
    const observe2 = { runForSession: jest.fn(async () => ({ handled: true, action: 'obs612' })) };
    const portal = { isPortalSession: () => true, afterTranscription: jest.fn(async () => ({ action: 'analysis' })) };
    const r = await T().observePostTranscription('sess-portal', sessRow('sess-portal'), '9230', { observe2, portal, env: {} });
    expect(observe2.runForSession).not.toHaveBeenCalled();
    expect(portal.afterTranscription).toHaveBeenCalled();
    expect(r.action).toBe('portal');
  });
  test('WhatsApp visit with the gates off: the analysis is queued', async () => {
    const observe2 = { runForSession: jest.fn(async () => ({ handled: true, action: 'obs612' })) };
    const queueAnalysis = jest.fn(async () => true);
    const portal = { isPortalSession: () => false, afterTranscription: jest.fn() };
    const r = await T().observePostTranscription('sess-dc', sessRow('sess-dc'), '9230', { observe2, portal, queueAnalysis, env: {} });
    expect(observe2.runForSession).not.toHaveBeenCalled();
    expect(queueAnalysis).toHaveBeenCalledWith('sess-dc', { from: '9230' });
    expect(r.action).toBe('queued_analysis');
  });
});
