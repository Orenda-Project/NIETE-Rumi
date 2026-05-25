/**
 * bootstrap-db — one-command fresh-install applies the 3 canonical SQL files in
 * order against an injected SQL executor. Verifies ordering, real-file reads,
 * stop-on-error, and missing-file handling. No live DB (execSql is injected).
 */

const path = require('path');
const { DatabaseBootstrapper } = require('../../infrastructure/scripts/bootstrap-db');

const SCHEMA_DIR = path.resolve(__dirname, '../../infrastructure/supabase');

describe('DatabaseBootstrapper', () => {
  it('applies the 3 canonical files in order (schema → rls → seed)', async () => {
    const applied = [];
    const b = new DatabaseBootstrapper({
      supabaseUrl: 'x', supabaseKey: 'y', schemaDir: SCHEMA_DIR,
      execSql: async (_sql, label) => { applied.push(label); },
    });
    const result = await b.bootstrap();
    expect(applied).toEqual([
      '00_complete-schema.sql',
      '01_rls-policies.sql',
      '02_seed-data.sql',
    ]);
    expect(result.errors).toEqual([]);
    expect(result.applied).toHaveLength(3);
  });

  it('passes the real file contents to execSql (non-empty schema)', async () => {
    const sizes = {};
    const b = new DatabaseBootstrapper({
      supabaseUrl: 'x', supabaseKey: 'y', schemaDir: SCHEMA_DIR,
      execSql: async (sql, label) => { sizes[label] = sql.length; },
    });
    await b.bootstrap();
    expect(sizes['00_complete-schema.sql']).toBeGreaterThan(1000);
    expect(sizes['02_seed-data.sql']).toBeGreaterThan(100);
  });

  it('stops at the first failure — RLS/seed are not applied if schema fails', async () => {
    const applied = [];
    const b = new DatabaseBootstrapper({
      supabaseUrl: 'x', supabaseKey: 'y', schemaDir: SCHEMA_DIR,
      execSql: async (_sql, label) => {
        if (label === '00_complete-schema.sql') throw new Error('boom');
        applied.push(label);
      },
    });
    const result = await b.bootstrap();
    expect(applied).toEqual([]); // never reached rls/seed
    expect(result.applied).toEqual([]);
    expect(result.errors).toEqual([{ file: '00_complete-schema.sql', error: 'boom' }]);
  });

  it('errors clearly when a SQL file is missing', async () => {
    const b = new DatabaseBootstrapper({
      supabaseUrl: 'x', supabaseKey: 'y', schemaDir: '/nonexistent/dir',
      execSql: async () => {},
    });
    const result = await b.bootstrap();
    expect(result.applied).toEqual([]);
    expect(result.errors[0].file).toBe('00_complete-schema.sql');
    expect(result.errors[0].error).toMatch(/not found/);
  });
});
