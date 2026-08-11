/**
 * Settings must go through the ONE language writer.
 *
 * Three defects lived in this handler, all silent:
 *   - it wrote the column directly, so no lock was set and the 24-hour Redis
 *     cache kept serving the old language for up to a day
 *   - `screenData.language || 'en'` meant a framework-only save rewrote an Urdu
 *     teacher to English
 *   - it wrote language to BOTH the preferences JSONB and the column, then read
 *     the blob first while the rest of the bot read the column, so the screen
 *     could show one language while the bot spoke another
 */

let updates;
let userRow;
let setUserLanguageMock;

function load({ row = { preferences: {}, preferred_language: 'ur' }, writerOk = true } = {}) {
  jest.resetModules();
  updates = [];
  userRow = row;

  const chain = {
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve({ data: userRow, error: null }),
    update(payload) {
      updates.push(payload);
      return { eq: () => Promise.resolve({ error: null }) };
    },
  };
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => chain }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

  setUserLanguageMock = jest.fn().mockResolvedValue(writerOk);
  jest.doMock('../../bot/shared/utils/language-cache', () => ({
    setUserLanguage: setUserLanguageMock,
  }));

  return require('../../bot/shared/routes/settings-endpoint');
}

const FRAMEWORK = 'oecd';

describe('settings — a language change goes through the writer', () => {
  it('calls the writer, locked, when the language actually changes', async () => {
    const S = load({ row: { preferences: {}, preferred_language: 'ur' } });
    await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      language: 'en',
      observation_framework: FRAMEWORK,
    }, 'tok');

    expect(setUserLanguageMock).toHaveBeenCalledTimes(1);
    expect(setUserLanguageMock).toHaveBeenCalledWith('u1', 'en', true);
  });

  it('never writes preferred_language directly', async () => {
    const S = load({ row: { preferences: {}, preferred_language: 'ur' } });
    await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      language: 'en',
      observation_framework: FRAMEWORK,
    }, 'tok');

    for (const payload of updates) {
      expect(payload).not.toHaveProperty('preferred_language');
    }
  });

  it('surfaces an error when the writer rejects the language', async () => {
    const S = load({ writerOk: false });
    const res = await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      language: 'sw',
      observation_framework: FRAMEWORK,
    }, 'tok');

    expect(res?.data?.error).toBeTruthy();
    expect(res.screen).toBeUndefined();
  });
});

describe('settings — a save that does not touch language must not touch language', () => {
  it('does not call the writer for a framework-only submission', async () => {
    // The regression that mattered most: `screenData.language || 'en'` silently
    // rewrote an Urdu teacher to English when she only changed her framework.
    const S = load({ row: { preferences: {}, preferred_language: 'ur' } });
    await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      observation_framework: FRAMEWORK,
    }, 'tok');

    expect(setUserLanguageMock).not.toHaveBeenCalled();
    for (const payload of updates) {
      expect(payload).not.toHaveProperty('preferred_language');
    }
  });

  it('treats an empty or null language field as "not submitted"', async () => {
    for (const value of ['', null]) {
      const S = load({ row: { preferences: {}, preferred_language: 'ur' } });
      await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
        language: value,
        observation_framework: FRAMEWORK,
      }, 'tok');
      expect(setUserLanguageMock).not.toHaveBeenCalled();
    }
  });

  it('does not re-lock when the submitted language equals the stored one', async () => {
    // Re-saving the same value is not a choice; locking on it would let an
    // incidental save silently change her lock state.
    const S = load({ row: { preferences: {}, preferred_language: 'ur' } });
    await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      language: 'ur',
      observation_framework: FRAMEWORK,
    }, 'tok');

    expect(setUserLanguageMock).not.toHaveBeenCalled();
  });

  it('still persists the framework change', async () => {
    const S = load({ row: { preferences: { curriculum: 'nbf' }, preferred_language: 'ur' } });
    await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      observation_framework: FRAMEWORK,
    }, 'tok');

    const prefs = updates.find((u) => u.preferences)?.preferences;
    expect(prefs).toMatchObject({ observation_framework: FRAMEWORK, curriculum: 'nbf' });
  });
});

describe('settings — the confirmation speaks the language she just chose', () => {
  const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');

  it('confirms in Urdu when she switches to Urdu', async () => {
    // The most common Urdu journey: open /settings, switch to Urdu, save. The
    // success screen was hardcoded English, so it told her in English that Rumi
    // would now speak Urdu.
    const S = load({ row: { preferences: {}, preferred_language: 'en' } });
    const res = await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      language: 'ur',
      observation_framework: FRAMEWORK,
    }, 'tok');

    expect(res.data.confirmation_message).toBe(UX_STRINGS.settingsSaved.ur);
    expect(res.data.details_message).toContain('زبان');
  });

  it('confirms in English when she switches to English', async () => {
    const S = load({ row: { preferences: {}, preferred_language: 'ur' } });
    const res = await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      language: 'en',
      observation_framework: FRAMEWORK,
    }, 'tok');

    expect(res.data.confirmation_message).toBe(UX_STRINGS.settingsSaved.en);
  });

  it('uses her existing language on a framework-only save', async () => {
    // No language submitted: the confirmation must still be in HER language,
    // not the floor.
    const S = load({ row: { preferences: {}, preferred_language: 'ur' } });
    const res = await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      observation_framework: FRAMEWORK,
    }, 'tok');

    expect(res.data.confirmation_message).toBe(UX_STRINGS.settingsSaved.ur);
  });

  it('renders no unreplaced placeholder', async () => {
    const S = load({ row: { preferences: {}, preferred_language: 'ur' } });
    const res = await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      language: 'ur',
      observation_framework: FRAMEWORK,
    }, 'tok');

    expect(res.data.details_message).not.toMatch(/\{|\}/);
  });
});

describe('settings — one home for the language, not two', () => {
  it('does not write language into the preferences blob', async () => {
    const S = load({ row: { preferences: {}, preferred_language: 'ur' } });
    await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      language: 'en',
      observation_framework: FRAMEWORK,
    }, 'tok');

    const prefs = updates.find((u) => u.preferences)?.preferences;
    expect(prefs).toBeDefined();
    expect(prefs).not.toHaveProperty('language');
  });

  it('strips a stale language key left in the blob by the old code path', async () => {
    const S = load({ row: { preferences: { language: 'sw', curriculum: 'nbf' }, preferred_language: 'ur' } });
    await S.handleSettingsDataExchange('u1', 'SETTINGS_MAIN', {
      observation_framework: FRAMEWORK,
    }, 'tok');

    const prefs = updates.find((u) => u.preferences)?.preferences;
    expect(prefs).not.toHaveProperty('language');
    expect(prefs).toMatchObject({ curriculum: 'nbf' });
  });

  it('INIT reads the column, not the blob', async () => {
    // With the blob disagreeing, the screen must still show what the bot uses.
    const S = load({ row: { preferences: { language: 'sw' }, preferred_language: 'en', region: 'ict' } });
    const res = await S.handleSettingsInit('u1');
    expect(res.data.current_language).toBe('en');
  });

  it('INIT offers exactly the two registry languages', async () => {
    const S = load({ row: { preferences: {}, preferred_language: 'ur', region: 'ict' } });
    const res = await S.handleSettingsInit('u1');
    expect(res.data.languages.map((l) => l.id)).toEqual(['ur', 'en']);
  });
});
