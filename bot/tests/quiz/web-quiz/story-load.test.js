'use strict';
/**
 * Loading a storybook (story-load.js): from the prepared book files to rows and stored files, and the READY gates.
 * Fixtures are invented "Testwala" books with two pages, written to a temp folder; the database is an in-memory store
 * with the same interface as supabaseStore(); storage is a recorded upload function. Nothing first-party is faked.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const L = require('../../../shared/services/quiz/story-load');
const Store = require('../../../shared/services/quiz/story-store');

const SRC = 'src-asad-testwala';
const BOOK_ID = Store.bookIdFor(SRC);
// A real VP8 header (240x357) followed by filler: enough for the size reader, unique per call.
const webp = (w, h, tag) => {
  const b = Buffer.alloc(40 + tag.length);
  b.write('RIFF', 0); b.write('WEBP', 8); b.write('VP8 ', 12);
  b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28); b.write(tag, 40);
  return b;
};
const h8 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);

let dir;
function fixture({ voices = [1, 2], questionsReviewed = 3, band = true, wer = 0.0, drift = 60, wpm = 92, pace = null, grade = 1, mismatch = false, pageWatermark = false, bigPage = false, long = false } = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqsl-'));
  const serve = path.join(dir, 'serve'); const vdir = path.join(dir, 'voices'); fs.mkdirSync(serve); fs.mkdirSync(vdir);
  fs.writeFileSync(path.join(serve, 'thumb.webp'), webp(240, 357, 'cover'));
  fs.writeFileSync(path.join(serve, 'p01.webp'), bigPage ? Buffer.concat([webp(720, 1083, 'p1'), Buffer.alloc(90 * 1024)]) : webp(720, 1083, 'p1'));
  fs.writeFileSync(path.join(serve, 'p02.webp'), webp(720, 1083, 'p2'));
  fs.writeFileSync(path.join(serve, 'p01-band.webp'), webp(1440, 260, 'b1'));
  fs.writeFileSync(path.join(serve, 'p02-band.webp'), webp(1440, 260, 'b2'));
  const page = (n, text) => {
    const words = text.split(' ').map((t, i) => ({ i, t, box: [10 + 40 * i, 800, 36.4, 40], qa: 'x' }));
    return { n, lang: 'en', image: { file: `p0${n}.webp`, w: 720, h: 1083 }, text, words, boxes_ok: true, text_source: 'pdf', confidence: 0.987, is_picture: false,
      ...(band ? { text_band: { file: `p0${n}-band.webp`, w: 1440, h: 260, box: [0, 780, 720, 130] } } : {}), ...(pageWatermark && n === 2 ? { watermark: true } : {}) };
  };
  const book = { source_id: SRC, slug: 'g1-en-asad-testwala', title: 'Asad Testwala', grade, lang: 'en', slo_english: 'Nouns',
    author: 'Sara Testwala', illustrator: 'Ali Testwala', cover: { file: 'cover.webp', thumb: 'thumb.webp' }, text_ready: true, unsettled_pages: [],
    pages: long ? [page(1, 'Asad Testwala reads a book with Sara Testwala under the big tree.'), page(2, 'The cat sits on the mat and the dog runs to it.')]
      : [page(1, 'Asad Testwala reads.'), page(2, 'The cat sits.')] };
  for (const n of voices) {
    const words = book.pages[n - 1].words.map((w) => ({ i: w.i, t: w.t, s_ms: 400 + 500 * w.i, e_ms: 850 + 500 * w.i }));
    if (mismatch && n === 2) words.pop();
    fs.writeFileSync(path.join(vdir, `p0${n}.json`), JSON.stringify({ v: 1, lang: 'en', audio: { ms: 2100, mime: 'audio/ogg' }, words, wpm, pace_wpm: pace == null ? wpm : pace, voice: { provider: 'soniox', voice: 'Grace', model: 'tts-rt-v2' }, timing_src: 'stt_align' }));
    fs.writeFileSync(path.join(vdir, `p0${n}.qa.json`), JSON.stringify({ wer, drift_ms_max: drift, drift_ms_mean: 40, drift_ms_p90: 50, cost_usd: 0.0012 }));
    fs.writeFileSync(path.join(vdir, `p0${n}.ogg`), Buffer.from(`OggS-page-${n}`));
  }
  fs.writeFileSync(path.join(vdir, 'q1.ogg'), Buffer.from('OggS-q1'));
  fs.writeFileSync(path.join(vdir, 'q1o2.ogg'), Buffer.from('OggS-q1o2'));
  fs.writeFileSync(path.join(vdir, 'questions.sprite.ogg'), Buffer.from('OggS-sprite'));
  fs.writeFileSync(path.join(vdir, 'questions.voice.json'), JSON.stringify({ sprite: { ogg: 'questions.sprite.ogg', clips: { q1: { s_ms: 0, e_ms: 2200 }, q1o1: { s_ms: 2350, e_ms: 3100 } } } }));
  const qs = [1, 2, 3, 4].map((n) => ({ n, kind: n === 4 ? 'inference' : 'literal', q: `Who reads ${n}?`, options: [{ t: 'Asad' }, { t: 'Sara' }, { t: 'Ali' }], answer_i: 0, page_ref: 1,
    review_status: n <= questionsReviewed ? 'reviewed' : 'draft', reviewer_note: 'ok' }));
  const qfile = path.join(dir, `${SRC}.json`);
  fs.writeFileSync(qfile, JSON.stringify({ source_id: SRC, questions: qs }));
  return { book, serveDir: serve, voiceDir: vdir, questionsFile: qfile, cleared: true };
}
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });

/** The same interface as supabaseStore(), over maps. */
function memoryStore() {
  const t = { books: new Map(), pages: new Map(), voices: new Map(), questions: new Map() };
  return {
    t,
    bookStatus: async (id) => (t.books.get(id) || {}).status || null,
    upsertBook: async (r) => { t.books.set(r.id, { ...t.books.get(r.id), ...r }); },
    upsertPages: async (rows) => rows.forEach((r) => t.pages.set(r.id, r)),
    deletePagesAbove: async (b, n) => [...t.pages.values()].filter((p) => p.book_id === b && p.n > n).forEach((p) => t.pages.delete(p.id)),
    currentVoices: async (ids) => [...t.voices.values()].filter((v) => ids.includes(v.page_id) && v.is_current),
    retireVoice: async (id) => { t.voices.get(id).is_current = false; },
    upsertVoice: async (r) => {
      if ([...t.voices.values()].some((v) => v.id !== r.id && v.page_id === r.page_id && v.lang === r.lang && v.is_current && r.is_current)) throw new Error('duplicate key story_page_voices_current');
      t.voices.set(r.id, r);
    },
    // an upsert writes the columns it names and leaves the others as stored (PostgREST)
    upsertQuestions: async (rows) => rows.forEach((r) => t.questions.set(r.id, { ...t.questions.get(r.id), ...r })),
    deleteQuestionsAbove: async (b, n) => [...t.questions.values()].filter((q) => q.book_id === b && q.n > n).forEach((q) => t.questions.delete(q.id)),
    setStatus: async (id, status) => { t.books.get(id).status = status; },
  };
}
const recorder = () => { const up = []; return { up, upload: async (buf, o) => { up.push({ ...o, n: buf.length }); return o.key; } }; };

describe('planBook', () => {
  test('a finished book is READY: stable ids, hashed files, the contract\'s rows', () => {
    const f = fixture();
    const p = L.planBook(f);
    expect(p.why).toEqual([]);
    expect(p.ready).toBe(true);
    expect(p.bookId).toBe(BOOK_ID);
    expect(p.bookRow).toMatchObject({ id: BOOK_ID, source_id: SRC, slug: 'g1-en-asad-testwala', title: 'Asad Testwala', grade: 1, lang: 'en', pages: 2,
      author: 'Sara Testwala', illustrator: 'Ali Testwala', cover_w: 240, cover_h: 357, minutes: 0.1 });
    expect(p.bookRow.cover_file).toMatch(/^cover-[0-9a-f]{8}\.webp$/);
    expect(p.bookRow.questions_sprite).toEqual({ file: `qs-${h8(Buffer.from('OggS-sprite'))}.ogg`, clips: { q1: { s_ms: 0, e_ms: 2200 }, q1o1: { s_ms: 2350, e_ms: 3100 } } });
    expect(p.pages[0]).toMatchObject({ id: Store.uuidV5(BOOK_ID, 'p01'), n: 1, image_w: 720, image_h: 1083, text: 'Asad Testwala reads.', boxes_ok: true, text_source: 'pdf', confidence: 0.99, is_picture: false });
    expect(p.pages[0].image_file).toBe(`p01-${h8(fs.readFileSync(path.join(f.serveDir, 'p01.webp')))}.webp`);
    expect(p.pages[0].words[0]).toEqual({ i: 0, t: 'Asad', box: [10, 800, 36, 40] });
    expect(p.pages[0].text_band).toEqual({ file: expect.stringMatching(/^p01-band-[0-9a-f]{8}\.webp$/), w: 1440, h: 260, box: [0, 780, 720, 130] });
    expect(p.voices[0].row).toMatchObject({ lang: 'en', provider: 'soniox', voice: 'Grace', model: 'tts-rt-v2', ms: 2100, timing_source: 'stt_align', wer: 0, drift_ms_max: 60, wpm: 92 });
    expect(p.voices[0].row.timings[0]).toEqual({ i: 0, s_ms: 400, e_ms: 850 });
    expect(p.questions).toHaveLength(4);
    expect(p.questions[0]).toMatchObject({ id: Store.uuidV5(BOOK_ID, 'q1'), n: 1, kind: 'literal', answer_i: 0, page_ref: 1, review_status: 'reviewed',
      audio: { q: expect.stringMatching(/^q1-[0-9a-f]{8}\.ogg$/), o: [null, expect.stringMatching(/^q1o2-[0-9a-f]{8}\.ogg$/), null] } });
    expect(p.files.every((x) => Store.FILE_RX.test(x.name))).toBe(true);
    expect(p.counts).toEqual({ pages: 2, textPages: 2, voiced: 2, questions: 4, reviewed: 3 });
  });

  test('each failed gate keeps the book a draft and says why', () => {
    expect(L.planBook(fixture({ voices: [1] })).why).toEqual(['p02: no voice']);
    expect(L.planBook(fixture({ mismatch: true })).why).toEqual(['p02: voice words differ from the page words']);
    expect(L.planBook(fixture({ wer: 0.2, drift: 150 })).why).toEqual(['p01: voice wer 0.2', 'p02: voice wer 0.2']);
    expect(L.planBook(fixture({ wpm: 104, long: true })).why).toEqual(['p01: voice pace 104 wpm', 'p02: voice pace 104 wpm']);
    expect(L.planBook(fixture({ wpm: 104, grade: 3, long: true })).why).toEqual([]);
    expect(L.planBook(fixture({ wpm: 118, grade: 4, long: true })).why).toEqual(['p01: voice pace 118 wpm', 'p02: voice pace 118 wpm']);
    expect(L.planBook(fixture({ questionsReviewed: 2 })).why).toEqual(['questions: 2 reviewed']);
    expect(L.planBook(fixture({ band: false })).why).toEqual(['p01: no word band', 'p02: no word band']);
    expect(L.planBook(fixture({ pageWatermark: true })).why).toEqual(['p02: watermark']);
    expect(L.planBook(fixture({ bigPage: true })).why).toEqual([expect.stringMatching(/^p01: picture \d+ B > 80 KB$/)]);
    expect(L.planBook({ ...fixture(), cleared: false }).why).toEqual(['watermark: not cleared']);
    const f = fixture();
    expect(L.planBook({ ...f, book: { ...f.book, unsettled_pages: [2] } }).why).toEqual(['text not settled']);
    expect(L.planBook({ ...fixture(), voiceDir: null }).why).toEqual(['p01: no voice', 'p02: no voice']);
    [L.planBook(fixture({ voices: [1] })), L.planBook(fixture({ questionsReviewed: 0 }))].forEach((p) => expect(p.ready).toBe(false));
  });

  test('the cleaned page wins (picture and band); a cleaned page needs a looker\'s pass; the column says so', () => {
    const f = fixture();
    const cleanDir = path.join(dir, 'clean'); fs.mkdirSync(cleanDir);
    const cleanedPic = webp(720, 1083, 'p2-cleaned');
    fs.writeFileSync(path.join(cleanDir, 'p02.webp'), cleanedPic);
    const page2 = (looked, ok) => new Map([[2, { image: { file: 'p02.webp', w: 720, h: 1083 }, cleaned: true, method: 'a', looked, ok }]]);
    const passed = L.planBook({ ...f, cleanDir, cleanPages: page2(true, true) });
    expect(passed.why).toEqual([]);
    expect(passed.pages[1].image_file).toBe(`p02-${h8(cleanedPic)}.webp`);
    expect(passed.pages.map((p) => p.watermark)).toEqual([false, false]);
    const unlooked = L.planBook({ ...f, cleanDir, cleanPages: page2(false, true) });
    expect(unlooked.why).toEqual(['p02: cleaned page not passed by a looker']);
    expect(unlooked.pages.map((p) => p.watermark)).toEqual([false, true]);
    expect(L.planBook({ ...f, cleanDir, cleanPages: page2(true, false) }).why).toEqual(['p02: cleaned page not passed by a looker']);
    expect(L.planBook({ ...f, cleared: false }).pages.map((p) => p.watermark)).toEqual([true, true]);
  });

  test('lines are carried (malformed dropped); a voice its own build failed does not count; the READALONG key names the timing file', () => {
    const f = fixture();
    f.book.pages[0].lines = [{ i0: 0, i1: 2, box: [10.4, 800, 300, 40] }, { i0: 3 }, { i0: 2, i1: 1 }];
    const vj = path.join(f.voiceDir, 'p02.json');
    fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), ok: false, fails: ['wpm 140'], audio: { ms: 2100, key: 'readalong/sandbox/story/en/x-p02/sx-grace-0a1b2c3d.ogg' } }));
    const p = L.planBook(f);
    expect(p.pages[0].lines).toEqual([{ i0: 0, i1: 2, box: [10, 800, 300, 40] }]);
    expect(p.pages[1].lines).toBeNull();
    expect(p.why).toEqual(['p02: voice failed its own checks (wpm 140)']);
    expect(p.voices.map((v) => v.n)).toEqual([1]);
    expect(p.voices[0].row.timing_key).toBeNull();
    fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), ok: true, fails: [] }));
    const q = L.planBook(f);
    expect(q.why).toEqual([]);
    expect(q.voices[1].row.timing_key).toBe('readalong/sandbox/story/en/x-p02/sx-grace-0a1b2c3d.json');
    expect(q.voices[1].file.name).toMatch(/^a02-[0-9a-f]{8}\.ogg$/);
  });

  test('a page whose voice has a stored key but no local clip is not voiced: the book stays a draft', () => {
    const f = fixture();
    const vj = path.join(f.voiceDir, 'p01.json');
    fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), audio: { ms: 2100, key: 'readalong/sandbox/story/en/x-p01/sx-grace-0a1b2c3d.ogg' } }));
    fs.rmSync(path.join(f.voiceDir, 'p01.ogg'));
    const p = L.planBook(f);
    expect(p.why).toEqual(['p01: voice clip missing']);
    expect(p.ready).toBe(false);
    expect(p.voices.map((v) => v.n)).toEqual([2]);
    expect(p.voices.every((v) => v.file && Store.FILE_RX.test(v.file.name))).toBe(true);
  });

  test('a voice whose timing is marked low quality keeps its voice and carries the mark (line highlight); others carry none', async () => {
    const f = fixture();
    const vj = path.join(f.voiceDir, 'p02.json');
    fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), ok: true, quality: 'low' }));
    const p = L.planBook(f);
    expect(p.why).toEqual([]);
    expect(p.voices.map((v) => [v.n, v.row.quality])).toEqual([[1, null], [2, 'low']]);
    fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), quality: 'great' }));
    expect(L.planBook(f).voices.map((v) => v.row.quality)).toEqual([null, null]);
    const store = memoryStore(); const r = recorder();
    await L.applyPlan(p, { store, upload: r.upload, env: 'sandbox' });
    expect([...store.t.voices.values()].map((v) => v.quality).sort()).toEqual(['low', null]);
  });

  test('a voice not yet through its timing checks counts as line-timed: the mirror flag, or no p90 on the page', () => {
    const f = fixture();
    const vj = path.join(f.voiceDir, 'p01.json');
    fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), timing_quality: 'low' }));
    const qj = path.join(f.voiceDir, 'p02.qa.json'); const q = JSON.parse(fs.readFileSync(qj, 'utf8')); delete q.drift_ms_p90; fs.writeFileSync(qj, JSON.stringify(q));
    const p = L.planBook(f);
    expect(p.why).toEqual([]);
    expect(p.voices.map((v) => [v.n, v.row.quality])).toEqual([[1, 'low'], [2, 'low']]);
  });

  test('two pace gates: the whole clip (100 / 115) and the word span (130 / 145)', () => {
    expect(L.planBook(fixture({ wpm: 104, pace: 98, long: true })).why).toEqual(['p01: voice pace 104 wpm', 'p02: voice pace 104 wpm']);
    expect(L.planBook(fixture({ wpm: 95, pace: 125 })).why).toEqual([]);
    expect(L.planBook(fixture({ wpm: 95, pace: 133 })).why).toEqual(['p01: voice span pace 133 wpm', 'p02: voice span pace 133 wpm']);
    expect(L.planBook(fixture({ wpm: 110, pace: 140, grade: 3 })).why).toEqual([]);
    expect(L.planBook(fixture({ wpm: 110, pace: 148, grade: 5 })).why).toEqual(['p01: voice span pace 148 wpm', 'p02: voice span pace 148 wpm']);
    const f = fixture({ pace: 120, long: true });
    for (const n of [1, 2]) {
      const vj = path.join(f.voiceDir, `p0${n}.json`); const j = JSON.parse(fs.readFileSync(vj, 'utf8')); delete j.wpm; fs.writeFileSync(vj, JSON.stringify(j));
      const qj = path.join(f.voiceDir, `p0${n}.qa.json`); fs.writeFileSync(qj, JSON.stringify({ ...JSON.parse(fs.readFileSync(qj, 'utf8')), wpm_clip: n === 1 ? 99 : 103 }));
    }
    expect(L.planBook(f).why).toEqual(['p02: voice pace 103 wpm']);
    const g = fixture({ pace: 120 });
    const vj = path.join(g.voiceDir, 'p01.json'); const j = JSON.parse(fs.readFileSync(vj, 'utf8')); delete j.wpm; fs.writeFileSync(vj, JSON.stringify(j));
    expect(L.planBook(g).why).toEqual(['p01: voice pace unknown wpm']);
  });

  test('both pace gates keep a 2 % measurement tolerance, and no more', () => {
    expect(L.planBook(fixture({ wpm: 102, pace: 132.6, long: true })).why).toEqual([]);
    expect(L.planBook(fixture({ wpm: 102.1, pace: 120, long: true })).why).toEqual(['p01: voice pace 102.1 wpm', 'p02: voice pace 102.1 wpm']);
    expect(L.planBook(fixture({ wpm: 95, pace: 132.7, long: true })).why).toEqual(['p01: voice span pace 132.7 wpm', 'p02: voice span pace 132.7 wpm']);
    expect(L.planBook(fixture({ wpm: 117.3, pace: 147.9, grade: 3, long: true })).why).toEqual([]);
    expect(L.planBook(fixture({ wpm: 117.4, pace: 148, grade: 5, long: true })).why).toEqual(['p01: voice pace 117.4 wpm', 'p01: voice span pace 148 wpm', 'p02: voice pace 117.4 wpm', 'p02: voice span pace 148 wpm']);
  });

  test('a page under 10 words: the whole-clip gate is 115 in every grade, and the span gate decides', () => {
    expect(L.planBook(fixture({ wpm: 108.9, pace: 128.4 })).why).toEqual([]);
    expect(L.planBook(fixture({ wpm: 117.3, pace: 120 })).why).toEqual([]);
    expect(L.planBook(fixture({ wpm: 117.4, pace: 120 })).why).toEqual(['p01: voice pace 117.4 wpm', 'p02: voice pace 117.4 wpm']);
    expect(L.planBook(fixture({ wpm: 108.9, pace: 133 })).why).toEqual(['p01: voice span pace 133 wpm', 'p02: voice span pace 133 wpm']);
    // Ten words or more: the grade's own gate.
    expect(L.planBook(fixture({ wpm: 108.9, pace: 128.4, long: true })).why).toEqual(['p01: voice pace 108.9 wpm', 'p02: voice pace 108.9 wpm']);
  });

  test('a wer miss ships only when the voice build waived it for a listen (both marks), never on one mark alone', () => {
    const qa = (f, extra) => {
      const qj = path.join(f.voiceDir, 'p02.qa.json');
      fs.writeFileSync(qj, JSON.stringify({ ...JSON.parse(fs.readFileSync(qj, 'utf8')), wer: 0.182, ...extra }));
      return L.planBook(f).why;
    };
    expect(qa(fixture(), {})).toEqual(['p02: voice wer 0.182']);
    expect(qa(fixture(), { listen_asked: true, waived: ['wer 0.182 (one short word misheard by every recogniser; listen asked)'] })).toEqual([]);
    expect(qa(fixture(), { listen_asked: true })).toEqual(['p02: voice wer 0.182']);
    expect(qa(fixture(), { waived: ['wer 0.182'] })).toEqual(['p02: voice wer 0.182']);
    expect(qa(fixture(), { listen_asked: true, waived: ['pace 104'] })).toEqual(['p02: voice wer 0.182']);
  });

  test('a voice with no span pace anywhere fails gate B; a span pace in the check file alone is read', () => {
    const f = fixture({ wpm: 95, pace: 120 });
    const vj = path.join(f.voiceDir, 'p02.json'); const j = JSON.parse(fs.readFileSync(vj, 'utf8')); delete j.pace_wpm; fs.writeFileSync(vj, JSON.stringify(j));
    expect(L.planBook(f).why).toEqual(['p02: voice span pace unknown wpm']);
    expect(L.planBook(f).ready).toBe(false);
    const qj = path.join(f.voiceDir, 'p02.qa.json'); fs.writeFileSync(qj, JSON.stringify({ ...JSON.parse(fs.readFileSync(qj, 'utf8')), pace_wpm: 128 }));
    expect(L.planBook(f).why).toEqual([]);
  });

  test('a page whose voice fails any check is loaded with no voice (Your turn), never as voiced', async () => {
    const f = fixture();
    const vj = path.join(f.voiceDir, 'p02.json');
    fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), ok: false, fails: ['drift 148'] }));
    const p = L.planBook(f);
    expect(p.why).toEqual(['p02: voice failed its own checks (drift 148)']);
    expect(p.voices.map((v) => v.n)).toEqual([1]);
    expect(p.counts.voiced).toBe(1);
    expect(L.planBook(fixture({ wer: 0.2 })).voices).toEqual([]);
    const store = memoryStore(); const r = recorder();
    await L.applyPlan(p, { store, upload: r.upload, env: 'sandbox' });
    expect([...store.t.voices.values()].map((v) => v.page_id)).toEqual([Store.uuidV5(BOOK_ID, 'p01')]);
    expect(store.t.books.get(BOOK_ID).status).toBe('draft');
  });

  test('a picture page needs no words, band or voice; the uuid ids never change between runs', () => {
    const f = fixture({ voices: [1] });
    f.book.pages[1] = { ...f.book.pages[1], is_picture: true, words: [], text: '', text_band: undefined };
    const p = L.planBook(f);
    expect(p.why).toEqual([]);
    expect(p.counts).toMatchObject({ textPages: 1, voiced: 1 });
    expect(L.planBook(f).pages.map((x) => x.id)).toEqual(p.pages.map((x) => x.id));
  });
});

describe('applyPlan', () => {
  test('stores every file under story/<env>/<book>/ then writes the rows; a re-run writes the same rows', async () => {
    const plan = L.planBook(fixture());
    const store = memoryStore(); const r = recorder();
    const out = await L.applyPlan(plan, { store, upload: r.upload, env: 'sandbox' });
    expect(out).toMatchObject({ bookId: BOOK_ID, status: 'ready', uploaded: plan.files.length });
    expect(r.up.every((u) => u.key === `story/sandbox/${BOOK_ID}/${u.name}`)).toBe(true);
    expect(store.t.pages.size).toBe(2);
    expect(store.t.voices.size).toBe(2);
    expect([...store.t.voices.values()][0].audio_key).toMatch(new RegExp(`^story/sandbox/${BOOK_ID}/a01-[0-9a-f]{8}\\.ogg$`));
    expect(store.t.questions.size).toBe(4);
    await L.applyPlan(plan, { store, upload: r.upload, env: 'sandbox', has: () => true });
    expect([store.t.pages.size, store.t.voices.size, store.t.questions.size]).toEqual([2, 2, 4]);
  });

  test('every voice row names a clip that was uploaded, with its bytes and audio type: no row points at a missing file', async () => {
    const f = fixture();
    const plan = L.planBook(f);
    const store = memoryStore(); const r = recorder();
    await L.applyPlan(plan, { store, upload: r.upload, env: 'sandbox' });
    const voices = [...store.t.voices.values()];
    expect(voices).toHaveLength(2);
    for (const v of voices) {
      const up = r.up.find((u) => u.key === v.audio_key);
      expect(up).toBeTruthy();
      expect(up.contentType).toBe('audio/ogg');
      const n = Number(path.basename(v.audio_key).slice(1, 3));
      expect(up.n).toBe(fs.readFileSync(path.join(f.voiceDir, `p0${n}.ogg`)).length);
    }
  });

  test('a book is ready only when every voice clip is in storage under story/; a missing one keeps it a draft with the reason', async () => {
    const plan = L.planBook(fixture());
    const store = memoryStore(); const r = recorder();
    const missing = plan.voices.find((v) => v.n === 2);
    const out = await L.applyPlan(plan, { store, upload: r.upload, env: 'sandbox', stored: async (k) => !k.endsWith(missing.file.name) });
    expect(out.status).toBe('draft');
    expect(plan.why).toEqual(['p02: voice clip not stored']);
    expect(store.t.books.get(BOOK_ID).status).toBe('draft');
    const again = L.planBook(fixture());
    const asked = [];
    expect((await L.applyPlan(again, { store, upload: r.upload, env: 'sandbox', stored: async (k) => { asked.push(k); return true; } })).status).toBe('ready');
    expect(asked.sort()).toEqual([...store.t.voices.values()].filter((v) => v.is_current).map((v) => v.audio_key).sort());
    expect(asked.every((k) => k.startsWith(`story/sandbox/${BOOK_ID}/`))).toBe(true);
  });

  test('a page whose voice no longer passes loses its current voice row (no stale clip is served)', async () => {
    const f = fixture();
    const store = memoryStore(); const r = recorder();
    await L.applyPlan(L.planBook(f), { store, upload: r.upload, env: 'sandbox' });
    const vj = path.join(f.voiceDir, 'p02.json');
    fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), ok: false, fails: ['wer 0.3'] }));
    await L.applyPlan(L.planBook(f), { store, upload: r.upload, env: 'sandbox' });
    const cur = [...store.t.voices.values()].filter((v) => v.is_current).map((v) => v.page_id);
    expect(cur).toEqual([Store.uuidV5(BOOK_ID, 'p01')]);
    expect(store.t.voices.size).toBe(2);
  });

  test('a re-voice keeps the old row and moves is_current; a book set off stays off; a not-ready book is a draft', async () => {
    const store = memoryStore(); const r = recorder();
    await L.applyPlan(L.planBook(fixture()), { store, upload: r.upload, env: 'sandbox' });
    const f2 = fixture();
    fs.writeFileSync(path.join(f2.voiceDir, 'p01.ogg'), Buffer.from('OggS-page-1-revoiced'));
    await L.applyPlan(L.planBook(f2), { store, upload: r.upload, env: 'sandbox' });
    const p1 = [...store.t.voices.values()].filter((v) => v.page_id === Store.uuidV5(BOOK_ID, 'p01'));
    expect(p1).toHaveLength(2);
    expect(p1.filter((v) => v.is_current)).toHaveLength(1);
    await store.setStatus(BOOK_ID, 'off');
    expect((await L.applyPlan(L.planBook(fixture()), { store, upload: r.upload, env: 'sandbox' })).status).toBe('off');
    const store2 = memoryStore();
    expect((await L.applyPlan(L.planBook(fixture({ voices: [] })), { store: store2, upload: r.upload, env: 'sandbox' })).status).toBe('draft');
    expect(store2.t.books.get(BOOK_ID).status).toBe('draft');
  });

  test('a book that shrinks loses its extra pages and questions; dry run writes and uploads nothing', async () => {
    const store = memoryStore(); const r = recorder();
    await L.applyPlan(L.planBook(fixture()), { store, upload: r.upload, env: 'sandbox' });
    const f = fixture();
    f.book.pages = f.book.pages.slice(0, 1);
    const q = JSON.parse(fs.readFileSync(f.questionsFile, 'utf8')); q.questions = q.questions.slice(0, 3); fs.writeFileSync(f.questionsFile, JSON.stringify(q));
    await L.applyPlan(L.planBook(f), { store, upload: r.upload, env: 'sandbox' });
    expect([store.t.pages.size, store.t.questions.size]).toEqual([1, 3]);
    const store3 = memoryStore(); const r3 = recorder();
    const out = await L.applyPlan(L.planBook(fixture()), { store: store3, upload: r3.upload, env: 'sandbox', dryRun: true });
    expect(out.status).toBe('ready');
    expect([r3.up.length, store3.t.books.size]).toEqual([0, 0]);
  });
});

describe('supabaseStore', () => {
  test('every call names the contract\'s table and conflict key, and a database error throws', async () => {
    const calls = [];
    const q = (table) => {
      const b = { _t: table };
      ['select', 'upsert', 'update', 'delete', 'eq', 'gt', 'in', 'maybeSingle'].forEach((m) => { b[m] = (...a) => { calls.push([table, m, ...a]); return b; }; });
      b.then = (res) => res({ data: table === 'story_books' ? { status: 'ready' } : [], error: null });
      return b;
    };
    const s = L.supabaseStore({ from: q });
    expect(await s.bookStatus(BOOK_ID)).toBe('ready');
    await s.upsertPages([{ id: 'x' }]);
    expect(calls).toContainEqual(['story_pages', 'upsert', [{ id: 'x' }], { onConflict: 'id' }]);
    await s.retireVoice('v1');
    expect(calls).toContainEqual(['story_page_voices', 'update', { is_current: false }]);
    const bad = L.supabaseStore({ from: () => ({ upsert: () => ({ then: (res) => res({ data: null, error: { code: '42P01', message: 'relation does not exist' } }) }) }) });
    await expect(bad.upsertBook({ id: 'x' })).rejects.toThrow(/42P01/);
  });
});

describe('missedPages: the pages children opened before they had a voice', () => {
  // story_events as rows; a query is the chain the loader builds, applied to them (eq on a column or a data->> key, gt/lte on at).
  const db = (events, books) => ({
    from: (table) => {
      const f = [];
      const b = {
        select: () => b,
        eq: (k, v) => { f.push((r) => String(k.startsWith('data->>') ? (r.data || {})[k.slice(7)] : r[k]) === String(v)); return b; },
        lte: (k, v) => { f.push((r) => r[k] <= v); return b; },
        gt: (k, v) => { f.push((r) => r[k] > v); return b; },
        in: (k, vs) => { f.push((r) => vs.includes(r[k])); return b; },
        order: () => b,
        limit: () => b,
        then: (res) => res({ data: (table === 'story_events' ? events : books).filter((r) => f.every((p) => p(r))), error: null }),
      };
      return b;
    },
  });
  const B1 = 'b0000000-0000-4000-8000-0000000000b1';
  const B2 = 'b0000000-0000-4000-8000-0000000000b2';
  const at = (m) => `2026-10-16T22:${String(m).padStart(2, '0')}:00.000Z`;
  const now = () => new Date('2026-10-16T23:00:00.000Z');

  test('both shapes: a story_page_unvoiced row and a story_page_listened {miss:true} row; never a page really listened', async () => {
    const events = [
      { book_id: B1, page_n: 2, at: at(1), event: 'story_page_listened', data: { miss: true } },
      { book_id: B2, page_n: 4, at: at(2), event: 'story_page_unvoiced', data: {} },
      { book_id: B1, page_n: 3, at: at(3), event: 'story_page_listened', data: { ms: 9000, completed: true } },
      { book_id: B2, page_n: 4, at: at(4), event: 'story_page_unvoiced', data: {} },
    ];
    const out = await L.missedPages(db(events, [{ id: B1, source_id: 'src-1' }, { id: B2, source_id: 'src-2' }]), { now });
    expect(out.until).toBe('2026-10-16T23:00:00.000Z');
    expect(out.pages).toEqual([{ book_id: B1, n: 2, source_id: 'src-1' }, { book_id: B2, n: 4, source_id: 'src-2' }]);
  });

  test('since: only rows after the last run, in either shape', async () => {
    const events = [
      { book_id: B1, page_n: 2, at: at(1), event: 'story_page_unvoiced', data: {} },
      { book_id: B1, page_n: 5, at: at(30), event: 'story_page_unvoiced', data: {} },
      { book_id: B2, page_n: 1, at: at(31), event: 'story_page_listened', data: { miss: true } },
    ];
    const out = await L.missedPages(db(events, [{ id: B1, source_id: 'src-1' }, { id: B2, source_id: 'src-2' }]), { since: at(10), now });
    expect(out.pages.map((p) => `${p.source_id}/${p.n}`)).toEqual(['src-1/5', 'src-2/1']);
  });
});

describe('the voice method gate (app_settings web_quiz_story_voice_gate; absent or not true = today)', () => {
  // A natural-speed take as the voice build records it: one provider call, its bytes as delivered.
  const METHOD = { splices: 0, atempo: 1, inserted_silence_ms: 0, speed: 1, kbps: 64, midword_hits: 0 };
  const naturalize = (f, { pages = [1, 2], qa = {}, wpm = 153, pace = 170 } = {}) => {
    for (const n of pages) {
      const vj = path.join(f.voiceDir, `p0${n}.json`); const qj = path.join(f.voiceDir, `p0${n}.qa.json`);
      fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), wpm, pace_wpm: pace, voice: { provider: 'elevenlabs', voice: 'Bella', model: 'eleven_v4' }, timing_src: 'forced_align' }));
      fs.writeFileSync(qj, JSON.stringify({ ...JSON.parse(fs.readFileSync(qj, 'utf8')), ...METHOD, wpm_clip: wpm, ...qa }));
      fs.writeFileSync(path.join(f.voiceDir, `p0${n}.ogg`), Buffer.from(`OggS-natural-${n}`));
    }
    return f;
  };
  const strip = (p) => JSON.parse(JSON.stringify({ ...p, files: p.files.map((x) => x.name) }));

  test('voiceGateOn: only JSON true turns it on (a string is not true)', () => {
    [undefined, null, false, 'false', 'true', '"true"', ' TRUE ', 1, 'yes', {}, [], { on: true }, { enabled: true }].forEach((v) => expect(L.voiceGateOn(v)).toBe(false));
    expect(L.voiceGateOn(true)).toBe(true);
  });

  test('off: the plan is byte-identical to today, and a natural-speed take is refused by the pace gates as today', () => {
    for (const make of [() => fixture(), () => fixture({ wpm: 104, long: true }), () => naturalize(fixture({ long: true })), () => fixture({ voices: [1] })]) {
      const today = strip(L.planBook(make()));
      for (const voiceGate of [false, undefined, null]) expect(strip(L.planBook({ ...make(), voiceGate }))).toEqual(today);
    }
    expect(L.planBook({ ...naturalize(fixture({ long: true })), voiceGate: false }).why)
      .toEqual(['p01: voice pace 153 wpm', 'p01: voice span pace 170 wpm', 'p02: voice pace 153 wpm', 'p02: voice span pace 170 wpm']);
  });

  test('on: a one-take natural voice at 153 wpm is stored; no pace ceiling, the other checks unchanged', () => {
    const p = L.planBook({ ...naturalize(fixture({ long: true })), voiceGate: true });
    expect(p.why).toEqual([]);
    expect(p.ready).toBe(true);
    expect(p.misses).toEqual([]);
    expect(p.voices.map((v) => [v.n, v.row.provider, v.row.voice, v.row.timing_source, v.row.wpm])).toEqual([[1, 'elevenlabs', 'Bella', 'forced_align', 170], [2, 'elevenlabs', 'Bella', 'forced_align', 170]]);
    const wer = L.planBook({ ...naturalize(fixture({ long: true, wer: 0.2 })), voiceGate: true });
    expect(wer.misses.map((m) => [m.n, m.why])).toEqual([[1, ['voice wer 0.2']], [2, ['voice wer 0.2']]]);
    expect(L.planBook({ ...naturalize(fixture({ long: true, mismatch: true })), voiceGate: true }).misses.map((m) => m.why)).toEqual([['voice words differ from the page words']]);
  });

  test('on: the method gate refuses a stretched, cut, padded, slowed, thin or broken take, and a missing method record', () => {
    const miss = (o) => L.planBook({ ...naturalize(naturalize(fixture({ long: true })), { pages: [2], ...o }), voiceGate: true }).misses.map((m) => [m.n, m.why]);
    expect(miss({ qa: { splices: 3 } })).toEqual([[2, ['voice method: splices 3']]]);
    expect(miss({ qa: { splices: 1 } })).toEqual([[2, ['voice method: splices 1']]]);
    expect(miss({ qa: { kbps: 47.9 } })).toEqual([[2, ['voice method: 47.9 kb/s']]]);
    expect(miss({ qa: { atempo: 0.85 } })).toEqual([[2, ['voice method: atempo 0.85']]]);
    expect(miss({ qa: { inserted_silence_ms: 400 } })).toEqual([[2, ['voice method: inserted silence 400 ms']]]);
    expect(miss({ qa: { speed: 0.7 } })).toEqual([[2, ['voice method: speed 0.7']]]);
    expect(miss({ qa: { speed: 0.9 } })).toEqual([]);
    expect(miss({ qa: { kbps: 24 } })).toEqual([[2, ['voice method: 24 kb/s']]]);
    expect(miss({ qa: { kbps: 48 } })).toEqual([]);
    expect(miss({ qa: { midword_hits: 1 } })).toEqual([[2, ['voice midword silence 1']]]);
    expect(miss({ wpm: 59.9 })).toEqual([[2, ['voice pace 59.9 wpm outside 60–220']]]);
    expect(miss({ wpm: 220.1 })).toEqual([[2, ['voice pace 220.1 wpm outside 60–220']]]);
    expect(miss({ wpm: 220, pace: 260 })).toEqual([]);
    // The old library's records carry no method fields: under the gate they are not a natural take.
    const old = L.planBook({ ...fixture({ long: true }), voiceGate: true }).misses;
    expect(old.map((m) => m.n)).toEqual([1, 2]);
    expect(old[0].why).toEqual(['voice method: splices unknown', 'voice method: atempo unknown', 'voice method: inserted silence unknown', 'voice method: speed unknown', 'voice method: kb/s unknown', 'voice timing source stt_align', 'voice midword silence unknown']);
  });

  test('on: words the timing sources could not settle make the page line-timed, never a guessed box', () => {
    const f = naturalize(fixture({ long: true }), { pages: [2], qa: { timing_unresolved: 2 } });
    const p = L.planBook({ ...f, voiceGate: true });
    expect(p.why).toEqual([]);
    expect(p.voices.map((v) => [v.n, v.row.quality])).toEqual([[2, 'low']]);
    expect(L.planBook({ ...naturalize(fixture({ long: true })), voiceGate: true }).voices.map((v) => v.row.quality)).toEqual([null, null]);
    // the library builder records the same count as unresolved_words
    const g = naturalize(fixture({ long: true }), { pages: [2], qa: { unresolved_words: 1 } });
    expect(L.planBook({ ...g, voiceGate: true }).voices.map((v) => [v.n, v.row.quality])).toEqual([[2, 'low']]);
  });

  test('on: a failed new take never silences a page; the page keeps the voice it has and the book stays ready', async () => {
    const store = memoryStore(); const r = recorder();
    const f = naturalize(fixture({ long: true }));
    await L.applyPlan(L.planBook({ ...f, voiceGate: true }), { store, upload: r.upload, env: 'sandbox' });
    const before = [...store.t.voices.values()].filter((v) => v.is_current).map((v) => v.audio_key).sort();
    expect(before).toHaveLength(2);
    naturalize(f, { pages: [1] });
    naturalize(f, { pages: [2], qa: { splices: 4 } });
    const plan = L.planBook({ ...f, voiceGate: true });
    const out = await L.applyPlan(plan, { store, upload: r.upload, env: 'sandbox' });
    expect(out.status).toBe('ready');
    expect(out.kept).toEqual([2]);
    const cur = [...store.t.voices.values()].filter((v) => v.is_current);
    expect(cur).toHaveLength(2);
    expect(cur.find((v) => v.page_id === Store.uuidV5(BOOK_ID, 'p02')).audio_key).toBe(before.find((k) => /\/a02-/.test(k)));
    expect(cur.find((v) => v.page_id === Store.uuidV5(BOOK_ID, 'p01')).provider).toBe('elevenlabs');
    expect(store.t.books.get(BOOK_ID).status).toBe('ready');
    expect(plan.why).toEqual([]);
  });

  test('on: a failed take on a page with no voice yet still leaves the book a draft, with the reason', async () => {
    const store = memoryStore(); const r = recorder();
    const f = naturalize(fixture({ long: true }), { pages: [2], qa: { atempo: 0.85 } });
    naturalize(f, { pages: [1] });
    const out = await L.applyPlan(L.planBook({ ...f, voiceGate: true }), { store, upload: r.upload, env: 'sandbox' });
    expect(out.status).toBe('draft');
    expect(out.kept).toEqual([]);
    expect(store.t.books.get(BOOK_ID).status).toBe('draft');
    expect([...store.t.voices.values()].map((v) => v.page_id)).toEqual([Store.uuidV5(BOOK_ID, 'p01')]);
    const fresh = L.planBook({ ...f, voiceGate: true });
    await L.applyPlan(fresh, { store: memoryStore(), upload: r.upload, env: 'sandbox' });
    expect(fresh.why).toEqual(['p02: voice method: atempo 0.85']);
  });

  test('readVoiceGate reads the one key; no row or not true → false; a read error throws (a pass never guesses)', async () => {
    const db = (row, error = null) => { const calls = []; return { calls, from: (t) => { const b = {}; ['select', 'eq', 'maybeSingle'].forEach((m) => { b[m] = (...a) => { calls.push([t, m, ...a]); return b; }; }); b.then = (res) => res({ data: row, error }); return b; } }; };
    const d = db({ key: 'web_quiz_story_voice_gate', value: true });
    expect(await L.readVoiceGate(d)).toBe(true);
    expect(d.calls).toContainEqual(['app_settings', 'eq', 'key', 'web_quiz_story_voice_gate']);
    expect(await L.readVoiceGate(db(null))).toBe(false);
    expect(await L.readVoiceGate(db({ key: 'web_quiz_story_voice_gate', value: { on: true } }))).toBe(false);
    await expect(L.readVoiceGate(db(null, { message: 'boom' }))).rejects.toThrow('boom');
  });

  test('on: a kept voice never blanks the book\'s minutes; they count the kept page\'s stored length', async () => {
    const store = memoryStore(); const r = recorder();
    const f = fixture({ long: true, wpm: 92 });
    await L.applyPlan(L.planBook(f), { store, upload: r.upload, env: 'sandbox' });
    const m0 = store.t.books.get(BOOK_ID).minutes;
    naturalize(f, { pages: [1] }); naturalize(f, { pages: [2], qa: { splices: 4 } });
    await L.applyPlan(L.planBook({ ...f, voiceGate: true }), { store, upload: r.upload, env: 'sandbox' });
    expect(m0).not.toBeNull();
    expect(store.t.books.get(BOOK_ID).minutes).toBe(m0);
    // a kept row with no stored length: the stored minutes stay as they are
    [...store.t.voices.values()].forEach((v) => { delete v.ms; });
    store.t.books.get(BOOK_ID).minutes = 7.5;
    await L.applyPlan(L.planBook({ ...f, voiceGate: true }), { store, upload: r.upload, env: 'sandbox' });
    expect(store.t.books.get(BOOK_ID).minutes).toBe(7.5);
  });

  test('on: the dry run gives the write\'s answer: kept pages ready, a voiceless missed page draft, no store = draft', async () => {
    const f = naturalize(naturalize(fixture({ long: true })), { pages: [2], qa: { atempo: 0.85 } });
    const dry = await L.applyPlan(L.planBook({ ...f, voiceGate: true }), { store: memoryStore(), upload: recorder().upload, env: 'sandbox', dryRun: true });
    const wet = await L.applyPlan(L.planBook({ ...f, voiceGate: true }), { store: memoryStore(), upload: recorder().upload, env: 'sandbox' });
    expect([dry.status, wet.status]).toEqual(['draft', 'draft']);
    const plan = L.planBook({ ...f, voiceGate: true });
    const none = await L.applyPlan(plan, { store: null, upload: null, env: 'sandbox', dryRun: true });
    expect(none.status).toBe('draft');
    expect(plan.why).toEqual(['p02: voice method: atempo 0.85']);
    // the page has a voice already: the dry run says ready and kept, as the write does, and writes nothing
    const store = memoryStore();
    await L.applyPlan(L.planBook(fixture({ long: true, wpm: 92 })), { store, upload: recorder().upload, env: 'sandbox' });
    const snap = JSON.stringify([...store.t.voices.values(), ...store.t.books.values()]);
    const g = naturalize(naturalize(fixture({ long: true })), { pages: [2], qa: { atempo: 0.85 } });
    const d2 = await L.applyPlan(L.planBook({ ...g, voiceGate: true }), { store, upload: recorder().upload, env: 'sandbox', dryRun: true });
    // page 1's new voice differs from page 2's kept one, so (one voice per book) page 1 keeps its voice too
    expect([d2.status, d2.kept]).toEqual(['ready', [1, 2]]);
    expect(JSON.stringify([...store.t.voices.values(), ...store.t.books.values()])).toBe(snap);
    // off: the dry run is today's (no store read)
    const off = await L.applyPlan(L.planBook(f), { store: null, upload: null, env: 'sandbox', dryRun: true });
    expect(off).toEqual({ bookId: BOOK_ID, uploaded: L.planBook(f).files.length, skipped: 0, status: L.planBook(f).ready ? 'ready' : 'draft' });
  });

  test('on: a question clip is stored only when its record says one natural take; otherwise the question keeps its audio', async () => {
    const store = memoryStore(); const r = recorder();
    const f = fixture({ long: true, wpm: 92 });
    await L.applyPlan(L.planBook(f), { store, upload: r.upload, env: 'sandbox' });
    const q1 = Store.uuidV5(BOOK_ID, 'q1');
    const before = store.t.questions.get(q1).audio; const sprite0 = store.t.books.get(BOOK_ID).questions_sprite;
    expect(before.q).toMatch(/^q1-/);
    naturalize(f);
    fs.writeFileSync(path.join(f.voiceDir, 'q1.ogg'), Buffer.from('OggS-q1-natural'));
    fs.writeFileSync(path.join(f.voiceDir, 'questions.sprite.ogg'), Buffer.from('OggS-sprite-natural'));
    // the old library's questions.voice.json has no per-clip record: not a natural take
    const old = L.planBook({ ...f, voiceGate: true });
    expect(old.questionMisses).toEqual([{ n: 1, why: ['q1: no build record', 'q1o2: no build record'] }]);
    await L.applyPlan(old, { store, upload: r.upload, env: 'sandbox' });
    expect(store.t.questions.get(q1).audio).toEqual(before);
    expect(store.t.books.get(BOOK_ID).questions_sprite).toEqual(sprite0);
    expect(store.t.questions.get(q1).q).toBe('Who reads 1?');
    // one stretched option keeps the whole question's audio and the sprite
    const qv = path.join(f.voiceDir, 'questions.voice.json');
    const rec = { splices: 0, atempo: 1, inserted_silence_ms: 0, speed: 0.9, encodes: 1, kbps: 64 };
    const vj = JSON.parse(fs.readFileSync(qv, 'utf8'));
    fs.writeFileSync(qv, JSON.stringify({ ...vj, clips: { q1: rec, q1o2: { ...rec, atempo: 0.85 } } }));
    const half = L.planBook({ ...f, voiceGate: true });
    expect(half.questionMisses).toEqual([{ n: 1, why: ['q1o2: atempo 0.85'] }]);
    expect(half.files.filter((x) => /^(qs|q\d)/.test(x.name))).toEqual([]); // no held clip or sprite is stored
    await L.applyPlan(half, { store, upload: r.upload, env: 'sandbox' });
    expect(store.t.questions.get(q1).audio).toEqual(before);
    expect(store.t.books.get(BOOK_ID).questions_sprite).toEqual(sprite0);
    // every clip natural: the new clips and the new sprite are stored
    fs.writeFileSync(qv, JSON.stringify({ ...vj, clips: { q1: rec, q1o2: rec } }));
    const good = L.planBook({ ...f, voiceGate: true });
    expect(good.questionMisses).toEqual([]);
    await L.applyPlan(good, { store, upload: r.upload, env: 'sandbox' });
    expect(store.t.questions.get(q1).audio.q).not.toBe(before.q);
    expect(store.t.books.get(BOOK_ID).questions_sprite.file).not.toBe(sprite0.file);
    for (const k of [{ kbps: 32 }, { speed: 0.8 }, { splices: 2 }, { inserted_silence_ms: 300 }]) {
      fs.writeFileSync(qv, JSON.stringify({ ...vj, clips: { q1: { ...rec, ...k }, q1o2: rec } }));
      expect(L.planBook({ ...f, voiceGate: true }).questionMisses.map((m) => m.n)).toEqual([1]);
    }
  });

  test('on: the word times must come from the provider or a forced alignment of the stored audio, never a recogniser', () => {
    const f = naturalize(fixture({ long: true }));
    const set = (n, o) => { const vj = path.join(f.voiceDir, `p0${n}.json`); const j = JSON.parse(fs.readFileSync(vj, 'utf8')); delete j.timing_src; delete j.timing_source; fs.writeFileSync(vj, JSON.stringify({ ...j, ...o })); };
    const miss = () => L.planBook({ ...f, voiceGate: true }).misses.map((m) => [m.n, m.why]);
    expect(miss()).toEqual([]);
    set(2, { timing_src: 'stt_align' });
    expect(miss()).toEqual([[2, ['voice timing source stt_align']]]);
    set(2, {});
    expect(miss()).toEqual([[2, ['voice timing source unknown']]]);
    set(2, { timing_source: 'provider' });
    expect(miss()).toEqual([]);
  });

  test('on: a page with no pace on record is refused', () => {
    const f = naturalize(fixture({ long: true }));
    const vj = path.join(f.voiceDir, 'p02.json'); const qj = path.join(f.voiceDir, 'p02.qa.json');
    const j = JSON.parse(fs.readFileSync(vj, 'utf8')); delete j.wpm; fs.writeFileSync(vj, JSON.stringify(j));
    const q = JSON.parse(fs.readFileSync(qj, 'utf8')); delete q.wpm_clip; delete q.wpm; fs.writeFileSync(qj, JSON.stringify(q));
    expect(L.planBook({ ...f, voiceGate: true }).misses.map((m) => [m.n, m.why])).toEqual([[2, ['voice pace unknown wpm outside 60–220']]]);
  });

  test('on: one voice per book: two voices in one run, or a new voice beside a kept old one, keep the book as it is', async () => {
    const f = naturalize(fixture({ long: true }));
    const vj = path.join(f.voiceDir, 'p02.json');
    fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(fs.readFileSync(vj, 'utf8')), voice: { provider: 'elevenlabs', voice: 'Sara', model: 'eleven_v4' } }));
    const two = L.planBook({ ...f, voiceGate: true });
    expect(two.voices).toEqual([]);
    expect(two.misses.map((m) => [m.n, m.why])).toEqual([[1, ['one voice per book: 2 voices in this run']], [2, ['one voice per book: 2 voices in this run']]]);
    // a new take on page 1 beside page 2's kept old voice: page 1 keeps its old voice too, never a mixed book
    const store = memoryStore(); const r = recorder();
    const g = fixture({ long: true, wpm: 92 });
    await L.applyPlan(L.planBook(g), { store, upload: r.upload, env: 'sandbox' });
    const before = [...store.t.voices.values()].filter((v) => v.is_current).map((v) => v.audio_key).sort();
    naturalize(g, { pages: [1] }); naturalize(g, { pages: [2], qa: { splices: 2 } });
    const plan = L.planBook({ ...g, voiceGate: true });
    const r2 = recorder();
    const out = await L.applyPlan(plan, { store, upload: r2.upload, env: 'sandbox' });
    expect([out.status, out.kept]).toEqual(['ready', [1, 2]]);
    expect(r2.up.filter((u) => /^a\d\d-/.test(u.name))).toEqual([]); // a held-back take is never stored
    expect([...store.t.voices.values()].filter((v) => v.is_current).map((v) => v.audio_key).sort()).toEqual(before);
    const dry = await L.applyPlan(L.planBook({ ...g, voiceGate: true }), { store, upload: r.upload, env: 'sandbox', dryRun: true });
    expect([dry.status, dry.kept]).toEqual(['ready', [1, 2]]);
    // the same voice as the kept page: the new take is stored
    const h = fixture({ long: true });
    const s2 = memoryStore();
    naturalize(h);
    await L.applyPlan(L.planBook({ ...h, voiceGate: true }), { store: s2, upload: r.upload, env: 'sandbox' });
    fs.writeFileSync(path.join(h.voiceDir, 'p01.ogg'), Buffer.from('OggS-natural-1-retake'));
    naturalize(h, { pages: [2], qa: { splices: 2 } });
    const o2 = await L.applyPlan(L.planBook({ ...h, voiceGate: true }), { store: s2, upload: r.upload, env: 'sandbox' });
    expect(o2.kept).toEqual([2]);
    expect([...s2.t.voices.values()].filter((v) => v.is_current && v.page_id === Store.uuidV5(BOOK_ID, 'p01'))[0].audio_key).toMatch(/\/a01-/);
  });

  test('on: a page keeps only a voice in its own language', async () => {
    const store = memoryStore(); const r = recorder();
    const f = naturalize(naturalize(fixture({ long: true })), { pages: [2], qa: { splices: 2 } });
    const p2 = Store.uuidV5(BOOK_ID, 'p02');
    store.t.voices.set('ur1', { id: 'ur1', page_id: p2, lang: 'ur', audio_key: 'story/x/a02-ur.ogg', is_current: true, ms: 2000, provider: 'elevenlabs', voice: 'Bella', model: 'eleven_v4' });
    const out = await L.applyPlan(L.planBook({ ...f, voiceGate: true }), { store, upload: r.upload, env: 'sandbox' });
    expect([out.status, out.kept]).toEqual(['draft', []]);
  });

  test('off: planBook and applyPlan\'s writes match the recorded base loader over 15 books', async () => {
    const variants = { plain: {}, fast: { wpm: 160 }, slow_span: { pace: 190 }, no_voice: { voices: [] }, one_voice: { voices: [1] }, wer: { wer: 0.3 },
      drift: { drift: 400 }, mismatch: { mismatch: true }, no_band: { band: false }, watermark: { pageWatermark: true }, big_page: { bigPage: true },
      few_questions: { questionsReviewed: 2 }, grade2_long: { grade: 2, long: true }, grade3: { grade: 3, long: true, wpm: 120 }, grade4_natural: { grade: 4, long: true, wpm: 153 } };
    const got = {};
    for (const [name, o] of Object.entries(variants)) {
      for (const voiceGate of [undefined, false, null]) {
        const store = memoryStore(); const r = recorder();
        store.t.voices.set('old', { id: 'old', page_id: Store.uuidV5(BOOK_ID, 'p02'), lang: 'en', audio_key: 'story/x/a02-old.ogg', is_current: true, ms: 1900 });
        const plan = L.planBook({ ...fixture(o), voiceGate });
        const p = JSON.parse(JSON.stringify({ ...plan, files: plan.files.map((x) => [x.name, x.contentType, x.buf.length]) }));
        const out = await L.applyPlan(plan, { store, upload: r.upload, env: 'sandbox' });
        const books = [...store.t.books.values()].map((b) => ({ ...b, updated_at: 'T' }));
        const row = { plan: p, out, books, pages: [...store.t.pages.values()], voices: [...store.t.voices.values()], questions: [...store.t.questions.values()], up: r.up };
        // the whole plan and every write, pinned by a hash of the canonical JSON (keys sorted), plus the readable verdict
        const canon = (x) => (Array.isArray(x) ? `[${x.map(canon).join(',')}]` : x && typeof x === 'object' ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}` : JSON.stringify(x));
        const pin = { sha256: require('crypto').createHash('sha256').update(canon(row)).digest('hex'), status: out.status, why: plan.why, writes: { books: books.length, pages: row.pages.length, voices: row.voices.length, questions: row.questions.length, uploads: r.up.length } };
        if (voiceGate === undefined) got[name] = pin; else expect(pin).toEqual(got[name]);
      }
    }
    expect(got).toMatchSnapshot();
  });

  test('supabaseStore: the current voices carry their length, and questions that keep their audio are written apart', async () => {
    const calls = [];
    const q = (table) => {
      const b = {};
      ['select', 'upsert', 'eq', 'in'].forEach((m) => { b[m] = (...a) => { calls.push([table, m, ...a]); return b; }; });
      b.then = (res) => res({ data: [], error: null });
      return b;
    };
    const s = L.supabaseStore({ from: q });
    await s.currentVoices(['p']);
    expect(calls).toContainEqual(['story_page_voices', 'select', 'id, page_id, lang, audio_key, ms, provider, voice, model']);
    await s.upsertQuestions([{ id: 'a', n: 1, audio: { q: 'x' } }, { id: 'b', n: 2 }]);
    expect(calls.filter((c) => c[0] === 'story_questions' && c[1] === 'upsert').map((c) => c[2])).toEqual([[{ id: 'a', n: 1, audio: { q: 'x' } }], [{ id: 'b', n: 2 }]]);
  });
});
