/**
 * Settings flow — region-config (region-agnostic default framework),
 * settings-config (language dropdown, now derived from the language registry
 * rather than an environment variable), and the settings-endpoint
 * INIT / data_exchange / BACK handlers.
 *
 * All bot-only deps (supabase, logger, language-cache) are mocked so the suite
 * runs at the repo root before `bot/` deps are installed (CI test-ordering trap).
 */

const fs = require('fs');
const path = require('path');

function makeSupabaseChain(result = { data: null, error: null }) {
  const chain = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.single = jest.fn().mockResolvedValue(result);
  chain.maybeSingle = jest.fn().mockResolvedValue(result);
  chain.then = (resolve) => resolve(result);
  return chain;
}

// ── region-config ──────────────────────────────────────────────────────────
describe('region-config', () => {
  const ORIG = { ...process.env };
  afterEach(() => { process.env = { ...ORIG }; jest.resetModules(); });

  it('defaults the framework to OECD when no env is set', () => {
    jest.resetModules();
    delete process.env.DEFAULT_OBSERVATION_FRAMEWORK;
    delete process.env.REGION_FRAMEWORK_MAP;
    const rc = require('../../bot/shared/config/region-config');
    expect(rc.DEFAULT_FRAMEWORK).toBe('oecd');
    expect(rc.defaultFrameworkForRegion('anywhere')).toBe('oecd');
    expect(rc.defaultFrameworkForRegion('')).toBe('oecd');
    expect(rc.defaultFrameworkForRegion(undefined)).toBe('oecd');
  });

  it('honours DEFAULT_OBSERVATION_FRAMEWORK', () => {
    jest.resetModules();
    process.env.DEFAULT_OBSERVATION_FRAMEWORK = 'teach';
    const rc = require('../../bot/shared/config/region-config');
    expect(rc.defaultFrameworkForRegion('xyz')).toBe('teach');
  });

  it('applies REGION_FRAMEWORK_MAP overrides (case-insensitive), ignoring unknown framework keys', () => {
    jest.resetModules();
    process.env.REGION_FRAMEWORK_MAP = JSON.stringify({ punjab: 'hots', coast: 'bogus' });
    const rc = require('../../bot/shared/config/region-config');
    expect(rc.defaultFrameworkForRegion('Punjab')).toBe('hots'); // mapped + valid
    expect(rc.defaultFrameworkForRegion('coast')).toBe('oecd');   // mapped but invalid → default
    expect(rc.defaultFrameworkForRegion('elsewhere')).toBe('oecd');
  });

  it('survives malformed REGION_FRAMEWORK_MAP JSON', () => {
    jest.resetModules();
    process.env.REGION_FRAMEWORK_MAP = 'not json{';
    const rc = require('../../bot/shared/config/region-config');
    expect(rc.defaultFrameworkForRegion('punjab')).toBe('oecd');
  });

  it('has no hardcoded region names in the source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/config/region-config.js'), 'utf8'
    );
    expect(src).not.toMatch(/HOTS_DEFAULT_REGIONS/);
    expect(src.toLowerCase()).not.toContain('rawalpindi');
  });
});

// ── settings-config ──────────────────────────────────────────────────────────
describe('settings-config', () => {
  const ORIG = { ...process.env };
  afterEach(() => { process.env = { ...ORIG }; jest.resetModules(); });

  // These three expectations changed deliberately. They encoded the defect:
  // the dropdown was env-driven with a five-language fallback, the variable was
  // not set on this deployment, so ICT teachers were offered Kiswahili, Arabic
  // and Spanish — and a MALFORMED value produced that same list, so a typo could
  // not be detected by reading the config. The list now derives from the language
  // registry, which is the single source of truth for what we serve.

  it('exposes the registry offer as {id,title} objects, Urdu first', () => {
    jest.resetModules();
    const { LANGUAGES_DROPDOWN, FRAMEWORKS_DROPDOWN } = require('../../bot/shared/config/settings-config');
    // Urdu leads because ICT government-school teaching is predominantly
    // Urdu-medium; the first entry is also the default for a teacher who has
    // not chosen. This used to expect English first.
    expect(LANGUAGES_DROPDOWN.map(l => l.id)).toEqual(['ur', 'en']);
    LANGUAGES_DROPDOWN.forEach(l => { expect(l).toHaveProperty('id'); expect(l).toHaveProperty('title'); });
    // frameworks derived from region-config labels
    expect(FRAMEWORKS_DROPDOWN.map(f => f.id).sort()).toEqual(['fico', 'hots', 'oecd', 'teach']);
  });

  it('IGNORES SETTINGS_LANGUAGES — the offer is code, not configuration', () => {
    jest.resetModules();
    process.env.SETTINGS_LANGUAGES = JSON.stringify([{ id: 'sw', title: 'Kiswahili' }]);
    const { LANGUAGES_DROPDOWN } = require('../../bot/shared/config/settings-config');
    // An environment variable must not be able to offer a language the
    // deployment cannot serve. Previously this override was honoured.
    expect(LANGUAGES_DROPDOWN.map(l => l.id)).toEqual(['ur', 'en']);
  });

  it('cannot be broken by a malformed or empty SETTINGS_LANGUAGES', () => {
    for (const value of ['[]', 'broken', '', undefined]) {
      jest.resetModules();
      if (value === undefined) delete process.env.SETTINGS_LANGUAGES;
      else process.env.SETTINGS_LANGUAGES = value;
      const cfg = require('../../bot/shared/config/settings-config');
      expect(cfg.LANGUAGES_DROPDOWN.map(l => l.id)).toEqual(['ur', 'en']);
    }
  });

  it('offers no language this deployment does not serve', () => {
    jest.resetModules();
    const { LANGUAGES_DROPDOWN } = require('../../bot/shared/config/settings-config');
    const ids = LANGUAGES_DROPDOWN.map(l => l.id);
    for (const off of ['sw', 'ar', 'es', 'pa-PK', 'sd-PK', 'ps-PK', 'bal-PK', 'ta-LK']) {
      expect(ids).not.toContain(off);
    }
  });
});

// ── settings-endpoint ────────────────────────────────────────────────────────
describe('settings-endpoint', () => {
  let endpoint;
  let setUserLanguageSpy;
  let supabaseFrom;
  let updateSpy;

  function loadEndpoint(userRow) {
    jest.resetModules();
    delete process.env.DEFAULT_OBSERVATION_FRAMEWORK;
    delete process.env.REGION_FRAMEWORK_MAP;
    delete process.env.SETTINGS_LANGUAGES;
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    updateSpy = jest.fn(() => chainFor({ data: null, error: null }));
    function chainFor(result) {
      const chain = makeSupabaseChain(result);
      chain.update = updateSpy;
      return chain;
    }
    supabaseFrom = jest.fn(() => chainFor({ data: userRow, error: null }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: supabaseFrom }));
    // Language now goes through the one writer. Mocked here both to assert the
    // call and because the real module pulls in the Redis client.
    setUserLanguageSpy = jest.fn().mockResolvedValue(true);
    jest.doMock('../../bot/shared/utils/language-cache', () => ({
      setUserLanguage: setUserLanguageSpy,
    }));
    endpoint = require('../../bot/shared/routes/settings-endpoint');
  }

  it('INIT returns SETTINGS_MAIN with dropdowns + current values', async () => {
    loadEndpoint({ preferred_language: 'ur', preferences: {}, region: '' });
    const res = await endpoint.handleSettingsInit('user-1');
    expect(res.screen).toBe('SETTINGS_MAIN');
    expect(Array.isArray(res.data.languages)).toBe(true);
    expect(Array.isArray(res.data.frameworks)).toBe(true);
    expect(res.data.current_language).toBe('ur');
    expect(res.data.current_framework).toBe('oecd'); // region default
    expect(res.data.info_text).toContain('OECD');
  });

  it('INIT uses a per-region framework override when configured', async () => {
    jest.resetModules();
    process.env.REGION_FRAMEWORK_MAP = JSON.stringify({ punjab: 'hots' });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: () => makeSupabaseChain({ data: { preferred_language: 'en', preferences: {}, region: 'punjab' }, error: null }),
    }));
    const ep = require('../../bot/shared/routes/settings-endpoint');
    const res = await ep.handleSettingsInit('user-2');
    expect(res.data.current_framework).toBe('hots');
    delete process.env.REGION_FRAMEWORK_MAP;
  });

  // Rewritten deliberately. This previously submitted 'sw' and asserted that
  // Kiswahili was written to BOTH preferred_language and preferences.language.
  // All three parts of that are now wrong by design: Kiswahili is not offered,
  // the column is written only by the writer, and language no longer lives in
  // the preferences blob (the dual store is what let the screen and the bot
  // disagree permanently).
  it('data_exchange on SETTINGS_MAIN persists the framework and delegates language to the writer', async () => {
    loadEndpoint({ preferences: { curriculum: 'national' }, preferred_language: 'ur' });
    const res = await endpoint.handleSettingsDataExchange(
      'user-3', 'SETTINGS_MAIN',
      { language: 'en', observation_framework: 'teach' },
      'user-3:settings:123'
    );
    expect(res.screen).toBe('SUCCESS');
    expect(res.data.details_message).toContain('English');
    expect(res.data.details_message).toContain('Teach');
    expect(res.data.extension_message_response.params.flow_token).toBe('user-3:settings:123');

    // Language: through the writer, locked, and never written to the column here.
    expect(setUserLanguageSpy).toHaveBeenCalledWith('user-3', 'en', true);
    expect(updateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ preferred_language: expect.anything() })
    );

    // Framework: still merged into the blob, existing keys preserved, and the
    // blob carries no language key.
    const prefsWrite = updateSpy.mock.calls.map(c => c[0]).find(p => p && p.preferences);
    expect(prefsWrite.preferences).toMatchObject({ curriculum: 'national', observation_framework: 'teach' });
    expect(prefsWrite.preferences).not.toHaveProperty('language');
  });

  it('data_exchange rejects an unsupported framework', async () => {
    loadEndpoint({ preferences: {} });
    const res = await endpoint.handleSettingsDataExchange(
      'user-4', 'SETTINGS_MAIN', { language: 'en', observation_framework: 'nonsense' }, 'tok'
    );
    expect(res.data.error).toBeDefined();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('data_exchange on an unknown screen returns an error', async () => {
    loadEndpoint({ preferences: {} });
    const res = await endpoint.handleSettingsDataExchange('user-5', 'MYSTERY', {}, 'tok');
    expect(res.data.error).toBeDefined();
  });

  it('BACK returns the SETTINGS_MAIN init payload', async () => {
    loadEndpoint({ preferred_language: 'en', preferences: {}, region: '' });
    const res = await endpoint.handleSettingsBack('user-6', 'SUCCESS', 'tok');
    expect(res.screen).toBe('SETTINGS_MAIN');
  });
});

// ── flow JSON + leak gate ─────────────────────────────────────────────────────
describe('settings-flow.json', () => {
  const flowPath = path.join(__dirname, '../../docs/flows/settings-flow.json');

  it('is valid JSON with SETTINGS_MAIN → SUCCESS routing', () => {
    const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
    expect(flow.routing_model.SETTINGS_MAIN).toEqual(['SUCCESS']);
    const ids = flow.screens.map(s => s.id);
    expect(ids).toContain('SETTINGS_MAIN');
    expect(ids).toContain('SUCCESS');
  });

  it('is leak-free (no internal phone/name/path/bead tokens)', () => {
    const raw = fs.readFileSync(flowPath, 'utf8');
    const endpointSrc = fs.readFileSync(path.join(__dirname, '../../bot/shared/routes/settings-endpoint.js'), 'utf8');
    for (const banned of ['+92', '+255', '0329', '5012345', 'Taleemabad', 'Rawalpindi', 'TaleemHub', 'bd-', 'PROJ-', 'Silverleaf']) {
      expect(raw).not.toContain(banned);
      expect(endpointSrc).not.toContain(banned);
    }
  });
});
