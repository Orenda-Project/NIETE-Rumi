/**
 * bd-qix9oh.6 — the FICO17 v6 replay (spec §10.3): which lessons it reads, the agreement maths, the targets, and
 * that the database it is handed can only read. The scoring itself runs the real fico17-v6 shadow and the real
 * /observe2 v3 moments + v6 rules; here only the database is faked (fake-supabase) and no model is called.
 */

const crypto = require('crypto');
const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

let mockFake = createFakeSupabase({});
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(() => Promise.resolve(true)) }));
// The model boundary of the DC call: analyzePedagogy is the one network call shadow.scoreV6 makes.
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ analyzePedagogy: jest.fn(() => Promise.reject(new Error('no model in tests'))) }));

const R = require('../../bot/scripts/fico17-v6-replay');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const LONG = 'x'.repeat(8000);

function lesson(id, over = {}) {
  return {
    session: { id, created_at: '2026-10-14T05:00:00Z', status: 'completed', observation_type: 'leader_observation', audio_duration_seconds: 1500, transcript_text: LONG, ...(over.session || {}) },
    form: { id: `f-${id}`, coaching_session_id: id, checked_at: '2026-10-14T06:00:00Z', period_minutes: 35, rubric_version: 'fico-ict-17-2026-09', observer_user_id: 'obs', teacher_user_id: 'tch', ...(over.form || {}) },
    observer: { id: 'obs', is_test_user: false, ...(over.observer || {}) },
    teacher: { id: 'tch', is_test_user: false, school_id: 's1', ...(over.teacher || {}) },
    school: { id: 's1', region: 'Sihala', is_probable_test: false, is_active: true, ...(over.school || {}) },
    finalLevels: over.finalLevels === undefined ? { C1: '2' } : over.finalLevels,
  };
}

describe('lesson selection (spec §10.3)', () => {
  test('a programme-school visit, checked, with a long transcript, is eligible', () => {
    expect(R.ineligibleBecause(lesson('a'))).toBeNull();
  });

  test.each([
    ['test observer', { observer: { is_test_user: true } }, 'test_account'],
    ['test teacher', { teacher: { is_test_user: true } }, 'test_account'],
    ['probable-test school', { school: { is_probable_test: true } }, 'not_programme_school'],
    ['school outside the ICT sectors', { school: { region: 'Gilgit-Baltistan' } }, 'not_programme_school'],
    ['no school', { teacher: { school_id: null }, school: null }, 'not_programme_school'],
    ['transcript under 8,000 characters', { session: { transcript_text: 'x'.repeat(7999) } }, 'short_transcript'],
    ['visit not checked', { form: { checked_at: null } }, 'not_completed'],
    ['session cancelled', { session: { status: 'cancelled' } }, 'not_completed'],
    ['no coach levels', { finalLevels: null }, 'not_completed'],
    ['a v6 visit', { form: { rubric_version: 'fico17_v6' } }, 'not_v5'],
  ])('%s is left out', (_name, over, why) => {
    const l = lesson('a', over);
    if (over.school === null) l.school = null;
    expect(R.ineligibleBecause(l)).toBe(why);
  });

  test('the fixed ten come first, then the next 20 eligible by md5(id), never a fixed one twice', () => {
    const fixed = ['f1', 'f2'];
    const pool = [...fixed, ...Array.from({ length: 30 }, (_, i) => `p${i}`), 'bad'].map((id) => lesson(id, id === 'bad' ? { observer: { is_test_user: true } } : {}));
    const picked = R.pickLessons(pool, { fixed, extra: 20 });
    expect(picked.slice(0, 2).map((l) => l.session.id)).toEqual(fixed);
    const rest = picked.slice(2).map((l) => l.session.id);
    const expected = Array.from({ length: 30 }, (_, i) => `p${i}`).sort((a, b) => md5(a).localeCompare(md5(b))).slice(0, 20);
    expect(rest).toEqual(expected);
    expect(picked).toHaveLength(22);
  });

  test('a fixed id missing from the database is reported, not silently replaced', () => {
    const picked = R.pickLessons([lesson('p1')], { fixed: ['gone'], extra: 1 });
    expect(picked.missingFixed).toEqual(['gone']);
    expect(picked.map((l) => l.session.id)).toEqual(['p1']);
  });

  test('fetchLessons reads only through select and joins form, users and school', async () => {
    const db = createFakeSupabase({
      observation_field_forms: [{ id: 'f1', coaching_session_id: 's1', checked_at: '2026-10-14', period_minutes: 30, rubric_version: 'fico-ict-17-2026-09', observer_user_id: 'o', teacher_user_id: 't' },
        { id: 'f2', coaching_session_id: null, checked_at: null }],
      coaching_sessions: [{ id: 's1', created_at: '2026-10-14T05:00:00Z', status: 'completed', observation_type: 'leader_observation', audio_duration_seconds: 900, transcript_text: LONG, final_levels: { C1: '3' } }],
      users: [{ id: 'o', is_test_user: false, school_id: null }, { id: 't', is_test_user: false, school_id: 'sc' }],
      schools: [{ id: 'sc', region: 'Tarnol', is_probable_test: false, is_active: true }],
    });
    const pool = await R.fetchLessons(R.readOnly(db));
    expect(pool).toHaveLength(1);
    expect(pool[0].finalLevels).toEqual({ C1: '3' });
    expect(pool[0].school.region).toBe('Tarnol');
    expect(R.ineligibleBecause(pool[0])).toBeNull();
    expect(db.__calls.every((c) => c.action === 'select')).toBe(true);
  });
});

describe('the database is read-only', () => {
  test('readOnly exposes no write method, and assertReadOnly proves it', () => {
    const db = R.readOnly(createFakeSupabase({}));
    const q = db.from('coaching_sessions');
    for (const m of ['insert', 'update', 'upsert', 'delete']) expect(q[m]).toBeUndefined();
    expect(db.rpc).toBeUndefined();
    expect(() => R.assertReadOnly(db)).not.toThrow();
  });

  test('assertReadOnly throws on a client that can write', () => {
    expect(() => R.assertReadOnly(createFakeSupabase({}))).toThrow(/write method reachable: insert/);
  });

  test('a query after select still cannot reach a write', () => {
    const q = R.readOnly(createFakeSupabase({})).from('users').select('id').eq('id', 'x');
    expect(q.update).toBeUndefined();
    expect(q.delete).toBeUndefined();
  });

  test('restGet builds a PostgREST GET and never another verb', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: true, json: async () => [{ id: 'a' }] }; };
    const db = R.restGet({ url: 'https://db.example', key: 'k', fetchImpl });
    const { data } = await db.from('coaching_sessions').select('id,status').in('id', ['a', 'b']).eq('status', 'completed');
    expect(data).toEqual([{ id: 'a' }]);
    expect(seen[0].init.method).toBe('GET');
    expect(seen[0].url).toBe('https://db.example/rest/v1/coaching_sessions?select=id%2Cstatus&id=in.(a%2Cb)&status=eq.completed');
    expect(() => R.assertReadOnly(db)).not.toThrow();
  });
});

describe('agreement maths', () => {
  const row = (id, coach, model, status = 'ok') => ({ id, status, coach, model });

  test('exact, within 1, above and below; NA and IE never enter agreement', () => {
    const rows = [
      row('a', { C1: '2', C2: '3' }, { C1: 2, C2: 4 }),
      row('b', { C1: '3', C2: 'NA' }, { C1: 1, C2: 3 }),
      row('c', { C1: '2', C2: '2' }, { C1: 'IE', C2: 'NA' }),
    ];
    const t = R.agreement(rows, ['C1', 'C2']);
    expect(t.byCode.C1).toMatchObject({ n: 2, exact: 1, within1: 1, above: 0, below: 1 });
    expect(t.byCode.C2).toMatchObject({ n: 1, exact: 0, within1: 1, above: 1, below: 0 });
    expect(t.pooled).toMatchObject({ n: 3, exact: 1, within1: 2, above: 1, below: 1 });
    expect(t.ie).toMatchObject({ all: 1, onOk: 1, resultsOnOk: 6 });
  });

  test('levels stored as strings or numbers read the same; anything else is not a level', () => {
    expect(R.level('3')).toBe(3);
    expect(R.level(4)).toBe(4);
    for (const v of ['NA', 'IE', '', null, undefined, '5', 0, '2.5']) expect(R.level(v)).toBeNull();
  });

  test('pct rounds to one decimal and is null on n = 0', () => {
    expect(R.pct(1, 3)).toBe(33.3);
    expect(R.pct(0, 0)).toBeNull();
  });

  test('level-2 share counts lessons with a numeric result only', () => {
    const rows = [row('a', {}, { C1: 2 }), row('b', {}, { C1: 3 }), row('c', {}, { C1: 'IE' })];
    expect(R.levelShare(rows, 'C1', 2)).toEqual({ k: 1, n: 2 });
  });
});

describe('targets (spec §10.3, RULINGS Q3)', () => {
  const base = (over = {}) => ({
    pooled: { n: 100, exact: 52, within1: 86 },
    aboveFixed: { C1: { k: 3, n: 10 }, D1: { k: 2, n: 10 } },
    share2: { C1: { k: 5, n: 10 }, C6: { k: 5, n: 10 } },
    problems: { flagged: 4, expected: 4 },
    ie: { onOk: 2, resultsOnOk: 100 },
    ...over,
  });

  test('every target met passes every row', () => {
    expect(R.targets(base()).every((t) => t.pass)).toBe(true);
  });

  test('each row fails on its own edge', () => {
    const fails = (over) => R.targets(base(over)).filter((t) => !t.pass).map((t) => t.key);
    expect(fails({ pooled: { n: 100, exact: 50, within1: 86 } })).toEqual(['exact']);
    expect(fails({ pooled: { n: 100, exact: 52, within1: 84 } })).toEqual(['within1']);
    expect(fails({ aboveFixed: { C1: { k: 4, n: 10 }, D1: { k: 2, n: 10 } } })).toEqual(['above_C1']);
    expect(fails({ share2: { C1: { k: 6, n: 10 }, C6: { k: 5, n: 10 } } })).toEqual(['share2_C1']);
    expect(fails({ problems: { flagged: 3, expected: 4 } })).toEqual(['problems']);
    expect(fails({ ie: { onOk: 5, resultsOnOk: 100 } })).toEqual(['ie_ok']);
  });
});

describe('what leaves the script', () => {
  test('an output row carries id, date, levels and status only: no transcript, no quote, no name', () => {
    const out = R.publicRow({
      id: 's1', date: '2026-10-14', status: 'partial', coach: { C1: '2' }, dc: { C1: 3 }, rules: { C1: 2 },
      transcript: 'secret words', quotes: ['x'], teacherName: 'X', issues: [{ type: 'short', from: '24:00' }],
    });
    expect(Object.keys(out).sort()).toEqual(['coach', 'date', 'dc', 'id', 'issues', 'rules', 'status']);
    expect(JSON.stringify(out)).not.toMatch(/secret|teacherName/);
  });
});

describe('scoreLesson: the real gate, DC shadow, v3 moments and v6 rules; only the models are faked', () => {
  const GPT = require('../../bot/shared/services/gpt5-mini.service');
  const deps = (completeJson) => ({
    gate: require('../../bot/shared/services/observe/transcript-quality'),
    shadow: require('../../bot/shared/services/coaching/frameworks/fico17-v6/shadow'),
    moments: require('../../bot/shared/services/observe/observe2/moments'),
    rules: require('../../bot/shared/services/observe/observe2/rules'),
    quotes: require('../../bot/shared/services/observe/observe2/quote-check'),
    labels: require('../../bot/shared/services/observe/observe2/label-check'),
    reply: require('../../bot/shared/services/observe/observe2/llm-reply'),
    completeJson,
  });
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const OK_T = Array.from({ length: 16 }, (_, i) => `[${mmss(i * 150)}] ${i % 2 ? 'Student' : 'Teacher'} (EN): line number ${i} about plants and water.`)
    .concat(['[39:00] Teacher (EN): Open your book to page 12 and find the picture of the plant.']).join('\n\n');
  const BROKEN_T = ['[00:30] Teacher (UR): آج ہم پودوں کے بارے میں پڑھیں گے۔',
    ...Array.from({ length: 76 }, (_, i) => `[${mmss(120 + i * 30)}] Student (UR): ٹھیک ٹھیک ٹھیک`)].join('\n\n');
  const l = (t) => ({ ...lesson('s1', { session: { transcript_text: t } }), finalLevels: { C1: '2', C8: '3', F1: 'NA' }, form: { ...lesson('s1').form, period_minutes: 40, answers: {} } });

  test('a broken transcript: no model call at all, every DC result IE, moment rows IE', async () => {
    const completeJson = jest.fn();
    GPT.analyzePedagogy.mockClear();
    const out = await R.scoreLesson(l(BROKEN_T), deps(completeJson));
    expect(out.status).toBe('broken');
    expect(completeJson).not.toHaveBeenCalled();
    expect(GPT.analyzePedagogy).not.toHaveBeenCalled();
    expect(out.dc_status).toBe('broken');
    expect(new Set(Object.values(out.dc))).toEqual(new Set(['IE']));
    expect(out.rules.C1).toBe('IE');
    expect(out.coach).toMatchObject({ C1: '2', C8: '3', F1: 'NA', C2: '' });
  });

  test('an ok transcript: the DC failure is recorded, every found moment counts in the v6 rules', async () => {
    const completeJson = jest.fn()
      .mockResolvedValueOnce({ result: { moments: [{ moment: 'explain', type: 'resource_used', minute: '39:00', quote: 'Open your book to page 12 and find the picture of the plant.', why: 'used' }], counts: { closed_q: 0, praise_generic: 0 }, room: [] }, usage: {}, finishReason: 'stop' })
      .mockRejectedValue(new Error('label check unavailable'));
    const out = await R.scoreLesson(l(OK_T), deps(completeJson));
    expect(out.status).toBe('ok');
    expect(out.dc_status).toBe('failed');
    expect(out.dc).toEqual({});
    expect(out.rules_status).toBe('ok');
    expect(out.moments).toEqual({ returned: 1, known: 1, quoted: 1, labelled: 1, kept: 1 });
    expect(out.rules.C8).toBe(3);
    expect(completeJson.mock.calls[0][0]).toMatch(/TRANSCRIPT:/);
    expect(completeJson.mock.calls[0][1]).toMatchObject({ job: 'observe2.moments' });
  });
});
