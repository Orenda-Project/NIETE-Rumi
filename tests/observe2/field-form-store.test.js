/**
 * /observe2 — the store for observation_field_forms. What it must guarantee, whoever calls it:
 * parts save only while unsealed; the seal happens once; a recording links once; the check is
 * submitted once; a database error is reported, never mistaken for "no row".
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const { logToFile } = require('../../bot/shared/utils/logger');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');

beforeEach(() => { mockFake = createFakeSupabase(); jest.clearAllMocks(); });

const newForm = async () => (await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 't-1', visitContext: { teacher_ext_id: 'x1' } })).form;

describe('creating and reading', () => {
  test('a new form carries the coach, the teacher, the ids and the rubric version', async () => {
    const f = await newForm();
    expect(f).toMatchObject({ observer_user_id: 'coach-1', teacher_user_id: 't-1', visit_context: { teacher_ext_id: 'x1' }, rubric_version: Store.RUBRIC_VERSION });
    expect((await Store.getForm(f.id)).form.id).toBe(f.id);
  });
  test('a database error is reported and logged at error, not read as "no row"', async () => {
    mockFake.__failNext({ message: 'column "x" does not exist' });
    const r = await Store.getForm('nope');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not exist/);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/getForm failed/), expect.any(Object), 'error');
  });
});

describe('saving parts', () => {
  test('Part 1 keeps only its own fields, stamps the halfway mark once', async () => {
    const f = await newForm();
    const r = await Store.savePart(f, 'p1', { present: '32', p1_spoke: '5', p1_listen: ['once'], p2_spoke: '9', stray: 'x', p1_notes: '' });
    expect(r.ok).toBe(true);
    expect(r.form.answers).toEqual({ present: '32', p1_spoke: '5', p1_listen: ['once'] });
    const first = r.form.part1_done_at;
    expect(first).toBeTruthy();
    const again = await Store.savePart(r.form, 'p1', { present: '31' });
    expect(again.form.part1_done_at).toBe(first);
    expect(again.form.answers.present).toBe('31');
  });
  test('every part write is guarded by sealed_at IS NULL', async () => {
    const f = await newForm();
    await Store.savePart(f, 'p2', { p2_spoke: '7' });
    const upd = mockFake.__calls.find((c) => c.action === 'update');
    expect(upd.filters).toContainEqual(['is', 'sealed_at', null]);
  });
  test('a sealed form refuses a part', async () => {
    const f = await newForm();
    const s = await Store.seal(f, { incident: 'none', lp: 'used', priority: 'C8' });
    const r = await Store.savePart(s.form, 'p1', { present: '30' });
    expect(r).toEqual({ ok: false, sealed: true });
  });
});

describe('the seal', () => {
  test('stamps sealed_at once and merges the last screen', async () => {
    const f = await newForm();
    const withP1 = (await Store.savePart(f, 'p1', { present: '32', p1_spoke: '5' })).form;
    const s = await Store.seal(withP1, { incident: 'none', priority: 'C8', seal_ok: 'true' });
    expect(s.ok).toBe(true);
    expect(s.form.sealed_at).toBeTruthy();
    expect(s.form.answers).toEqual({ present: '32', p1_spoke: '5', incident: 'none', priority: 'C8' });
  });
  test('a second "Seal and send" finds it sealed and changes nothing', async () => {
    const f = await newForm();
    const first = await Store.seal(f, { incident: 'none', lp: 'used', priority: 'C8' });
    const second = await Store.seal(f, { incident: 'error', detail: 'x', lp: 'used', priority: 'F1' });
    expect(second.ok).toBe(false);
    expect(second.alreadySealed).toBe(true);
    expect(second.form.sealed_at).toBe(first.form.sealed_at);
    expect(second.form.answers.priority).toBe('C8');
  });
});

describe('linking the recording', () => {
  test('finds the coach\'s newest unlinked form in the window, and links it once', async () => {
    const old = await newForm();
    mockFake.__tables.observation_field_forms[0].created_at = '2000-01-01T00:00:00.000Z';
    const f = await newForm();
    const found = await Store.findOpenFormForCapture('coach-1');
    expect(found.form.id).toBe(f.id);
    expect((await Store.linkSession(f.id, 'sess-1')).ok).toBe(true);
    expect((await Store.linkSession(f.id, 'sess-2')).ok).toBe(false);
    expect((await Store.findBySession('sess-1')).form.id).toBe(f.id);
    expect((await Store.findOpenFormForCapture('coach-1')).form).toBeNull();
    expect(old.id).not.toBe(f.id);
  });
  test('another coach\'s form is never found', async () => {
    await newForm();
    expect((await Store.findOpenFormForCapture('coach-2')).form).toBeNull();
  });
});

describe('the check', () => {
  test('screens add to the review; the submission happens once', async () => {
    const f = await newForm();
    const a = await Store.saveReview(f, { heard_ask_1: 'yes' });
    const b = await Store.saveReview(a.form, { heard_wrong_1: 'no' });
    expect(b.form.evidence_review).toEqual({ heard_ask_1: 'yes', heard_wrong_1: 'no' });
    const done = await Store.markChecked(b.form, { C1: '3' }, { why: 'x' });
    expect(done.ok).toBe(true);
    expect(done.form.final_levels).toEqual({ C1: '3' });
    expect((await Store.markChecked(b.form, { C1: '2' })).alreadyChecked).toBe(true);
  });
});

describe('the period', () => {
  test('only 20-90 minutes, and only before the seal', async () => {
    const f = await newForm();
    expect((await Store.setPeriod(f.id, 40)).ok).toBe(true);
    expect((await Store.setPeriod(f.id, 5)).ok).toBe(false);
  });
});
