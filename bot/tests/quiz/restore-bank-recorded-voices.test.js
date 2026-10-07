'use strict';
/**
 * The one-off that gives the library questions back their recorded option voices. The real script
 * runs against an in-memory Supabase stand-in (the only boundary faked).
 */
jest.mock('../../shared/config/supabase', () => ({}));
const Restore = require('../../scripts/quiz/restore-bank-recorded-voices');

const REF = 'sandboxrefabc';
const ENV = { SUPABASE_URL: `https://${REF}.supabase.co` };
const clip = (n) => `https://clips.example/${n}.ogg`;

function fakeDb(questions, quizzes) {
  const writes = [];
  const from = (table) => {
    const q = { filters: [] };
    const api = {
      select() { return api; },
      in(col, vals) { q.filters.push((r) => vals.includes(r[col])); return api; },
      eq(col, v) { q.filters.push((r) => r[col] === v); return api; },
      maybeSingle() { return Promise.resolve({ data: (table === 'quizzes' ? quizzes : questions).find((r) => q.filters.every((f) => f(r))) || null, error: null }); },
      then(res) { return res({ data: (table === 'quizzes' ? quizzes : questions).filter((r) => q.filters.every((f) => f(r))), error: null }); },
      update(v) {
        return { eq(col, id) { writes.push({ table, id, v }); const r = (table === 'quizzes' ? quizzes : questions).find((x) => x[col] === id); Object.assign(r, v); return Promise.resolve({ error: null }); } };
      },
    };
    return api;
  };
  return { from, writes };
}

const q1 = () => ({ id: 'q1', quiz_id: 'z1', option_a: 'February', option_b: 'May', option_c: null, option_d: null,
  media: { question_audio: [clip('q1')], explanation_audio: clip('why1') } });
const ENTRY = { id: 'q1', options: { a: 'February', b: 'May' }, option_audio: [{ index: 1, url: clip('may') }, { index: 0, url: clip('feb') }] };
const run = (argv, db, map) => Restore.main(argv, { env: ENV, db, map, print: () => {} });

test('dry run by default: plans the write, writes nothing', async () => {
  const db = fakeDb([q1()], []);
  const out = await run(['--expect-ref', REF], db, [ENTRY]);
  expect(out.written).toBe(1);
  expect(db.writes).toEqual([]);
});

test('--apply writes option_audio by stored slot and leaves the rest of media alone; a second run is "same"', async () => {
  const db = fakeDb([q1()], []);
  await run(['--expect-ref', REF, '--apply'], db, [ENTRY]);
  expect(db.writes).toHaveLength(1);
  expect(db.writes[0].v.media).toEqual({ question_audio: [clip('q1')], explanation_audio: clip('why1'),
    option_audio: [{ index: 0, url: clip('feb') }, { index: 1, url: clip('may') }] });
  const again = await run(['--expect-ref', REF, '--apply'], db, [ENTRY]);
  expect(again.same).toBe(1);
  expect(db.writes).toHaveLength(1);
});

test('a row whose option words changed since the clips were checked is not touched', async () => {
  const row = { ...q1(), option_b: 'April' };
  const db = fakeDb([row], []);
  const out = await run(['--expect-ref', REF, '--apply'], db, [ENTRY]);
  expect(out.changed).toBe(1);
  expect(db.writes).toEqual([]);
});

test('a rejected question clip is moved aside (kept), and a recorded quiz with no generated question clip is recorded again', async () => {
  const db = fakeDb([q1()], [{ id: 'z1', meta: { other: 1, web: { audio_v: 4, audio_voice: 'sx-grace', audio: { q1: { q: null, opts: [] } } } } }]);
  const out = await run(['--expect-ref', REF, '--apply'], db, [{ id: 'q1', options: { a: 'February', b: 'May' }, reject_question_audio: true }]);
  const media = db.writes.find((w) => w.table === 'quiz_questions').v.media;
  expect(media.question_audio).toEqual([]);
  expect(media.question_audio_rejected).toEqual([clip('q1')]);
  expect(out.requeued).toBe(1);
  const meta = db.writes.find((w) => w.table === 'quizzes').v.meta;
  expect(meta.web.audio_v).toBeUndefined();
  expect(meta.other).toBe(1);
  expect(meta.web.audio_voice).toBe('sx-grace');
});

test('refuses another project (nothing read or written)', async () => {
  const db = fakeDb([q1()], []);
  const out = await run(['--expect-ref', 'someotherref', '--apply'], db, [ENTRY]);
  expect(out.refused).toBe(true);
  expect(db.writes).toEqual([]);
});

test('an entry naming an option the row does not show is refused', () => {
  expect(Restore.nextMedia(q1(), { ...ENTRY, option_audio: [{ index: 2, url: clip('x') }] })).toEqual({ skip: 'bad_entry' });
});

test('a row the database hands back with its keys reordered (jsonb) is still "same"', async () => {
  // Postgres jsonb does not keep key order: {url, index} comes back for {index, url}, and option_audio may sit first.
  const stored = { option_audio: [{ url: clip('feb'), index: 0 }, { url: clip('may'), index: 1 }], explanation_audio: clip('why1'), question_audio: [clip('q1')] };
  const db = fakeDb([{ ...q1(), media: stored }], []);
  const out = await run(['--expect-ref', REF, '--apply'], db, [ENTRY]);
  expect(out.same).toBe(1);
  expect(db.writes).toEqual([]);
});
