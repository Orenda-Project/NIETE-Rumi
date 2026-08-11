/**
 * The language writer — the single enforcement point.
 *
 * Two defects motivated this. The offer clamp existed as isMarketLanguage() but
 * guarded only two of the paths that wrote language, so the coaching-audio path
 * could persist pa-PK or ar onto an ICT teacher; every read surface then folded
 * her back to English and her Urdu was gone with no visible cause. And the lock
 * column was written but never READ, so an explicit choice carried no weight.
 *
 * Enforcement a caller can forget is not enforcement, so it lives in the writer.
 */

let redisStore;
let dbRow;
let updateCaptor;

function load({ row = { language_locked: false }, redisGet = {} } = {}) {
  jest.resetModules();
  redisStore = { ...redisGet };
  dbRow = row;
  updateCaptor = [];

  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    get: jest.fn(async (k) => (k in redisStore ? redisStore[k] : null)),
    set: jest.fn(async (k, v) => { redisStore[k] = v; }),
    delete: jest.fn(async (k) => { delete redisStore[k]; }),
  }));

  const chain = {
    update(payload) {
      updateCaptor.push(payload);
      return { eq: () => Promise.resolve({ error: null }) };
    },
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve({ data: dbRow, error: null }),
  };
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => chain }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

  return require('../../bot/shared/utils/language-cache');
}

describe('language writer — only the offer may be stored', () => {
  it('accepts the two offered languages', async () => {
    const C = load();
    await expect(C.setUserLanguage('u1', 'ur', true)).resolves.toBe(true);
    await expect(C.setUserLanguage('u1', 'en', true)).resolves.toBe(true);
  });

  it('rejects every off-market language, storing nothing', async () => {
    const C = load();
    for (const code of ['sw', 'ar', 'es', 'pa-PK', 'sd-PK', 'ps-PK', 'bal-PK', 'ta-LK', 'hi']) {
      await expect(C.setUserLanguage('u1', code, true)).resolves.toBe(false);
    }
    expect(updateCaptor).toHaveLength(0);
  });

  it('rejects the exact codes that reached production output', async () => {
    // 19 Punjabi and 2 Arabic replies were served to teachers whose stored
    // preference is only ever en or ur. This is the write that made that possible.
    const C = load();
    await expect(C.setUserLanguage('u1', 'pa-PK', false)).resolves.toBe(false);
    await expect(C.setUserLanguage('u1', 'ar', false)).resolves.toBe(false);
    expect(updateCaptor).toHaveLength(0);
  });

  it('rejects junk and missing values without throwing', async () => {
    const C = load();
    for (const bad of [null, undefined, '', 'EN', 'ur-PK', 'gibberish', 42]) {
      await expect(C.setUserLanguage('u1', bad, true)).resolves.toBe(false);
    }
    expect(updateCaptor).toHaveLength(0);
  });

  it('refuses without a user id', async () => {
    const C = load();
    await expect(C.setUserLanguage(null, 'ur', true)).resolves.toBe(false);
    expect(updateCaptor).toHaveLength(0);
  });
});

describe('language writer — a successful write locks and invalidates', () => {
  it('persists the language and the lock together', async () => {
    const C = load();
    await C.setUserLanguage('u1', 'ur', true);
    expect(updateCaptor[0]).toMatchObject({ preferred_language: 'ur', language_locked: true });
  });

  it('can write without locking, for a non-explicit path', async () => {
    const C = load();
    await C.setUserLanguage('u1', 'ur', false);
    expect(updateCaptor[0]).toMatchObject({ language_locked: false });
  });

  it('refreshes BOTH redis keys, so no stale language survives the write', async () => {
    // Settings used to write the column directly and invalidate nothing, leaving
    // the 24-hour cache serving the old language for up to a day.
    const C = load();
    await C.setUserLanguage('u1', 'en', true);
    expect(redisStore['user:language:u1']).toBe('en');
    expect(redisStore['user:language_locked:u1']).toBe('true');
  });
});

describe('language lock reader — the reader that never existed', () => {
  it('reports true for a teacher who explicitly chose', async () => {
    const C = load({ row: { language_locked: true } });
    await expect(C.isUserLanguageLocked('u1')).resolves.toBe(true);
  });

  it('reports false for a teacher who never chose', async () => {
    const C = load({ row: { language_locked: false } });
    await expect(C.isUserLanguageLocked('u1')).resolves.toBe(false);
  });

  it('round-trips a write made through the writer', async () => {
    const C = load({ row: { language_locked: false } });
    await C.setUserLanguage('u1', 'ur', true);
    await expect(C.isUserLanguageLocked('u1')).resolves.toBe(true);
  });

  it('reads the cache when present, without hitting the database', async () => {
    const C = load({ row: { language_locked: false }, redisGet: { 'user:language_locked:u1': 'true' } });
    await expect(C.isUserLanguageLocked('u1')).resolves.toBe(true);
  });

  it('treats "cannot tell" as LOCKED, never as permission', async () => {
    // A caller asking this is deciding whether it may overwrite her choice.
    // Failing open would re-create the defect this reader exists to close.
    const C = load({ row: null });
    await expect(C.isUserLanguageLocked('u1')).resolves.toBe(true);
    await expect(C.isUserLanguageLocked(null)).resolves.toBe(true);
  });
});

describe('language writer — recognition is broader than the offer', () => {
  it('still recognises off-market codes for telemetry, while refusing to store them', async () => {
    // Deliberate asymmetry: output_language must be able to RECORD that we
    // emitted something off-market — that is how the leak was found — while the
    // preference column may only ever hold a language we serve.
    const C = load();
    expect(C.VALID_LANGUAGES).toContain('pa-PK');
    expect(C.VALID_LANGUAGES).toContain('ar');
    await expect(C.setUserLanguage('u1', 'pa-PK', true)).resolves.toBe(false);
  });

  it('keeps English as the emergency floor', async () => {
    const C = load();
    expect(C.DEFAULT_LANGUAGE).toBe('en');
  });
});
