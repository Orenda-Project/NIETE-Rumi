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
    upsertQuestions: async (rows) => rows.forEach((r) => t.questions.set(r.id, r)),
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

  test('a clip timed on other words than the page\'s (same count) is not voiced: a one-for-one spelling fix needs a new take', () => {
    const f = fixture();
    const vj = path.join(f.voiceDir, 'p02.json'); const j = JSON.parse(fs.readFileSync(vj, 'utf8'));
    j.words[1].t = 'cot'; fs.writeFileSync(vj, JSON.stringify(j));
    const p = L.planBook(f);
    expect(p.why).toEqual(['p02: voice words differ from the page words']);
    expect(p.ready).toBe(false);
    expect(p.voices.map((v) => v.n)).toEqual([1]);
    // the same word in another Unicode form (composed vs decomposed) is the same word
    const g = fixture();
    const gj = path.join(g.voiceDir, 'p01.json'); const k = JSON.parse(fs.readFileSync(gj, 'utf8'));
    g.book.pages[0].words[0].t = 'Asa\u0301d'; k.words[0].t = 'As\u00e1d';
    fs.writeFileSync(gj, JSON.stringify(k));
    expect(L.planBook(g).why).toEqual([]);
  });

  test('a printed spelling rides on its word as alt (strings, composed, no repeats, never the word itself); a word without one is unchanged', () => {
    const f = fixture();
    f.book.pages[0].words[2].alt = ['reeds', 'reeds', '', 7, 'reads.', ' re\u0301ads ', 'reads'];
    const p = L.planBook(f);
    expect(p.pages[0].words[2]).toEqual({ i: 2, t: 'reads.', box: [90, 800, 36, 40], alt: ['reeds', 'r\u00e9ads', 'reads'] });
    expect(p.pages[0].words[0]).toEqual({ i: 0, t: 'Asad', box: [10, 800, 36, 40] });
    expect(p.pages[1].words.every((w) => !('alt' in w))).toBe(true);
    expect(L.cleanWords([{ i: 0, t: 'a', alt: 'b' }, { i: 1, t: 'c', alt: [] }])).toEqual([{ i: 0, t: 'a' }, { i: 1, t: 'c' }]);
    expect(p.ready).toBe(true);
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
