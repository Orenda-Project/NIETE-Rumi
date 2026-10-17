'use strict';
/**
 * scripts/web-quiz/load-stories.js as a command: a dry run over a manifest prints one counts line per book and a
 * total, writes loaded.csv merged by source id, and never needs the environment; a real run refuses without the
 * expected database. The watermark-cleaning step's clean manifest + verdicts decide the page's watermark gate.
 * Fixtures are an invented one-page "Testwala" book in a temp folder.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('../../../../scripts/web-quiz/load-stories');

const SRC = 'src-sara-testwala';
const webp = (tag) => { const b = Buffer.alloc(40 + tag.length); b.write('RIFF', 0); b.write('WEBP', 8); b.write('VP8 ', 12); b.writeUInt16LE(240, 26); b.writeUInt16LE(357, 28); b.write(tag, 40); return b; };
let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqls-'));
  const serve = path.join(dir, 'serve', SRC); fs.mkdirSync(serve, { recursive: true });
  ['thumb.webp', 'p01.webp', 'p01-band.webp'].forEach((f) => fs.writeFileSync(path.join(serve, f), webp(f)));
  const v = path.join(dir, 'voices', SRC); fs.mkdirSync(v, { recursive: true });
  fs.writeFileSync(path.join(v, 'p01.json'), JSON.stringify({ audio: { ms: 1500 }, words: [{ i: 0, t: 'Sara', s_ms: 400, e_ms: 900 }, { i: 1, t: 'reads.', s_ms: 950, e_ms: 1400 }], wpm: 80, pace_wpm: 90, voice: { provider: 'soniox', voice: 'Grace' } }));
  fs.writeFileSync(path.join(v, 'p01.qa.json'), JSON.stringify({ wer: 0 }));
  fs.writeFileSync(path.join(v, 'p01.ogg'), Buffer.from('OggS'));
  const q = path.join(dir, 'questions'); fs.mkdirSync(q);
  fs.writeFileSync(path.join(q, `${SRC}.json`), JSON.stringify({ questions: [1, 2, 3].map((n) => ({ n, kind: 'literal', q: `Q${n}?`, options: [{ t: 'a' }, { t: 'b' }, { t: 'c' }], answer_i: 1, page_ref: 1, review_status: 'reviewed' })) }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ local_serve_root: path.join(dir, 'serve'), books: [{ source_id: SRC, slug: 'sara-testwala', title: 'Sara Testwala', grade: 2, lang: 'en', text_ready: true, unsettled_pages: [], cover: { thumb: 'thumb.webp' },
    pages: [{ n: 1, image: { file: 'p01.webp', w: 720, h: 1083 }, text: 'Sara reads.', words: [{ i: 0, t: 'Sara', box: [1, 2, 3, 4] }, { i: 1, t: 'reads.', box: [5, 2, 3, 4] }], text_band: { file: 'p01-band.webp', w: 1440, h: 260, box: [0, 0, 720, 130] }, boxes_ok: true, is_picture: false }] }] }));
  fs.writeFileSync(path.join(dir, 'cleared.csv'), `source_id,method\n${SRC},none\n`);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const io = () => { const o = { out: '', err: '' }; return { o, stdout: { write: (s) => { o.out += s; } }, stderr: { write: (s) => { o.err += s; } } }; };
const base = () => ['--manifest', path.join(dir, 'manifest.json'), '--env', 'sandbox', '--voices', path.join(dir, 'voices'), '--questions', path.join(dir, 'questions'), '--out', path.join(dir, 'loaded.csv')];

test('dry run: counts per book and a total, loaded.csv written, no env needed', async () => {
  const out = io();
  expect(await main({ argv: [...base(), '--cleared', path.join(dir, 'cleared.csv'), '--dry-run'], env: {}, io: out })).toBe(0);
  const lines = out.o.out.trim().split('\n').map((l) => JSON.parse(l));
  expect(lines[0]).toMatchObject({ source_id: SRC, pages: 1, voiced: '1/1', questions: 3, status: 'ready', why: [] });
  expect(lines[1]).toEqual({ books: 1, ready: 1, draft: 0, failed: 0, dry_run: true });
  const csv = fs.readFileSync(path.join(dir, 'loaded.csv'), 'utf8');
  expect(csv.split('\n')[0]).toBe('source_id,book_id,grade,lang,pages,voiced,questions,status,why,at');
  expect(csv).toContain(`${SRC},`);
  expect(csv).toContain('dry:ready');
});

test('without the sweep the book is a draft; a cleaned page needs its verdict', async () => {
  const o1 = io();
  await main({ argv: [...base(), '--dry-run'], env: {}, io: o1 });
  expect(JSON.parse(o1.o.out.split('\n')[0]).why).toEqual(['watermark: not cleared']);
  const cdir = path.join(dir, 'clean'); fs.mkdirSync(path.join(cdir, 'serve', SRC), { recursive: true });
  fs.writeFileSync(path.join(cdir, 'serve', SRC, 'p01.webp'), webp('cleaned'));
  fs.writeFileSync(path.join(cdir, 'clean_manifest.json'), JSON.stringify({ books: [{ source_id: SRC, pages: [{ n: 1, image: { file: 'p01.webp', w: 720, h: 1083 }, cleaned: true, method: 'a', looked: true }] }] }));
  fs.writeFileSync(path.join(cdir, 'verdicts.json'), JSON.stringify({ [`${SRC}/1`]: { clean_ok: false, text_ok: true } }));
  const args = [...base(), '--cleared', path.join(dir, 'cleared.csv'), '--clean', path.join(cdir, 'clean_manifest.json'), '--dry-run'];
  const o2 = io();
  await main({ argv: [...args, '--verdicts', path.join(cdir, 'verdicts.json')], env: {}, io: o2 });
  expect(JSON.parse(o2.o.out.split('\n')[0]).why).toEqual(['p01: cleaned page not passed by a looker']);
  const o3 = io();
  await main({ argv: args, env: {}, io: o3 });
  expect(JSON.parse(o3.o.out.split('\n')[0]).status).toBe('ready');
});

test('a real run refuses without the expected database', async () => {
  const o = io();
  expect(await main({ argv: [...base(), '--expect-ref', 'sandboxref'], env: { SUPABASE_URL: 'https://prodref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }, io: o })).toBe(2);
  expect(o.o.err).toMatch(/not the expected database/);
  const o2 = io();
  expect(await main({ argv: base(), env: {}, io: o2 })).toBe(2);
});

test('--misses: the pages opened without a voice since the last run, distinct, with their source ids; reads only', async () => {
  const calls = [];
  const rows = {
    story_events: [{ book_id: 'b1', page_n: 2, at: '2026-10-16T18:00:00Z' }, { book_id: 'b1', page_n: 2, at: '2026-10-16T18:01:00Z' }, { book_id: 'b2', page_n: 1, at: '2026-10-16T18:02:00Z' }],
    story_books: [{ id: 'b1', source_id: 'src-1' }, { id: 'b2', source_id: 'src-2' }],
  };
  const db = { from: (t) => { const b = { _t: t }; ['select', 'eq', 'lte', 'gt', 'in', 'order', 'limit'].forEach((m) => { b[m] = (...a) => { calls.push([t, m, ...a]); return b; }; }); b.then = (res) => res({ data: rows[t], error: null }); return b; } };
  const file = path.join(dir, 'misses.json');
  fs.writeFileSync(file, JSON.stringify({ until: '2026-10-16T17:59:00Z' }));
  const o = io();
  expect(await main({ argv: ['--misses', file], db, io: o, now: () => new Date('2026-10-16T18:05:00Z') })).toBe(0);
  expect(JSON.parse(o.o.out)).toEqual({ misses: 2, books: 2, since: '2026-10-16T17:59:00Z', until: '2026-10-16T18:05:00.000Z' });
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).pages).toEqual([{ book_id: 'b1', n: 2, source_id: 'src-1' }, { book_id: 'b2', n: 1, source_id: 'src-2' }]);
  expect(calls).toContainEqual(['story_events', 'eq', 'data->>miss', 'true']);
  expect(calls).toContainEqual(['story_events', 'gt', 'at', '2026-10-16T17:59:00Z']);
  expect(calls.some((c) => ['upsert', 'update', 'delete', 'insert'].includes(c[1]))).toBe(false);
});

test('the voice method gate is read once from app_settings web_quiz_story_voice_gate; absent = today\'s pace gates', async () => {
  const vj = path.join(dir, 'voices', SRC, 'p01.json');
  fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), wpm: 150, pace_wpm: 160, timing_src: 'forced_align' }));
  fs.writeFileSync(path.join(dir, 'voices', SRC, 'p01.qa.json'), JSON.stringify({ wer: 0, splices: 0, atempo: 1, inserted_silence_ms: 0, speed: 1, kbps: 64, midword_hits: 0 }));
  const reads = [];
  const db = (value) => ({ from: (t) => { reads.push(t); const b = {}; ['select', 'eq', 'maybeSingle'].forEach((m) => { b[m] = () => b; }); b.then = (res) => res({ data: t === 'app_settings' && value !== undefined ? { key: 'web_quiz_story_voice_gate', value } : null, error: null }); return b; } });
  const run = async (d) => { const o = io(); await main({ argv: [...base(), '--cleared', path.join(dir, 'cleared.csv'), '--dry-run'], env: {}, io: o, db: d }); return o.o.out.trim().split('\n').map((l) => JSON.parse(l)); };
  const today = await run(undefined);
  expect(today[0]).toMatchObject({ status: 'draft', why: ['p01: voice pace 150 wpm', 'p01: voice span pace 160 wpm'] });
  expect(today[1]).toEqual({ books: 1, ready: 0, draft: 1, failed: 0, dry_run: true });
  expect(await run(db(undefined))).toEqual(today);
  expect(await run(db(false))).toEqual(today);
  reads.length = 0;
  const on = await run(db(true));
  expect(on[0]).toMatchObject({ status: 'ready', why: [], voiced: '1/1', kept_voice: [], misses: [], question_kept: [] });
  expect(on[1]).toEqual({ books: 1, ready: 1, draft: 0, failed: 0, dry_run: true, voice_gate: true });
  expect(reads).toEqual(['app_settings']);
});

test('gate on, dry run with a database: the current voices are read (read only), so a kept page reads as the write would', async () => {
  const vj = path.join(dir, 'voices', SRC, 'p01.json');
  fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), timing_src: 'forced_align' }));
  fs.writeFileSync(path.join(dir, 'voices', SRC, 'p01.qa.json'), JSON.stringify({ wer: 0, splices: 0, atempo: 0.85, inserted_silence_ms: 0, speed: 1, kbps: 64, midword_hits: 0 }));
  const calls = [];
  const db = (voices) => ({ from: (t) => { const b = {}; ['select', 'eq', 'in', 'maybeSingle', 'upsert', 'update', 'delete', 'insert'].forEach((m) => { b[m] = (...a) => { calls.push([t, m, ...a]); return b; }; });
    b.then = (res) => res({ data: t === 'app_settings' ? { key: 'web_quiz_story_voice_gate', value: true } : voices, error: null }); return b; } });
  const run = async (d) => { const o = io(); await main({ argv: [...base(), '--cleared', path.join(dir, 'cleared.csv'), '--dry-run'], env: {}, io: o, db: d }); return o.o.out.trim().split('\n').map((l) => JSON.parse(l)); };
  const none = await run(db([]));
  expect(none[0]).toMatchObject({ status: 'draft', kept_voice: [], misses: ['p01: voice method: atempo 0.85'], why: ['p01: voice method: atempo 0.85'] });
  const pid = none[0].book_id && require('../../../shared/services/quiz/story-store').uuidV5(none[0].book_id, 'p01');
  calls.length = 0;
  const kept = await run(db([{ id: 'v1', page_id: pid, lang: 'en', audio_key: 'story/x/a01.ogg', ms: 2100 }]));
  expect(kept[0]).toMatchObject({ status: 'ready', kept_voice: [1], why: [] });
  expect(kept[1]).toMatchObject({ ready: 1, dry_run: true, voice_gate: true });
  expect(calls).toContainEqual(['story_page_voices', 'select', 'id, page_id, lang, audio_key, ms, provider, voice, model']);
  expect(calls.some((c) => ['upsert', 'update', 'delete', 'insert'].includes(c[1]))).toBe(false);
});

test('the switch is on only for JSON true: a string or another shape plans with today\'s pace gates', async () => {
  const vj = path.join(dir, 'voices', SRC, 'p01.json');
  fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), wpm: 150, pace_wpm: 160 }));
  const db = (value) => ({ from: (t) => { const b = {}; ['select', 'eq', 'in', 'maybeSingle'].forEach((m) => { b[m] = () => b; }); b.then = (res) => res({ data: t === 'app_settings' ? { key: 'web_quiz_story_voice_gate', value } : [], error: null }); return b; } });
  const run = async (d) => { const o = io(); await main({ argv: [...base(), '--cleared', path.join(dir, 'cleared.csv'), '--dry-run'], env: {}, io: o, db: d }); return o.o.out.trim().split('\n').map((l) => JSON.parse(l)); };
  for (const v of ['true', '"true"', ' TRUE ', 1, { enabled: true }]) {
    const out = await run(db(v));
    expect(out[0]).toMatchObject({ status: 'draft', why: ['p01: voice pace 150 wpm', 'p01: voice span pace 160 wpm'] });
    expect(out[0].kept_voice).toBeUndefined();
    expect(out[1].voice_gate).toBeUndefined();
  }
});

test('a switch read error writes nothing: the run logs it, plans as a dry run with today\'s gates and exits 3', async () => {
  const calls = [];
  const db = { from: (t) => { const b = {}; ['select', 'eq', 'in', 'maybeSingle', 'upsert', 'update', 'delete', 'insert'].forEach((m) => { b[m] = (...a) => { calls.push([t, m]); return b; }; }); b.then = (res) => res(t === 'app_settings' ? { data: null, error: { code: '57014', message: 'timeout' } } : { data: [], error: null }); return b; } };
  const o = io();
  const rc = await main({ argv: [...base(), '--cleared', path.join(dir, 'cleared.csv')], env: {}, io: o, db });
  expect(rc).toBe(3);
  const lines = o.o.out.trim().split('\n').map((l) => JSON.parse(l));
  expect(lines[0].status).toMatch(/^(ready|draft)$/);
  expect(lines[1]).toMatchObject({ dry_run: true, voice_gate_read_failed: true });
  expect(o.o.err).toMatch(/web_quiz\.story_voice_gate_read_failed/);
  expect(fs.existsSync(path.join(dir, 'loaded.csv'))).toBe(false);
  expect(calls.filter((c) => ['upsert', 'update', 'delete', 'insert'].includes(c[1]))).toEqual([]);
});

test('--read-db: a dry run that reads the switch and the current voices from the database (read only); it needs the database', async () => {
  const o = io();
  expect(await main({ argv: [...base(), '--cleared', path.join(dir, 'cleared.csv'), '--dry-run', '--read-db'], env: {}, io: o })).toBe(2);
  expect(o.o.err).toMatch(/--expect-ref, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/);
  const o2 = io();
  expect(await main({ argv: [...base(), '--cleared', path.join(dir, 'cleared.csv'), '--dry-run'], env: {}, io: o2 })).toBe(0);
});
