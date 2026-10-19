'use strict';
/**
 * Dashboard/services/fln-corpus.service.js: the FLN bundle, loaded from the mirror, held in memory.
 * Network (global fetch) and app_settings (dashboard/config/supabase) are the only things mocked.
 */
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, VERSION } = require('./fixtures/fln-corpus.fixture');

const ENV = { ...process.env };
let settingValue; // app_settings.fln_corpus_version
let fetchMock;

function supabaseStub() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: settingValue === undefined ? null : { value: settingValue }, error: null }) }),
      }),
    }),
  };
}

const okBody = (obj, { gzip = false } = {}) => {
  const raw = Buffer.from(JSON.stringify(obj));
  const buf = gzip ? zlib.gzipSync(raw) : raw;
  return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

function load() {
  return require('../../dashboard/services/fln-corpus.service');
}

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  process.env = { ...ENV, FLN_CORPUS_BASE: 'https://cdn.example.test/fln/corpus' };
  delete process.env.FLN_CORPUS_FILE;
  delete process.env.FLN_CORPUS_VERSION;
  settingValue = VERSION;
  fetchMock = jest.fn(async () => okBody(build()));
  global.fetch = fetchMock;
  jest.doMock('../../dashboard/config/supabase', () => supabaseStub());
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
afterAll(() => { process.env = ENV; });

describe('load', () => {
  it('fetches <base>/<ver>/corpus.json with the version from app_settings, and is ready after', async () => {
    const C = load();
    expect(C.ready()).toBe(false);
    expect(await C.ensure()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://cdn.example.test/fln/corpus/${VERSION}/corpus.json`);
    expect(C.ready()).toBe(true);
  });

  it('falls back to FLN_CORPUS_VERSION, then CONTENT_R2_PUBLIC_URL for the base', async () => {
    settingValue = undefined;
    process.env.FLN_CORPUS_VERSION = VERSION;
    delete process.env.FLN_CORPUS_BASE;
    process.env.CONTENT_R2_PUBLIC_URL = 'https://content.example.test/';
    const C = load();
    expect(await C.ensure()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://content.example.test/fln/corpus/${VERSION}/corpus.json`);
  });

  it('gunzips a body that starts with 1f 8b', async () => {
    fetchMock.mockImplementation(async () => okBody(build(), { gzip: true }));
    const C = load();
    expect(await C.ensure()).toBe(true);
    expect(C.plan(900003).title).toBe('Sounds of q, x, z');
  });

  it('refuses a bundle whose embedded version is not the one asked for', async () => {
    fetchMock.mockImplementation(async () => okBody({ ...build(), version: 'v1-20990101-deadbeef' }));
    const C = load();
    expect(await C.ensure()).toBe(false);
    expect(C.ready()).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('no row and no env → the last-resort DEFAULT_VERSION v1, with a warning', async () => {
    settingValue = undefined;
    const C = load();
    expect(C.DEFAULT_VERSION).toBe('v1-20261018-786b5bff');
    await C.ensure();
    expect(fetchMock.mock.calls[0][0]).toBe('https://cdn.example.test/fln/corpus/v1-20261018-786b5bff/corpus.json');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('FLN corpus: using the code default version'), expect.anything());
  });

  it('a garbled version row is ignored for the default, never fetched as a path', async () => {
    settingValue = '../../etc/passwd';
    const C = load();
    await C.ensure();
    expect(fetchMock.mock.calls[0][0]).toBe('https://cdn.example.test/fln/corpus/v1-20261018-786b5bff/corpus.json');
    expect(console.warn).toHaveBeenCalled();
  });

  it('concurrent callers share ONE fetch', async () => {
    const C = load();
    const r = await Promise.all([C.ensure(), C.ensure(), C.ensure()]);
    expect(r).toEqual([true, true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a failed fetch is retried only after the backoff (5 s, then 30 s)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-10-18T10:00:00Z'));
    fetchMock.mockImplementation(async () => { throw new Error('down'); });
    const C = load();
    expect(await C.ensure()).toBe(false);
    expect(await C.ensure()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date('2026-10-18T10:00:06Z'));
    expect(await C.ensure()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.setSystemTime(new Date('2026-10-18T10:00:20Z'));
    expect(await C.ensure()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementation(async () => okBody(build()));
    jest.setSystemTime(new Date('2026-10-18T10:00:37Z'));
    expect(await C.ensure()).toBe(true);
  });

  it('a non-200 is a failure', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 429, arrayBuffer: async () => new ArrayBuffer(0) }));
    expect(await load().ensure()).toBe(false);
  });

  it('re-checks the version row after 5 min and swaps atomically when it changes', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-10-18T10:00:00Z'));
    const C = load();
    expect(await C.ensure()).toBe(true);
    const NEXT = 'v1-20261019-feedf00d';
    const next = build(); next.version = NEXT; next.plans['900003'].title = 'Sounds of q, x, z (fixed)';
    fetchMock.mockImplementation(async (url) => okBody(url.includes(NEXT) ? next : build()));
    settingValue = NEXT;
    jest.setSystemTime(new Date('2026-10-18T10:04:00Z'));
    await C.ensure();
    await C.__settledForTests();
    expect(fetchMock).toHaveBeenCalledTimes(1); // not due yet
    jest.setSystemTime(new Date('2026-10-18T10:05:30Z'));
    expect(await C.ensure()).toBe(true); // the old one keeps serving while the new one loads
    await C.__settledForTests();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(C.version()).toBe(NEXT);
    expect(C.plan(900003).title).toBe('Sounds of q, x, z (fixed)');
  });

  it('FLN_CORPUS_FILE loads from disk (dev/QA) without the network', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fln-'));
    const file = path.join(dir, 'corpus.json');
    fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(build()))));
    process.env.FLN_CORPUS_FILE = file;
    const C = load();
    expect(await C.ensure()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(C.version()).toBe(VERSION);
  });
});

describe('reads', () => {
  let C;
  beforeEach(() => { C = load(); C.__setForTests(build()); });

  it('isHidden = no core|additional row; unknown is hidden too', () => {
    expect(C.isHidden(900003)).toBe(false);
    expect(C.isHidden('900006')).toBe(false); // additional is served
    expect(C.isHidden(900007)).toBe(true); // shelf hidden
    expect(C.isHidden(123)).toBe(true);
    expect(C.plan(123)).toBe(null);
  });

  it('subjectOf', () => {
    expect(C.subjectOf('rh-ur')).toEqual({ key: 'rh-ur', name_en: 'Reading Hour · Urdu', name_ur: 'ریڈنگ آور — اردو', lang: 'ur', dir: 'rtl' });
    expect(C.subjectOf('art')).toBe(null);
  });

  it('placementOf: every served row with the level grades, pos and count', () => {
    expect(C.placementOf(900003)).toEqual([{
      subject: 'rh-en', level: 1, grades: [1], grade: 1, strand: 'daily', chapter_title_en: 'Sounds', chapter_title_ur: null, pos: 2, count: 5, label: null,
    }]);
    expect(C.placementOf(900008)[0]).toMatchObject({ level: 2, grades: [2, 3], count: 40 });
    expect(C.placementOf(900007)).toEqual([]);
  });

  it('grade 1 RH-EN: level 1, guide first unnumbered, screener note, hidden absent, counts from placement', () => {
    const cat = C.catalogue({ grade: 1, subject: 'rh-en' });
    expect(cat.subject.key).toBe('rh-en');
    expect(cat.grade).toBe(1);
    expect(cat.level).toBe(1);
    expect(cat.strands.map((s) => s.strand)).toEqual(['daily']);
    const ch = cat.strands[0].chapters;
    expect(ch.map((c) => c.chapter_no)).toEqual([1, 2, 3]);
    const rows = ch.flatMap((c) => c.plans);
    expect(rows.map((r) => r.id)).toEqual([900001, 900002, 900003, 900004, 900005, 900006]);
    expect(rows[0]).toMatchObject({ label: 'guide', pos: 0, chips: expect.objectContaining({ guide: true }) });
    expect(rows[1]).toMatchObject({ label: 'screener', minutes: 53, note_en: 'Ask each learner to read the row aloud.', chips: expect.objectContaining({ screener: true }) });
    expect(rows[2]).toEqual({
      id: 900003, title: 'Sounds of q, x, z', lang: 'en', dir: 'ltr', minutes: 30,
      chips: { sounds: 3, words: 2, narration: true, video: false, textbook: false, additional: false, screener: false, guide: false },
      opened: false, pos: 2, count: 5, label: null, note_en: null, note_ur: null,
    });
    expect(rows[4].chips.textbook).toBe(true);
    expect(rows[5].chips.additional).toBe(true);
    expect(ch[1]).toMatchObject({ title_en: 'Sounds', title_ur: null });
  });

  it('grades 2-3 are level 2, 4-5 level 3', () => {
    expect(C.catalogue({ grade: 3, subject: 'rh-en' }).level).toBe(2);
    expect(C.catalogue({ grade: 5, subject: 'rh-en' }).level).toBe(3);
    expect(C.catalogue({ grade: 3, subject: 'rh-en' }).strands[0].chapters[0].plans[0]).toMatchObject({ id: 900008, count: 40 });
  });

  it('NUM grade 2: daily before extended', () => {
    const cat = C.catalogue({ grade: 2, subject: 'num' });
    expect(cat.strands.map((s) => s.strand)).toEqual(['daily', 'extended']);
  });

  it('G8 without level: level null, no strands, the levels with the screener first-class', () => {
    const cat = C.catalogue({ grade: 8, subject: 'rh-en' });
    expect(cat.level).toBe(null);
    expect(cat.strands).toEqual([]);
    expect(cat.levels.map((l) => l.level)).toEqual([1, 2, 3]);
    expect(cat.levels[0]).toMatchObject({
      grades: [1], screener_id: 900002, screener_minutes: 53, count: 5,
      note_en: 'Ask each learner to read the row aloud.', note_ur: 'ہر بچے سے قطار پڑھوائیں۔',
    });
    expect(cat.levels[1]).toMatchObject({ screener_id: null, count: 40 });
  });

  it('G8 level=3 → the grade-5 rows; level=1 → grade 1 with the screener before the lessons', () => {
    const l3 = C.catalogue({ grade: 8, subject: 'rh-en', level: 3 });
    expect(l3.level).toBe(3);
    expect(l3.strands[0].chapters[0].plans.map((r) => r.id)).toEqual([900009]);
    const l1 = C.catalogue({ grade: 8, subject: 'rh-en', level: 1 });
    expect(l1.strands[0].chapters[0].plans.map((r) => r.label)).toEqual(['guide', 'screener']);
  });

  it('opened marks rows from the given set', () => {
    const cat = C.catalogue({ grade: 1, subject: 'rh-ur', opened: new Set(['900010']) });
    expect(cat.strands[0].chapters[0].plans[0]).toMatchObject({ id: 900010, opened: true, lang: 'ur', dir: 'rtl', title: 'حروف کی مشق ۲ اور 3' });
  });

  it('levels: screener_audio says whether the screener has any audio (the answer-key chip promises it)', () => {
    expect(C.levels('rh-en')[0]).toMatchObject({ screener_id: 900002, screener_audio: true });
    const b = build();
    const r = b.placement.find((x) => x.lp_id === 900002);
    r.audio = { sounds: 0, words: 0, narration: false, video: false };
    C.__setForTests(b);
    expect(C.levels('rh-en')[0]).toMatchObject({ screener_id: 900002, screener_audio: false });
    expect(C.catalogue({ grade: 8, subject: 'rh-en' }).levels[0].screener_audio).toBe(false);
  });

  it('kickerFor(placementRow, lang): subject kicker + level, EN with ·, UR with — and Urdu digits', () => {
    const p = C.placementOf(900003)[0];
    expect(C.kickerFor(p, 'en')).toBe('Reading Hour · English · Level 1');
    expect(C.kickerFor(p, 'ur')).toBe('ریڈنگ آور — انگریزی — سطح ۱');
    expect(C.kickerFor({ subject: 'num', level: 2 }, 'ur')).toBe('بنیادی حساب — سطح ۲');
    expect(C.kickerFor({ subject: 'num', level: null }, 'en')).toBe('Numeracy');
    expect(C.kickerFor(null, 'en')).toBe('');
  });

  it('a placement row without `audio` takes its chips from the plan (audio_summary, else the media by role)', () => {
    const b = build();
    for (const r of b.placement) delete r.audio;
    delete b.plans['900010'].audio_summary; // Urdu plan: one sound clip in its media, no summary
    b.plans['900010'].videos = [{ kind: 'video', src: 'https://media.example.test/v.mp4' }];
    b.plans['900010'].sections[0].groups[0].items[0].media.push(
      { kind: 'audio', src: 'https://media.example.test/w.mp3', role: 'word' },
      { kind: 'audio', src: 'https://media.example.test/n.mp3', role: 'narration' },
    );
    C.__setForTests(b);
    const en = C.catalogue({ grade: 1, subject: 'rh-en' }).strands[0].chapters[1].plans[0];
    expect(en.chips).toMatchObject({ sounds: 1, words: 0, narration: false, video: false });
    const ur = C.catalogue({ grade: 1, subject: 'rh-ur' }).strands[0].chapters[0].plans[0];
    expect(ur.chips).toMatchObject({ sounds: 1, words: 1, narration: true, video: true });
  });

  it('levels without count/minutes in the bundle are computed', () => {
    const b = build();
    for (const r of b.placement) delete r.count;
    C.__setForTests(b);
    const lv = C.levels('rh-en');
    expect(lv.map((l) => l.count)).toEqual([5, 1, 1]);
    expect(lv[0].screener_minutes).toBe(53);
  });

  it('placementOf: a lesson placed in two grades of one level → one row per grade, each with its own grade, pos and count', () => {
    const b = build();
    const g3 = b.placement.find((r) => r.lp_id === 900008);
    b.placement.unshift({ ...g3, grade: 2, pos: 2, count: 38 });
    C.__setForTests(b);
    const rows = C.placementOf(900008);
    expect(rows.map((r) => [r.grade, r.pos, r.count])).toEqual([[2, 2, 38], [3, 1, 40]]);
    expect(rows[0]).toMatchObject({ level: 2, grades: [2, 3] });
  });

  it('levels(subject)', () => {
    expect(C.levels('num').map((l) => l.level)).toEqual([2]);
  });

  it('__resetForTests unloads', () => {
    C.__resetForTests();
    expect(C.ready()).toBe(false);
  });
});

// Optional smoke test against a full dev bundle on the developer's machine (never in the repo, never in CI):
//   FLN_DEV_CORPUS=<path to a corpus.json-shaped file> node tests/run.js tests/portal/fln-corpus.test.js
const DEV = process.env.FLN_DEV_CORPUS;
(DEV && fs.existsSync(DEV) ? describe : describe.skip)('smoke: FLN_DEV_CORPUS via FLN_CORPUS_FILE', () => {
  it('loads (version check relaxed for a local file) and answers every subject x grade', async () => {
    process.env.FLN_CORPUS_FILE = DEV;
    settingValue = undefined;
    const C = load();
    expect(await C.ensure()).toBe(true);
    let rows = 0;
    for (const subject of ['rh-en', 'rh-ur', 'num']) {
      for (let grade = 1; grade <= 12; grade += 1) {
        const cat = C.catalogue({ grade, subject });
        if (grade <= 5) {
          const plans = cat.strands.flatMap((s) => s.chapters.flatMap((c) => c.plans));
          expect(plans.length).toBeGreaterThan(0);
          for (const r of plans) {
            expect(C.isHidden(r.id)).toBe(false);
            expect(typeof r.minutes).toBe('number');
            expect(r.count).toBeGreaterThan(0);
          }
          rows += plans.length;
        } else {
          expect(cat.strands).toEqual([]);
          expect(cat.levels.length).toBeGreaterThan(0);
          for (const l of cat.levels) {
            const lv = C.catalogue({ grade, subject, level: l.level });
            expect(lv.strands.length).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(rows).toBeGreaterThan(100);
    // eslint-disable-next-line no-console
    process.stdout.write(`\n[fln smoke] version=${C.version()} served rows grades 1-5=${rows}\n`);
  });
});
