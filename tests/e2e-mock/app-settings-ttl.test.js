/**
 * The one lane-tunable TTL for app_settings switch caches (bd-0vaqcg), carried to main with #5148, whose
 * lp-whatsapp-off.js reads it. On main only the helper itself is checked here: staging's version of this file also
 * checks that six quiz modules and app-redirect read it, which comes with bd-0vaqcg's own promotion.
 */
describe('bot/shared/config/app-settings-ttl.js', () => {
  const fresh = (env) => { jest.resetModules(); delete process.env.APP_SETTINGS_FLAG_TTL_MS; Object.assign(process.env, env); return require('../../bot/shared/config/app-settings-ttl'); };
  test('unset → 30 s', () => { expect(fresh({}).APP_SETTINGS_FLAG_TTL_MS).toBe(30000); });
  test('a whole number of ms up to an hour is honoured (1000 on the lane)', () => { expect(fresh({ APP_SETTINGS_FLAG_TTL_MS: '1000' }).APP_SETTINGS_FLAG_TTL_MS).toBe(1000); });
  test('anything else keeps 30 s', () => {
    for (const v of ['soon', '0', '-5', '3600001', '1.5']) expect(fresh({ APP_SETTINGS_FLAG_TTL_MS: v }).APP_SETTINGS_FLAG_TTL_MS).toBe(30000);
  });
});
