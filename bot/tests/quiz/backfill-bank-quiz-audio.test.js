'use strict';
/**
 * The one-off backfill that records the video-bank ("library") quizzes' clips before a child
 * opens them. The real script and the real publishQuizAudio run; only the boundaries are faked:
 * supabase (an in-memory client), R2, the voice gateway and the loggers.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })),
  uploadBuffer: jest.fn(async () => true),
  presignKey: jest.fn(async (k) => `r2:${k}`),
  getPresignedUrl: jest.fn(async (u) => u),
  buildR2PublicUrl: jest.fn((k) => `r2:${k}`),
}));
jest.mock('../../shared/services/tts', () => ({
  synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS-fake'), provider: 'soniox', durationSec: 2 })),
}));

const Backfill = require('../../scripts/quiz/backfill-bank-quiz-audio');
const Publish = require('../../shared/services/quiz/web-quiz-publish.service');
const Store = require('../../shared/services/quiz/web-quiz-audio-store');
const tts = require('../../shared/services/tts');
const r2 = require('../../shared/storage/r2');

const REF = 'sandboxrefabc';
const ENV = { SUPABASE_URL: `https://${REF}.supabase.co` };
const NOW = Date.parse('2026-10-06T18:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

/** A tiny in-memory PostgREST: select/eq/is/gte/order/range/maybeSingle/update and the count head query. */
function fakeDb(tables) {
  const writes = [];
  const val = (row, col) => {
    const m = /^(\w+)->(\w+)->>(\w+)$/.exec(col);
    if (m) { const v = (((row[m[1]] || {})[m[2]]) || {})[m[3]]; return v == null ? null : String(v); }
    return row[col];
  };
  const from = (table) => {
    const filters = [];
    let order = null; let range = null; let head = false; let cols = null;
    const rows = () => {
      let out = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
      if (order) out = out.slice().sort((a, b) => (String(a[order.col]).localeCompare(String(b[order.col]))) * (order.asc ? 1 : -1));
      if (range) out = out.slice(range[0], range[1] + 1);
      if (!cols) return out;
      return out.map((r) => Object.fromEntries(cols.map((c) => { const [a, p] = c.includes(':') ? c.split(':') : [c, c]; return [a, val(r, p)]; })));
    };
    const q = {
      select(c, opts) { head = !!(opts && opts.head); cols = c === '*' ? null : String(c).split(',').map((s) => s.trim()); return q; },
      eq(col, v) { filters.push((r) => val(r, col) === v); return q; },
      is(col, v) { filters.push((r) => (r[col] == null) === (v === null)); return q; },
      gte(col, v) { filters.push((r) => String(r[col]) >= v); return q; },
      order(col, o) { order = { col, asc: !o || o.ascending !== false }; return q; },
      range(a, b) { range = [a, b]; return q; },
      maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      update(v) { return { eq: (col, id) => { writes.push({ table, id, v }); const r = (tables[table] || []).find((x) => x[col] === id); if (r) Object.assign(r, v); return Promise.resolve({ error: null }); } }; },
      then(res, rej) { const d = rows(); return Promise.resolve(head ? { count: d.length, data: null, error: null } : { data: d, error: null }).then(res, rej); },
    };
    return q;
  };
  return { from, writes };
}

const question = (quizId, n, text) => ({
  id: `${quizId}-q${n}`, quiz_id: quizId, question_text: text, option_a: 'Yes', option_b: 'No', option_c: null, option_d: null,
  correct_option: 'A', option_feedback: {}, explanation: 'Because it is.', media: {}, sort_order: n,
});

function world() {
  const vids = [
    { id: 'v-g3sci-1', grade: '3', subject: 'Science', created_at: '2026-01-01', migration_status: 'done', superseded_by: null },
    { id: 'v-g3sci-2', grade: '3', subject: 'Science', created_at: '2026-01-02', migration_status: 'done', superseded_by: null },
    { id: 'v-g1eng-1', grade: '1', subject: 'English', created_at: '2026-01-05', migration_status: 'done', superseded_by: null },
    { id: 'v-g1eng-2', grade: '1', subject: 'English', created_at: '2026-01-06', migration_status: 'done', superseded_by: null },
    { id: 'v-g1eng-3', grade: '1', subject: 'English', created_at: '2026-01-08', migration_status: 'done', superseded_by: null },
    { id: 'v-g1mat-1', grade: '1', subject: 'Maths', created_at: '2026-01-07', migration_status: 'done', superseded_by: null },
    { id: 'v-old', grade: '1', subject: 'Maths', created_at: '2026-01-01', migration_status: 'done', superseded_by: 'v-g1mat-1' },
  ];
  const quiz = (id, video, meta = {}) => ({ id, video_id: video, quiz_source: 'video', status: 'ready', language: null, meta });
  const quizzes = [
    quiz('q-g3sci-1', 'v-g3sci-1'), quiz('q-g3sci-2', 'v-g3sci-2'), quiz('q-g1eng-1', 'v-g1eng-1'),
    quiz('q-g1eng-2', 'v-g1eng-2'), quiz('q-g1eng-3', 'v-g1eng-3'), quiz('q-g1mat-1', 'v-g1mat-1'), quiz('q-old', 'v-old'),
    { id: 'q-teacher', video_id: null, quiz_source: 'lesson_plan', status: 'ready', language: 'en', meta: {} },
  ];
  const sessions = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `s-a${i}`, quiz_id: 'q-g3sci-2', created_at: daysAgo(2) })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `s-b${i}`, quiz_id: 'q-g1eng-2', created_at: daysAgo(3) })),
    ...Array.from({ length: 9 }, (_, i) => ({ id: `s-c${i}`, quiz_id: 'q-g1mat-1', created_at: daysAgo(20) })), // outside 14 days
    ...Array.from({ length: 4 }, (_, i) => ({ id: `s-d${i}`, quiz_id: 'q-teacher', created_at: daysAgo(1) })),
  ];
  const qq = quizzes.flatMap((q) => [question(q.id, 1, 'What does a plant need?'), question(q.id, 2, 'Is the sun a star?')]);
  return { student_videos: vids, quizzes, quiz_sessions: sessions, quiz_questions: qq, app_settings: [] };
}

function run(argv, { db, env = ENV } = {}) {
  const lines = [];
  return Backfill.main(argv, { db, env, now: NOW, print: (l) => lines.push(l) }).then((r) => ({ r, lines }));
}
const ranked = (lines) => lines.filter((l) => /^\d+\t/.test(l)).map((l) => l.split('\t')[1]);

beforeEach(() => { jest.clearAllMocks(); Store.resetSettingsCache(); });

describe('ranking', () => {
  test('opens in the last 14 days first; ties: each grade x subject first lesson before any second, then grade, then subject', async () => {
    const { lines } = await run(['--expect-ref', REF, '--limit', '10'], { db: fakeDb(world()) });
    expect(ranked(lines)).toEqual([
      'q-g3sci-2', // 5 opens
      'q-g1eng-2', // 2 opens
      'q-g1eng-1', 'q-g1mat-1', 'q-g3sci-1', // 0 opens, first lessons: grade 1 (English, Maths) then grade 3
      'q-g1eng-3', // 0 opens, a third lesson: after every grade x subject's first
    ]);
    expect(lines.join('\n')).not.toMatch(/q-old|q-teacher/); // superseded video, teacher quiz: not the library
  });
  test('--limit cuts the ranking; the default limit is 0 (nothing)', async () => {
    expect(ranked((await run(['--expect-ref', REF, '--limit', '2'], { db: fakeDb(world()) })).lines)).toEqual(['q-g3sci-2', 'q-g1eng-2']);
    const none = await run(['--expect-ref', REF, '--apply'], { db: fakeDb(world()) });
    expect(ranked(none.lines)).toEqual([]);
    expect(tts.synthesize).not.toHaveBeenCalled();
  });
});

describe('dry run (the default) makes zero calls', () => {
  test('no voice, no R2, no database write — and it prints the plan with clips, chars and USD', async () => {
    const db = fakeDb(world());
    const { r, lines } = await run(['--expect-ref', REF, '--limit', '5'], { db });
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(r2.headObject).not.toHaveBeenCalled();
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    expect(r.planned).toBe(5);
    const first = lines.find((l) => l.startsWith('1\t')).split('\t');
    expect(first[2]).toBe('en'); // language from the questions' script (#1787), as publish chooses it
    expect(Number(first[6])).toBeGreaterThan(0); // clips
    expect(Number(first[7])).toBeGreaterThan(0); // chars
    expect(lines[lines.length - 1]).toMatch(/^SUMMARY mode=dry-run quizzes to_record=5 skipped=0 chars=\d+ est_usd=\d/);
  });
});

describe('--apply records through publishQuizAudio, idempotent on isCurrent', () => {
  test('a quiz already current in its quiz voice is skipped, counted and not re-billed; the rest are recorded', async () => {
    const w = world();
    w.quizzes.find((q) => q.id === 'q-g3sci-2').meta = { web: { audio_v: Publish.AUDIO_VERSION, audio_voice: 'sx-grace', audio: {} } };
    const db = fakeDb(w);
    const { r, lines } = await run(['--expect-ref', REF, '--limit', '2', '--apply'], { db });
    const quizIdsSpoken = new Set(r2.uploadBuffer.mock.calls.map((c) => c[1].split('/')[2]));
    expect(quizIdsSpoken).toEqual(new Set(['q-g1eng-2']));
    tts.synthesize.mock.calls.forEach((c) => expect(c[0]).toMatchObject({ provider: 'soniox', voice: 'Grace' }));
    expect(r).toMatchObject({ done: 1, skipped: 1, failed: 0 });
    // The last write: question 1's clips are written as soon as they exist, the stamp comes with the rest.
    const stamped = db.writes.filter((x) => x.id === 'q-g1eng-2').pop().v.meta.web;
    expect(Publish.isCurrent(stamped)).toBe(true);
    expect(lines[lines.length - 1]).toMatch(/^SUMMARY mode=apply quizzes done=1 skipped=1 failed=0 not_started=0 chars=\d+ usd=\d/);

    // Run again: everything in the top 2 is now current — nothing is synthesized.
    jest.clearAllMocks();
    const again = await run(['--expect-ref', REF, '--limit', '2', '--apply'], { db });
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(again.r).toMatchObject({ done: 0, skipped: 2, failed: 0 });
  });
  test('stops before the next quiz once the spend reaches --max-usd', async () => {
    const { r } = await run(['--expect-ref', REF, '--limit', '5', '--apply', '--concurrency', '1', '--max-usd', '0.000001'], { db: fakeDb(world()) });
    expect(r.done).toBe(1);
    expect(r.stopped).toBe('max_usd');
  });
});

describe('refuses a database it was not pointed at', () => {
  test.each([
    ['another project', { SUPABASE_URL: 'https://someotherref.supabase.co' }, ['--expect-ref', REF, '--apply', '--limit', '5']],
    ['no --expect-ref', ENV, ['--apply', '--limit', '5']],
    ['no SUPABASE_URL', {}, ['--expect-ref', REF, '--apply', '--limit', '5']],
  ])('%s: nothing read, nothing recorded, neither ref printed', async (_n, env, argv) => {
    const db = fakeDb(world());
    const spy = jest.spyOn(db, 'from');
    const { r, lines } = await run(argv, { db, env });
    expect(r.refused).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(lines.join('\n')).not.toMatch(new RegExp(`${REF}|someotherref`));
  });
});
