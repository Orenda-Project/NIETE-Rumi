/**
 * The portal reads and writes ONE language, through the ONE writer.
 *
 * Two defects this closes, both from the audit's Phase 5:
 *
 *   READ  — the portal's i18n detection order was ['localStorage','navigator',
 *           'htmlTag']. It guessed her language from the BROWSER and never asked
 *           what she had chosen in WhatsApp. So an Urdu-preferring teacher on an
 *           English-locale phone got an English portal, permanently.
 *
 *   WRITE — the switcher called i18n.changeLanguage() and nothing else. It was a
 *           device-local cosmetic: switching in the portal never reached the bot,
 *           so her next WhatsApp message came back in the old language.
 *
 * The architecturally important part is HOW the write happens. The portal API is
 * served by dashboard/, a different service from the bot — so the tempting shortcut
 * is a direct `users.update({ preferred_language })` right there. That would be a
 * SECOND writer, which is the exact defect Phase 1 spent its whole effort removing:
 * a direct column write sets no lock and invalidates no cache, so the 24-hour Redis
 * entry keeps serving the old language and a later recording can overwrite it.
 *
 * dashboard/routes/portal.routes.js already requires from bot/shared/ in several
 * places, so the real writer is reachable. These tests pin that it is used.
 */

const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '../../dashboard/routes/portal.routes.js');
const RAW = fs.readFileSync(ROUTES, 'utf8');
const CODE = RAW
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The language endpoint's own slice of the file, for scoped assertions. */
function endpointBlock(method) {
  const re = new RegExp(`router\\.${method}\\('/me/language'[\\s\\S]*?\\n\\}\\);`, 'm');
  const m = CODE.match(re);
  return m ? m[0] : '';
}

describe('GET /me/language — the portal can ask what she chose', () => {
  const block = endpointBlock('get');

  it('exists', () => {
    expect(block).not.toBe('');
  });

  it('requires an authenticated session', () => {
    // It returns a teacher's stored preference; it must not be readable
    // unauthenticated.
    expect(block).toMatch(/requirePortalAuth/);
  });

  it('reads the session user, never a user id from the request body or query', () => {
    // Trusting a client-supplied id here would let anyone read anyone's setting.
    expect(block).toMatch(/req\.session\.portalUserId/);
    expect(block).not.toMatch(/req\.(body|query|params)\.userId/);
  });

  it('clamps what it returns to the offer', () => {
    // A row written before Phase 1 could still hold an off-market code; the portal
    // has no bundle for it and would fall back silently.
    expect(block).toMatch(/clampLanguage/);
  });
});

describe('PUT /me/language — the switcher becomes a real mutator', () => {
  const block = endpointBlock('put');

  it('exists', () => {
    expect(block).not.toBe('');
  });

  it('requires an authenticated session', () => {
    expect(block).toMatch(/requirePortalAuth/);
  });

  it('writes through the ONE writer, not a direct column update', () => {
    // The whole point. setUserLanguage validates against the offer, sets the lock
    // and invalidates BOTH Redis keys. A direct .update({ preferred_language })
    // here would recreate Phase 1's defect in a second service.
    expect(block).toMatch(/setUserLanguage\s*\(/);
    expect(block).not.toMatch(/preferred_language\s*:/);
  });

  it('locks the choice, because a portal switch is an explicit choice', () => {
    expect(block).toMatch(/setUserLanguage\s*\([^)]*true/);
  });

  it('rejects a language outside the offer rather than storing it', () => {
    expect(block).toMatch(/isOffered|clampLanguage/);
  });

  it('surfaces a writer rejection instead of reporting success', () => {
    // setUserLanguage returns false on rejection. Ignoring that would tell the
    // teacher her language changed when it did not.
    expect(block).toMatch(/40\d|success:\s*false/);
  });
});

describe('the writer is imported from the bot, not reimplemented', () => {
  it('requires language-cache from bot/shared', () => {
    expect(CODE).toMatch(/require\([^)]*bot\/shared\/utils\/language-cache[^)]*\)/);
  });

  it('does not define its own language write helper', () => {
    expect(CODE).not.toMatch(/function\s+setUserLanguage/);
  });
});

describe('the portal front end uses the endpoint', () => {
  const api = fs.readFileSync(
    path.join(__dirname, '../../portal/src/portal/services/api.ts'),
    'utf8'
  );
  // Comments stripped. This is the FIFTH time in this workstream that a
  // source-ordering assertion matched an explanatory comment instead of the code
  // it describes — here the header comment names i18n.changeLanguage() while
  // explaining why it must come second, which put the "render" match before the
  // "write" match and failed a correct implementation.
  const switcher = fs
    .readFileSync(path.join(__dirname, '../../portal/src/components/LanguageSwitcher.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the api client exposes get + set language', () => {
    expect(api).toMatch(/me\/language/);
  });

  it('the switcher persists before it re-renders', () => {
    // If changeLanguage ran first and the write failed, the UI would show a
    // language the bot does not know about.
    expect(switcher).toMatch(/languageApi\.set|me\/language/);
    // The WRITE is languageApi.set(); the RENDER is i18n.changeLanguage(). Anchored
    // to i18n. so the local wrapper named changeLanguage is not what gets matched.
    const write = switcher.search(/languageApi\.set\s*\(/);
    const render = switcher.search(/i18n\.changeLanguage\s*\(/);
    expect(write).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(-1);
    expect(write).toBeLessThan(render);
  });
});
