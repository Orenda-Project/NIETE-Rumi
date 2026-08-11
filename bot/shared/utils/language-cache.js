/**
 * Language Cache Utilities
 * Redis-backed caching for user language preferences with PostgreSQL fallback
 *
 * Phase 2: Language Architecture
 *
 * Features:
 * - Fast Redis lookups with 24-hour TTL
 * - PostgreSQL persistence as source of truth
 * - Automatic cache invalidation on updates
 * - Fail-safe fallback to database if Redis unavailable
 *
 * Key Pattern: user:language:{user_id}
 * TTL: 86400 seconds (24 hours)
 */

const redisService = require('../services/cache/railway-redis.service');
const supabase = require('../config/supabase');
const { logToFile } = require('./logger');
const { CANONICAL } = require('./language-canon');
const { isOffered, LANGUAGE_OFFER } = require('../config/languages');

/**
 * Language codes we can RECOGNISE — deliberately broader than what we OFFER.
 *
 * Two different questions, two different lists:
 *   - "can I make sense of this code?"  -> CANONICAL (here). Broad, because
 *     telemetry must be able to record that we detected or emitted something
 *     off-market. That is how the current leak was found.
 *   - "may this be STORED as a teacher's preference?" -> isOffered() from the
 *     registry. Narrow: exactly the two languages this deployment serves.
 *
 * Conflating them either lets an off-market language be stored, or blinds the
 * detector and the telemetry to anything outside the offer.
 */
const VALID_LANGUAGES = [...CANONICAL];

/**
 * The emergency floor when no language can be determined.
 *
 * English by resolved decision, and NOT the same thing as the registry's
 * offerDefaultLanguage() (Urdu — what a teacher is offered first). An Urdu floor
 * would be the same silent-wrong-language error in the other direction.
 */
const DEFAULT_LANGUAGE = 'en';
const CACHE_TTL = 86400; // 24 hours

/**
 * Get user's preferred language
 * Checks Redis cache first, falls back to database
 *
 * @param {string} userId - User ID from users table
 * @returns {Promise<string>} Language code (en, es, ur, ar, pa-PK, ps-PK, sd-PK, bal-PK, ta-LK)
 */
async function getUserLanguage(userId) {
  if (!userId) {
    logToFile('⚠️  getUserLanguage: No userId provided', { level: 'warn' });
    return DEFAULT_LANGUAGE;
  }

  try {
    // Step 1: Try Redis cache first
    const cacheKey = `user:language:${userId}`;
    const cached = await redisService.get(cacheKey);

    if (cached && VALID_LANGUAGES.includes(cached)) {
      logToFile('✅ Language from cache', { userId, language: cached });
      return cached;
    }

    // Step 2: Cache miss - fetch from database
    const { data, error } = await supabase
      .from('users')
      .select('preferred_language')
      .eq('id', userId)
      .single();

    if (error) {
      logToFile('❌ Failed to fetch user language from DB', {
        userId,
        error: error.message
      });
      return DEFAULT_LANGUAGE;
    }

    const language = data?.preferred_language || DEFAULT_LANGUAGE;

    // Validate language code
    if (!VALID_LANGUAGES.includes(language)) {
      logToFile('⚠️  Invalid language in DB, using default', {
        userId,
        invalidLanguage: language,
        defaultLanguage: DEFAULT_LANGUAGE
      });
      return DEFAULT_LANGUAGE;
    }

    // Step 3: Update cache for next time
    await redisService.set(cacheKey, language, CACHE_TTL);

    logToFile('✅ Language from DB (cached)', { userId, language });
    return language;

  } catch (error) {
    logToFile('❌ Error in getUserLanguage', {
      userId,
      error: error.message
    });
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Set user's preferred language and lock status
 * Updates both database and Redis cache atomically
 *
 * IMPORTANT: This is the SINGLE source of truth for language updates.
 * All language changes should go through this function to avoid duplication.
 *
 * @param {string} userId - User ID from users table
 * @param {string} languageCode - Language code (en, es, ur, ar, pa-PK, ps-PK, sd-PK, bal-PK, ta-LK)
 * @param {boolean} lockLanguage - Whether to lock the language (default: true)
 *                                 - true: User explicitly selected this language, use it always
 *                                 - false: Auto-detect mode, may change based on detection
 * @returns {Promise<boolean>} Success status
 */
async function setUserLanguage(userId, languageCode, lockLanguage = true) {
  if (!userId) {
    logToFile('⚠️  setUserLanguage: No userId provided', { level: 'warn' });
    return false;
  }

  // THE enforcement point. Nothing may be stored as a teacher's preference
  // unless this deployment actually serves it.
  //
  // This lives inside the writer rather than at each caller for a reason: the
  // clamp already existed as isMarketLanguage() but only guarded two of the
  // paths that wrote language, so the coaching-audio path could persist pa-PK or
  // ar onto an ICT teacher. Every read surface would then fold her back to
  // English and her Urdu was gone with no visible cause. Enforcement a caller
  // can forget is not enforcement.
  if (!isOffered(languageCode)) {
    logToFile('❌ Rejected language write — not in this deployment\'s offer', {
      userId,
      languageCode,
      offer: LANGUAGE_OFFER
    });
    return false;
  }

  try {
    // Step 1: Update database (source of truth) - BOTH fields
    const { error } = await supabase
      .from('users')
      .update({
        preferred_language: languageCode,
        language_locked: lockLanguage,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (error) {
      logToFile('❌ Failed to update user language in DB', {
        userId,
        languageCode,
        lockLanguage,
        error: error.message
      });
      return false;
    }

    // Step 2: Update Redis cache for preferred_language
    const cacheKey = `user:language:${userId}`;
    await redisService.set(cacheKey, languageCode, CACHE_TTL);

    // Step 3: Also cache the lock status
    const lockCacheKey = `user:language_locked:${userId}`;
    await redisService.set(lockCacheKey, lockLanguage.toString(), CACHE_TTL);

    logToFile('✅ User language updated', {
      userId,
      newLanguage: languageCode,
      languageLocked: lockLanguage
    });

    return true;

  } catch (error) {
    logToFile('❌ Error in setUserLanguage', {
      userId,
      languageCode,
      lockLanguage,
      error: error.message
    });
    return false;
  }
}

/*
 * setLanguageLock() was here, and is deliberately gone.
 *
 * Its only purpose was to set language_locked WITHOUT changing the language —
 * and its only caller was the "Auto-detect" picker row, whose effect was to
 * UNLOCK a teacher's preference. Unlocking is the precise mechanism that let a
 * classroom recording overwrite a choice she had made, which is the defect this
 * workstream exists to remove. Auto-detect was deleted in Phase 1; this left a
 * function whose entire job is to re-open that door, exported and callable.
 *
 * A deletion rather than a deprecation comment, because "don't call this" is not
 * enforcement — the audit is full of clamps that were correct at every site and
 * still drifted. Locking now happens only as part of setUserLanguage(), where it
 * is set as a consequence of an actual, explicit choice.
 *
 * If a future feature genuinely needs to unlock (e.g. an explicit "let Rumi
 * decide" setting), it should be reintroduced with a caller, a test, and a
 * decision recorded — not resurrected from a dead export.
 */

/**
 * Has this teacher explicitly chosen her language?
 *
 * The lock column existed and the writer set it, but nothing ever READ it — so
 * an explicit choice made in /settings or /language carried no weight, and the
 * coaching-audio path could overwrite it. This is that missing reader.
 *
 * On any failure it reports LOCKED. That is the conservative direction: a caller
 * asking this question is deciding whether it may overwrite her preference, and
 * "I could not tell" must never become "go ahead".
 *
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isUserLanguageLocked(userId) {
  if (!userId) return true;

  const lockCacheKey = `user:language_locked:${userId}`;
  try {
    const cached = await redisService.get(lockCacheKey);
    if (cached === 'true') return true;
    if (cached === 'false') return false;

    const { data, error } = await supabase
      .from('users')
      .select('language_locked')
      .eq('id', userId)
      .single();

    // No row is just as much "cannot tell" as an error is — an absent user
    // cannot have consented to an overwrite.
    if (error || !data) {
      logToFile('⚠️  Could not read language lock — treating as locked', {
        userId,
        error: error?.message || 'no row'
      });
      return true;
    }

    const locked = data.language_locked === true;
    await redisService.set(lockCacheKey, locked.toString(), CACHE_TTL);
    return locked;
  } catch (error) {
    logToFile('⚠️  Error reading language lock — treating as locked', {
      userId,
      error: error.message
    });
    return true;
  }
}

/**
 * Clear user's language cache
 * Forces next lookup to fetch from database
 *
 * Use cases:
 * - Manual cache invalidation
 * - After database migrations
 * - Testing/debugging
 *
 * @param {string} userId - User ID from users table
 * @returns {Promise<boolean>} Success status
 */
async function clearUserLanguageCache(userId) {
  if (!userId) {
    logToFile('⚠️  clearUserLanguageCache: No userId provided', { level: 'warn' });
    return false;
  }

  try {
    // Clear both language and lock cache keys
    const cacheKey = `user:language:${userId}`;
    const lockCacheKey = `user:language_locked:${userId}`;

    await Promise.all([
      redisService.delete(cacheKey),
      redisService.delete(lockCacheKey)
    ]);

    logToFile('✅ Language cache cleared', { userId });
    return true;

  } catch (error) {
    logToFile('❌ Error clearing language cache', {
      userId,
      error: error.message
    });
    return false;
  }
}

/**
 * Batch prefetch language preferences for multiple users
 * Useful for warming cache before bulk operations
 *
 * @param {string[]} userIds - Array of user IDs
 * @returns {Promise<Map<string, string>>} Map of userId -> languageCode
 */
async function prefetchLanguages(userIds) {
  if (!userIds || userIds.length === 0) {
    return new Map();
  }

  try {
    const languageMap = new Map();

    // Fetch all users' languages from database
    const { data, error } = await supabase
      .from('users')
      .select('id, preferred_language')
      .in('id', userIds);

    if (error) {
      logToFile('❌ Failed to prefetch languages', {
        userCount: userIds.length,
        error: error.message
      });
      return languageMap;
    }

    // Cache each language and build map
    for (const user of data) {
      const language = VALID_LANGUAGES.includes(user.preferred_language)
        ? user.preferred_language
        : DEFAULT_LANGUAGE;

      languageMap.set(user.id, language);

      // Update cache
      const cacheKey = `user:language:${user.id}`;
      await redisService.set(cacheKey, language, CACHE_TTL);
    }

    logToFile('✅ Languages prefetched', {
      userCount: data.length,
      cached: languageMap.size
    });

    return languageMap;

  } catch (error) {
    logToFile('❌ Error prefetching languages', {
      userCount: userIds.length,
      error: error.message
    });
    return new Map();
  }
}

/**
 * Get language statistics
 * Useful for analytics and monitoring
 *
 * @returns {Promise<object>} Language distribution stats
 */
async function getLanguageStats() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('preferred_language');

    if (error) {
      logToFile('❌ Failed to fetch language stats', { error: error.message });
      return null;
    }

    // Count by language
    const stats = data.reduce((acc, user) => {
      const lang = user.preferred_language || DEFAULT_LANGUAGE;
      acc[lang] = (acc[lang] || 0) + 1;
      return acc;
    }, {});

    logToFile('📊 Language statistics', stats);
    return stats;

  } catch (error) {
    logToFile('❌ Error getting language stats', { error: error.message });
    return null;
  }
}

// Phone-based function removed - use getUserLanguage(user.id) instead

// Phone-based function removed - use setUserLanguage(user.id, languageCode) instead

module.exports = {
  getUserLanguage,
  setUserLanguage,
  isUserLanguageLocked,
  clearUserLanguageCache,
  prefetchLanguages,
  getLanguageStats,
  VALID_LANGUAGES,
  DEFAULT_LANGUAGE
};
