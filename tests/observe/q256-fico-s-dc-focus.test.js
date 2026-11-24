'use strict';

/**
 * Queue #256 (the operator 24 Nov ~11:20: "indicator to work on should be pre filled by DC as well") — on a FICO 6-12
 * Digital Coach visit the Feedback Form's "Indicator to work on" (fs_focus) opens on the Digital Coach's pick, marked as
 * its pick, and the observer can change it; what they submit is what the record (and so the report) uses.
 *
 * The Digital Coach's pick is the rule the debrief notes and the report already use for the one thing to work on when
 * nobody chose one (observe-debrief-guide _ficoSTarget): the LOWEST level it set, first in sheet order on a tie. N/A,
 * couldn't tell and the starred (observer-only) indicators never count. It set no level: no pick, the field opens empty.
 *
 *   dcFocusOf     the pick from the form row's Digital Coach reply (pure)
 *   Flow          FS_FEEDBACK's init.fs_focus is the pick, its option says so (EN + UR); her own saved pick wins
 *   portal        values.fs_focus is the pick, the fs_focus part carries `dcChoice`; nothing "missing" for it
 *   submit        the record's focus is what she submitted (changed or not)
 *   off a DC visit  nothing changes (the Flow still opens on her lowest level, the portal empty)
 */

const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const S = require('../../bot/shared/services/coaching/frameworks/fico-s');
const FsDc = require('../../bot/shared/services/observe/obs612/fico-s-dc');
const FS = require('../../bot/shared/services/observe/obs612/fico-s-flow');
const Portal = require('../../bot/shared/services/observe/obs612/portal');

/** A Digital Coach reply: level 3 everywhere, B2 and C4 at 1 (B2 first in sheet order), C2 N/A, D1 couldn't tell. */
function dcAnalysis(over = {}) {
  const levels = {};
  for (const c of S.DC_CODES) levels[c] = { result: 3, because: `Heard ${c}.`, evidence: [{ time: '01:05', quote: `Words for ${c}` }] };
  levels.B2 = { result: 1, because: 'No wait time after questions.', evidence: [] };
  levels.C4 = { result: 1, because: 'No checking for understanding.', evidence: [] };
  levels.C2 = { result: 'NA', because: 'No answer was wrong.', evidence: [] };
  levels.D1 = { result: 'IE', because: 'too noisy', evidence: [] };
  return { framework: 'fico_s_v1_2', rubric: 'fico_s_v1_2', prompt_version: 'fico-s-dc-test', levels: { ...levels, ...over } };
}
const dcOfAnalysis = (a = dcAnalysis()) => FsDc.prefillDraft({}, a, { rubric: 'fico_s_v1_2' });
const allIe = () => Object.fromEntries(S.DC_CODES.map((c) => [c, { result: 'IE', because: 'x', evidence: [] }]));

describe('dcFocusOf: the Digital Coach\'s one indicator to work on', () => {
  test('the lowest level it set, first in sheet order on a tie', () => {
    expect(FsDc.dcFocusOf(dcOfAnalysis().dc, 'fico_s_v1_2')).toBe('B2');
  });
  test('N/A and couldn\'t tell never count; a starred level never counts', () => {
    const only = { ...allIe(), C2: { result: 'NA', because: 'x', evidence: [] }, A3: { result: 4, because: 'x', evidence: [] } };
    expect(FsDc.dcFocusOf(dcOfAnalysis(dcAnalysis(only)).dc, 'fico_s_v1_2')).toBe('A3');
    const dc = { levels: { E3: { result: 1, because: 'x', evidence: [] }, A2: { result: 2, because: 'x', evidence: [] } } };
    expect(FsDc.dcFocusOf(dc, 'fico_s_v1_2')).toBe('A2');
  });
  test('no level set, no reply, not a Digital Coach visit: no pick', () => {
    expect(FsDc.dcFocusOf(dcOfAnalysis(dcAnalysis(allIe())).dc, 'fico_s_v1_2')).toBeNull();
    expect(FsDc.dcFocusOf(null)).toBeNull();
    expect(FsDc.dcFocusOf({})).toBeNull();
  });
});

describe('the WhatsApp Flow\'s feedback screen', () => {
  // (C4's own Urdu name ends in انتخاب, so the Urdu mark is matched whole.)
  const picked = (opts) => opts.filter((o) => /Teaching Assistant's pick$|ٹیچنگ اسسٹنٹ کا انتخاب$/.test(o.description));

  test('a Digital Coach visit opens on its pick, and the option says it is the Digital Coach\'s (EN + UR)', () => {
    const { draft, dc } = dcOfAnalysis();
    const en = FS.screenData('FS_FEEDBACK', draft, 'en', { dc, rubric: 'fico_s_v1_2' });
    expect(en.init.fs_focus).toBe('B2');
    expect(en.focus_opts.find((o) => o.id === 'B2').description).toMatch(/NIETE Teaching Assistant's pick$/);
    expect(picked(en.focus_opts).map((o) => o.id)).toEqual(['B2']);
    const ur = FS.screenData('FS_FEEDBACK', draft, 'ur', { dc, rubric: 'fico_s_v1_2' });
    expect(ur.init.fs_focus).toBe('B2');
    expect(ur.focus_opts.find((o) => o.id === 'B2').description).toMatch(/ٹیچنگ اسسٹنٹ کا انتخاب$/);
    expect(picked(ur.focus_opts).map((o) => o.id)).toEqual(['B2']);
    for (const o of [...en.focus_opts, ...ur.focus_opts]) expect(Array.from(o.description).length).toBeLessThanOrEqual(300);
  });
  test('her own saved pick wins (the mark stays on the Digital Coach\'s)', () => {
    const { draft, dc } = dcOfAnalysis();
    const d = FS.screenData('FS_FEEDBACK', { ...draft, fs_focus: 'A1' }, 'en', { dc, rubric: 'fico_s_v1_2' });
    expect(d.init.fs_focus).toBe('A1');
    expect(picked(d.focus_opts).map((o) => o.id)).toEqual(['B2']);
  });
  test('the Digital Coach set no level: the field opens empty (never her lowest level)', () => {
    const { dc } = dcOfAnalysis(dcAnalysis(allIe()));
    const d = FS.screenData('FS_FEEDBACK', { A1: '1', A2: '2' }, 'en', { dc, rubric: 'fico_s_v1_2' });
    expect(d.init.fs_focus).toBe('');
    expect(picked(d.focus_opts)).toEqual([]);
  });
  test('off a Digital Coach visit: as before (her lowest level, no mark)', () => {
    const d = FS.screenData('FS_FEEDBACK', { A1: '3', B3: '1', C1: '1' }, 'en', { rubric: 'fico_s_v1_2' });
    expect(d.init.fs_focus).toBe('B3');
    expect(picked(d.focus_opts)).toEqual([]);
  });
});

describe('the portal door', () => {
  const row = (id, reason = 'fico_s_dc') => ({ id, status: 'obs612_form', framework: 'fico_s_v1_2', framework_selection_reason: reason, analysis_data: {} });
  const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
  const sessRow = (id) => mockFake.__tables.coaching_sessions.find((s) => s.id === id);
  const feedbackPart = (v, name) => v.sections.find((s) => s.id === 'FS_FEEDBACK').parts.find((p) => p.name === name);

  beforeEach(() => {
    const { draft, dc } = dcOfAnalysis();
    const base = {
      observer_user_id: 'coach-1', teacher_user_id: 'teacher-1', rubric_version: 'fico_s_v1_2',
      visit_context: { grade: 7, subject: 'maths', via: 'observe' }, photos: [], sealed_at: null, checked_at: null, final_levels: null,
    };
    mockFake = createFakeSupabase({
      users: [
        { id: 'coach-1', name: 'Coach Amna', phone_number: '923000000001', preferred_language: 'en', role: 'coach' },
        { id: 'teacher-1', name: 'Rabia', school_name: 'IMSG I-8/1', phone_number: '923000000002' },
      ],
      observation_field_forms: [
        { ...base, id: 'f-dc', coaching_session_id: 's-dc', answers: { obs612: draft, fico_s_dc: dc } },
        { ...base, id: 'f-mine', coaching_session_id: 's-mine', answers: { obs612: { ...draft, fs_focus: 'A1' }, fico_s_dc: dc } },
        { ...base, id: 'f-plain', coaching_session_id: 's-plain', answers: { obs612: { A1: '3', B3: '1' } } },
        { ...base, id: 'f-sealed', coaching_session_id: 's-sealed', sealed_at: '2026-11-24T08:00:00Z', answers: { obs612: { ...draft, fs_focus: 'C1' }, fico_s_dc: dc } },
      ],
      coaching_sessions: [row('s-dc'), row('s-mine'), row('s-plain', 'fico_s_lesson'), row('s-sealed')],
    });
  });

  test('a Digital Coach visit opens on its pick, marked on that option; nothing missing for it', async () => {
    const v = await Portal.portalDraft({ userId: 'coach-1', row: row('s-dc') });
    expect(v.status).toBe('ok');
    expect(v.values.fs_focus).toBe('B2');
    expect(feedbackPart(v, 'fs_focus').dcChoice).toBe('B2');
    expect(feedbackPart(v, 'fs_focus_2').dcChoice).toBeUndefined();
    expect(v.missing).not.toContain('fs_focus');
    expect(v.errors.fs_focus).toBeUndefined();
    // Shown, not yet saved: the form row is unchanged until she saves (her save posts every value).
    expect(formRow('f-dc').answers.obs612.fs_focus).toBeUndefined();
  });

  test('her own saved pick wins; the mark stays on the Digital Coach\'s', async () => {
    const v = await Portal.portalDraft({ userId: 'coach-1', row: row('s-mine') });
    expect(v.values.fs_focus).toBe('A1');
    expect(feedbackPart(v, 'fs_focus').dcChoice).toBe('B2');
  });

  test('off a Digital Coach visit: empty, no mark (as before)', async () => {
    const v = await Portal.portalDraft({ userId: 'coach-1', row: row('s-plain', 'fico_s_lesson') });
    expect(v.values.fs_focus).toBeUndefined();
    expect(feedbackPart(v, 'fs_focus').dcChoice).toBeUndefined();
    expect(v.missing).toContain('fs_focus');
  });

  test('a submitted form reads as she submitted it', async () => {
    const v = await Portal.portalDraft({ userId: 'coach-1', row: row('s-sealed') });
    expect(v.values.fs_focus).toBe('C1');
  });

  test('what she submits is what the record keeps: the pick as shown, or the one she changed to', async () => {
    const v = await Portal.portalDraft({ userId: 'coach-1', row: row('s-dc') });
    const posted = {
      ...v.values, E3: '3', ev_E3: 'Three notebooks checked, comments in two of them.', D1: '2', ev_D1: 'Answers were one word, the observer heard.',
      fb_strengths: 'Clear objective on the board.', fs_action: 'Wait five seconds after each question.',
    };
    for (const c of S.RUBRIC.checklist) posted[c.key] = 'yes';
    const kept = await Portal.portalSave({ userId: 'coach-1', row: row('s-dc'), edits: posted, submit: true });
    expect(kept).toMatchObject({ submitted: true });
    expect(sessRow('s-dc').analysis_data.obs612.feedback.focus[0].code).toBe('B2');

    const changed = await Portal.portalSave({ userId: 'coach-1', row: row('s-mine'), edits: { ...posted, fs_focus: 'C4' }, submit: true });
    expect(changed).toMatchObject({ submitted: true });
    expect(sessRow('s-mine').analysis_data.obs612.feedback.focus[0].code).toBe('C4');
  });
});
