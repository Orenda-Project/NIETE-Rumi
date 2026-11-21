'use strict';

/**
 * bd-31ziu8.3 — the FICO-S v1.1 form: its Flow (one indicator a screen, EN + UR from the endpoint), its endpoint door
 * (shared /api/flows/obs612, token '<coach>:obs612:<formId>:fs'), the record a Submit stores, and what the coach, the
 * teacher and the portal are shown. The endpoint and its record run for real over a fake database.
 */

const fs = require('fs');
const path = require('path');
const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const mockSendCoachSummary = jest.fn(() => Promise.resolve({ ok: true }));
jest.mock('../../bot/shared/services/observe/obs612/summary', () => ({
  ...jest.requireActual('../../bot/shared/services/observe/obs612/summary'),
  sendCoachSummary: (...a) => mockSendCoachSummary(...a),
}));

const Endpoint = require('../../bot/shared/routes/obs612-endpoint');
const FS = require('../../bot/shared/services/observe/obs612/fico-s-flow');
const FicoS = require('../../bot/shared/services/coaching/frameworks/fico-s');
const { render } = require('../../bot/scripts/generate-fico-s-flow-json');

const FLOW_FILE = path.join(__dirname, '../../bot/docs/flows/fico-s-flow.json');
const FLOW = JSON.parse(fs.readFileSync(FLOW_FILE, 'utf8'));
const SCREEN = Object.fromEntries(FLOW.screens.map((s) => [s.id, s]));
const cps = (s) => Array.from(String(s || '')).length;
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };
const fsToken = (formId, coach = 'coach-1') => `${coach}:obs612:${formId}:fs`;
const fdeToken = (formId, coach = 'coach-1') => `${coach}:obs612:${formId}`;
const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const ex = (formId, screen, payload) => Endpoint.handleObs612DataExchange(fsToken(formId), screen, { screen, ...payload });

/** What the Flow posts on a screen with every field answered well. */
function answersFor(screenId) {
  const s = FS.screenById(screenId);
  const out = {};
  for (const f of s.fields) {
    if (f.check === 'level') out[f.name] = f.code === 'C2' ? 'NA' : String((FicoS.CODES.indexOf(f.code) % 4) + 1);
    else if (f.check === 'evidence') out[f.name] = `Saw it in the room for ${f.key}, clearly.`;
    else if (f.check === 'yes_no') out[f.name] = 'yes';
    else if (f.name === 'fs_focus') out[f.name] = 'C3';
    else if (f.name === 'fs_focus_2' || f.name === 'fs_action_2') out[f.name] = '';
    else out[f.name] = f.required ? `Words for ${f.name}` : '';
  }
  return out;
}

afterEach(flush);
beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', name: 'Coach Amna', phone_number: '923000000001', preferred_language: 'en' },
      { id: 'coach-ur', name: 'Coach Hira', phone_number: '923000000003', preferred_language: 'ur' },
      { id: 'teacher-1', name: 'Rabia', school_name: 'IMSG I-8/1', phone_number: '923000000002' },
    ],
    observation_field_forms: [
      { id: 'form-s', rubric_version: 'fico_s_v1_1', visit_context: { grade: 10, subject: 'science', via: 'observe' }, coaching_session_id: 'sess-1' },
      { id: 'form-s-ur', observer_user_id: 'coach-ur', rubric_version: 'fico_s_v1_1', visit_context: { grade: 7, subject: 'maths', via: 'observe' } },
      { id: 'form-fde', rubric_version: 'obs612-msci-v1', visit_context: { grade: 7, subject: 'maths', via: 'observe' } },
    ].map((f) => ({
      observer_user_id: 'coach-1', teacher_user_id: 'teacher-1', coaching_session_id: null, answers: {}, photos: [],
      sealed_at: null, checked_at: null, final_levels: null, ...f,
    })),
    coaching_sessions: [
      { id: 'sess-1', status: 'obs612_form', user_id: 'teacher-1', observer_user_id: 'coach-1', framework: 'fico_s_v1_1', analysis_data: { transcript_summary: 'kept' } },
    ],
  });
});

describe('the Flow JSON', () => {
  test('is what the generator writes (never hand-edited)', () => {
    expect(fs.readFileSync(FLOW_FILE, 'utf8')).toBe(render());
  });

  test('start, five section intros, 23 indicator screens, the checklist, the feedback, NOTICE, DONE', () => {
    const ids = FLOW.screens.map((s) => s.id);
    expect(ids[0]).toBe('FS_START');
    expect(ids.filter((i) => i.startsWith('FS_INTRO_'))).toEqual(['FS_INTRO_A', 'FS_INTRO_B', 'FS_INTRO_C', 'FS_INTRO_D', 'FS_INTRO_E']);
    expect(FS.SCREENS.filter((s) => s.kind === 'indicator').map((s) => s.code)).toEqual(FicoS.CODES);
    expect(ids.slice(-4)).toEqual(['FS_CHECKLIST', 'FS_FEEDBACK', 'NOTICE', 'DONE']);
    expect(Object.keys(FLOW.routing_model).filter((k) => !(FLOW.routing_model[k] || []).length)).toEqual(['DONE']);
  });

  test('one indicator a screen: a required level radio and a required evidence box; back hint on the screen', () => {
    for (const s of FS.SCREENS.filter((x) => x.kind === 'indicator')) {
      const form = SCREEN[s.id].layout.children[0];
      const radio = form.children.find((c) => c.type === 'RadioButtonsGroup');
      const area = form.children.find((c) => c.type === 'TextArea');
      expect(radio).toMatchObject({ name: `lv_${s.code}`, required: true, 'data-source': '${data.opts}' });
      expect(area).toMatchObject({ name: `ev_${s.code}`, required: true });
      expect(form.children.some((c) => c.text === '${data.back_hint}')).toBe(true);
    }
  });

  test('forward-only routes; FS_START has no route in (the INIT screen)', () => {
    const incoming = new Set(Object.values(FLOW.routing_model).flat());
    expect(incoming.has('FS_START')).toBe(false);
    for (const [from, to] of Object.entries(FLOW.routing_model)) {
      const i = FS.pathFor().indexOf(from);
      for (const t of to) if (t !== 'DONE') expect(FS.pathFor().indexOf(t)).toBe(i + 1);
    }
  });
});

describe('Meta\'s field caps hold in both languages (a cap overrun refuses the whole screen)', () => {
  test.each(['en', 'ur'])('%s', (lang) => {
    for (const s of FS.SCREENS) {
      const d = FS.screenData(s.id, {}, lang);
      if (d.heading) expect(cps(d.heading)).toBeLessThanOrEqual(80);
      for (const k of ['lbl_level']) if (d[k]) expect(cps(d[k])).toBeLessThanOrEqual(30);
      for (const k of ['lbl_ev', 'lbl_strengths', 'lbl_focus', 'lbl_action', 'lbl_by', 'lbl_focus_2', 'lbl_action_2']) {
        if (d[k]) expect(cps(d[k])).toBeLessThanOrEqual(20);
      }
      for (const k of ['help_ev', 'help_strengths', 'help_action', 'help_by']) if (d[k]) expect(cps(d[k])).toBeLessThanOrEqual(80);
      if (d.next_label) expect(cps(d.next_label)).toBeLessThanOrEqual(35);
      for (const o of [...(d.opts || []), ...(d.focus_opts || []), ...(d.yes_no || [])]) {
        expect(cps(o.title)).toBeLessThanOrEqual(30);
        if (o.description) expect(cps(o.description)).toBeLessThanOrEqual(300);
      }
      for (const c of FicoS.RUBRIC.checklist) {
        if (d[`${c.key}_lbl`]) expect(cps(d[`${c.key}_lbl`])).toBeLessThanOrEqual(30);
        if (d[`${c.key}_text`]) expect(cps(d[`${c.key}_text`])).toBeLessThanOrEqual(300);
      }
    }
  });

  test('Urdu screens are Urdu (Nastaliq script), with Urdu digits and the codes isolated', () => {
    const d = FS.screenData('FS_C_TWO', {}, 'ur');
    expect(d.heading).toMatch(/⁦C2⁩/);
    expect(d.look_for).toMatch(/[؀-ۿ]/);
    expect(d.progress).toMatch(/[۰-۹]/);
    expect(d.opts.map((o) => o.id)).toEqual(['1', '2', '3', '4', 'NA']);
    expect(d.opts[3].title).toBe('۴ · مثالی');
  });
});

describe('the endpoint door', () => {
  test('INIT on a FICO-S token opens FS_START in the observer\'s language', async () => {
    const en = await Endpoint.handleObs612Init(fsToken('form-s'));
    expect(en.screen).toBe('FS_START');
    expect(en.data.heading).toMatch(/FICO 6-12/);
    const ur = await Endpoint.handleObs612Init(fsToken('form-s-ur', 'coach-ur'));
    expect(ur.data.next_label).toBe('شروع کریں');
  });

  test('each Flow serves its own forms: the FDE token on a FICO-S form, and the FICO-S token on an FDE form, refuse', async () => {
    expect((await Endpoint.handleObs612Init(fdeToken('form-s'))).screen).toBe('NOTICE');
    const r = await Endpoint.handleObs612Init(fsToken('form-fde'));
    expect(r.screen).toBe('NOTICE');
    expect(r.data.notice_body).toMatch(/FICO 6-12/);
  });

  test('a screen saves first, then checks: no evidence keeps the observer on the screen', async () => {
    const r = await ex('form-s', 'FS_A_ONE', { lv_A1: '3', ev_A1: 'short' });
    expect(r.screen).toBe('FS_A_ONE');
    expect(r.data.error_messages).toEqual({ ev_A1: expect.stringMatching(/20 characters/) });
    // queue #184: the change box (shown on a Digital Coach visit only) starts empty
    expect(r.data.init).toEqual({ lv_A1: '3', ev_A1: 'short', chg_A1: '' });
    expect(formRow('form-s').answers.obs612).toEqual({ A1: '3', ev_A1: 'short' });
  });

  test('N/A is refused where the sheet does not allow it, taken on C2', async () => {
    const bad = await ex('form-s', 'FS_C_ONE', { lv_C1: 'NA', ev_C1: 'The teacher asked no questions at all.' });
    expect(bad.data.error_messages).toHaveProperty('lv_C1');
    const ok = await ex('form-s', 'FS_C_TWO', { lv_C2: 'NA', ev_C2: 'No student answer was wrong this lesson.' });
    expect(ok.screen).toBe('FS_C_THREE');
  });

  test('a whole walk: every screen once, Submit stores the FICO-S record and seals the form', async () => {
    let res = await Endpoint.handleObs612Init(fsToken('form-s'));
    for (let guard = 0; res.screen !== 'DONE' && guard < 40; guard += 1) res = await ex('form-s', res.screen, answersFor(res.screen));
    expect(res.screen).toBe('DONE');
    expect(res.data).toMatchObject({ outcome: 'submitted', form_id: 'form-s' });
    const form = formRow('form-s');
    expect(form.sealed_at).toBeTruthy();
    const sess = mockFake.__tables.coaching_sessions.find((s) => s.id === 'sess-1');
    const a = sess.analysis_data;
    expect(a).toMatchObject({ framework: 'fico_s_v1_1', rubric: 'fico_s_v1_1', rubric_label: 'FICO 6-12', scores: { rubric: 'fico_s_v1_1' } });
    expect(a.obs612).toMatchObject({ tool: 'ficos', grade: 10, subject: 'science', scored_by: 'coach', branched_from: 'fico17_v6' });
    expect(Object.keys(a.obs612.answers)).toHaveLength(23);
    expect(a.obs612.answers.C2).toBe('NA');
    expect(a.obs612.evidence.A1).toMatch(/Saw it/);
    expect(a.obs612.result).toMatchObject({ counted: 22, max: 88, na: ['C2'] });
    expect(a.obs612.feedback).toMatchObject({ strengths: 'Words for fb_strengths', focus: [{ code: 'C3', action: 'Words for fs_action' }] });
    expect(a.scores.overall_percentage).toBeUndefined();
    // HITL parity: the Submit is the review; the debrief is still to come (FDE marks it done at Submit).
    expect(sess.status).toBe('observer_review_complete');
    expect(sess.debrief_status == null || sess.debrief_status === 'pending').toBe(true);
    await flush();
    expect(mockSendCoachSummary).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1' }));
  });

  test('Submit with an indicator missing stays on the feedback screen and names it', async () => {
    const draft = {};
    for (const s of FS.SCREENS) Object.assign(draft, FS.mergeDraft({}, s.id, answersFor(s.id)));
    delete draft.B4;
    formRow('form-s').answers = { obs612: draft };
    const r = await ex('form-s', 'FS_FEEDBACK', answersFor('FS_FEEDBACK'));
    expect(r.screen).toBe('FS_FEEDBACK');
    expect(r.data.err_note).toMatch(/B4 Links to real life/);
    expect(formRow('form-s').sealed_at).toBeNull();
  });
});

describe('what the record shows', () => {
  const Record = require('../../bot/shared/services/observe/obs612/record');
  const View = require('../../bot/shared/services/observe/obs612/view');
  const Summary = require('../../bot/shared/services/observe/obs612/summary');
  const Report = require('../../bot/shared/services/coaching/report-v2/obs612-report');
  const { transformObs612ToReportData } = require('../../bot/shared/services/coaching/report-transformers/obs612-report-transformer');
  const { getOverall } = require('../../dashboard/services/coaching-frameworks.service');
  const draft = () => {
    const d = {};
    for (const s of FS.SCREENS) Object.assign(d, FS.mergeDraft({}, s.id, answersFor(s.id)));
    return d;
  };
  const analysis = () => Record.buildAnalysis({
    id: 'f1', rubric_version: 'fico_s_v1_1', observer_user_id: 'c1', teacher_user_id: 't1', visit_context: { grade: 7, subject: 'maths', via: 'observe' },
  }, draft());

  test('never a FICO number: the dashboard reads no V3 overall from it', () => {
    expect(getOverall(analysis())).toEqual({ points: 0, maxPoints: 0, percentage: null, rubric: 'fico_s_v1_1' });
  });

  test('the coach summary names FICO-S, the % and band, the section averages, the focus (en and ur)', () => {
    const en = Summary.buildCoachSummary(analysis(), { lang: 'en', teacherName: 'Rabia' });
    expect(en).toMatch(/FICO 6-12: \d+ \/ 88 · [\d.]+% · (Below standard|Developing|Proficient|Exemplary)/);
    expect(en).toMatch(/A \d\.\d · B \d\.\d · C \d\.\d · D \d\.\d · E \d\.\d/);
    expect(en).toMatch(/Work on: C3 Who gets to answer/);
    expect(en).toMatch(/_FICO 6-12_/);
    const ur = Summary.buildCoachSummary(analysis(), { lang: 'ur', teacherName: 'Rabia' });
    expect(ur).toMatch(/⁦FICO 6-12⁩/);
    expect(ur).toMatch(/۸۸ میں سے/);
    // HITL parity (operator 18 Nov ~16:35): after the review comes the debrief, offered as after a FICO review.
    const msgs = Summary.buildSummaryMessages('sess-1', analysis(), { lang: 'en', teacherName: 'Rabia' });
    expect(msgs.buttons.buttons.map((b) => b.id)).toEqual(['observe_debrief_now_sess-1', 'observe_debrief_later_sess-1']);
    expect(msgs.buttons.body).toMatch(/FICO 6-12:/);
  });

  test('the portal block: headline, five section rows with bars, 23 indicator rows, the feedback', () => {
    const p = View.portalSummary(analysis());
    expect(p).toMatchObject({ label: 'FICO 6-12', tool: 'ficos', rubric: 'fico_s_v1_1', noTotal: false });
    expect(p.rows).toHaveLength(28);
    expect(p.rows[0]).toMatchObject({ name: 'A · Lesson planning & structure', pct: expect.any(Number) });
    expect(p.rows.find((r) => r.name.startsWith('C2 ')).value).toBe('N/A');
    expect(p.footer).toMatch(/Not a FICO17 v6 score/);
  });

  test('the teacher report: the FICO hero page with FICO-S sections, the band, the focus and the action', () => {
    const vm = Report.buildObs612HeroVm({ created_at: '2026-11-18T10:00:00Z' }, analysis(), { language: 'en', teacherName: 'Rabia' });
    expect(vm.groups.map((g) => g.name)).toEqual([
      'A. Lesson planning & structure', 'B. Subject knowledge & teaching', 'C. Classroom practice', 'D. Student learning & engagement', 'E. Checking learning',
    ]);
    expect(vm.score.max).toBe(88);
    expect(vm.narrative.affirmation).toMatch(/FICO 6-12/);
    expect(vm.narrative.horizon_title).toMatch(/^C3\. Who gets to answer/);
    expect(vm.tryNext).toMatch(/Words for fs_action/);
    expect(Report.caption(Report.buildObs612ReportVm({ created_at: '2026-11-18T10:00:00Z' }, analysis(), { language: 'en' }))).toMatch(/FICO 6-12 · Grade 7 · Maths/);
  });

  test('the report record (transformer): FICO-S totals, one goal a section, every indicator set by the observer', () => {
    const r = transformObs612ToReportData({ created_at: '2026-11-18T10:00:00Z' }, 'Rabia', analysis());
    expect(r).toMatchObject({ rubric: 'fico_s_v1_1', rubricLabel: 'FICO 6-12', maxScore: 88, noTotal: false });
    expect(r.goals).toHaveLength(5);
    expect(r.goals.flatMap((g) => g.criteria)).toHaveLength(23);
    expect(r.goals.flatMap((g) => g.criteria).every((c) => c.setBy === 'coach')).toBe(true);
  });

  test('the dispatchers route a FICO-S analysis to the grade 6-12 report (never the FICO hero)', () => {
    const dispatch = require('../../bot/shared/services/coaching/report-transformers/report-transformer-dispatch');
    const src = fs.readFileSync(require.resolve('../../bot/shared/services/coaching/report-transformers/report-transformer-dispatch'), 'utf8');
    expect(src).toMatch(/OBS612\.KNOWN_IDS/);
    const O = require('../../bot/shared/services/coaching/frameworks/obs612');
    // Queue #218: both FICO-S versions route to the grade 6-12 report (a v1.1 visit keeps its report).
    expect(O.KNOWN_IDS).toEqual(expect.arrayContaining(['fico_s_v1_1', 'fico_s_v1_2']));
    const { transformObs612ToReportData: t612 } = require('../../bot/shared/services/coaching/report-transformers/obs612-report-transformer');
    expect(dispatch.getReportTransformer('fico_s_v1_1')).toBe(t612);
    expect(dispatch.getReportTransformer('fico_s_v1_2')).toBe(t612);
    const R = require('../../bot/shared/services/coaching/report-renderers/renderer-registry');
    expect(R.heroBrandFor('fico_s_v1_1')).toBe('niete');
    expect(R.heroBrandFor('fico_s_v1_2')).toBe('niete');
    expect(R.getReportRenderer('fico_s_v1_1').key).toBe('obs612');
    expect(R.getReportRenderer('fico_s_v1_2').key).toBe('obs612');
    expect(typeof dispatch).toBe('object');
  });
});

describe('the portal door (obs612/portal.js) fills the same form', () => {
  const Portal = require('../../bot/shared/services/observe/obs612/portal');
  const row = { id: 'sess-1', status: 'obs612_form', framework: 'fico_s_v1_1', analysis_data: {} };

  test('GET: one section a screen, levels with the sheet\'s words, every field named by its draft key', async () => {
    mockFake.__tables.observation_field_forms.find((f) => f.id === 'form-s').coaching_session_id = 'sess-1';
    const v = await Portal.portalDraft({ userId: 'coach-1', row });
    expect(v).toMatchObject({ status: 'ok', kind: 'obs612', tool: 'ficos', label: 'FICO 6-12', editable: true });
    expect(v.sections).toHaveLength(FS.SCREENS.length);
    const a1 = v.sections.find((s) => s.id === 'FS_A_ONE').parts.find((p) => p.name === 'A1');
    expect(a1.options.map((o) => o.title)).toEqual(['1 · Below standard', '2 · Developing', '3 · Proficient', '4 · Exemplary']);
    expect(v.missing).toEqual(expect.arrayContaining(['A1', 'ev_A1', 'fb_strengths', 'fs_focus', 'fs_action']));
  });

  test('POST save then Submit: the same record as the Flow\'s', async () => {
    const edits = {};
    for (const s of FS.SCREENS) Object.assign(edits, FS.mergeDraft({}, s.id, answersFor(s.id)));
    const saved = await Portal.portalSave({ userId: 'coach-1', row, edits });
    expect(saved).toMatchObject({ saved: true, missing: [] });
    const done = await Portal.portalSave({ userId: 'coach-1', row, edits: {}, submit: true });
    expect(done).toMatchObject({ submitted: true, coachingSessionId: 'sess-1' });
    const a = mockFake.__tables.coaching_sessions.find((s) => s.id === 'sess-1').analysis_data;
    expect(a.obs612.result.counted).toBe(22);
  });
});

describe('HITL parity: a principal and a coach get the same FICO-S flow (operator 18 Nov ~16:35)', () => {
  const Svc = require('../../bot/shared/services/observe/portal-observe.service');
  const draftAll = () => {
    const d = {};
    for (const s of FS.SCREENS) Object.assign(d, FS.mergeDraft({}, s.id, answersFor(s.id)));
    return d;
  };
  const setup = (observerId, role) => {
    mockFake.__tables.users.push({ id: observerId, name: `Obs ${role}`, role, phone_number: '923000000009', preferred_language: 'en' });
    mockFake.__tables.coaching_sessions.push({
      id: `sess-${role}`, status: 'obs612_form', user_id: 'teacher-1', observer_user_id: observerId,
      observation_type: 'leader_observation', framework: 'fico_s_v1_1', analysis_data: {},
    });
    mockFake.__tables.observation_field_forms.push({
      id: `form-${role}`, observer_user_id: observerId, teacher_user_id: 'teacher-1', coaching_session_id: `sess-${role}`,
      rubric_version: 'fico_s_v1_1', visit_context: { grade: 7, subject: 'maths', via: 'portal' }, answers: { obs612: draftAll() },
      photos: [], sealed_at: null, checked_at: null, final_levels: null,
    });
  };

  test.each([['coach', 'obs-coach-1'], ['principal', 'obs-principal-1']])('%s: portal Submit seals, keeps the debrief open and starts the debrief notes at once', async (role, id) => {
    setup(id, role);
    const buildDebriefGuide = jest.fn(async () => ({ opener: 'notes' }));
    const mergeObserverDebrief = jest.fn(async () => true);
    const d = { supabase: require('../../bot/shared/config/supabase'), debrief: { buildDebriefGuide, mergeObserverDebrief }, log: jest.fn() };
    const out = await Svc.saveDraft({ userId: id, coachingSessionId: `sess-${role}`, edits: {}, submit: true }, d);
    expect(out).toMatchObject({ submitted: true, tool: 'ficos' });
    const sess = mockFake.__tables.coaching_sessions.find((x) => x.id === `sess-${role}`);
    expect(sess.status).toBe('observer_review_complete');
    expect(sess.debrief_status == null || sess.debrief_status === 'pending').toBe(true);
    await flush();
    expect(buildDebriefGuide).toHaveBeenCalledTimes(1);
    expect(mergeObserverDebrief).toHaveBeenCalledWith(`sess-${role}`, { guide_snapshot: { opener: 'notes' } });
    // the portal's next step is the debrief ("talk"), as after a FICO review
    const { stepOfRow } = require('../../bot/shared/services/observe/portal-observe-step');
    expect(stepOfRow(sess).step).toBe('talk');
  });

  test('the debrief notes are the observer\'s own words (the guide builder takes a 6-12 form visit\'s talk guide)', () => {
    // observe-debrief.buildDebriefGuide: an isObs612Scored analysis gets obs612/summary buildTalkGuide (no model).
    const src = fs.readFileSync(require.resolve('../../bot/shared/services/observe/observe-debrief.service'), 'utf8');
    expect(src).toMatch(/isObs612Scored\(v2\)\) \{\s*const \{ buildTalkGuide/);
    const analysis = require('../../bot/shared/services/observe/obs612/record').buildAnalysis({
      id: 'f1', rubric_version: 'fico_s_v1_1', observer_user_id: 'c1', teacher_user_id: 't1', visit_context: { grade: 10, subject: 'science', via: 'observe' },
    }, draftAll());
    expect(require('../../bot/shared/services/coaching/frameworks/own-rubric').isObs612Scored(analysis)).toBe(true);
    const guide = require('../../bot/shared/services/observe/obs612/summary').buildTalkGuide(analysis, { lang: 'en' });
    expect(guide).toMatch(/Words for fb_strengths/);
    expect(guide).toMatch(/C3 Who gets to answer/);
  });

  test('FDE\'s tools are unchanged: their Submit still closes the debrief and offers Send', async () => {
    const Summary = require('../../bot/shared/services/observe/obs612/summary');
    const fde = { framework: 'obs612-gen-v1', rubric: 'obs612-gen-v1', obs612: { rubric_id: 'obs612-gen-v1', answers: {}, feedback: { line: 'ok' } } };
    const msgs = Summary.buildSummaryMessages('sess-9', fde, { lang: 'en' });
    expect(msgs.buttons.buttons.map((b) => b.id)[0]).toMatch(/^observe_send_start_/);
  });
});

describe('the checklist is required (operator 19 Nov: "the checklist section is not optional")', () => {
  const CHECKS = FicoS.RUBRIC.checklist.map((c) => c.key);
  test('Next with checks unanswered keeps the observer on the checklist, a line under each one missing (EN, UR)', async () => {
    const r = await ex('form-s', 'FS_CHECKLIST', { cl_1: 'yes', cl_2: 'no' });
    expect(r.screen).toBe('FS_CHECKLIST');
    expect(Object.keys(r.data.error_messages).sort()).toEqual(CHECKS.slice(2).sort());
    expect(r.data.error_messages.cl_3).toBe('Choose Yes or No.');
    expect(r.data.err_v).toBe(true);
    const u = await Endpoint.handleObs612DataExchange(fsToken('form-s-ur', 'coach-ur'), 'FS_CHECKLIST', { screen: 'FS_CHECKLIST' });
    expect(u.screen).toBe('FS_CHECKLIST');
    expect(u.data.error_messages.cl_1).toBe('ہاں یا نہیں چنیں۔');
  });
  test('every check answered goes on to the feedback', async () => {
    const ok = await ex('form-s', 'FS_CHECKLIST', Object.fromEntries(CHECKS.map((k) => [k, 'no'])));
    expect(ok.screen).toBe('FS_FEEDBACK');
  });
});
