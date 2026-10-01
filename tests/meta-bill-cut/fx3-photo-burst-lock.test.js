'use strict';
/**
 * Meta bill cut FX3 (bd-w2daa.24) item 1 — photos sent together overwrite each other (bd-fr45b).
 *
 * WhatsApp delivers a gallery burst as separate webhooks within a second. Each request resolved the
 * coaching session BEFORE any of them had written, so every one appended its photo to the same
 * stale `classroom_photos` and wrote the array back: the last write won. Seen live on sandbox
 * (E1 run 1, 16:17:49Z): two photos → both logged photoCount 1, the burst prompt said
 * "📷 Photo 1 of 3", one photo lost. NC4's one-prompt-per-burst re-reads the count from the row,
 * so it could only ever report what survived.
 *
 * Now the append re-reads the row under a per-session lock (in-process queue + Redis lock across
 * replicas — the Global fix, lane I7 G1-17), so every photo is kept and the one burst prompt
 * carries the true count. Fail-safe: no Redis, a Redis that errors, or a lock someone else holds
 * past the wait → the photo is still stored, nothing blocks.
 *
 * Driven through media-attach.attachClassroomPhoto — the one path every classroom photo takes, for
 * the teacher's coaching session AND the coach's /observe session. Only the network is faked
 * (Supabase with a real read→write gap, Redis, WhatsApp, R2).
 */
const SID = '11111111-2222-4333-8444-555555555555';
const FROM = '923001234567';
const USER = { id: 'teacher-1', preferred_language: 'en' };
const COACH = { id: 'coach-1', preferred_language: 'en' };

const sent = [];
const mockRedis = new Map();
let redisMode;   // 'up' | 'down' | 'throws' | 'lock_held'
let sessionRow;
let userLang = 'en';
const later = (ms) => new Promise((r) => setTimeout(r, ms));

function waMock() {
  return {
    sendMessage: jest.fn(async (to, text) => { sent.push({ kind: 'text', to, text }); return true; }),
    sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ kind: 'buttons', to, body: p.body, buttons: p.buttons }); return true; }),
    sendInteractiveMessage: jest.fn(async (to, p) => { sent.push({ kind: 'list', to, body: p.body && p.body.text }); return true; }),
    sendReaction: jest.fn(async (to, id, emoji) => { sent.push({ kind: 'reaction', to, id, emoji }); return true; }),
    downloadMedia: jest.fn(async () => Buffer.from('JPEG')),
  };
}

function redisMock() {
  const up = () => redisMode !== 'down';
  const boom = () => { if (redisMode === 'throws') throw new Error('ECONNRESET'); };
  return {
    isAvailable: () => up(),
    setNX: jest.fn(async (k, v) => { if (!up()) return true; if (mockRedis.has(k)) return false; mockRedis.set(k, v); return true; }),
    set: jest.fn(async (k, v) => { if (!up()) return false; mockRedis.set(k, v); return true; }),
    get: jest.fn(async (k) => (up() && mockRedis.has(k) ? mockRedis.get(k) : null)),
    delete: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
    setexWithCeiling: jest.fn(async (k, _t, v) => { mockRedis.set(k, v); return true; }),
    // Real SET NX semantics, like railway-redis.service.acquireLock / releaseLock.
    acquireLock: jest.fn(async (resource, lockId) => {
      if (!up()) return false;
      boom();
      if (redisMode === 'lock_held') return false;
      const k = `lock:${resource}`;
      if (mockRedis.has(k)) return false;
      mockRedis.set(k, lockId);
      return true;
    }),
    releaseLock: jest.fn(async (resource, lockId) => {
      const k = `lock:${resource}`;
      if (mockRedis.get(k) === lockId) { mockRedis.delete(k); return true; }
      return false;
    }),
  };
}

/** Supabase with a network gap: a read resolves a few ms later with the row AS IT WAS when asked. */
function supabaseMock() {
  return {
    from: (table) => {
      const b = {};
      let patch = null;
      ['select', 'eq', 'order', 'limit', 'not', 'in', 'is', 'neq', 'or'].forEach((m) => { b[m] = () => b; });
      b.update = (p) => { patch = p; return b; };
      const read = async () => {
        if (table === 'users') return { data: { id: USER.id, preferred_language: userLang, region: 'ict' }, error: null };
        const snap = JSON.parse(JSON.stringify(sessionRow));
        await later(3);
        return { data: snap, error: null };
      };
      b.single = read;
      b.maybeSingle = read;
      b.then = (ok, ko) => {
        if (patch && table === 'coaching_sessions') {
          return later(3).then(() => { sessionRow = { ...sessionRow, ...patch }; return { data: null, error: null }; }).then(ok, ko);
        }
        return Promise.resolve(table === 'coaching_sessions'
          ? { data: [{ id: SID, ...sessionRow }], error: null }
          : { data: null, error: null }).then(ok, ko);
      };
      return b;
    },
  };
}

function load() {
  jest.resetModules();
  sent.length = 0;
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => waMock());
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => redisMock());
  jest.doMock('../../bot/shared/config/supabase', () => supabaseMock());
  jest.doMock('../../bot/shared/storage/r2', () => ({
    uploadImageWithRetry: jest.fn(async (_b, _u, name) => { await later(2); return `r2://${name}-${Math.random().toString(36).slice(2, 8)}`; }),
  }));
  jest.doMock('../../bot/shared/utils/language-cache', () => ({ getUserLanguage: jest.fn(async () => userLang), setUserLanguage: jest.fn() }));
  return {
    attach: require('../../bot/shared/services/coaching/media-attach.service'),
    ux: require('../../bot/shared/config/ux-strings'),
    logger: require('../../bot/shared/utils/logger'),
  };
}

function teacherOnPhotoStep() {
  return {
    id: SID, user_id: USER.id, status: 'awaiting_classroom_photo', observation_type: null, observer_user_id: null,
    conversation_state: { current_state: 'AWAITING_CLASSROOM_PHOTO', classroom_photos: [] },
    classroom_photos: [],
  };
}
function coachObserveOnPhotoStep() {
  return { ...teacherOnPhotoStep(), user_id: 'observed-teacher', observer_user_id: COACH.id, observation_type: 'leader_observation' };
}
function holding() {
  return { ...teacherOnPhotoStep(), status: 'transcribing', conversation_state: { current_state: 'TRANSCRIBING' } };
}

/** N photos of one burst: every request resolved the session before any of them wrote. */
function burst(m, n, sessionFactory, user = USER) {
  const stale = sessionFactory();
  return Promise.all(Array.from({ length: n }, (_, i) => m.attach.attachClassroomPhoto({
    user, from: FROM, mediaId: `img-${i}`, mimeType: 'image/jpeg', session: JSON.parse(JSON.stringify(stale)),
    messageId: `wamid.PHOTO_${i}`,
  })));
}

const stored = () => (sessionRow.classroom_photos || []).length;
const storedInState = () => ((sessionRow.conversation_state || {}).classroom_photos || []).length;
const receiptPrompts = () => sent.filter((s) => s.kind === 'buttons' && (s.buttons || []).some((b) => b.id === `photo_more_${SID}`));

beforeEach(() => {
  mockRedis.clear();
  redisMode = 'up';
  userLang = 'en';
  process.env.COACHING_PHOTO_PROMPT_DEBOUNCE_MS = '60';
  process.env.COACHING_PHOTO_LOCK_WAIT_MS = '200';
});
afterAll(() => {
  delete process.env.COACHING_PHOTO_PROMPT_DEBOUNCE_MS;
  delete process.env.COACHING_PHOTO_LOCK_WAIT_MS;
});

describe('FX3-1 — every photo of a burst is stored, and the ONE burst prompt carries the true count', () => {
  test('teacher coaching: 2 photos in the same second → 2 stored, ONE prompt "📸 2 of 3 photos received…"', async () => {
    const m = load();
    sessionRow = teacherOnPhotoStep();
    await burst(m, 2, teacherOnPhotoStep);

    expect(stored()).toBe(2);
    expect(storedInState()).toBe(2);
    expect(new Set(sessionRow.classroom_photos.map((p) => p.url)).size).toBe(2);
    const prompts = receiptPrompts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].body).toBe(m.ux.resolveUx('coachingPhotoReceivedMany', { language: 'en', params: { n: '2', max: '3' } }));
    expect(sent.filter((s) => s.kind === 'text')).toEqual([]);
  });

  test('coach /observe (shares the gate): 2 photos together → 2 stored, one "2 of 3" prompt', async () => {
    const m = load();
    sessionRow = coachObserveOnPhotoStep();
    await burst(m, 2, coachObserveOnPhotoStep, COACH);

    expect(stored()).toBe(2);
    expect(receiptPrompts()).toHaveLength(1);
    expect(receiptPrompts()[0].body).toBe(m.ux.resolveUx('coachingPhotoReceivedMany', { language: 'en', params: { n: '2', max: '3' } }));
  });

  test('[ur] 2 photos together → the Urdu prompt with Urdu digits ۲ of ۳', async () => {
    userLang = 'ur';
    const m = load();
    sessionRow = teacherOnPhotoStep();
    await burst(m, 2, teacherOnPhotoStep, { ...USER, preferred_language: 'ur' });

    expect(stored()).toBe(2);
    expect(receiptPrompts()).toHaveLength(1);
    expect(receiptPrompts()[0].body).toBe(m.ux.resolveUx('coachingPhotoReceivedMany', { language: 'ur', params: { n: '۲', max: '۳' } }));
  });

  test('3 photos together → 3 stored, no receipt prompt, ONE lesson-plan prompt opened by "Photo 3 … Maximum reached."', async () => {
    const m = load();
    sessionRow = teacherOnPhotoStep();
    await burst(m, 3, teacherOnPhotoStep);

    expect(stored()).toBe(3);
    expect(receiptPrompts()).toEqual([]);
    const lead = m.ux.resolveUx('coachingPhotoMaxReached', { language: 'en', params: { n: '3' } });
    const lp = sent.filter((s) => s.kind === 'buttons' || s.kind === 'list');
    expect(lp).toHaveLength(1);
    expect(lp[0].body.startsWith(`${lead}\n\n`)).toBe(true);
    expect(sessionRow.status).toBe('awaiting_lesson_plan');
  });

  test('4 photos together → 3 stored (the cap), still ONE lesson-plan prompt, no error', async () => {
    const m = load();
    sessionRow = teacherOnPhotoStep();
    await burst(m, 4, teacherOnPhotoStep);

    expect(stored()).toBe(3);
    expect(receiptPrompts()).toEqual([]);
    expect(sent.filter((s) => s.kind === 'buttons' || s.kind === 'list')).toHaveLength(1);
  });

  test('race path (photos before the photo step): 2 held together → 2 stored, a 📸 on each', async () => {
    const m = load();
    sessionRow = holding();
    await burst(m, 2, holding);

    expect(stored()).toBe(2);
    expect(sent.filter((s) => s.kind === 'reaction').map((s) => s.id).sort()).toEqual(['wamid.PHOTO_0', 'wamid.PHOTO_1']);
  });
});

describe('FX3-1 — fail-safe: never lose a photo, never block', () => {
  test('Redis down → both photos still stored (in-process queue); each answered at once, as before', async () => {
    redisMode = 'down';
    const m = load();
    sessionRow = teacherOnPhotoStep();
    await burst(m, 2, teacherOnPhotoStep);

    expect(stored()).toBe(2);
    // No Redis = no debounce (NC4's documented fallback): one prompt per photo, the last says 2.
    const bodies = receiptPrompts().map((p) => p.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(m.ux.resolveUx('coachingPhotoReceivedMany', { language: 'en', params: { n: '2', max: '3' } }));
  });

  test('the lock call throws → photos still stored, no rejection', async () => {
    redisMode = 'throws';
    const m = load();
    sessionRow = teacherOnPhotoStep();
    await expect(burst(m, 2, teacherOnPhotoStep)).resolves.toHaveLength(2);
    expect(stored()).toBe(2);
  });

  test('another replica holds the lock past the wait → the photo is stored anyway, within the wait bound', async () => {
    redisMode = 'lock_held';
    const m = load();
    sessionRow = teacherOnPhotoStep();
    const t0 = Date.now();
    await m.attach.attachClassroomPhoto({
      user: USER, from: FROM, mediaId: 'img-x', mimeType: 'image/jpeg', session: teacherOnPhotoStep(), messageId: 'wamid.X',
    });
    expect(stored()).toBe(1);
    expect(Date.now() - t0).toBeLessThan(200 + 60 + 500);
    expect(m.logger.logToFile).toHaveBeenCalledWith(expect.stringContaining('lock'), expect.objectContaining({ coachingSessionId: SID }));
  });

  test('the lock is released after each append (the next burst is not slowed)', async () => {
    const m = load();
    sessionRow = teacherOnPhotoStep();
    await burst(m, 2, teacherOnPhotoStep);
    expect([...mockRedis.keys()].filter((k) => k.startsWith('lock:'))).toEqual([]);
  });
});
