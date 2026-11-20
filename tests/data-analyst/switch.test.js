'use strict';
/**
 * The data analyst's per-person switch (app_settings data_analyst_whatsapp) and its presence gate.
 *
 * Stricter than the principal-app switch on purpose: only a LIST turns it on, never `true`, because
 * "everyone" on a data tool is not a value anyone should be able to type by accident. An entry is a
 * users.id (asked as DATA_MCP_USER_EMAIL) or {id, email} (asked as that address).
 */

const SW = require('../../bot/shared/services/data-analyst/switch');

const ME = '60530046-0000-4000-8000-000000000001';
const OTHER = '7eac0000-0000-4000-8000-000000000003';

function supabaseWith(value, { error = null, throws = false } = {}) {
  const reads = [];
  return {
    reads,
    from(table) {
      const q = {
        select() { return q; },
        eq(col, v) { reads.push({ table, col, v }); return q; },
        async maybeSingle() {
          if (throws) throw new Error('db down');
          return { data: value === undefined ? null : { value }, error };
        },
      };
      return q;
    },
  };
}

const ENV = {
  DATA_MCP_URL: 'https://mcp.example/mcp',
  DATA_MCP_USER_EMAIL: 'operator@example.org',
  ANTHROPIC_API_KEY: 'sk-test-value',
};

beforeEach(() => SW._resetCache());

describe('identityFor (pure)', () => {
  test('a users.id in the list is on, asked as the configured address', () => {
    expect(SW.identityFor([ME], ME, ENV)).toEqual({ userId: ME, email: 'operator@example.org' });
  });
  test('an {id, email} entry is on, asked as its own address', () => {
    expect(SW.identityFor([{ id: OTHER, email: 'officer@niete.edu.pk' }], OTHER, ENV))
      .toEqual({ userId: OTHER, email: 'officer@niete.edu.pk' });
  });
  test('the list stored as JSON text is read', () => {
    expect(SW.identityFor(JSON.stringify([ME]), ME, ENV)).not.toBeNull();
  });
  test('someone not named is off', () => {
    expect(SW.identityFor([ME], OTHER, ENV)).toBeNull();
  });
  test('true, "true", an object, a number or garbage is off (no "everyone" switch)', () => {
    for (const v of [true, 'true', { [ME]: true }, 1, 'not json', null, undefined]) {
      expect(SW.identityFor(v, ME, ENV)).toBeNull();
    }
  });
  test('a bare id with no configured address is off (never an anonymous audit row)', () => {
    expect(SW.identityFor([ME], ME, { ...ENV, DATA_MCP_USER_EMAIL: '' })).toBeNull();
  });
});

describe('isConfigured (presence gate)', () => {
  test('on only when the MCP url, the address and the Anthropic key are all set', () => {
    expect(SW.isConfigured(ENV)).toBe(true);
    expect(SW.isConfigured({ ...ENV, DATA_MCP_URL: '' })).toBe(false);
    expect(SW.isConfigured({ ...ENV, DATA_MCP_USER_EMAIL: undefined })).toBe(false);
    expect(SW.isConfigured({ ...ENV, ANTHROPIC_API_KEY: '' })).toBe(false);
  });
});

describe('dataAnalystIdentity (reads app_settings, fail-closed)', () => {
  test('reads the data_analyst_whatsapp row and names her', async () => {
    const sb = supabaseWith([ME]);
    await expect(SW.dataAnalystIdentity(sb, ME, { env: ENV })).resolves.toEqual({ userId: ME, email: 'operator@example.org' });
    expect(sb.reads).toEqual([{ table: 'app_settings', col: 'key', v: 'data_analyst_whatsapp' }]);
  });
  test('no row is off', async () => {
    await expect(SW.dataAnalystIdentity(supabaseWith(undefined), ME, { env: ENV })).resolves.toBeNull();
  });
  test('a read error or a throw is off', async () => {
    await expect(SW.dataAnalystIdentity(supabaseWith([ME], { error: { message: 'x' } }), ME, { env: ENV })).resolves.toBeNull();
    await expect(SW.dataAnalystIdentity(supabaseWith([ME], { throws: true }), ME, { env: ENV })).resolves.toBeNull();
  });
  test('no user id is off without a read', async () => {
    const sb = supabaseWith([ME]);
    await expect(SW.dataAnalystIdentity(sb, null, { env: ENV })).resolves.toBeNull();
    expect(sb.reads).toHaveLength(0);
  });
  test('the row is read once a minute, not on every message', async () => {
    const sb = supabaseWith([ME]);
    let t = 1_000_000;
    await SW.dataAnalystIdentity(sb, ME, { env: ENV, now: () => t });
    await SW.dataAnalystIdentity(sb, OTHER, { env: ENV, now: () => t + 30_000 });
    expect(sb.reads).toHaveLength(1);
    await SW.dataAnalystIdentity(sb, ME, { env: ENV, now: () => t + 61_000 });
    expect(sb.reads).toHaveLength(2);
  });
});
