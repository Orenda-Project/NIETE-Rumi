/**
 * /observe2 — Part 1 and Part 2 follow the lesson plan's steps, not the clock (FICO pilot sheet R4,
 * a coach, and R10, the ICT lead, 14 Oct: "the second snapshot also focuses on Guided Practice … There is no
 * specific snapshot to capture evidence of students' independent work").
 *
 * The 5-step plan: warm-up, explanation, guided practice, independent practice, wrap-up.
 *   Part 1: warm-up to guided practice. "Part 1 done" is tapped when the children start working on
 *           their own; that tap is still the part1_done_at stamp.
 *   Part 2: independent practice and the wrap-up. Its questions are about children working alone,
 *           and they feed existing indicators (C2, D4) through rules.js; C3, C7, C8 come from Part 1.
 *
 * A form opened on the Flow published before this (form version 4) posts no `fv` on its parts and keeps
 * the old questions, checks and rules.
 *
 * Real: endpoints, store, rules. Mocked: the database (in memory), WhatsApp.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  displayTimeZone: () => 'Asia/Karachi',
  acknowledgeFormSubmitted: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/child-test/conversation/offer', () => ({ sendOffer: jest.fn(() => Promise.resolve(false)) }), { virtual: true });

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Form = require('../../bot/shared/routes/observe2-form-endpoint');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const { FORM_VERSION } = require('../../bot/shared/services/observe/observe2/field-form.flow');
const { addUp } = require('../../bot/shared/services/observe/observe2/rules');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');
const { PLAIN } = require('../../bot/shared/services/observe/observe2/fico17');

const formToken = (id) => `coach-1:observe2-form:${id}`;
const checkToken = (id) => `coach-1:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);

const PART_1 = {
  screen: 'PART_ONE', fv: FORM_VERSION, present: '30', p1_spoke: '6', p1_picked: 'often', p1_groups: 'combine', p1_listen: ['often'],
  p1_listen_other: '', p1_materials: 'children', p1_used: ['book'], p1_change: 'yes', p1_change_how: 'clear', p1_notes: '',
};
const PART_2 = {
  screen: 'PART_TWO', fv: FORM_VERSION, p2_spoke: '9', p2_new: '3', p2_task: 'all', p2_teacher: ['round', 'helped'], p2_stuck: 'unsure',
  p2_think: ['why'], p2_change: 'yes', p2_change_how: 'slow', p2_notes: '',
};
// Today's Flow (form version 4): the same questions in both parts, and no fv on the parts.
const OLD_PART_2 = {
  screen: 'PART_TWO', p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'],
  p2_listen_other: '', p2_materials: 'children', p2_change: 'no', p2_notes: '',
};

async function newForm(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), { period_minutes: 35 }, patch);
  return form.id;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en' },
    ],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
  });
});

describe('the parts follow the lesson\'s steps', () => {
  test('Part 1 is up to and including guided practice: "Part 1 done" when independent practice starts', async () => {
    const out = await Form.handleObserve2FormInit(formToken(await newForm()));
    expect(out.data.part_hint).toMatch(/up to and including guided practice/i);
    expect(out.data.part_hint).toMatch(/start independent practice, tap "Part 1 done"/i);
    expect(out.data.part_hint).not.toMatch(/minute \d+/);
  });

  test('Part 2 is independent practice and the wrap-up, to the end of the period', async () => {
    const id = await newForm();
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', PART_1);
    expect(out.screen).toBe('PART_TWO');
    expect(out.data.part_hint).toMatch(/independent practice and the wrap-up/i);
    expect(out.data.part_hint).toMatch(/minute 35/);
    expect(row(id).part1_done_at).toBeTruthy();
  });

  test('a form reopened after Part 1 says what Part 2 is', async () => {
    const out = await Form.handleObserve2FormInit(formToken(await newForm({ part1_done_at: '2026-10-15T05:20:00.000Z' })));
    expect(out.data.continue_line).toMatch(/independent practice and the wrap-up/i);
  });

  test('the chat steps say when to save Part 1', () => {
    const body = observe2Strings('en').form_body(25);
    expect(body).toMatch(/Part 1 is up to and including guided practice: save it when the children start independent practice/);
    expect(body).toMatch(/minute 25/);
    expect(observe2Strings('ur').form_body(25)).toMatch(/۲۵/);
  });
});

describe('Part 2 asks about the children working on their own', () => {
  test('saved with its own answers, then the lesson plan', async () => {
    const id = await newForm();
    await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', PART_1);
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_TWO', PART_2);
    expect(out.screen).toBe('LESSON_PLAN');
    expect(row(id).answers).toMatchObject({ p2_task: 'all', p2_teacher: ['round', 'helped'], p2_stuck: 'unsure', p2_change_how: 'slow' });
    expect(row(id).answers.p2_picked).toBeUndefined();
  });

  test('every child\'s task, what the teacher did and what children did when stuck are asked for', async () => {
    const id = await newForm();
    await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', PART_1);
    const noTask = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_TWO', { ...PART_2, p2_task: '' });
    expect(noTask.screen).toBe('PART_TWO');
    expect(noTask.data.error_messages.p2_task).toBeTruthy();
    const half = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_TWO', { ...PART_2, p2_teacher: [], p2_stuck: '' });
    expect(Object.keys(half.data.error_messages).sort()).toEqual(['p2_stuck', 'p2_teacher']);
    expect(row(id).part2_done_at).toBeUndefined();
  });

  test('with no work on their own, there is nothing to ask about it', async () => {
    const id = await newForm();
    await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', PART_1);
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_TWO', { ...PART_2, p2_task: 'none', p2_teacher: [], p2_stuck: '' });
    expect(out.screen).toBe('LESSON_PLAN');
  });

  test('a form on today\'s Flow keeps today\'s Part 2: its answers and its checks', async () => {
    const id = await newForm();
    await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', { ...PART_1, fv: undefined, p1_used: undefined });
    const refused = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_TWO', { ...OLD_PART_2, p2_picked: '' });
    expect(refused.data.error_messages.p2_picked).toBeTruthy();
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'PART_TWO', OLD_PART_2);
    expect(out.screen).toBe('LESSON_PLAN');
    expect(row(id).answers).toMatchObject({ p2_picked: 'often', p2_groups: 'combine', p2_materials: 'children' });
  });

  test('a form on today\'s Flow still gets the photo step after the plan', async () => {
    const id = await newForm({ part1_done_at: 'x', part2_done_at: 'x', answers: { present: '30' } });
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'LESSON_PLAN', { screen: 'LESSON_PLAN', fv: '4', lp: 'none' });
    expect(out.screen).toBe('PHOTOS');
  });
});

describe('what Part 2 adds up to', () => {
  const NEW = { ...PART_1, ...PART_2 };
  const lv = (answers, code, extra = {}) => addUp({ form: answers, ...extra })[code];

  test('C3, C7 and C8 come from Part 1 only', () => {
    expect(lv(NEW, 'C3').level).toBe(3);
    expect(lv(NEW, 'C7').level).toBe(3);
    expect(lv(NEW, 'C8').level).toBe(3);
  });

  test('D4: what the coach saw when the work got hard is the level, unless the recording heard more', () => {
    expect(lv(NEW, 'D4')).toMatchObject({ level: 3, source: 'seen' });
    expect(lv(NEW, 'D4').because).toContain(PLAIN.D4[2].toLowerCase());
    expect(lv({ ...NEW, p2_stuck: 'waited' }, 'D4').level).toBe(1);
    expect(lv({ ...NEW, p2_stuck: 'kept' }, 'D4').level).toBe(4);
    const heard = [{ type: 'hedged' }, { type: 'hedged' }, { type: 'unprompted' }];
    expect(lv({ ...NEW, p2_stuck: 'waited' }, 'D4', { confirmed: heard }).level).toBe(4);
    expect(lv({ ...NEW, p2_stuck: 'easy' }, 'D4').level).toBeNull();
    expect(lv({ ...NEW, p2_stuck: 'easy' }, 'D4').because).toMatch(/nobody got stuck/i);
  });

  test('D4 with no work on their own is left to the recording', () => {
    const r = lv({ ...NEW, p2_task: 'none', p2_teacher: [], p2_stuck: '' }, 'D4');
    expect(r.level).toBeNull();
    expect(r.because).toMatch(/no work on their own/i);
  });

  test('C2: helping children who were stuck rules out "ignored", and is named either way', () => {
    expect(lv(NEW, 'C2')).toMatchObject({ level: 2, source: 'seen' });
    expect(lv(NEW, 'C2').because).toMatch(/helped those who were stuck/);
    const ignored = [{ type: 'wrong_ignored' }];
    expect(lv(NEW, 'C2', { confirmed: ignored }).level).toBe(2);
    const reasons = [{ type: 'wrong_reason' }, { type: 'wrong_reason' }];
    const r = lv(NEW, 'C2', { confirmed: reasons });
    expect(r.level).toBe(3);
    expect(r.because).toMatch(/went round the room/);
    expect(lv({ ...NEW, p2_teacher: ['front'] }, 'C2').level).toBeNull();
  });

  test('a failed recording still counts what the coach saw', () => {
    const failed = { ...NEW, incident: 'tech' };
    expect(lv(failed, 'D4').level).toBe(3);
    expect(lv(failed, 'C2').level).toBe(2);
    expect(lv(failed, 'C1').level).toBe('IE');
  });

  test('a form on today\'s Flow adds up exactly as before', () => {
    const old = { ...PART_1, fv: undefined, p1_used: undefined, ...OLD_PART_2 };
    expect(lv(old, 'C3').level).toBe(3);
    expect(lv(old, 'C7').level).toBe(3);
    expect(lv(old, 'D4').level).toBeNull();
    expect(lv(old, 'C2').level).toBeNull();
  });

  test('the record carries what was seen at the desks beside the level, where the teacher\'s portal reads it', () => {
    const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
    const a = buildAnalysis({ id: 'f1', answers: NEW, rumi_moments: { moments: [] }, evidence_review: {}, final_levels: { C2: '2', D4: '3' } });
    const ind = (code) => Object.values(a.domains).flatMap((d) => d.indicators).find((i) => i.id === code);
    expect(ind('D4').evidence).toContain('Seen while they worked alone: 2+ tried while unsure');
    expect(ind('C2').evidence).toContain('Seen while they worked alone, the teacher went round the room; helped those who were stuck');
  });

  test('the check shows the coach what Part 2 added up to', async () => {
    const id = await newForm({
      answers: { ...NEW, screen: undefined, fv: undefined, incident: 'none', lp: 'none', priority: 'C2' },
      sealed_at: '2026-10-15T05:39:00.000Z', part1_done_at: 'x', part2_done_at: 'x', coaching_session_id: 'sess-1',
      rumi_moments: { moments: [], counts: {} }, moments_ready_at: 'x',
    });
    let out;
    for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK', 'HEARD_EXPLAIN']) {
      // eslint-disable-next-line no-await-in-loop
      out = await Check.handleObserve2CheckDataExchange(checkToken(id), s, { screen: s });
    }
    expect(out.screen).toBe('ADDED_ONE');
    expect(out.data).toMatchObject({ D4_level: '3', C2_level: '2' });
    expect(out.data.D4_because).toMatch(/worked alone/);
  });
});
