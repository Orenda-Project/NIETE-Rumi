/**
 * @supabase/supabase-js stub for the root test suite.
 *
 * The package is a runtime dependency of bot/ but not of the root, and the root
 * test job runs before bot deps install — so any suite whose require chain reached
 * bot/shared/config/supabase.js died on an unresolved module instead of on its own
 * assertions. Same case and same fix as the dotenv, pg and AWS stubs beside it.
 *
 * createClient returns a chainable builder whose terminals resolve EMPTY. A test
 * that needs rows should mock the service it is exercising rather than reach
 * through to this stub: resolving empty keeps a forgotten mock surfacing as an
 * assertion failure on the data, not as an unresolved-module crash.
 */

const emptyOne = () => Promise.resolve({ data: null, error: null });
const emptyMany = () => Promise.resolve({ data: [], error: null });

function builder() {
  const b = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq',
                   'gt', 'gte', 'lt', 'lte', 'in', 'is', 'not', 'or', 'filter',
                   'like', 'ilike', 'contains', 'order', 'limit', 'range',
                   'returns', 'match', 'overlaps']) {
    b[m] = jest.fn(() => b);
  }
  b.single = jest.fn(emptyOne);
  b.maybeSingle = jest.fn(emptyOne);
  // Awaiting the builder itself is a valid terminal in supabase-js.
  b.then = (resolve, reject) => emptyMany().then(resolve, reject);
  return b;
}

const createClient = jest.fn(() => ({
  from: jest.fn(() => builder()),
  rpc: jest.fn(emptyMany),
  auth: {
    getUser: jest.fn(emptyOne),
    signOut: jest.fn(() => Promise.resolve({ error: null })),
  },
  storage: {
    from: jest.fn(() => ({
      upload: jest.fn(emptyOne),
      download: jest.fn(emptyOne),
      remove: jest.fn(emptyOne),
      createSignedUrl: jest.fn(() => Promise.resolve({ data: { signedUrl: '' }, error: null })),
    })),
  },
}));

module.exports = { createClient };
module.exports.default = module.exports;
