'use strict';
/**
 * The watch root (app_settings VALUE web_quiz_watch_root) as the videos module reads it: one spelling, the same as the
 * other watch-root readers (trimmed, lower case). Anything that is not an id, or a failed read, is no root.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const supabase = require('../../../shared/config/supabase');
const Videos = require('../../../shared/services/quiz/web-quiz-videos');

function stored(value, { fail = false } = {}) {
  supabase.from = (table) => {
    expect(table).toBe('app_settings');
    const q = { select: () => q, eq: () => q, maybeSingle: async () => { if (fail) throw new Error('down'); return { data: value === undefined ? null : { value }, error: null }; } };
    return q;
  };
}
const ID = '6f861416-a578-412d-b7b3-4d03046fecd9';

test('a padded upper-case id (a JSON string) is read as the lower-case id', async () => {
  stored(JSON.stringify('  6F861416-A578-412D-B7B3-4D03046FECD9 '));
  await expect(Videos.watchRoot()).resolves.toBe(ID);
});
test('a padded upper-case id stored as a plain string is read the same', async () => {
  stored('  6F861416-A578-412D-B7B3-4D03046FECD9 ');
  await expect(Videos.watchRoot()).resolves.toBe(ID);
});
test('today\'s spelling still reads as it is', async () => {
  stored(JSON.stringify(ID));
  await expect(Videos.watchRoot()).resolves.toBe(ID);
});
test('not an id, absent, or a failed read: no root', async () => {
  stored(JSON.stringify('not-a-share-code'));
  await expect(Videos.watchRoot()).resolves.toBeNull();
  stored(undefined);
  await expect(Videos.watchRoot()).resolves.toBeNull();
  stored(null, { fail: true });
  await expect(Videos.watchRoot()).resolves.toBeNull();
});
