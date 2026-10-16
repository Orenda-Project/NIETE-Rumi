'use strict';
/**
 * The Challenge's clip warm job (web-quiz-challenge-clip-warm.js), behind app_settings `web_quiz_challenge_clip_warm`
 * (parent `web_quiz_challenge_v2`, whose parent is `web_quiz_challenge`; all off by default): once a Pakistan day and
 * on the first sweep tick after boot, every released passage and every passage released in the next 7 days has its
 * clips recorded by the serve's own keys and recorder, so no child meets silence on the first tap after a deploy.
 * Faked boundaries only (Supabase, R2, TTS, the LLM client); the service, the item bank and the queue service's tick run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key) => `https://signed.test/${key}`),
  listKeys: jest.fn(async () => []),
  deleteKey: jest.fn(async () => true),
  deleteAudio: jest.fn(async () => true),
  getPresignedUploadUrl: jest.fn(),
  getPresignedUrl: jest.fn(),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  downloadFromR2: jest.fn(),
}));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 1 })) }));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../../shared/services/gpt5-mini.service', () => ({ analyzePedagogy: jest.fn(), extractReflectiveCorpus: jest.fn() }));
jest.mock('@anthropic-ai/sdk', () => {
  class Anthropic { constructor() { this.messages = { create: jest.fn() }; } }
  Anthropic.default = Anthropic;
  Anthropic.APIError = class APIError extends Error {};
  return Anthropic;
}, { virtual: true });
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const tts = require('../../../shared/services/tts');
const { logEvent } = require('../../../shared/utils/structured-logger');
const { logToFile } = require('../../../shared/utils/logger');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const CW = require('../../../shared/services/quiz/web-quiz-challenge-clip-warm');

const NOW = Date.parse('2026-10-16T06:00:00Z');
const DAY = 24 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const ON = [
  { key: 'web_quiz_challenge', value: true },
  { key: 'web_quiz_challenge_v2', value: true },
  { key: 'web_quiz_challenge_clip_warm', value: true },
  { key: 'web_quiz_challenge_option_audio', value: true },
];
const row = (id, lang, kind, releasedAt) => ({ passage_id: id, lang, kind, pool: 'check', band: 2, status: 'calibrated', released_at: releasedAt, withdrawn_at: null });
const STOCK = [
  row('en.read.2.setA', 'en', 'read', iso(NOW - 30 * DAY)),
  row('en.listen.2.setA', 'en', 'listen', iso(NOW - DAY)),
  row('ur.listen.2.setA', 'ur', 'listen', iso(NOW + 3 * DAY)),   // next week: warmed before its release
  row('ur.read.2.setA', 'ur', 'read', iso(NOW + 30 * DAY)),      // far: not yet
];

// The four Set A pointers, as the shipped stock writes them.
let dir;
const pointer = (id, lang, kind, v3kind) => ({ passage_id: id, lang, kind, band: 2, pool: 'check', is_reference: true, v3_ref: { lang, kind: v3kind }, questions_extra: [], bank_version: 'child-test-items-v3' });
beforeAll(() => {
  process.env.R2_BUCKET_NAME = 'r2-default';
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenge-clip-warm-'));
  for (const p of [pointer('en.read.2.setA', 'en', 'read', 'story'), pointer('en.listen.2.setA', 'en', 'listen', 'listening'),
    pointer('ur.read.2.setA', 'ur', 'read', 'story'), pointer('ur.listen.2.setA', 'ur', 'listen', 'listening')]) {
    fs.writeFileSync(path.join(dir, `${p.passage_id}.json`), JSON.stringify(p));
  }
  Bank._loadPassagesFrom(dir);
});
afterAll(() => { Bank._loadPassagesFrom(); fs.rmSync(dir, { recursive: true, force: true }); });

let db;
beforeEach(() => {
  db = { app_settings: [...ON], challenge_passages: STOCK.map((r) => ({ ...r })) };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  CW.__reset();
  jest.clearAllMocks();
});

const warmEvents = () => logEvent.mock.calls.filter(([name]) => name === 'web_quiz.ch_clip_warm');
const passageReads = () => supabase.calls.filter((c) => c.table === 'challenge_passages');
const spoken = () => tts.synthesize.mock.calls.map(([a]) => a.text);

// What the serve asks for, passage by passage, with the keys it reads them under (web-quiz-challenge.js: storyClip
// clipKey('listen','story'), questions/listenQuestions clipKey(ex, qN) and clipKey('listen', 'qN-opt') under option audio).
function served(id) {
  const p = Bank.getPassage(id);
  const out = [];
  if (p.kind === 'listen') out.push({ key: Ch.clipKey('listen', 'story', p.lang, p.text), text: p.text });
  for (const q of p.questions) {
    const t = Ch.tapOptions(q, p.lang, 'any-run');
    if (!t) continue;
    const k = q.id.split('.').pop();
    out.push({ key: Ch.clipKey(p.kind, k, p.lang, q.prompt), text: q.prompt });
    if (p.kind === 'listen') t.options.forEach((o) => out.push({ key: Ch.clipKey('listen', `${k}-opt`, p.lang, o), text: o }));
  }
  return out;
}

// n cold listen passages (story only), all released: n clips the store does not have.
const coldStock = (n) => {
  const many = fs.mkdtempSync(path.join(os.tmpdir(), 'challenge-clip-warm-cap-'));
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const id = `en.listen.1.cap${String(i).padStart(3, '0')}`;
    ids.push(id);
    fs.writeFileSync(path.join(many, `${id}.json`), JSON.stringify({ passage_id: id, lang: 'en', kind: 'listen', band: 1, pool: 'check', text: `Story number ${i} for the cap.`, questions: [], bank_version: 'child-test-items-v4' }));
  }
  Bank._loadPassagesFrom(many);
  db.challenge_passages = ids.map((id) => row(id, 'en', 'listen', iso(NOW - DAY)));
  return () => { Bank._loadPassagesFrom(dir); fs.rmSync(many, { recursive: true, force: true }); };
};

describe('the switch and its parents', () => {
  test('switch off: nothing read, nothing recorded, no event', async () => {
    db.app_settings = ON.filter((s) => s.key !== 'web_quiz_challenge_clip_warm');
    expect(await CW.warmClips({ now: NOW })).toBeNull();
    expect(passageReads()).toEqual([]);
    expect(r2.headObject).not.toHaveBeenCalled();
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
    expect(warmEvents()).toEqual([]);
  });

  test('_v2 off with _clip_warm on: nothing (the parent rule); the same with the Challenge itself off', async () => {
    db.app_settings = ON.filter((s) => s.key !== 'web_quiz_challenge_v2');
    expect(await CW.warmClips({ now: NOW })).toBeNull();
    Ch.__reset();
    db.app_settings = ON.filter((s) => s.key !== 'web_quiz_challenge');
    expect(await CW.warmClips({ now: NOW })).toBeNull();
    expect(passageReads()).toEqual([]);
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(warmEvents()).toEqual([]);
  });
});

describe('a run', () => {
  test('on: the released passages and next week\'s are warmed by the serve\'s keys, the far one is not; one event', async () => {
    const want = [...served('en.read.2.setA'), ...served('en.listen.2.setA'), ...served('ur.listen.2.setA')];
    const keys = new Set(want.map((c) => c.key));
    const far = served('ur.read.2.setA');
    expect(keys.size).toBeGreaterThan(10);
    const out = await CW.warmClips({ now: NOW });
    expect(out).toMatchObject({ n: keys.size, missing: 0, recorded: keys.size, capped: false, passages: 3 });
    // every upload went to a key the serve reads, each once, and the voice said exactly the served texts
    expect(new Set(r2.uploadBuffer.mock.calls.map((c) => c[1]))).toEqual(keys);
    expect(r2.uploadBuffer).toHaveBeenCalledTimes(keys.size);
    expect(new Set(spoken())).toEqual(new Set(want.map((c) => c.text)));
    for (const c of far) expect(r2.uploadBuffer.mock.calls.map((x) => x[1])).not.toContain(c.key);
    expect(warmEvents()).toEqual([['web_quiz.ch_clip_warm', { n: keys.size, missing: 0, missing_listen: 0, missing_story: 0, w: 's' }]]);
    // each recording is the serve's own: one ch_clip_recorded per clip
    expect(logEvent.mock.calls.filter(([name]) => name === 'web_quiz.ch_clip_recorded')).toHaveLength(keys.size);
  });

  test('a clip the store already has is not recorded again; a second run records nothing and asks the store nothing', async () => {
    const enStory = Bank.getPassage('en.listen.2.setA').text;
    const had = Ch.clipKey('listen', 'story', 'en', enStory);
    r2.headObject.mockImplementation(async (key) => ({ exists: key === had }));
    const first = await CW.warmClips({ now: NOW });
    expect(spoken()).not.toContain(enStory);
    expect(r2.uploadBuffer.mock.calls.map((c) => c[1])).not.toContain(had);
    expect(first.missing).toBe(0);
    jest.clearAllMocks();
    const second = await CW.warmClips({ now: NOW });
    expect(second).toMatchObject({ n: first.n, missing: 0 });
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(r2.headObject).not.toHaveBeenCalled();
    expect(warmEvents()).toEqual([['web_quiz.ch_clip_warm', { n: first.n, missing: 0, missing_listen: 0, missing_story: 0, w: 's' }]]);
  });

  test('a withdrawn or retired passage is not warmed', async () => {
    db.challenge_passages = [
      { ...STOCK[1], withdrawn_at: iso(NOW - DAY) },
      { ...STOCK[0], status: 'retired' },
    ];
    expect(await CW.warmClips({ now: NOW })).toMatchObject({ n: 0, missing: 0 });
    expect(tts.synthesize).not.toHaveBeenCalled();
  });

  test('its own allowance: 200 cold clips under the shared cap of 128 → 96 recorded, 104 missing, a serve headroom of 32 left', async () => {
    expect(Ch.MAX_CLIP_RECORDINGS).toBe(128);
    expect(CW.WARM_MAX_PER_RUN).toBe(96);
    const done = coldStock(200);
    try {
      const out = await CW.warmClips({ now: NOW });
      expect(tts.synthesize).toHaveBeenCalledTimes(96);
      expect(out).toMatchObject({ n: 200, missing: 104, recorded: 96, capped: true });
      expect(warmEvents()).toEqual([['web_quiz.ch_clip_warm', { n: 200, missing: 104, missing_listen: 104, missing_story: 0, w: 's' }]]);   // every clip here is a check-pool listening story
      // the rest were asked of the store, never recorded
      expect(r2.headObject).toHaveBeenCalledTimes(200);
      expect(Ch.clipsLeft()).toBeGreaterThanOrEqual(CW.SERVE_HEADROOM);
    } finally { done(); }
  });

  test('the serve headroom: with the shared counter already at 100 (28 left ≤ 32) the warm records nothing; all missing', async () => {
    // 100 recordings by the shared recorder (as a child's first serves would spend them)
    for (let i = 0; i < 100; i += 1) await Ch.warmClip(`quiz-audio/x/challenge/en/listen/pre-${i}.ogg`, `Line ${i}`, 'en');
    expect(Ch.clipsLeft()).toBe(28);
    tts.synthesize.mockClear();
    const done = coldStock(10);
    try {
      const out = await CW.warmClips({ now: NOW });
      expect(tts.synthesize).not.toHaveBeenCalled();
      expect(out).toMatchObject({ n: 10, missing: 10, recorded: 0, capped: true });
      expect(Ch.clipsLeft()).toBe(28);
    } finally { done(); }
  });
});

describe('the order: check-pool listening clips first (the story, then its questions), then every other clip', () => {
  // A stock whose RELEASE order puts a read passage first and a practice listening story before the check-pool listening
  // passage: the warm must still record the check-pool listening story first (the one clip a child cannot play the stop
  // without), then that passage's prompts and options, and only then the read prompts and the practice story.
  let restore;
  const PRACTICE_STORY = 'A practice story for the shelf, never counted.';
  beforeEach(() => {
    r2.headObject.mockImplementation(async () => ({ exists: false }));   // a cold store (an earlier test leaves a per-key implementation behind)
    const many = fs.mkdtempSync(path.join(os.tmpdir(), 'challenge-clip-warm-order-'));
    for (const p of [pointer('en.read.2.setA', 'en', 'read', 'story'), pointer('en.listen.2.setA', 'en', 'listen', 'listening')]) {
      fs.writeFileSync(path.join(many, `${p.passage_id}.json`), JSON.stringify(p));
    }
    fs.writeFileSync(path.join(many, 'en.listen.1.story01.json'), JSON.stringify({ passage_id: 'en.listen.1.story01', lang: 'en', kind: 'listen', band: 1, pool: 'practice', text: PRACTICE_STORY, questions: [], bank_version: 'child-test-items-v4' }));
    Bank._loadPassagesFrom(many);
    db.challenge_passages = [
      row('en.read.2.setA', 'en', 'read', iso(NOW - 30 * DAY)),                                   // released first
      { ...row('en.listen.1.story01', 'en', 'listen', iso(NOW - 10 * DAY)), pool: 'practice' },  // a practice story, released second
      row('en.listen.2.setA', 'en', 'listen', iso(NOW - DAY)),                                    // the check-pool listening passage, released last
    ];
    restore = () => { Bank._loadPassagesFrom(dir); fs.rmSync(many, { recursive: true, force: true }); };
  });
  afterEach(() => restore());

  test('the check-pool listening story is recorded first, its prompts and options next, the read prompts and the practice story after', async () => {
    const listen = served('en.listen.2.setA');
    const read = served('en.read.2.setA');
    const out = await CW.warmClips({ now: NOW });
    expect(out).toMatchObject({ missing: 0, passages: 3, n: listen.length + read.length + 1 });
    const order = spoken();
    expect(order[0]).toBe(Bank.getPassage('en.listen.2.setA').text);
    const lastListen = Math.max(...listen.map((c) => order.indexOf(c.text)));
    const firstOther = Math.min(...read.map((c) => order.indexOf(c.text)), order.indexOf(PRACTICE_STORY));
    expect(lastListen).toBeLessThan(firstOther);
  });

  test('under the cap only the check-pool listening clips are recorded: with room for two recordings, the story and its first prompt; the read clips are the missing ones', async () => {
    // the shared recorder has 34 left (two above the serve headroom of 32)
    for (let i = 0; i < Ch.MAX_CLIP_RECORDINGS - CW.SERVE_HEADROOM - 2; i += 1) await Ch.warmClip(`quiz-audio/x/challenge/en/listen/pre-${i}.ogg`, `Line ${i}`, 'en');
    expect(Ch.clipsLeft()).toBe(CW.SERVE_HEADROOM + 2);
    tts.synthesize.mockClear();
    const listen = served('en.listen.2.setA');
    const read = served('en.read.2.setA');
    const out = await CW.warmClips({ now: NOW });
    expect(tts.synthesize).toHaveBeenCalledTimes(2);
    expect(spoken()).toEqual([listen[0].text, listen[1].text]);
    expect(out).toMatchObject({ recorded: 2, capped: true, missing: listen.length + read.length + 1 - 2 });
    for (const c of read) expect(spoken()).not.toContain(c.text);
    expect(spoken()).not.toContain(PRACTICE_STORY);
  });
});

describe('the story read-along: a released practice story\'s clip is warmed, Urdu first, before any read prompt', () => {
  // Story Time serves a practice READ story with a read-along clip (web-quiz-challenge.js readAlongClip,
  // clipKey('read', 'story', lang, text)); the page offers "hear it from me" only once that clip exists, so the warm
  // records it ahead of the first child who opens the story in each language.
  const EN_STORY = 'Ali found a small red kite by the river and ran home to show his sister.';
  const UR_STORY = 'علی نے دریا کے کنارے پتنگ دیکھی';
  const story = (id, lang, text) => ({ passage_id: id, lang, kind: 'read', band: 1, pool: 'practice', text, questions: [], bank_version: 'child-test-items-v4' });
  const practiceRow = (id, lang, releasedAt) => ({ ...row(id, lang, 'read', releasedAt), band: 1, pool: 'practice', status: 'reviewed' });
  const storyKey = (lang, text) => Ch.clipKey('read', 'story', lang, text);
  const asked = () => r2.headObject.mock.calls.map(([key]) => key);
  let restore;
  const load = (files) => {
    const many = fs.mkdtempSync(path.join(os.tmpdir(), 'challenge-clip-warm-story-'));
    for (const p of files) fs.writeFileSync(path.join(many, `${p.passage_id}.json`), JSON.stringify(p));
    Bank._loadPassagesFrom(many);
    restore = () => { Bank._loadPassagesFrom(dir); fs.rmSync(many, { recursive: true, force: true }); };
  };
  // room for exactly `n` recordings: the shared recorder pre-filled to n above the serve headroom
  const roomFor = async (n) => {
    for (let i = 0; i < Ch.MAX_CLIP_RECORDINGS - CW.SERVE_HEADROOM - n; i += 1) await Ch.warmClip(`quiz-audio/x/challenge/en/listen/pre-${i}.ogg`, `Line ${i}`, 'en');
    expect(Ch.clipsLeft()).toBe(CW.SERVE_HEADROOM + n);
    tts.synthesize.mockClear();
    r2.uploadBuffer.mockClear();
    r2.headObject.mockClear();
  };
  // a check-pool listening passage released first, a check-pool read passage, an EN story released second, a UR story released last
  const mixed = () => {
    load([pointer('en.listen.2.setA', 'en', 'listen', 'listening'), pointer('en.read.2.setA', 'en', 'read', 'story'),
      story('en.read.1.story01', 'en', EN_STORY), story('ur.read.1.story01', 'ur', UR_STORY)]);
    db.challenge_passages = [
      row('en.listen.2.setA', 'en', 'listen', iso(NOW - 30 * DAY)),
      row('en.read.2.setA', 'en', 'read', iso(NOW - 20 * DAY)),
      practiceRow('en.read.1.story01', 'en', iso(NOW - 10 * DAY)),
      practiceRow('ur.read.1.story01', 'ur', iso(NOW - DAY)),
    ];
  };
  beforeEach(() => { r2.headObject.mockImplementation(async () => ({ exists: false })); restore = null; });   // a cold store
  afterEach(() => { if (restore) restore(); });

  test('a released story with no clip → the warm records its read-along clip (the key the serve reads)', async () => {
    load([pointer('en.read.2.setA', 'en', 'read', 'story'), pointer('en.listen.2.setA', 'en', 'listen', 'listening'), story('en.read.1.story01', 'en', EN_STORY)]);
    db.challenge_passages = [
      row('en.read.2.setA', 'en', 'read', iso(NOW - 30 * DAY)),
      row('en.listen.2.setA', 'en', 'listen', iso(NOW - DAY)),
      practiceRow('en.read.1.story01', 'en', iso(NOW - 10 * DAY)),
    ];
    const out = await CW.warmClips({ now: NOW });
    expect(spoken()).toContain(EN_STORY);
    expect(r2.uploadBuffer.mock.calls.map((c) => c[1])).toContain(storyKey('en', EN_STORY));
    expect(asked()).toContain(storyKey('en', EN_STORY));
    expect(out).toMatchObject({ missing: 0, missing_story: 0, passages: 3 });
    expect(warmEvents()).toEqual([['web_quiz.ch_clip_warm', { n: out.n, missing: 0, missing_listen: 0, missing_story: 0, w: 's' }]]);
  });

  test('under the cap, the UR story\'s clip is recorded before any read prompt and before the EN story', async () => {
    mixed();
    const listen = served('en.listen.2.setA');
    const read = served('en.read.2.setA');
    expect(read.length).toBeGreaterThan(0);
    await roomFor(listen.length + 2);
    const out = await CW.warmClips({ now: NOW });
    // the counted listening clips first (the options' order is per run, so as a set), then the UR story, then the EN story
    expect(spoken()).toHaveLength(listen.length + 2);
    expect(new Set(spoken().slice(0, listen.length))).toEqual(new Set(listen.map((c) => c.text)));
    expect(spoken().slice(listen.length)).toEqual([UR_STORY, EN_STORY]);
    expect(r2.uploadBuffer.mock.calls.slice(-2).map((c) => c[1])).toEqual([storyKey('ur', UR_STORY), storyKey('en', EN_STORY)]);
    for (const c of read) expect(spoken()).not.toContain(c.text);
    expect(out).toMatchObject({ recorded: listen.length + 2, capped: true, missing: read.length, missing_listen: 0, missing_story: 0 });
  });

  test('a cold story under the cap counts in missing_story; a check-pool read passage gets no read-along clip', async () => {
    mixed();
    const listen = served('en.listen.2.setA');
    const read = served('en.read.2.setA');
    await roomFor(listen.length);
    const out = await CW.warmClips({ now: NOW });
    expect(spoken()).toHaveLength(listen.length);
    expect(new Set(spoken())).toEqual(new Set(listen.map((c) => c.text)));
    expect(out).toMatchObject({ recorded: listen.length, capped: true, missing: read.length + 2, missing_listen: 0, missing_story: 2 });
    expect(warmEvents()).toEqual([['web_quiz.ch_clip_warm', { n: listen.length + read.length + 2, missing: read.length + 2, missing_listen: 0, missing_story: 2, w: 's' }]]);
    restore();
    // a check-pool read passage alone: its prompts are warmed, its text never as a read-along clip
    load([pointer('en.read.2.setA', 'en', 'read', 'story')]);
    db.challenge_passages = [row('en.read.2.setA', 'en', 'read', iso(NOW - 30 * DAY))];
    Ch.__reset();
    jest.clearAllMocks();
    r2.headObject.mockImplementation(async () => ({ exists: false }));
    const text = Bank.getPassage('en.read.2.setA').text;
    expect(typeof text).toBe('string');
    const alone = await CW.warmClips({ now: NOW });
    expect(alone).toMatchObject({ n: read.length, missing: 0, missing_story: 0 });
    expect(asked()).not.toContain(storyKey('en', text));
    expect(asked().filter((k) => k.includes('/read/story-'))).toEqual([]);
    expect(spoken()).not.toContain(text);
  });

  test('a reserve story gets no read-along clip; the shelf\'s story beside it does', async () => {
    const RESERVE = 'A reserve story the shelf never lists, kept back for later.';
    load([story('en.read.1.story01', 'en', EN_STORY), story('en.read.1.reserve01', 'en', RESERVE)]);
    db.challenge_passages = [practiceRow('en.read.1.story01', 'en', iso(NOW - 10 * DAY)), practiceRow('en.read.1.reserve01', 'en', iso(NOW - 10 * DAY))];
    const out = await CW.warmClips({ now: NOW });
    expect(asked()).toContain(storyKey('en', EN_STORY));
    expect(asked()).not.toContain(storyKey('en', RESERVE));
    expect(spoken()).toEqual([EN_STORY]);
    expect(out).toMatchObject({ n: 1, missing: 0, missing_story: 0, passages: 2 });
  });
});

describe('the daily guard (capped runs re-arm the hour, bounded)', () => {
  const HOUR = 3600 * 1000;
  beforeEach(() => r2.headObject.mockImplementation(async () => ({ exists: false })));   // a cold store

  test('a capped run that recorded clips does not close the day: the next tick that Pakistan day warms again', async () => {
    const done = coldStock(200);
    try {
      const first = await CW.daily({ now: NOW });
      expect(first).toMatchObject({ capped: true, recorded: 96 });
      const second = await CW.daily({ now: NOW + HOUR });
      expect(second).not.toBeNull();
      expect(second).toMatchObject({ n: 200, capped: true });
      expect(warmEvents()).toHaveLength(2);
    } finally { done(); }
  });

  test('a capped run that recorded nothing closes the day at once; the next Pakistan day runs', async () => {
    // the shared recorder at 28 left (≤ the serve headroom of 32): the warm can record nothing
    for (let i = 0; i < 100; i += 1) await Ch.warmClip(`quiz-audio/x/challenge/en/listen/pre-${i}.ogg`, `Line ${i}`, 'en');
    const done = coldStock(10);
    try {
      expect(await CW.daily({ now: NOW })).toMatchObject({ capped: true, recorded: 0, missing: 10 });
      expect(await CW.daily({ now: NOW + HOUR })).toBeNull();
      expect(warmEvents()).toHaveLength(1);
      // the next Pakistan day the shared allowance is back (the recorder's allowance returns each Pakistan day): the ten clips record
      expect(await CW.daily({ now: NOW + DAY })).toMatchObject({ capped: false, recorded: 10, missing: 0 });
      expect(warmEvents()).toHaveLength(2);
    } finally { done(); }
  });

  test('at most 8 capped runs a Pakistan day: the 9th tick that day does nothing; the next day runs', async () => {
    const done = coldStock(100);
    try {
      for (let i = 0; i < 8; i += 1) {
        Ch.__reset();   // the shared recorder's allowance given back between ticks, so every run records and is capped
        const out = await CW.daily({ now: NOW + i * HOUR });
        expect(out).toMatchObject({ capped: true, recorded: 96 });
      }
      Ch.__reset();
      expect(await CW.daily({ now: NOW + 8 * HOUR })).toBeNull();
      expect(warmEvents()).toHaveLength(8);
      Ch.__reset();
      expect(await CW.daily({ now: NOW + DAY })).toMatchObject({ capped: true, recorded: 96 });
      expect(warmEvents()).toHaveLength(9);
    } finally { done(); }
  });

  test('the recorder\'s allowance returns at the next Pakistan day: a run that spent it (96 recorded, 32 left) records again the next day, never the same day', async () => {
    // the aim on a long-lived process (the recorder's allowance returns each Pakistan day): without a daily return of the shared allowance a capped run can only ever re-arm into
    // a run that records nothing (28 left ≤ the serve headroom) — a 350-clip stock would wait for a redeploy, not for the next tick.
    const done = coldStock(200);
    try {
      expect(await CW.daily({ now: NOW })).toMatchObject({ capped: true, recorded: 96 });
      expect(Ch.clipsLeft()).toBe(Ch.MAX_CLIP_RECORDINGS - 96);
      // the same day: the re-armed tick runs, records nothing (the allowance is spent) and closes the day
      expect(await CW.daily({ now: NOW + HOUR })).toMatchObject({ capped: true, recorded: 0 });
      expect(await CW.daily({ now: NOW + 2 * HOUR })).toBeNull();
      // the next Pakistan day: the allowance is back, the warm records again
      expect(Ch.clipsLeft()).toBe(Ch.MAX_CLIP_RECORDINGS - 96);
      const next = await CW.daily({ now: NOW + DAY });
      expect(next).toMatchObject({ capped: true, recorded: 96 });
      expect(warmEvents()).toHaveLength(3);
    } finally { done(); }
  });

  test('an uncapped run closes the day: the second call that Pakistan day is null (today\'s rule)', async () => {
    expect(await CW.daily({ now: NOW })).toMatchObject({ capped: false, missing: 0 });
    expect(await CW.daily({ now: NOW + HOUR })).toBeNull();
    expect(warmEvents()).toHaveLength(1);
  });

  test('ch_clip_warm carries missing_listen: the missing check-pool listening clips (story, prompts, options); 0 when all are there', async () => {
    const many = fs.mkdtempSync(path.join(os.tmpdir(), 'challenge-clip-warm-ml-'));
    for (const p of [pointer('en.read.2.setA', 'en', 'read', 'story'), pointer('en.listen.2.setA', 'en', 'listen', 'listening')]) {
      fs.writeFileSync(path.join(many, `${p.passage_id}.json`), JSON.stringify(p));
    }
    Bank._loadPassagesFrom(many);
    db.challenge_passages = [row('en.read.2.setA', 'en', 'read', iso(NOW - 30 * DAY)), row('en.listen.2.setA', 'en', 'listen', iso(NOW - DAY))];
    try {
      const listen = served('en.listen.2.setA');
      const read = served('en.read.2.setA');
      // room for two recordings: the story and the first prompt; the rest of the listening clips and every read clip missing
      for (let i = 0; i < Ch.MAX_CLIP_RECORDINGS - CW.SERVE_HEADROOM - 2; i += 1) await Ch.warmClip(`quiz-audio/x/challenge/en/listen/pre-${i}.ogg`, `Line ${i}`, 'en');
      const capped = await CW.warmClips({ now: NOW });
      expect(capped).toMatchObject({ recorded: 2, missing: listen.length - 2 + read.length, missing_listen: listen.length - 2 });
      expect(warmEvents()).toEqual([['web_quiz.ch_clip_warm', { n: listen.length + read.length, missing: listen.length - 2 + read.length, missing_listen: listen.length - 2, missing_story: 0, w: 's' }]]);
      // every listening clip there, only read clips missing → 0
      Ch.__reset();
      for (let i = 0; i < Ch.MAX_CLIP_RECORDINGS - CW.SERVE_HEADROOM; i += 1) await Ch.warmClip(`quiz-audio/x/challenge/en/read/pre-${i}.ogg`, `Line ${i}`, 'en');
      const have = new Set(listen.map((c) => c.key));
      r2.headObject.mockImplementation(async (key) => ({ exists: have.has(key) }));
      logEvent.mockClear();
      const rest = await CW.warmClips({ now: NOW });
      expect(rest).toMatchObject({ capped: true, recorded: 0, missing: read.length, missing_listen: 0 });
      expect(warmEvents()).toEqual([['web_quiz.ch_clip_warm', { n: listen.length + read.length, missing: read.length, missing_listen: 0, missing_story: 0, w: 's' }]]);
    } finally { Bank._loadPassagesFrom(dir); fs.rmSync(many, { recursive: true, force: true }); }
  });
});

describe('the queue service\'s sweep tick (the hook)', () => {
  const ORIGINAL_Q = process.env.WORKER_QUEUES;
  afterEach(() => { if (ORIGINAL_Q === undefined) delete process.env.WORKER_QUEUES; else process.env.WORKER_QUEUES = ORIGINAL_Q; jest.restoreAllMocks(); });
  const scheduled = () => {
    process.env.WORKER_QUEUES = 'main';
    const { scheduleChallengeVoiceSweep } = require('../../../workers/sqs-worker');
    const noop = () => ({ unref() {} });
    return scheduleChallengeVoiceSweep({ worker: { isShuttingDown: false }, setIntervalFn: noop, setTimeoutFn: noop });
  };

  test('golden: switch off, the tick is the sweep as before plus the one switch read (then the housekeeping tick, unchanged)', async () => {
    db.app_settings = ON.filter((s) => s.key !== 'web_quiz_challenge_clip_warm');
    const base = await Ch.sweepOrphans();
    const baseCalls = supabase.calls.splice(0);
    const baseEvents = logEvent.mock.calls.splice(0);
    // the housekeeping tick (web-quiz-challenge-sweeper.js, its own tests) runs after the warm step: taken on its own here
    const strip = JSON.stringify(db.web_quiz_strip_weekly || null);
    await require('../../../shared/services/quiz/web-quiz-challenge-sweeper').tick();
    const hkCalls = supabase.calls.splice(0);
    const hkEvents = logEvent.mock.calls.splice(0);
    const hkLogs = logToFile.mock.calls.splice(0);
    db.web_quiz_strip_weekly = JSON.parse(strip) || undefined;
    require('../../../shared/services/quiz/web-quiz-challenge-sweeper').__reset();   // its once-a-day claim, undone for the scheduled run
    Ch.__reset();
    jest.clearAllMocks();
    const s = scheduled();
    logToFile.mockClear();
    await s.tick();
    expect(supabase.calls).toEqual([...baseCalls, { table: 'app_settings', op: 'select', payload: null }, ...hkCalls]);
    expect(logEvent.mock.calls).toEqual([...baseEvents, ...hkEvents]);
    expect(logToFile.mock.calls).toEqual([['🧹 Challenge voice orphan sweep', base], ...hkLogs]);
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(passageReads()).toEqual([]);
  });

  test('switch on: the first tick after boot warms, the next tick that Pakistan day does not, the next day does', async () => {
    const s = scheduled();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    await s.tick();
    expect(warmEvents()).toHaveLength(1);
    clock.mockReturnValue(NOW + 3600 * 1000);
    await s.tick();
    expect(warmEvents()).toHaveLength(1);
    clock.mockReturnValue(NOW + DAY);
    await s.tick();
    expect(warmEvents()).toHaveLength(2);
  });

  test('a failing warm is logged and never stops the sweep', async () => {
    const s = scheduled();
    jest.spyOn(CW, 'daily').mockRejectedValueOnce(new Error('store down'));
    await expect(s.tick()).resolves.toBeUndefined();
    expect(logToFile).toHaveBeenCalledWith('🧹 Challenge voice orphan sweep', expect.any(Object));
    expect(logToFile).toHaveBeenCalledWith('Error in challenge clip warm (non-fatal)', { error: 'store down' }, 'error');
  });
});
