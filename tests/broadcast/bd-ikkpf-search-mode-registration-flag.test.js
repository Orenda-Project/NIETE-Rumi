/**
 * bd-ikkpf — search mode must not re-filter an explicitly chosen cohort on
 * `registration_completed`.
 *
 * `registration_completed` records completion of the in-bot registration Flow.
 * On NIETE production it is true for 472 of 15,006 teachers (3.1%), while 0
 * teachers lack a phone number and 11,507 have messaged the bot. So the flag is
 * a product-funnel signal, not reachability and not consent.
 *
 * Search mode receives a cohort the operator selected BY ID. Re-filtering it on
 * that flag dropped the Grades 6-12 LP broadcast from 498 teachers to 19, and
 * the count-equality safety check at dashboard/index.js:3330 then failed the
 * whole request ("Expected 498 users but found 19").
 *
 * The phone_number NOT NULL check stays — a row with no phone cannot be sent to.
 * Filter mode keeps the flag: there the flag is the operator's stated intent.
 */

const path = require('path');

const SUPABASE_MODULE = path.join(__dirname, '../../dashboard/config/supabase');

// A recording stand-in for the PostgREST query builder. Every filter call is
// logged so a test can assert on the filters that were actually applied, rather
// than on the source text.
function makeSupabaseMock(rows) {
  const calls = [];
  const builder = {
    select(...a) { calls.push(['select', ...a]); return builder; },
    in(...a) { calls.push(['in', ...a]); return builder; },
    eq(...a) { calls.push(['eq', ...a]); return builder; },
    not(...a) { calls.push(['not', ...a]); return builder; },
    like(...a) { calls.push(['like', ...a]); return builder; },
    gte(...a) { calls.push(['gte', ...a]); return builder; },
    order(...a) { calls.push(['order', ...a]); return builder; },
    limit(...a) { calls.push(['limit', ...a]); return builder; },
    // Supabase builders are thenable, so awaiting one resolves the request.
    then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); }
  };
  return {
    client: { from(table) { calls.push(['from', table]); return builder; } },
    calls
  };
}

const filterNames = calls => calls.filter(c => c[0] === 'eq' || c[0] === 'not').map(c => c[1]);

describe('bd-ikkpf — getUsersForBroadcast search mode', () => {
  // The cohort as it actually is: every teacher has a phone number, almost none
  // carries the registration flag.
  const cohort = [
    { id: 'u1', phone_number: '923001111111', first_name: 'A', registration_completed: false },
    { id: 'u2', phone_number: '923002222222', first_name: 'B', registration_completed: false },
    { id: 'u3', phone_number: '923003333333', first_name: 'C', registration_completed: true }
  ];
  const cohortIds = cohort.map(u => u.id);

  let mock;
  let queries;

  beforeEach(() => {
    jest.resetModules();
    mock = makeSupabaseMock(cohort);
    jest.doMock(SUPABASE_MODULE, () => mock.client);
    jest.doMock(path.join(__dirname, '../../dashboard/services/materialized-views.service'), () => ({}));
    queries = require('../../dashboard/database/queries');
  });

  afterEach(() => { jest.dontMock(SUPABASE_MODULE); });

  it('does NOT filter the selected ids on registration_completed', async () => {
    await queries.getUsersForBroadcast({ mode: 'search', selectedUserIds: cohortIds });
    expect(filterNames(mock.calls)).not.toContain('registration_completed');
  });

  it('still requires a phone number — a row with no phone cannot be sent to', async () => {
    await queries.getUsersForBroadcast({ mode: 'search', selectedUserIds: cohortIds });
    expect(mock.calls).toEqual(
      expect.arrayContaining([['not', 'phone_number', 'is', null]])
    );
  });

  it('still scopes the query to exactly the ids it was given', async () => {
    await queries.getUsersForBroadcast({ mode: 'search', selectedUserIds: cohortIds });
    expect(mock.calls).toEqual(expect.arrayContaining([['in', 'id', cohortIds]]));
  });

  it('returns every selected teacher, so the index.js count-equality check passes', async () => {
    const users = await queries.getUsersForBroadcast({ mode: 'search', selectedUserIds: cohortIds });
    // This is the assertion the 498-teacher broadcast failed: users.length must
    // equal selectedUserIds.length or dashboard/index.js:3330 rejects the send.
    expect(users).toHaveLength(cohortIds.length);
    expect(users.map(u => u.id)).toEqual(cohortIds);
  });

  it('an empty id list is still a no-op, not a send to everyone', async () => {
    const users = await queries.getUsersForBroadcast({ mode: 'search', selectedUserIds: [] });
    expect(users).toEqual([]);
    expect(mock.calls).toEqual([]);
  });

  it('FILTER mode keeps registration_completed — this fix is search-mode only', async () => {
    await queries.getUsersForBroadcast({ activity: 'all', country: 'all' });
    expect(filterNames(mock.calls)).toContain('registration_completed');
  });
});

/**
 * The broadcast routes in dashboard/index.js do their OWN inline lookups in
 * search mode — the send route never calls getUsersForBroadcast — so fixing
 * queries.js alone leaves the actual send filtered. Three sites, all of which
 * must be clean:
 *
 *   GET  /observability/api/broadcast/search-users  — the recipient picker. With
 *        the flag it cannot FIND 479 of the 498, so they can never be selected.
 *   POST .../broadcast/preview (estimate)           — understates reach and cost.
 *   POST .../broadcast/send                         — the send itself. On this
 *        branch a count mismatch is only a console.warn, so the flag made the
 *        send silently shrink rather than fail loudly.
 *
 * Asserted against source because the blocks are inline in the Express file.
 */
describe('bd-ikkpf — dashboard/index.js broadcast routes', () => {
  const fs = require('fs');
  const INDEX = path.join(__dirname, '../../dashboard/index.js');
  const src = fs.readFileSync(INDEX, 'utf8');

  // Strip `//` comments so the bd-ikkpf notes explaining the absent filter cannot
  // themselves satisfy a `toContain('registration_completed')`. Block comments are
  // NOT stripped: a naive /* ... */ regex matches a `/*` inside a string literal
  // and deletes thousands of lines of real code, which makes every assertion here
  // pass or fail for the wrong reason.
  const code = src.replace(/^\s*\/\/.*$/gm, '');

  const blockAfter = (marker, chars = 700) => {
    const i = code.indexOf(marker);
    expect(i).toBeGreaterThan(-1);
    return code.slice(i, i + chars);
  };

  it('the recipient picker does not filter on registration_completed', () => {
    const block = blockAfter("'/observability/api/broadcast/search-users'", 1400);
    expect(block).toContain("from('users')");
    expect(block).toContain("not('phone_number', 'is', null)");
    expect(block).not.toContain('registration_completed');
  });

  it('no search-mode lookup in the broadcast routes filters on registration_completed', () => {
    // Every inline `.in('id', userIds)` lookup is a search-mode cohort fetch.
    const lookups = code.split("in('id', userIds)").slice(1).map(s => s.slice(0, 200));
    expect(lookups.length).toBeGreaterThanOrEqual(2); // preview + send
    for (const l of lookups) {
      expect(l).not.toContain('registration_completed');
      expect(l).toContain("not('phone_number', 'is', null)");
    }
  });

  it('the scope-preview endpoint still REPORTS registered vs unregistered', () => {
    // That endpoint counts the flag rather than filtering on it — it is the one
    // place the flag is the answer, and this fix must not strip it.
    expect(code).toContain('registeredCountQuery');
    expect(code).toContain('AND registration_completed = true');
    expect(code).toContain('unregisteredCount');
  });
});
