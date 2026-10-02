/**
 * /observe2 round 2 (2 Oct 2026 go-live call): the lesson plan is picked inside the form before the
 * seal, and the check gains the fidelity screen /observe has — each move the plan asked for, already
 * rated from the recording, which the coach confirms or corrects and which is re-scored by the same
 * scorer. Plus: up to ten photos, plainer wording, and a brief that opens with reflective questions,
 * carries the plan's result, and never names a placeholder level as what the coach saw.
 *
 * Real: the endpoints, the store, the rules, the moments module, the recent-plan source and the V8
 * catalogue, the fidelity orchestrator, move-list store and scorer, the /observe fidelity helpers,
 * the brief. Mocked at the boundary: the database (in-memory), WhatsApp, the moments model and the
 * fidelity grader's model call.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/roster/roster-media', () => ({
  decryptMedia: jest.fn((m) => Promise.resolve({ mediaId: m.media_id, data: Buffer.from(`jpeg:${m.media_id}`) })),
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn((b, key) => Promise.resolve(`https://r2.example/${key}`)) }));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { uploadBuffer } = require('../../bot/shared/storage/r2');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Form = require('../../bot/shared/routes/observe2-form-endpoint');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const { buildFieldFormFlow } = require('../../bot/shared/services/observe/observe2/field-form.flow');
const { buildEvidenceCheckFlow } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');
const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
const { PLAIN } = require('../../bot/shared/services/observe/observe2/fico17');

const LESSON = 'grade_4_math_ch5_seg3';
const VERSION = { version_stamp: 'v8-20260817T0809', content_hash: '0a1cd51499a1' };
const MOVES = [
  { move_id: 'm1', phase: 'warm_up', bucket: 'must_happen', text: 'Show two fraction strips and ask what the children notice.' },
  { move_id: 'm2', phase: 'direct_instruction', bucket: 'must_happen', text: 'Compare 1/2 and 3/4 by folding strips.' },
  { move_id: 'm3', phase: 'guided_practice', bucket: 'must_happen', text: 'Pairs order three fractions on a number line.' },
  { move_id: 'm4', phase: 'closure', bucket: 'must_happen', text: 'Exit ticket: which is bigger, 2/3 or 3/5?' },
];
const GRADED = {
  verdicts: [
    { move_id: 'm1', verdict: 'executed', evidence: '[00:10] What do you notice about the two strips?', rationale: 'The teacher showed the strips and asked.' },
    { move_id: 'm2', verdict: 'executed', evidence: '[01:16] Put three quarters next to one half.', rationale: 'Compared by folding.' },
    { move_id: 'm3', verdict: 'partial', evidence: '[01:38] Now work with your partner.', rationale: 'Pairs worked, but not on a number line.' },
    { move_id: 'm4', verdict: 'not_done', evidence: '', rationale: 'No exit ticket in the recording.' },
  ],
  moderators: { plan_navigability: null, note: null },
  narrative: 'Most of the plan was taught.',
  model: 'test-grader',
};
const TRANSCRIPT = [
  '[00:10] Teacher: What do you notice about the two strips?',
  '[00:42] Teacher: Why is two quarters the same as one half? Hamza?',
  '[01:00] Student: Because two small pieces cover the same length as one big piece.',
  '[01:16] Teacher: Put three quarters next to one half. What do you see?',
  '[01:38] Teacher: Now work with your partner. You can choose.',
].join('\n\n');
const MODEL_OUT = {
  moments: [
    { moment: 'ask', type: 'open_q_one', minute: '00:42', quote: 'Why is two quarters the same as one half? Hamza?' },
    { moment: 'ask', type: 'reasoning', minute: '01:00', quote: 'Because two small pieces cover the same length as one big piece.' },
    { moment: 'work', type: 'choice', minute: '01:38', quote: 'Now work with your partner. You can choose.' },
  ],
  counts: { closed_q: 1 },
};

const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const formToken = (id) => `coach-1:observe2-form:${id}`;
const checkToken = (id) => `coach-1:observe2-check:${id}`;
const flush = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r)); };
const cp = (s) => [...String(s)].length;

function walk(node, visit) {
  if (Array.isArray(node)) node.forEach((c) => walk(c, visit));
  else if (node && typeof node === 'object') {
    if (node.type) visit(node);
    for (const k of ['children', 'then', 'else']) if (Array.isArray(node[k])) walk(node[k], visit);
  }
}
const comps = (screen) => { const out = []; walk(screen.layout.children, (c) => out.push(c)); return out; };

const PART_1 = { screen: 'PART_ONE', present: '30', p1_spoke: '6', p1_picked: 'once', p1_groups: 'none', p1_materials: 'teacher', p1_change: 'no' };
const PART_2 = { screen: 'PART_TWO', p2_spoke: '8', p2_new: '3', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'yes', p2_change_how: 'clear' };
const AFTER = { screen: 'AFTER', incident: 'none', detail: '', note: '', priority: 'C1', seal_ok: true };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LP_FIDELITY_ENABLED = 'true';
  delete process.env.LP_FIDELITY_RUNS;
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', role: 'coach' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', role: 'teacher' },
    ],
    niete_lp_downloads: [
      { user_id: 'teacher-1', asset_id: 'asset-3', lesson_id: LESSON, ...VERSION, grade: 4, subject: 'math', chapter_number: 5, status: 'sent', created_at: '2026-10-02T08:00:00.000Z' },
      { user_id: 'teacher-1', asset_id: 'asset-2', lesson_id: 'grade_4_math_ch5_seg2', version_stamp: 'v8-x', content_hash: 'h2', grade: 4, subject: 'math', chapter_number: 5, status: 'sent', created_at: '2026-10-01T08:00:00.000Z' },
      { user_id: 'someone-else', asset_id: 'asset-9', lesson_id: 'grade_5_math_ch6_seg14', version_stamp: 'v', content_hash: 'h', grade: 5, subject: 'math', status: 'sent', created_at: '2026-10-02T09:00:00.000Z' },
    ],
    niete_lp_fidelity_moves: [{ lesson_id: LESSON, ...VERSION, template: 'GRADE4', total_minutes: 40, moves: MOVES, created_at: '2026-08-17T08:09:00.000Z' }],
  });
});
afterAll(() => { delete process.env.LP_FIDELITY_ENABLED; delete process.env.OBSERVE2_CHECK_FLOW_ID; });

async function newForm(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: { teacher_ext_id: 'tx1' } });
  Object.assign(formRow(form.id), { period_minutes: 40 }, patch);
  return form.id;
}

async function throughPart2(id) {
  await Form.handleObserve2FormInit(formToken(id));
  await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', PART_1);
  return Form.handleObserve2FormDataExchange(formToken(id), 'PART_TWO', PART_2);
}

// ------------------------------------------------------------------ the field form flow

describe('the field form: a lesson-plan screen before the seal', () => {
  const flow = buildFieldFormFlow();
  const screens = Object.fromEntries(flow.screens.map((s) => [s.id, s]));

  test('Part 2 leads to the lesson plan, then to the seal; a reopened form can land on it', () => {
    expect(flow.screens.map((s) => s.id)).toEqual(['PART_ONE', 'PART_TWO', 'LESSON_PLAN', 'AFTER', 'SEALED', 'CONTINUE']);
    expect(flow.routing_model).toMatchObject({
      PART_TWO: ['LESSON_PLAN'], LESSON_PLAN: ['AFTER'], AFTER: ['SEALED'],
      CONTINUE: ['PART_TWO', 'LESSON_PLAN', 'AFTER', 'SEALED'],
    });
  });

  test('the plan list is the teacher\'s own plans, sent by the server, shown only when there was a plan', () => {
    const c = comps(screens.LESSON_PLAN);
    const lp = c.find((x) => x.name === 'lp');
    expect(lp.type).toBe('RadioButtonsGroup');
    const pick = c.find((x) => x.name === 'lp_pick');
    expect(pick).toMatchObject({ type: 'Dropdown', 'data-source': '${data.lp_options}', required: false });
    const conditional = JSON.stringify(c.filter((x) => x.type === 'If'));
    expect(conditional).toContain("${form.lp} != 'none'");
    expect(conditional).toContain('lp_pick');
    const footer = c.find((x) => x.type === 'Footer');
    expect(footer['on-click-action'].payload).toEqual({ screen: 'LESSON_PLAN', lp: '${form.lp}', lp_pick: '${form.lp_pick}' });
  });

  test('the seal screen no longer asks about the plan; it shows the plan that was picked', () => {
    const c = comps(screens.AFTER);
    expect(c.find((x) => x.name === 'lp')).toBeUndefined();
    expect(c.some((x) => x.type === 'TextBody' && x.text === '${data.lp_line}')).toBe(true);
    expect(screens.AFTER.data.lp_line).toBeDefined();
  });

  test('up to ten photos, with a line on which photos help', () => {
    const picker = comps(screens.AFTER).find((x) => x.type === 'PhotoPicker');
    expect(picker['max-uploaded-photos']).toBe(10);
    expect(picker.description).toMatch(/board/i);
    expect(picker.description).toMatch(/materials/i);
    expect(picker.description).toMatch(/never faces/i);
  });

  test('plainer wording: no "Ready before being told", no "name sticks"; the check uses the same words', () => {
    const text = JSON.stringify(flow);
    expect(text).not.toMatch(/Ready before being told|name sticks|Signal, but slow to settle/);
    const how = comps(screens.PART_ONE).find((x) => x.name === 'p1_change_how');
    expect(how['data-source'].map((o) => o.title)).toEqual(PLAIN.C5);
    for (const o of how['data-source']) expect(o.description.length).toBeGreaterThan(40);
  });
});

// ------------------------------------------------------------------ the form endpoint

describe('picking the lesson plan in the form', () => {
  test('"Part 2 done" opens the lesson plan with the teacher\'s recent plans, newest first, and "Not in this list"', async () => {
    const id = await newForm();
    const out = await throughPart2(id);
    expect(out.screen).toBe('LESSON_PLAN');
    const opts = out.data.lp_options;
    expect(opts.map((o) => o.id)).toEqual(['asset-3', 'asset-2', 'other']);
    expect(opts[0].title).toMatch(/^Comparing & ordering/);
    expect(opts[0].description).toMatch(/^Grade 4 Math · Ch5 Day 3 · p\.79-81/);
    expect(opts[2].title).toBe('Not in this list');
    for (const o of opts) expect(cp(o.title)).toBeLessThanOrEqual(30);
    expect(out.data.lp_hint).toMatch(/Rabia/);
  });

  test('"Followed a lesson plan" without picking one is refused when there are plans to pick', async () => {
    const id = await newForm();
    await throughPart2(id);
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'LESSON_PLAN', { screen: 'LESSON_PLAN', lp: 'used', lp_pick: '' });
    expect(out.screen).toBe('LESSON_PLAN');
    expect(out.data.error_messages.lp_pick).toMatch(/Pick the plan/);
    expect(formRow(id).answers.lp).toBeUndefined();
  });

  test('a picked plan is saved with the keys the fidelity grader needs, and the seal screen names it', async () => {
    const id = await newForm();
    await throughPart2(id);
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'LESSON_PLAN', { screen: 'LESSON_PLAN', lp: 'used', lp_pick: 'asset-3' });
    expect(out.screen).toBe('AFTER');
    expect(out.data.lp_line).toMatch(/Comparing & ordering unlike fractions/);
    expect(out.data.lp_line).toMatch(/go back/i);
    const a = formRow(id).answers;
    expect(a.lp).toBe('used');
    expect(a.lp_ref).toMatchObject({ asset_id: 'asset-3', lesson_id: LESSON, ...VERSION, grade: '4', subject: 'math' });
  });

  test('"No plan for this lesson" goes straight on, and the seal screen says so', async () => {
    const id = await newForm();
    await throughPart2(id);
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'LESSON_PLAN', { screen: 'LESSON_PLAN', lp: 'none' });
    expect(out.screen).toBe('AFTER');
    expect(out.data.lp_line).toMatch(/no lesson plan/i);
    expect(formRow(id).answers.lp_ref).toBeUndefined();
  });

  test('a reopened form after Part 2 continues to the lesson plan; after the plan, to the seal', async () => {
    const id = await newForm();
    await throughPart2(id);
    const init = await Form.handleObserve2FormInit(formToken(id));
    expect(init.screen).toBe('CONTINUE');
    expect(init.data.continue_line).toMatch(/lesson plan/i);
    expect((await Form.handleObserve2FormDataExchange(formToken(id), 'CONTINUE', { screen: 'CONTINUE' })).screen).toBe('LESSON_PLAN');
    await Form.handleObserve2FormDataExchange(formToken(id), 'LESSON_PLAN', { screen: 'LESSON_PLAN', lp: 'used', lp_pick: 'asset-3' });
    expect((await Form.handleObserve2FormDataExchange(formToken(id), 'CONTINUE', { screen: 'CONTINUE' })).screen).toBe('AFTER');
  });

  test('the seal keeps the plan, and up to ten photos are stored', async () => {
    const id = await newForm();
    await throughPart2(id);
    await Form.handleObserve2FormDataExchange(formToken(id), 'LESSON_PLAN', { screen: 'LESSON_PLAN', lp: 'used', lp_pick: 'asset-3' });
    const photos = Array.from({ length: 12 }, (_, i) => ({ media_id: `m${i + 1}` }));
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'AFTER', { ...AFTER, photos });
    expect(out.screen).toBe('SEALED');
    await flush();
    const f = formRow(id);
    expect(f.sealed_at).toBeTruthy();
    expect(f.answers.lp_ref.lesson_id).toBe(LESSON);
    expect(uploadBuffer).toHaveBeenCalledTimes(10);
    expect(f.photos).toHaveLength(10);
  });
});

// ------------------------------------------------------------------ fidelity after transcription

describe('fidelity is graded from the recording against the picked plan', () => {
  async function sealedWithRecording(answersPatch = {}) {
    const id = await newForm({
      sealed_at: '2026-10-02T10:00:00.000Z',
      answers: { ...PART_1, ...PART_2, incident: 'none', priority: 'C1', lp: 'used', lp_ref: { asset_id: 'asset-3', lesson_id: LESSON, ...VERSION, grade: '4', subject: 'math', label: 'Comparing' }, ...answersPatch },
    });
    mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, audio_duration_seconds: 215, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
    await Store.linkSession(id, 'sess-1');
    return id;
  }

  test('the moments and the fidelity grading both run; the result is stored with the moments, never shown before the check', async () => {
    const id = await sealedWithRecording();
    const grader = jest.fn(() => Promise.resolve(GRADED));
    const out = await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve(MODEL_OUT), fidelityDeps: { analyzeFidelity: grader } });
    expect(out).toMatchObject({ handled: true, action: 'check_sent' });
    expect(grader).toHaveBeenCalledTimes(1);
    expect(grader.mock.calls[0][0].map((m) => m.move_id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(grader.mock.calls[0][1]).toContain('[01:16]');
    const fid = formRow(id).rumi_moments.fidelity;
    expect(fid).toMatchObject({ status: 'ok', source: 'corpus', lesson_id: LESSON, prescribed_count: 4, fidelity_pct: 62.5 });
    expect(fid.moves.map((m) => m.verdict)).toEqual(['executed', 'executed', 'partial', 'not_done']);
    expect(formRow(id).rumi_moments.moments).toHaveLength(3);
  });

  test('no plan picked: no grading, and the moments go on as before', async () => {
    const id = await sealedWithRecording({ lp: 'none', lp_ref: undefined });
    const grader = jest.fn(() => Promise.resolve(GRADED));
    await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve(MODEL_OUT), fidelityDeps: { analyzeFidelity: grader } });
    expect(grader).not.toHaveBeenCalled();
    expect(formRow(id).rumi_moments.fidelity).toBeNull();
    expect(formRow(id).rumi_moments.moments).toHaveLength(3);
  });

  test('a grader failure never costs the moments or the check', async () => {
    const id = await sealedWithRecording();
    const grader = jest.fn(() => Promise.reject(Object.assign(new Error('model down'), { reason: 'http_500' })));
    const out = await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve(MODEL_OUT), fidelityDeps: { analyzeFidelity: grader } });
    expect(out.action).toBe('check_sent');
    expect(formRow(id).rumi_moments.fidelity).toMatchObject({ status: 'fidelity_unavailable' });
    expect(formRow(id).rumi_moments.moments).toHaveLength(3);
  });
});

// ------------------------------------------------------------------ the check flow

describe('the check: a fidelity screen after the last moments screen', () => {
  const flow = buildEvidenceCheckFlow();
  const screens = Object.fromEntries(flow.screens.map((s) => [s.id, s]));

  test('HEARD_EXPLAIN goes to FIDELITY, or straight to the levels when there is no plan to check', () => {
    expect(flow.screens.map((s) => s.id)).toEqual(['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK', 'HEARD_EXPLAIN', 'FIDELITY', 'ADDED_ONE', 'ADDED_TWO', 'PRIORITY', 'DONE']);
    expect(flow.routing_model.HEARD_EXPLAIN).toEqual(['FIDELITY', 'ADDED_ONE']);
    expect(flow.routing_model.FIDELITY).toEqual(['ADDED_ONE']);
  });

  test('twelve move slots, each the step, what happened (pre-filled) and what was seen (pre-filled)', () => {
    const c = comps(screens.FIDELITY);
    expect(c.length).toBeLessThanOrEqual(50);
    const form = screens.FIDELITY.layout.children.find((x) => x.type === 'Form');
    for (let k = 1; k <= 12; k += 1) {
      const radio = c.find((x) => x.name === `fid_r_${k}`);
      expect(radio).toMatchObject({ type: 'RadioButtonsGroup', visible: `\${data.mv_${k}_v}`, required: false });
      expect(radio['data-source'].map((o) => o.id)).toEqual(['executed', 'substituted_equivalent', 'substituted_better', 'partial', 'not_done', 'not_adjudicable']);
      expect(c.find((x) => x.name === `fid_e_${k}`)).toMatchObject({ type: 'TextArea' });
      expect(form['init-values'][`fid_r_${k}`]).toBe(`\${data.fr_${k}}`);
      expect(form['init-values'][`fid_e_${k}`]).toBe(`\${data.fe_${k}}`);
    }
    const titles = c.find((x) => x.name === 'fid_r_1')['data-source'].map((o) => o.title);
    expect(titles).toEqual(['Done as planned', 'Done another way, as good', 'Done another way, better', 'Partly done', 'Not done', "Couldn't tell"]);
  });
});

// ------------------------------------------------------------------ the check endpoint

describe('checking the plan in the check', () => {
  async function checkable(fidelity) {
    const id = await newForm({
      sealed_at: '2026-10-02T10:00:00.000Z', coaching_session_id: 'sess-1', moments_ready_at: '2026-10-02T10:05:00.000Z',
      answers: { ...PART_1, ...PART_2, incident: 'none', priority: 'C1', lp: 'used' },
      rumi_moments: { moments: [{ id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:42', quote: 'Why is two quarters the same as one half? Hamza?', label: 'open question' }], counts: {}, fidelity },
    });
    mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'observe2_checking' }];
    return id;
  }
  const scored = () => require('../../bot/shared/services/coaching/fidelity/fidelity-scorer').scoreFidelity(MOVES, GRADED.verdicts);
  const okFidelity = () => ({ status: 'ok', source: 'corpus', lesson_id: LESSON, ...scored() });

  async function toExplain(id) {
    for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK']) {
      // eslint-disable-next-line no-await-in-loop
      await Check.handleObserve2CheckDataExchange(checkToken(id), s, { screen: s, [`${s.toLowerCase()}_1`]: 'yes' });
    }
    return Check.handleObserve2CheckDataExchange(checkToken(id), 'HEARD_EXPLAIN', { screen: 'HEARD_EXPLAIN' });
  }

  test('with a graded plan: the fidelity screen, each step pre-rated from the recording', async () => {
    const id = await checkable(okFidelity());
    const out = await toExplain(id);
    expect(out.screen).toBe('FIDELITY');
    expect(out.data.fid_header).toMatch(/4 steps/);
    expect(out.data.fid_header).toMatch(/2 done, 1 partly/);
    expect(out.data.mv_1).toMatch(/^Step 1 of 4 · Warm-up: Show two fraction strips/);
    expect(out.data.mv_1).toMatch(/From the recording: The teacher showed the strips and asked\./);
    expect(out.data).toMatchObject({ mv_1_v: true, mv_4_v: true, mv_5_v: false, fr_1: 'executed', fr_3: 'partial', fr_4: 'not_done' });
    expect(out.data.fe_1).toBe('[00:10] What do you notice about the two strips?');
  });

  test('no plan, or a plan that could not be graded: straight to the levels', async () => {
    for (const fid of [null, { status: 'lp_absent' }, { status: 'fidelity_unavailable' }]) {
      // eslint-disable-next-line no-await-in-loop
      const id = await checkable(fid);
      // eslint-disable-next-line no-await-in-loop
      expect((await toExplain(id)).screen).toBe('ADDED_ONE');
    }
  });

  test('the coach\'s corrections are re-scored by the same scorer, kept beside the recording\'s grading, then the levels', async () => {
    const id = await checkable(okFidelity());
    await toExplain(id);
    const out = await Check.handleObserve2CheckDataExchange(checkToken(id), 'FIDELITY', {
      screen: 'FIDELITY', fid_r_1: 'executed', fid_r_2: 'executed', fid_r_3: 'executed', fid_r_4: 'not_done',
      fid_e_1: '[00:10] What do you notice about the two strips?', fid_e_3: 'I saw every pair put the three fractions on a line.',
    });
    expect(out.screen).toBe('ADDED_ONE');
    const review = formRow(id).evidence_review;
    expect(review.fidelity).toMatchObject({ fidelity_pct: 75, observer_edited: true, verdicts_changed: 1, evidence_changed: 1 });
    expect(review.fidelity.moves.find((m) => m.move_id === 'm3')).toMatchObject({ verdict: 'executed', evidence: 'I saw every pair put the three fractions on a line.' });
    expect(formRow(id).rumi_moments.fidelity.fidelity_pct).toBe(62.5);
  });

  test('the brief opens with questions for the teacher and carries the plan result the coach confirmed', async () => {
    const id = await checkable(okFidelity());
    await toExplain(id);
    await Check.handleObserve2CheckDataExchange(checkToken(id), 'FIDELITY', { screen: 'FIDELITY', fid_r_1: 'executed', fid_r_2: 'executed', fid_r_3: 'executed', fid_r_4: 'not_done' });
    await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_ONE', { screen: 'ADDED_ONE' });
    await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_TWO', { screen: 'ADDED_TWO' });
    await Check.handleObserve2CheckDataExchange(checkToken(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C1' });
    await flush();
    const brief = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).find((t) => /brief/i.test(t));
    expect(brief).toMatch(/Open with questions/);
    expect(brief).toMatch(/How do you think the lesson went\?/);
    expect(brief).toMatch(/The lesson plan: 3 of 4 planned steps done \(75%\)/);
    expect(brief).not.toMatch(/undefined|null|NaN/);
  });
});

// ------------------------------------------------------------------ the brief, bd-ra8xu.20

describe('a placeholder level is never named as what the coach saw', () => {
  test('a kept "for now" level reads as what was seen, not as the level\'s label', () => {
    const form = {
      answers: { priority: 'C1' },
      rumi_moments: { moments: [] },
      evidence_review: { priority_final: 'C1', added: { C1: '2' }, added_hole: { C1: 'one open question answered by one child' } },
      final_levels: { C1: '2' },
    };
    const text = buildBrief(form, { teacherName: 'Rabia', lang: 'en' });
    expect(text).toContain('What you saw: one open question answered by one child');
    expect(text).not.toContain('What you saw: Yes/no or chorus answers only');
    expect(text).toContain(`The next step: ${PLAIN.C1[2]}`);
  });

  test('a level the coach changed is named by its label as before', () => {
    const form = {
      answers: { priority: 'C1' }, rumi_moments: { moments: [] },
      evidence_review: { priority_final: 'C1', added: { C1: '2' }, added_hole: { C1: 'one open question answered by one child' } },
      final_levels: { C1: '1' },
    };
    expect(buildBrief(form, { lang: 'en' })).toContain(`What you saw: ${PLAIN.C1[0]}`);
  });
});
