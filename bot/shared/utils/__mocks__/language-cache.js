/**
 * Mock Language Cache for Testing
 *
 * Keep this in step with the real module's exports. A consumer that calls
 * something absent here fails with "not a function", which reads as a bug in the
 * code under test rather than a gap in the mock.
 */

const getUserLanguage = jest.fn().mockResolvedValue('en');
const setUserLanguage = jest.fn().mockResolvedValue(true);
// Defaults to LOCKED, matching the real module's conservative direction: a caller
// asking this question is deciding whether it may overwrite a teacher's choice,
// and an unconfigured mock must not read as permission.
const isUserLanguageLocked = jest.fn().mockResolvedValue(true);
const clearUserLanguageCache = jest.fn().mockResolvedValue(true);

module.exports = {
  getUserLanguage,
  setUserLanguage,
  isUserLanguageLocked,
  clearUserLanguageCache,
  // Derived, not restated. The real module's VALID_LANGUAGES is the CANONICAL
  // recognition set, which is deliberately BROADER than the two languages we
  // offer — a hardcoded ['en','ur'] here quietly made the mock stricter than the
  // code it stands in for. language-canon is a pure module with no redis or
  // supabase dependency, so requiring it defeats none of the point of this mock.
  VALID_LANGUAGES: [...require('../language-canon').CANONICAL],
  DEFAULT_LANGUAGE: 'en',
};
