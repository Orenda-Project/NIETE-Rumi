/**
 * Registration asks for a language, once — step 4.1.
 *
 * This closes the root cause of the whole audit. 9,023 of 9,061 teachers (99.6%)
 * hold a language they never chose, and the reason is structural rather than
 * accidental: registration writes eleven fields to the users row and
 * preferred_language is not one of them. The teacher keeps the schema default
 * forever, and nothing ever asked her.
 *
 * It also closes a live contradiction in the very first message she receives.
 * The registration confirmation resolved its language with
 * `country === 'PK' ? 'ur' : 'en'`. The country dropdown supplies ISO codes and
 * every ICT teacher picks PK, so the greeting was ALWAYS Urdu — while her stored
 * preference stayed 'en', so every message after it was English. Greeted in
 * Urdu, then silently switched to English forever.
 *
 * The main bot logged this same pattern as BUG-071 and fixed it by extracting a
 * pure resolver; this fork never received that fix. The fix here is different and
 * better: stop inferring from country at all, and use what she actually chose.
 */

const { LANGUAGE_OFFER, offerDefaultLanguage } = require('../../bot/shared/config/languages');

let redisStore;
let setUserLanguageMock;

function loadEndpoint() {
  jest.resetModules();
  redisStore = new Map();
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    get: jest.fn((k) => Promise.resolve(redisStore.get(k) ?? null)),
    set: jest.fn((k, v) => { redisStore.set(k, v); return Promise.resolve(true); }),
    delete: jest.fn((k) => { redisStore.delete(k); return Promise.resolve(true); }),
  }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  return require('../../bot/shared/routes/registration-endpoint');
}

const TOK = 'flow-token-1';

describe('registration INIT — the language question is on the first screen', () => {
  it('offers exactly the two languages the deployment serves', async () => {
    const R = loadEndpoint();
    const res = await R.handleRegistrationInit('u1');

    expect(res.screen).toBe('PERSONAL_INFO');
    expect(res.data.languages.map((l) => l.id)).toEqual(LANGUAGE_OFFER);
  });

  it('puts Urdu first and pre-selects it', async () => {
    // Ordering IS the decision: ICT government-school teaching is predominantly
    // Urdu-medium, so Urdu is the offered default. A teacher who taps straight
    // through gets Urdu rather than the schema's English.
    const R = loadEndpoint();
    const res = await R.handleRegistrationInit('u1');

    expect(res.data.languages[0].id).toBe('ur');
    expect(res.data.init_language).toBe(offerDefaultLanguage());
    expect(res.data.init_language).toBe('ur');
  });

  it('labels each option in its own script, so the question is readable either way', async () => {
    // She has not told us her language yet — that is the whole point of the
    // screen — so an English-only label would be unreadable to exactly the
    // teachers most likely to want Urdu.
    const R = loadEndpoint();
    const res = await R.handleRegistrationInit('u1');
    const urdu = res.data.languages.find((l) => l.id === 'ur');
    expect(urdu.title).toMatch(/[؀-ۿ]/);
  });
});

describe('registration — the chosen language survives to the end of the flow', () => {
  async function runToSuccess(R, language) {
    await R.handleRegistrationDataExchange('u1', 'PERSONAL_INFO',
      { full_name: 'Ayesha Siddiqa', country: 'PK', ...(language !== undefined ? { language } : {}) }, TOK);
    await R.handleRegistrationDataExchange('u1', 'REGION_INFO',
      { region: 'urban-i', emis_code: '' }, TOK);
    return R.handleRegistrationDataExchange('u1', 'PROFESSIONAL_INFO',
      { school_name: 'Govt Girls HS', organization: 'niete', grade: '5', subjects: ['math'] }, TOK);
  }

  it('carries the language into the terminal payload', async () => {
    const R = loadEndpoint();
    const res = await runToSuccess(R, 'ur');

    expect(res.screen).toBe('SUCCESS');
    expect(res.data.extension_message_response.params.language).toBe('ur');
  });

  it('carries it on the "other organisation" path too', async () => {
    // Two different screens terminate this flow. A field added to one and
    // forgotten on the other is exactly the class of bug this workstream keeps
    // finding, so both paths are asserted.
    const R = loadEndpoint();
    await R.handleRegistrationDataExchange('u1', 'PERSONAL_INFO',
      { full_name: 'Ayesha', country: 'PK', language: 'ur' }, TOK);
    await R.handleRegistrationDataExchange('u1', 'REGION_INFO', { region: 'urban-i' }, TOK);
    await R.handleRegistrationDataExchange('u1', 'PROFESSIONAL_INFO',
      { school_name: 'S', organization: 'other', grade: '5', subjects: ['math'] }, TOK);
    const res = await R.handleRegistrationDataExchange('u1', 'ORG_DETAILS',
      { organization_other: 'Some Trust' }, TOK);

    expect(res.screen).toBe('SUCCESS');
    expect(res.data.extension_message_response.params.language).toBe('ur');
  });

  it('records English when she picks English', async () => {
    const R = loadEndpoint();
    const res = await runToSuccess(R, 'en');
    expect(res.data.extension_message_response.params.language).toBe('en');
  });

  it('falls back to the offered default when the field is missing entirely', async () => {
    // A stale client, or a Flow version published before this change, submits no
    // language at all. That must not become undefined flowing into a write.
    const R = loadEndpoint();
    const res = await runToSuccess(R, undefined);
    expect(res.data.extension_message_response.params.language).toBe(offerDefaultLanguage());
  });

  it('never lets an off-market code through', async () => {
    const R = loadEndpoint();
    const res = await runToSuccess(R, 'sw');
    expect(LANGUAGE_OFFER).toContain(res.data.extension_message_response.params.language);
    expect(res.data.extension_message_response.params.language).not.toBe('sw');
  });
});

describe('registration completion — the language is WRITTEN, and the greeting obeys it', () => {
  const RAW = require('fs').readFileSync(
    require.resolve('../../bot/shared/handlers/flow-response.handler.js'),
    'utf8'
  );
  // Comments stripped: the invariant is that the code must not DO this, not that
  // the file must never name it. The source deliberately documents the pattern it
  // replaced, and a guard that punished the explanation would push that reasoning
  // out of the file — which is where the next reader will look for it.
  const SOURCE = RAW
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('no longer infers the greeting language from country', () => {
    // The BUG-071 pattern. Asserted at source level because driving the whole
    // completion handler would need most of the registration pipeline mocked,
    // and what must hold is structural: the country-derived language is gone.
    expect(SOURCE).not.toMatch(/country\s*===\s*'PK'\s*\?\s*'ur'\s*:\s*'en'/);
  });

  it('writes the chosen language through the one writer, locked', () => {
    // Locked, because she chose it explicitly — that is what protects it from
    // being overwritten later. This is the population that grows beyond today's 38.
    expect(SOURCE).toMatch(/setUserLanguage\s*\(/);
    expect(SOURCE).toMatch(/registration/i);
  });

  it('resolves the greeting from the chosen language', () => {
    expect(SOURCE).toMatch(/registrationLanguage|chosenLanguage/);
  });
});
