/**
 * The module lists beside the query goldens (copy-deck-lift.modules.json, web-quiz-strip-dry.modules.json,
 * web-quiz-fixture.modules.json) are compared only inside the web quiz's own paths (web-quiz-owned-paths.js): a module
 * another team adds that a gate happens to load (on any tier's tree) neither fails the list nor needs a calibration;
 * a change among our own modules still fails it.
 */
const { OWNED, ownedOnly } = require('./web-quiz-owned-paths');

describe('the owned-paths filter', () => {
  const listed = ['bot/shared/config/copy.v2.json', 'bot/shared/services/quiz/web-quiz-strip.js', 'scripts/web-quiz/strip-dry.js'];

  test('a foreign module in the cache does not change the owned list', () => {
    const reached = [...listed, 'bot/shared/templates/coach-visit-request.template.js', 'bot/shared/services/lp-v8-catalog.service.js'];
    expect(ownedOnly(reached)).toEqual(ownedOnly(listed));
  });

  test('a new module of ours does change it, and so does one of ours that is gone', () => {
    expect(ownedOnly([...listed, 'bot/shared/services/quiz/web-quiz-new.js'])).not.toEqual(ownedOnly(listed));
    expect(ownedOnly(listed.slice(1))).not.toEqual(ownedOnly(listed));
  });

  test('the shared switch cache is ours as the exact file, not its folder', () => {
    // Our switch modules read through it, so a change to it alone must still reach the train tool.
    expect(OWNED).toContain('bot/shared/services/settings/switch-cache.js');
    expect(ownedOnly(['bot/shared/services/settings/switch-cache.js'])).toEqual(['bot/shared/services/settings/switch-cache.js']);
    expect(ownedOnly(['bot/shared/services/settings/other-settings.js'])).toEqual([]);
  });

  test('the owned prefixes, sorted output, no duplicates', () => {
    expect(OWNED).toEqual(expect.arrayContaining(['bot/shared/services/quiz/', 'bot/shared/services/child-test/', 'bot/shared/config/copy',
      'bot/shared/templates/class-round', 'bot/shared/templates/teacher-jugnu', 'dashboard/public/wq/', 'scripts/web-quiz/']));
    expect(ownedOnly(['scripts/web-quiz/b.js', 'bot/shared/services/quiz/a.js', 'scripts/web-quiz/b.js'])).toEqual(['bot/shared/services/quiz/a.js', 'scripts/web-quiz/b.js']);
  });
});
