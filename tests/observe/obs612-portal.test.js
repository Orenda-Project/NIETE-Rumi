/**
 * bd-ra8xu.40 — an FDE (obs612) visit's form, filled on the PORTAL (operator 12 Nov: a coach can do on the portal
 * everything the WhatsApp review Flow does, "and the same for FDE obs612 visits").
 *
 * The portal's draft routes (portal-observe.service getDraft / saveDraft) hand an FDE session to obs612/portal.js,
 * which serves FDE's form (the Flow's own screens, fields and options) and saves, checks and submits it through the
 * Flow's own pieces: the merge and per-screen check, record.whatIsMissing / buildAnalysis, store.saveDraft / submit.
 *
 * - open:     the visit's tool, its parts in the Flow's order, the saved draft, the label 'FDE v1'; editable from the
 *             recording landing until Submit; read-only once sealed; nothing for a cancelled visit.
 * - save:     merged into answers.obs612 (only this visit's fields, only real options), nothing else changes.
 * - submit:   refused with the field errors while anything is missing (the draft is kept); else the SAME stored result
 *             as the WhatsApp Flow's Submit, the session at observer_review_complete / debrief done, the form sealed.
 * - NO WhatsApp message for any of it (no Flow, no coach summary).
 * - the step: the form is the coach's step ('draft') until Submit, then the report, as after a WhatsApp Submit.
 *
 * Real: the portal service, the FDE module, store, record, Flow spec, rubric, the WhatsApp endpoint (for the twin).
 * Mocked: the database (in-memory), the logger, WhatsApp sends, the coach summary.
 */
const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendTemplateMessage: jest.fn(() => Promise.resolve(true)),
  sendImage: jest.fn(() => Promise.resolve(true)),
  sendDocument: jest.fn(() => Promise.resolve(true)),
}));
const mockSendCoachSummary = jest.fn(() => Promise.resolve({ ok: true }));
jest.mock('../../bot/shared/services/observe/obs612/summary', () => ({ sendCoachSummary: (...a) => mockSendCoachSummary(...a) }));

const WhatsApp = require('../../bot/shared/services/whatsapp.service');
const PortalObserve = require('../../bot/shared/services/observe/portal-observe.service');
const Endpoint = require('../../bot/shared/routes/obs612-endpoint');
const F = require('../../bot/shared/services/observe/obs612/flow');
const Record = require('../../bot/shared/services/observe/obs612/record');
const { stepOfRow } = require('../../bot/shared/services/observe/portal-observe-step');

const COACH = 'coach-1';
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };
const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const sessionRow = (id) => mockFake.__tables.coaching_sessions.find((r) => r.id === id);
const draftOf = (id, userId = COACH) => PortalObserve.getDraft({ userId, coachingSessionId: id });
const save = (id, edits, extra = {}) => PortalObserve.saveDraft({ userId: COACH, coachingSessionId: id, edits, ...extra });

const TOOLS = {
  msci: { rubric: 'obs612-msci-v1', vc: { grade: 7, subject: 'maths', sheet: null, via: 'observe' } },
  gen: { rubric: 'obs612-gen-v1', vc: { grade: 9, subject: 'islamiat', sheet: null, via: 'observe' } },
  en: { rubric: 'obs612-enur-v1', vc: { grade: 6, subject: 'english', sheet: 'en', via: 'observe', teacher_name: 'Rabia Bibi', school_name: 'IMCG F-7/2' } },
  ur: { rubric: 'obs612-enur-v1', vc: { grade: 8, subject: 'urdu', sheet: 'ur', via: 'observe' } },
};

// One /observe FDE visit: the stamped session (status as given) and its form row, linked.
function visit(name, tool, { status = 'obs612_form', sealed = false, answers = {}, observer = COACH } = {}) {
  const t = TOOLS[tool];
  return {
    session: {
      id: `sess-${name}`, status, framework: t.rubric, framework_selection_reason: 'obs612_lesson',
      observation_type: 'leader_observation', observer_user_id: observer, user_id: 'teacher-1', debrief_status: 'pending',
      audio_url: 'https://wa.example/audio.ogg', analysis_data: { transcript: 'kept' },
    },
    form: {
      id: `form-${name}`, rubric_version: t.rubric, visit_context: t.vc, observer_user_id: observer, teacher_user_id: 'teacher-1',
      coaching_session_id: `sess-${name}`, answers: { obs612: answers }, photos: [],
      sealed_at: sealed ? '2026-11-12T05:00:00.000Z' : null, checked_at: null, final_levels: null,
    },
  };
}

const VISITS = [
  visit('msci', 'msci'),
  visit('msci-wa', 'msci'),
  visit('gen', 'gen'),
  visit('gen-wa', 'gen'),
  visit('en', 'en'),
  visit('ur', 'ur'),
  visit('early', 'msci', { status: 'transcribing' }),
  visit('sealed', 'gen', { status: 'observer_review_complete', sealed: true, answers: { env_1: 'yes', fb_line: 'Done' } }),
  visit('cancelled', 'gen', { status: 'cancelled' }),
  visit('other', 'gen', { observer: 'coach-2' }),
];

// Every field on a visit's path answered: a real option for a choice, words for a required text, '' for an optional.
function fullAnswers(tool, sheet) {
  const out = {};
  for (const id of F.pathFor(tool, sheet)) {
    for (const f of F.fieldsOf(id)) {
      if (f.options) out[f.name] = f.required ? f.options[Math.min(2, f.options.length - 1)].id : '';
      else if (f.input === 'number') out[f.name] = '32';
      else out[f.name] = f.required ? `Words for ${f.name}` : '';
    }
  }
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: COACH, name: 'Coach Amna', role: 'coach', phone_number: '923000000001' },
      { id: 'coach-2', name: 'Coach Sana', role: 'coach', phone_number: '923000000003' },
      { id: 'teacher-1', name: 'Rabia', school_name: 'IMSG I-8/1', phone_number: '923000000002' },
    ],
    coaching_sessions: [
      ...VISITS.map((v) => v.session),
      { id: 'sess-fico', status: 'awaiting_observer_review', framework: 'fico', observation_type: 'leader_observation', observer_user_id: COACH, analysis_data: {} },
    ],
    observation_field_forms: VISITS.map((v) => v.form),
  });
});
afterEach(flush);

const noWhatsApp = () => {
  for (const fn of Object.values(WhatsApp)) if (jest.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
  expect(mockSendCoachSummary).not.toHaveBeenCalled();
};

describe('open: the visit\'s own FDE form', () => {
  test('an FDE session is answered with kind obs612, the label FDE v1, its tool and the Flow\'s parts in order', async () => {
    const out = await draftOf('sess-msci');
    expect(out).toMatchObject({
      status: 'ok', kind: 'obs612', label: 'FDE v1', tool: 'msci', toolName: 'Maths & Science tool',
      grade: 7, subject: 'maths', editable: true, sealed: false, values: {},
    });
    expect(out.sections.map((s) => s.id)).toEqual(F.pathFor('msci', null));
    expect(out.missing).toEqual(Record.whatIsMissing(formRow('form-msci'), {}));
    expect(out.missing.length).toBeGreaterThan(0);
  });

  test('every field of a part is the Flow\'s field: name, input, options, required; FDE\'s words as FDE printed them', async () => {
    const out = await draftOf('sess-msci');
    for (const s of out.sections) {
      const fields = s.parts.filter((p) => p.type === 'field');
      expect(fields.map((f) => f.name)).toEqual(F.fieldsOf(s.id).map((f) => f.name));
      fields.forEach((f, i) => {
        const spec = F.fieldsOf(s.id)[i];
        expect(f.input).toBe(spec.input);
        expect(f.required).toBe(Boolean(spec.required));
        if (spec.options) expect(f.options.map((o) => o.id)).toEqual(spec.options.map((o) => o.id));
      });
    }
    const before = out.sections.find((s) => s.id === 'MSCI_BEFORE'); // sections[0] is the overview (bd-ra8xu.53)
    const i1 = before.parts.find((p) => p.name === 'i1');
    expect(i1).toMatchObject({ role: 'item', kind: 'level', n: 1, short: 'Written work checked' });
    expect(i1.text).toMatch(/^Assigning and checking written work/);
    expect(i1.options[0]).toMatchObject({ id: '0', title: 'Level 0', description: 'Does not meet level 1' });
    expect(before.parts.find((p) => p.name === 'obs_i1')).toMatchObject({ role: 'observation', input: 'textarea', required: false });
  });

  test('General form: Yes/No items numbered as FDE numbers them; the last part asks the required feedback line', async () => {
    const out = await draftOf('sess-gen');
    const first = out.sections[0];
    expect(first.parts[0]).toEqual({ type: 'heading', text: 'CLASSROOM ENVIRONMENT' });
    expect(first.parts.find((p) => p.name === 'env_1')).toMatchObject({ role: 'item', kind: 'yes_no', n: 1, text: 'Well lit and airy classroom' });
    expect(first.parts.find((p) => p.name === 'env_1').options.map((o) => o.title)).toEqual(['Yes', 'No']);
    const last = out.sections[out.sections.length - 1].parts;
    expect(last.find((p) => p.type === 'sub' && p.role === 'feedback')).toBeTruthy();
    expect(last.find((p) => p.name === 'fb_line')).toMatchObject({ role: 'line', required: true });
  });

  test('English & Urdu: Section 1 rows from the visit, the sheet picks Section 2, items 1-4, the score from the saved draft', async () => {
    const en = await draftOf('sess-en');
    expect(en.sections.map((s) => s.id)).toEqual(F.pathFor('enur', 'en'));
    const ctx = en.sections[0].parts.find((p) => p.type === 'context');
    expect(ctx.rows).toEqual([
      { key: 'ctx_1', label: 'School', value: 'IMCG F-7/2' },
      { key: 'ctx_2', label: 'Observer', value: 'Coach Amna' },
      { key: 'ctx_3', label: 'Teacher', value: 'Rabia Bibi' },
      { key: 'ctx_4', label: 'Grade/Class', value: '6' },
    ]);
    expect(en.sections[0].parts.find((p) => p.name === 'ctx_6')).toMatchObject({ role: 'context', text: 'Lesson Topic', required: true });
    const ur = await draftOf('sess-ur');
    expect(ur.sections.map((s) => s.id)).toContain('ENUR_TWO_D');
    expect(ur.sections.map((s) => s.id)).not.toContain('ENUR_TWO_C');
    // 13 Nov: Section 7 has its own read-only part, just before Section 8.
    const score = ur.sections.find((s) => s.id === 'ENUR_SEVEN').parts.find((p) => p.type === 'score');
    expect(score).toMatchObject({ total: 0, max: 156, pct: 0 });
  });

  test('editable before the recording is even transcribed (the form exists from the capture)', async () => {
    expect(await draftOf('sess-early')).toMatchObject({ status: 'ok', kind: 'obs612', editable: true });
  });

  test('read-only once sealed: her final answers, sealed, editable false', async () => {
    expect(await draftOf('sess-sealed')).toMatchObject({
      status: 'ok', kind: 'obs612', editable: false, sealed: true, submittedAt: '2026-11-12T05:00:00.000Z',
      values: { env_1: 'yes', fb_line: 'Done' },
    });
  });

  test('a cancelled visit is read, never edited', async () => {
    expect(await draftOf('sess-cancelled')).toMatchObject({ status: 'ok', kind: 'obs612', editable: false, sealed: false });
  });

  test('another coach\'s visit is not found', async () => {
    expect(await draftOf('sess-other')).toEqual({ status: 'not_found' });
  });

  test('a FICO session still goes the FICO way (no kind)', async () => {
    const draft = { buildScreenPrefill: jest.fn(() => ({})), MAX_MOVE_SLOTS: 0 };
    const pack = () => ({ domainOrder: [], domains: {} });
    const out = await PortalObserve.getDraft({ userId: COACH, coachingSessionId: 'sess-fico' }, { draft, pack, languageFor: async () => 'en' });
    expect(out.status).toBe('ok');
    expect(out).not.toHaveProperty('kind');
  });
});

describe('save part-way', () => {
  test('her answers land in answers.obs612; only this visit\'s fields and real options; nothing else moves', async () => {
    const out = await save('sess-msci', { i1: '2', obs_i1: '  Notebooks checked  ', i2: 'maybe', r_C1: '2', env_1: 'yes' });
    expect(out).toMatchObject({ status: 'ok', kind: 'obs612', saved: true, values: { i1: '2', obs_i1: 'Notebooks checked' } });
    expect(formRow('form-msci').answers.obs612).toEqual({ i1: '2', obs_i1: 'Notebooks checked' });
    expect(formRow('form-msci').sealed_at).toBeNull();
    expect(sessionRow('sess-msci').status).toBe('obs612_form');
    expect(sessionRow('sess-msci').analysis_data).toEqual({ transcript: 'kept' });
    noWhatsApp();
  });

  test('the answer comes back with the Flow\'s per-field check, as codes', async () => {
    const out = await save('sess-msci', { i1: '2', dp_area_2: 'i3' });
    expect(out.errors.i1).toBeUndefined();
    expect(out.errors.i2).toBe('item');
    expect(out.errors.dp_action).toBe('text');
    expect(out.errors.dp_goal_2).toBe('row_two');
  });

  test('a later save keeps what an earlier one saved; a cleared answer is cleared', async () => {
    await save('sess-gen', { env_1: 'yes', comment_env: 'Bright room' });
    await save('sess-gen', { env_2: 'no', comment_env: '' });
    expect(formRow('form-gen').answers.obs612).toEqual({ env_1: 'yes', env_2: 'no' });
  });

  test('refused once sealed (409), and for a cancelled visit', async () => {
    expect(await save('sess-sealed', { env_2: 'no' })).toEqual({ status: 'not_ready', reason: 'sealed' });
    expect(await save('sess-cancelled', { env_1: 'no' })).toEqual({ status: 'not_ready', reason: 'visit_closed' });
    expect(formRow('form-sealed').answers.obs612).toEqual({ env_1: 'yes', fb_line: 'Done' });
  });

  test('another coach cannot save into it', async () => {
    expect(await PortalObserve.saveDraft({ userId: COACH, coachingSessionId: 'sess-other', edits: { env_1: 'yes' } })).toEqual({ status: 'not_found' });
  });
});

describe('Submit', () => {
  test('refused with the missing items and the field errors while anything is missing; what she sent is kept', async () => {
    const out = await save('sess-gen', { env_1: 'yes' }, { submit: true });
    expect(out).toMatchObject({ status: 'invalid', reason: 'obs612_incomplete' });
    expect(out.missing).toEqual(expect.arrayContaining(['env_2', 'fb_line']));
    expect(out.missing).not.toContain('env_1');
    expect(out.errors).toMatchObject({ env_2: 'item', fb_line: 'text' });
    expect(formRow('form-gen').answers.obs612).toEqual({ env_1: 'yes' });
    expect(formRow('form-gen').sealed_at).toBeNull();
    expect(sessionRow('sess-gen').status).toBe('obs612_form');
    noWhatsApp();
  });

  test('refused for a bad value the Flow would refuse too (class size not a whole number)', async () => {
    const answers = { ...fullAnswers('enur', 'en'), ctx_8: 'thirty' };
    const out = await save('sess-en', answers, { submit: true });
    expect(out).toMatchObject({ status: 'invalid', reason: 'obs612_incomplete', errors: { ctx_8: 'number' } });
    expect(formRow('form-en').sealed_at).toBeNull();
  });

  test('a complete form: sealed once, the session moved on exactly as a WhatsApp Submit moves it, and NO WhatsApp message', async () => {
    const out = await save('sess-msci', fullAnswers('msci', null), { submit: true });
    expect(out).toMatchObject({ status: 'ok', kind: 'obs612', submitted: true, coachingSessionId: 'sess-msci', sealed: true, editable: false });
    const form = formRow('form-msci');
    expect(form.sealed_at).toBeTruthy();
    expect(form.final_levels).toEqual(sessionRow('sess-msci').analysis_data.obs612.result);
    const s = sessionRow('sess-msci');
    expect(s).toMatchObject({ status: 'observer_review_complete', debrief_status: 'done', framework: 'obs612-msci-v1' });
    expect(s.analysis_data.transcript).toBe('kept');
    await flush();
    noWhatsApp();
    // A second Submit seals nothing.
    expect(await save('sess-msci', fullAnswers('msci', null), { submit: true })).toEqual({ status: 'not_ready', reason: 'sealed' });
  });

  test.each([
    ['msci', 'msci', null],
    ['gen', 'gen', null],
  ])('%s: the SAME stored result as the WhatsApp Flow\'s Submit of the same answers', async (name, tool, sheet) => {
    const answers = fullAnswers(tool, sheet);
    const portal = await save(`sess-${name}`, answers, { submit: true });
    expect(portal.status).toBe('ok');

    // The twin visit, through the Flow's endpoint, screen by screen.
    const token = `${COACH}:obs612:form-${name}-wa`;
    let res = await Endpoint.handleObs612Init(token);
    for (let guard = 0; res.screen !== 'DONE' && guard < 12; guard += 1) {
      const posted = { screen: res.screen };
      for (const f of F.fieldsOf(res.screen)) posted[f.name] = answers[f.name];
      res = await Endpoint.handleObs612DataExchange(token, res.screen, posted);
    }
    expect(res.data.outcome).toBe('submitted');
    await flush();

    const strip = (a) => ({ ...a, obs612: { ...a.obs612, submitted_at: 'x', form_id: 'x' } });
    const viaPortal = sessionRow(`sess-${name}`);
    const viaWhatsApp = sessionRow(`sess-${name}-wa`);
    expect(strip(viaPortal.analysis_data)).toEqual(strip(viaWhatsApp.analysis_data));
    expect(formRow(`form-${name}`).answers).toEqual(formRow(`form-${name}-wa`).answers);
    expect(formRow(`form-${name}`).final_levels).toEqual(formRow(`form-${name}-wa`).final_levels);
    expect([viaPortal.status, viaPortal.debrief_status]).toEqual([viaWhatsApp.status, viaWhatsApp.debrief_status]);
    // The WhatsApp Submit sends her the summary; the portal's sends nothing.
    expect(mockSendCoachSummary).toHaveBeenCalledTimes(1);
    expect(mockSendCoachSummary.mock.calls[0][0].sessionId).toBe(`sess-${name}-wa`);
  });

  test('after Submit the form reads back read-only, with what she submitted', async () => {
    const answers = fullAnswers('gen', null);
    await save('sess-gen', answers, { submit: true });
    const out = await draftOf('sess-gen');
    expect(out).toMatchObject({ kind: 'obs612', sealed: true, editable: false, missing: [] });
    expect(out.values.fb_line).toBe('Words for fb_line');
  });
});

describe('the step: the form is hers until Submit, then the report', () => {
  const COARSE = { analysing: 'analysing', draft: 'draft', feedback: 'report' };
  // coach v2 cannot require the bot (separate deploy): the two are held in step through its own read of a row.
  const SVC = require('../../dashboard/services/coach-v2.service');
  const { PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');
  const PATCH = [{
    teacher_ext_id: '923000000002', name: 'Rabia', phone: '923000000002', school_ext_id: 'niete:110', role: 'teacher',
    rumi_user_id: 'teacher-1', coaching_sessions: 1, observations: 1, training_modules: 0, school_name: 'IMSG I-8/1',
  }];
  const coachV2Step = async (row) => {
    const q = async (sql) => {
      if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
      if (sql === SVC.SQL.OBSERVATION_BY_ID) {
        return { rows: [{ ...row, created_at: '2026-11-12T04:00:00Z', scores: null, summary: null, delivery: null, analysis_data: undefined }] };
      }
      if (sql === SVC.SQL.USER_NAME) return { rows: [{ name: 'Coach Amna' }] };
      return { rows: [] };
    };
    return (await SVC.getCoachObservation(q, COACH, row.id, { today: '2026-11-12' })).step;
  };

  test('an FDE session at obs612_form is at the form (draft) — the bot and coach v2 agree', async () => {
    const row = sessionRow('sess-msci');
    expect(stepOfRow(row).step).toBe('draft');
    expect(await coachV2Step(row)).toBe('draft');
  });

  test('before transcription lands, an FDE session is already at the form', () => {
    expect(stepOfRow(sessionRow('sess-early')).step).toBe('draft');
  });

  test('after a portal Submit: the step after the form (feedback → report), and previewReport\'s guard lets it through', async () => {
    await save('sess-gen', fullAnswers('gen', null), { submit: true });
    const row = sessionRow('sess-gen');
    const { step } = stepOfRow(row);
    expect(COARSE[step]).toBe('report');
    expect(await coachV2Step(row)).toBe('report');
    // previewReport: past its guard (status + debrief), it asks for the teacher — not 'feedback_first'.
    const people = { isBound: () => true, teacherOf: async () => null };
    const out = await PortalObserve.previewReport({ userId: COACH, coachingSessionId: 'sess-gen' }, { people });
    expect(out).toEqual({ status: 'invalid', reason: 'no_teacher_phone' });
  });

  test('a FICO row is unchanged', () => {
    expect(stepOfRow({ status: 'transcribing' }).step).toBe('analysing');
    expect(stepOfRow({ status: 'awaiting_observer_review' }).step).toBe('draft');
  });
});
