'use strict';
/**
 * bd-9dbhh0.1 (VIDREC), COS rulings 20261028T151240 §1 + 151950 §1 (amends), red7 151721 / 152411:
 *   1. no separate WhatsApp clip message unless VIDEO_RECO_WA_MESSAGE is on (send.js sendAfterReport);
 *   2. the clip's /v link at the end of the report's own caption (caption-link.js), and the strip points at it ('link');
 *   3. "stop clips" (users.preferences.video_clips, clip-pref.js) → the engine stores the next pick as none/'opted_out'
 *      with the arm kept, so no strip, no caption link and no card follow; "not now" changes nothing else.
 * Every test runs the real module on the changed branch; only the network edges (store, WhatsApp, catalog) are faked.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
const REC = '1a2b3c4d-1111-4222-8333-444455556666';
const ENV = { ...process.env };
const SHOWN = { id: REC, user_id: UID, coaching_session_id: SID, status: 'shown', arm: 'video', module_id: 10, seg_id: '10-s1', start_s: 30, end_s: 210, reason_en: 'r', reason_ur: 'ر' };

let log;
beforeEach(() => {
  jest.resetModules();
  log = jest.fn();
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: log, logWarn: jest.fn(), logError: jest.fn() }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example.pk' };
  delete process.env.VIDEO_RECO_WA_MESSAGE;
  delete process.env.VIDEO_RECO_ENABLED;
  delete process.env.VIDEO_RECO_MODE;
  delete process.env.VIDEO_RECO_STRIP_WAIT_MS;
});
afterAll(() => { process.env = ENV; });
const catalog = () => require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(FIXTURE);

describe('1. no WhatsApp clip message by default (send.js)', () => {
  function wa() {
    return { sendCtaUrl: jest.fn(async () => true), sendMessage: jest.fn(async () => true) };
  }
  const deps = (whatsapp, extra = {}) => ({
    enabled: () => true, whatsapp, catalog: catalog(), store: { readForSession: jest.fn(async () => SHOWN), markSent: jest.fn(async () => true) },
    claimPiece: jest.fn(async () => true), releasePiece: jest.fn(async () => true), renderCard: jest.fn(async () => null), ...extra,
  });

  test('flags: VIDEO_RECO_WA_MESSAGE unset → off; true/1 → on', () => {
    const f = require('../../../bot/shared/services/coaching/video-reco/flags');
    expect(f.videoRecoWaMessage({})).toBe(false);
    expect(f.videoRecoWaMessage({ VIDEO_RECO_WA_MESSAGE: 'false' })).toBe(false);
    expect(f.videoRecoWaMessage({ VIDEO_RECO_WA_MESSAGE: 'true' })).toBe(true);
    expect(f.videoRecoWaMessage({ VIDEO_RECO_WA_MESSAGE: '1' })).toBe(true);
  });

  test('a shown row, the engine on, VIDEO_RECO_WA_MESSAGE unset → NOTHING sent, nothing claimed, no markSent', async () => {
    const S = require('../../../bot/shared/services/coaching/video-reco/send');
    const w = wa();
    const d = deps(w);
    const out = await S.sendAfterReport({ coachingSessionId: SID, phone: '10000000000', language: 'ur', row: Promise.resolve(SHOWN), deps: d });
    expect(out).toEqual({ sent: false, via: null });
    expect(w.sendCtaUrl).not.toHaveBeenCalled();
    expect(w.sendMessage).not.toHaveBeenCalled();
    expect(d.claimPiece).not.toHaveBeenCalled();
    expect(d.store.markSent).not.toHaveBeenCalled();
  });

  test('VIDEO_RECO_WA_MESSAGE=true → the old message, as today', async () => {
    process.env.VIDEO_RECO_WA_MESSAGE = 'true';
    const S = require('../../../bot/shared/services/coaching/video-reco/send');
    const w = wa();
    const out = await S.sendAfterReport({ coachingSessionId: SID, phone: '10000000000', language: 'ur', row: Promise.resolve(SHOWN), deps: deps(w) });
    expect(out).toEqual({ sent: true, via: 'cta' });
    expect(w.sendCtaUrl).toHaveBeenCalledTimes(1);
  });
});

describe('2. the link in the report caption (caption-link.js) and the strip hint (strip.js)', () => {
  const on = () => { process.env.VIDEO_RECO_ENABLED = 'true'; };

  test('a shown row → two lines: the label, then the /v link (surface wa) alone on the last line', async () => {
    on();
    const C = require('../../../bot/shared/services/coaching/video-reco/caption-link');
    const b = await C.linkBlock({ row: Promise.resolve(SHOWN), language: 'en', capMs: 50, deps: { catalog: catalog() } });
    const lines = b.text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^▶ Watch next \(3 min\): \S/);
    expect(lines[1]).toMatch(/^https:\/\/portal\.example\.pk\/v\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    const v = require('../../../bot/shared/services/coaching/video-reco/link-token').verifyVideoLink(lines[1].split('/v/')[1]);
    expect(v).toMatchObject({ ok: true, recommendationId: REC, userId: UID, surface: 'wa' });
    // Urdu: the label in Urdu with Urdu digits; the URL line has no bidi control or punctuation touching it
    const u = await C.linkBlock({ row: SHOWN, language: 'ur', capMs: 50, deps: { catalog: catalog() } });
    const [l0, l1] = u.text.split('\n');
    expect(l0).toContain('اگلا دیکھیں (۳ منٹ)');
    expect(l1).toBe(u.url);
    expect(l1).not.toMatch(/[⁦-⁩‏۔.)]$/);
    // withLink: the caption, a blank line, the block; the URL is the last thing in it
    expect(C.withLink('cap', u)).toBe(`cap\n\n${u.text}`);
    expect(C.withLink('cap', u).endsWith(u.url)).toBe(true);
  });

  test.each([
    ['shadow', { ...SHOWN, status: 'shadow', arm: 'control' }],
    ['none (stopped)', { ...SHOWN, status: 'none', none_reason: 'opted_out' }],
    ['no row', null],
  ])('%s → no link, and withLink leaves the caption byte for byte', async (_n, row) => {
    on();
    const C = require('../../../bot/shared/services/coaching/video-reco/caption-link');
    const b = await C.linkBlock({ row: Promise.resolve(row), language: 'ur', capMs: 50, deps: { catalog: catalog() } });
    expect(b).toBeNull();
    expect(C.withLink('cap', b)).toBe('cap');
    expect(C.reserveFor(b)).toBe(0);
  });

  test('engine off, or the clip message switched back on → no link (the message carries it, as before)', async () => {
    const C = require('../../../bot/shared/services/coaching/video-reco/caption-link');
    expect(await C.linkBlock({ row: SHOWN, language: 'en', capMs: 50, deps: { catalog: catalog() } })).toBeNull();
    on();
    process.env.VIDEO_RECO_WA_MESSAGE = 'true';
    expect(await C.linkBlock({ row: SHOWN, language: 'en', capMs: 50, deps: { catalog: catalog() } })).toBeNull();
  });

  test('a caption the block would push past 1,024 code points stays as it was (never a text of its own)', async () => {
    on();
    const C = require('../../../bot/shared/services/coaching/video-reco/caption-link');
    const b = await C.linkBlock({ row: SHOWN, language: 'en', capMs: 50, deps: { catalog: catalog() } });
    const long = 'x'.repeat(1024 - C.reserveFor(b) + 1);
    expect(C.withLink(long, b)).toBe(long);
    const fits = 'x'.repeat(1024 - C.reserveFor(b));
    expect([...C.withLink(fits, b)].length).toBe(1024);
  });

  const stripDeps = (open) => ({ enabled: () => true, catalog: catalog(), onTeacherApp: async () => false, windowOpen: async () => open });

  test('strip, window open, message off → where "link"; the hint points at the link under the picture, never "next message"', async () => {
    const St = require('../../../bot/shared/services/coaching/video-reco/strip');
    for (const language of ['en', 'ur']) {
      const vs = await St.stripFor({ coachingSessionId: SID, language, row: SHOWN, capMs: 50, phone: '1', userId: UID, deps: stripDeps(true) });
      expect(vs.where).toBe('link');
      const html = St.stripHtml(vs, { language, T: (x) => x });
      expect(html).not.toMatch(/next message|اگلے پیغام/);
      expect(html).toContain(language === 'en' ? 'tap the link under this picture' : 'اس تصویر کے نیچے لنک دبائیں');
    }
  });

  test('strip, message switched back on → "next", the old hint', async () => {
    const St = require('../../../bot/shared/services/coaching/video-reco/strip');
    const vs = await St.stripFor({ coachingSessionId: SID, language: 'en', row: SHOWN, capMs: 50, phone: '1', userId: UID, deps: { ...stripDeps(true), waMessage: () => true } });
    expect(vs.where).toBe('next');
    expect(St.stripHtml(vs, { language: 'en', T: (x) => x })).toContain('in the next message');
  });

  test('strip, window closed (template path) → no strip, no link promised; no link possible → no strip', async () => {
    const St = require('../../../bot/shared/services/coaching/video-reco/strip');
    expect(await St.stripFor({ coachingSessionId: SID, language: 'en', row: SHOWN, capMs: 50, phone: '1', userId: UID, deps: stripDeps(false) })).toBeNull();
    expect(await St.stripFor({ coachingSessionId: SID, language: 'en', row: SHOWN, capMs: 50, phone: '1', userId: UID, deps: { ...stripDeps(true), linkUrl: () => null } })).toBeNull();
  });
});

describe('3. stop / not now (clip-pref.js) and the engine', () => {
  test('next(): stop, a second stop (no change), resume, skip once per clip; ids and times only', () => {
    const P = require('../../../bot/shared/services/coaching/video-reco/clip-pref');
    const now = '2026-10-28T16:00:00.000Z';
    const s1 = P.next(undefined, 'stop', { recommendationId: REC, now });
    expect(s1).toEqual({ changed: true, value: { stopped: true, changed_at: now, stopped_at: now, stop_count: 1, rec: REC } });
    expect(P.next(s1.value, 'stop', { recommendationId: REC, now }).changed).toBe(false);
    const r = P.next(s1.value, 'resume', { recommendationId: REC, now });
    expect(r.value).toMatchObject({ stopped: false, resumed_at: now, stop_count: 1 });
    expect(P.next(r.value, 'resume', { now }).changed).toBe(false);
    const k = P.next(r.value, 'skip', { recommendationId: REC, now });
    expect(k.value).toMatchObject({ stopped: false, skip_count: 1, skip_rec: REC, skipped_at: now });
    expect(P.next(k.value, 'skip', { recommendationId: REC, now }).changed).toBe(false);
    expect(P.isStopped({ video_clips: s1.value })).toBe(true);
    expect(P.isStopped({ video_clips: k.value })).toBe(false);
    expect(P.isStopped(null)).toBe(false);
  });

  test('apply(): read-merge-write of users.preferences — the other keys kept, a repeat writes nothing', async () => {
    const P = require('../../../bot/shared/services/coaching/video-reco/clip-pref');
    let prefs = { framework: 'fico', observe_teachers: ['t1'] };
    const updates = [];
    const supa = {
      from: () => {
        const b = { _u: null };
        b.select = () => b; b.eq = () => b;
        b.update = (u) => { b._u = u; return b; };
        b.maybeSingle = async () => ({ data: { preferences: prefs }, error: null });
        b.then = (res) => { if (b._u) { updates.push(b._u); prefs = b._u.preferences; } return Promise.resolve({ error: null }).then(res); };
        return b;
      },
    };
    expect(await P.apply(supa, UID, 'stop', { recommendationId: REC })).toEqual({ ok: true, stopped: true, changed: true });
    expect(prefs).toMatchObject({ framework: 'fico', observe_teachers: ['t1'], video_clips: { stopped: true, rec: REC } });
    expect(await P.apply(supa, UID, 'stop', { recommendationId: REC })).toEqual({ ok: true, stopped: true, changed: false });
    expect(updates).toHaveLength(1);
    expect(await P.readStopped(supa, UID)).toBe(true);
    expect(await P.apply(supa, UID, 'resume', { recommendationId: REC })).toEqual({ ok: true, stopped: false, changed: true });
    expect(await P.readStopped(supa, UID)).toBe(false);
    expect(await P.apply(supa, UID, 'delete-everything')).toEqual({ ok: false, stopped: null, changed: false });
  });

  // The engine, on the harness of engine.test.js (a store fake, the fixture catalogue, a fake completeJson).
  const GOOD = {
    seg_id: '10-s1', moment: { at: '00:30', quote: '[a student], tum batao: is this a triangle? Yes or no' },
    reason_en: 'At 00:30 the class could only answer yes or no. This clip shows a teacher asking why and how instead.',
    reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.7,
  };
  function args(uid = UID) {
    return {
      session: {
        id: SID, user_id: uid, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' },
        diarization_data: { segments: [
          { start_ms: 30000, label: 'Teacher', text: 'Ahmed, tum batao: is this a triangle? Yes or no, quickly!' },
          { start_ms: 45000, label: 'Student', text: 'Yes' },
        ] },
      },
      analysis: { framework: 'fico', domains: { C: { indicators: [
        { id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed questions. Quote: "Is this a triangle? Yes or no"', evidence_summary: 'Only yes/no questions', timestamp: '[00:40]' },
      ] } }, subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' }, topic: 'shapes' },
      nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
      card: { indicator: 'C1', action: 'Ask two why questions about shapes' },
      coachingSessionId: SID,
    };
  }
  function deps(stopped, env = { VIDEO_RECO_ENABLED: 'true' }) {
    return {
      env,
      catalog: catalog(),
      store: {
        readForSession: jest.fn().mockResolvedValue(null),
        recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }),
        ladderProgress: jest.fn().mockResolvedValue({ level: 2, completedModules: [] }),
        trainingBands: jest.fn().mockResolvedValue([]),
        clipsStopped: jest.fn().mockResolvedValue(stopped),
        write: jest.fn(async (row) => ({ id: 'rec-1', ...row })),
      },
      v10GroupFor: jest.fn().mockResolvedValue({ group: 'C' }),
      completeJson: jest.fn().mockResolvedValue({ result: GOOD, usage: { prompt_tokens: 900, completion_tokens: 120 }, finishReason: 'stop' }),
    };
  }
  const engine = () => {
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('no direct supabase'); } }));
    return require('../../../bot/shared/services/coaching/video-reco/engine');
  };

  test('a stopped teacher in the video arm → the pick is stored as none / opted_out, the arm and the clip kept; read in the one wave', async () => {
    const E = engine();
    const d = deps(true);
    const row = await E.recommendForReport({ ...args(), deps: d });
    expect(row).toMatchObject({ status: 'none', none_reason: 'opted_out', arm: 'video', seg_id: '10-s1', user_id: UID });
    expect(d.store.clipsStopped).toHaveBeenCalledWith(UID);
  });

  test('not stopped → shown, exactly as before (none_reason null)', async () => {
    const E = engine();
    const row = await E.recommendForReport({ ...args(), deps: deps(false) });
    expect(row).toMatchObject({ status: 'shown', none_reason: null, arm: 'video', seg_id: '10-s1' });
  });

  test('a store with no clipsStopped (evals harness, an older store) → shown, as before', async () => {
    const E = engine();
    const d = deps(false);
    delete d.store.clipsStopped;
    expect(await E.recommendForReport({ ...args(), deps: d })).toMatchObject({ status: 'shown', none_reason: null });
  });

  test('a failed stop read → shown (the safe answer: today); shadow mode and the control arm stay shadow when stopped', async () => {
    const E = engine();
    const d = deps(false);
    d.store.clipsStopped.mockRejectedValue(new Error('down'));
    expect(await E.recommendForReport({ ...args(), deps: d })).toMatchObject({ status: 'shown' });
    expect(await E.recommendForReport({ ...args(), deps: deps(true, { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_MODE: 'shadow' }) }))
      .toMatchObject({ status: 'shadow', none_reason: null, arm: 'video' });
    const arm = require('../../../bot/shared/services/coaching/video-reco/arm');
    const env = { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_AB_ENABLED: 'true' };
    let uid = UID;
    for (let i = 0; arm.assignArm(uid, env) !== 'control'; i++) uid = `user-${i}`;
    expect(await E.recommendForReport({ ...args(uid), deps: deps(true, env) })).toMatchObject({ status: 'shadow', arm: 'control', none_reason: null });
  });

  test('every surface keys on shown: a stopped row gets no strip, no caption link, no message', async () => {
    process.env.VIDEO_RECO_ENABLED = 'true';
    const stoppedRow = { ...SHOWN, status: 'none', none_reason: 'opted_out' };
    const St = require('../../../bot/shared/services/coaching/video-reco/strip');
    expect(await St.stripFor({ coachingSessionId: SID, language: 'en', row: stoppedRow, capMs: 50, phone: '1', userId: UID, deps: { enabled: () => true, catalog: catalog(), onTeacherApp: async () => false, windowOpen: async () => true } })).toBeNull();
    const C = require('../../../bot/shared/services/coaching/video-reco/caption-link');
    expect(await C.linkBlock({ row: stoppedRow, language: 'en', capMs: 50, deps: { catalog: catalog() } })).toBeNull();
  });
});
