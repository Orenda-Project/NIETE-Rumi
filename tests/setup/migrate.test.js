const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Mock @supabase/supabase-js before requiring the module
// virtual: true because supabase-js is not installed in root node_modules
// (it's a runtime dependency installed on the deployment server)
const mockFrom = jest.fn();
const mockClient = { from: mockFrom };
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockClient),
}), { virtual: true });

// Mock global.fetch for SQL execution
const originalFetch = global.fetch;

const { MigrationRunner } = require('../../infrastructure/scripts/migrate');
const { createClient } = require('@supabase/supabase-js');

describe('MigrationRunner', () => {
  let tmpDir;
  let runner;

  beforeEach(() => {
    // Create a temp directory with test migration files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rumi-migrations-'));

    // Write test SQL migration files
    fs.writeFileSync(path.join(tmpDir, 'V1.0.0__initial_schema.sql'), 'CREATE TABLE users (id UUID PRIMARY KEY);');
    fs.writeFileSync(path.join(tmpDir, 'V1.1.0__add_sessions.sql'), 'CREATE TABLE sessions (id UUID PRIMARY KEY);');
    fs.writeFileSync(path.join(tmpDir, 'V2.0.0__add_analytics.sql'), 'CREATE TABLE analytics (id UUID PRIMARY KEY);');
    // Non-migration file should be ignored
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Migrations');

    runner = new MigrationRunner({
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key-123',
      migrationsDir: tmpDir,
    });

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // ── Constructor ──
  describe('constructor', () => {
    it('accepts { supabaseUrl, supabaseKey, migrationsDir }', () => {
      const r = new MigrationRunner({
        supabaseUrl: 'https://example.supabase.co',
        supabaseKey: 'key-abc',
        migrationsDir: '/some/path',
      });

      expect(r.supabaseUrl).toBe('https://example.supabase.co');
      expect(r.supabaseKey).toBe('key-abc');
      expect(r.migrationsDir).toBe('/some/path');
    });

    it('creates a Supabase client with the provided URL and key', () => {
      new MigrationRunner({
        supabaseUrl: 'https://example.supabase.co',
        supabaseKey: 'key-abc',
        migrationsDir: '/some/path',
      });

      expect(createClient).toHaveBeenCalledWith(
        'https://example.supabase.co',
        'key-abc'
      );
    });
  });

  // ── getAppliedVersions() ──
  describe('getAppliedVersions()', () => {
    it('queries schema_versions table and returns array of version strings', async () => {
      const mockSelect = jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({
          data: [
            { version: '1.0.0' },
            { version: '1.1.0' },
          ],
          error: null,
        }),
      });

      mockFrom.mockReturnValue({ select: mockSelect });

      const versions = await runner.getAppliedVersions();

      expect(mockFrom).toHaveBeenCalledWith('schema_versions');
      expect(mockSelect).toHaveBeenCalledWith('version');
      expect(versions).toEqual(['1.0.0', '1.1.0']);
    });

    it('returns empty array when table has no rows', async () => {
      const mockSelect = jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      });

      mockFrom.mockReturnValue({ select: mockSelect });

      const versions = await runner.getAppliedVersions();
      expect(versions).toEqual([]);
    });

    it('returns empty array and warns on error', async () => {
      const mockSelect = jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Table not found' },
        }),
      });

      mockFrom.mockReturnValue({ select: mockSelect });

      const versions = await runner.getAppliedVersions();
      expect(versions).toEqual([]);
      expect(console.warn).toHaveBeenCalled();
    });
  });

  // ── getPendingMigrations() ──
  describe('getPendingMigrations()', () => {
    it('scans migrationsDir for V*.sql files and filters out applied ones', async () => {
      // Mock getAppliedVersions to say V1.0.0 is already applied
      jest.spyOn(runner, 'getAppliedVersions').mockResolvedValue(['1.0.0']);

      const pending = await runner.getPendingMigrations();

      // Should only return V1.1.0 and V2.0.0
      expect(pending).toHaveLength(2);
      expect(pending[0]).toContain('V1.1.0');
      expect(pending[1]).toContain('V2.0.0');
    });

    it('sorts by version number correctly (V1.0.0 before V1.1.0 before V2.0.0)', async () => {
      jest.spyOn(runner, 'getAppliedVersions').mockResolvedValue([]);

      const pending = await runner.getPendingMigrations();

      expect(pending).toHaveLength(3);
      expect(pending[0]).toContain('V1.0.0');
      expect(pending[1]).toContain('V1.1.0');
      expect(pending[2]).toContain('V2.0.0');
    });

    it('skips already-applied versions', async () => {
      jest.spyOn(runner, 'getAppliedVersions').mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']);

      const pending = await runner.getPendingMigrations();

      expect(pending).toHaveLength(0);
    });

    it('ignores non-V*.sql files', async () => {
      jest.spyOn(runner, 'getAppliedVersions').mockResolvedValue([]);

      const pending = await runner.getPendingMigrations();

      // README.md should not appear
      const filenames = pending.map(f => path.basename(f));
      expect(filenames).not.toContain('README.md');
    });
  });

  // ── applyMigration(file) ──
  describe('applyMigration(file)', () => {
    // The live ledger is (version varchar, applied_at timestamp, description text) on every
    // NIETE database, and 00_complete-schema.sql creates exactly that. The runner used to
    // insert `filename` and `checksum`, which do not exist, so every migration it ran was
    // executed and then NOT recorded — and the next run would have applied it again.
    it('records only the columns schema_versions has: version, description, applied_at', async () => {
      const filePath = path.join(tmpDir, 'V1.0.0__initial_schema.sql');

      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ insert: mockInsert });

      await runner.applyMigration(filePath);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const rows = mockInsert.mock.calls[0][0];
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]).sort()).toEqual(['applied_at', 'description', 'version']);
      expect(rows[0].version).toBe('1.0.0');
    });

    it('keeps the filename and the SHA-256 of the file, inside description', async () => {
      const filePath = path.join(tmpDir, 'V1.0.0__initial_schema.sql');
      const expectedChecksum = crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath, 'utf-8'))
        .digest('hex');

      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ insert: mockInsert });

      await runner.applyMigration(filePath);

      expect(mockInsert.mock.calls[0][0][0].description)
        .toBe(`V1.0.0__initial_schema.sql sha256:${expectedChecksum}`);
    });

    it('reads SQL file and executes it via fetch', async () => {
      const filePath = path.join(tmpDir, 'V1.0.0__initial_schema.sql');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ insert: mockInsert });

      await runner.applyMigration(filePath);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/rpc/exec_sql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            apikey: 'test-key-123',
          }),
        })
      );
    });

    it('records applied migration in schema_versions table', async () => {
      const filePath = path.join(tmpDir, 'V1.0.0__initial_schema.sql');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ insert: mockInsert });

      await runner.applyMigration(filePath);

      expect(mockFrom).toHaveBeenCalledWith('schema_versions');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            version: '1.0.0',
          }),
        ])
      );
    });

    it('throws when SQL execution fails', async () => {
      const filePath = path.join(tmpDir, 'V1.0.0__initial_schema.sql');

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'SQL syntax error',
      });

      await expect(runner.applyMigration(filePath)).rejects.toThrow();
    });
  });

  // ── run() ──
  describe('run()', () => {
    it('applies all pending migrations in order', async () => {
      jest.spyOn(runner, 'getAppliedVersions').mockResolvedValue([]);

      const appliedOrder = [];
      jest.spyOn(runner, 'applyMigration').mockImplementation(async (file) => {
        appliedOrder.push(path.basename(file));
      });

      const result = await runner.run({ allowBacklog: true });

      expect(appliedOrder).toEqual([
        'V1.0.0__initial_schema.sql',
        'V1.1.0__add_sessions.sql',
        'V2.0.0__add_analytics.sql',
      ]);
      expect(result.applied).toHaveLength(3);
    });

    it('continues on error and records in errors array', async () => {
      jest.spyOn(runner, 'getAppliedVersions').mockResolvedValue([]);

      jest.spyOn(runner, 'applyMigration').mockImplementation(async (file) => {
        if (path.basename(file).includes('V1.1.0')) {
          throw new Error('Migration V1.1.0 failed');
        }
      });

      const result = await runner.run({ allowBacklog: true });

      // V1.0.0 should succeed, V1.1.0 should fail, V2.0.0 should succeed
      expect(result.applied).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        file: expect.stringContaining('V1.1.0'),
        error: expect.any(String),
      });
    });

    it('returns empty applied array when all migrations already applied', async () => {
      jest.spyOn(runner, 'getAppliedVersions').mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']);

      const result = await runner.run();

      expect(result.applied).toEqual([]);
      expect(result.skipped).toHaveLength(3);
      expect(result.errors).toEqual([]);
    });

    it('returns result with applied, skipped, and errors arrays', async () => {
      jest.spyOn(runner, 'getAppliedVersions').mockResolvedValue(['1.0.0', '1.1.0']);

      jest.spyOn(runner, 'applyMigration').mockImplementation(async () => {});

      const result = await runner.run();

      expect(result).toHaveProperty('applied');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.applied)).toBe(true);
      expect(Array.isArray(result.skipped)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  // ── run(): the ledger may be behind by the ONE migration being applied, no more ──
  //
  // On sandbox the ledger stopped at 1.3.6 while the folder runs to 1.5.x — every later
  // file was applied by hand and never recorded (the insert above always failed). A
  // blanket run would re-apply all of them, and some of them are one-shot (a backfill, a
  // DROP COLUMN) or must never run on production at all. So a backlog of more than one
  // pending file is refused, nothing is applied, and the operator is sent to the ledger
  // audit to record what is really applied first.
  describe('run() — refuses a ledger that is behind by more than one migration', () => {
    it('applies a single pending migration without any flag', async () => {
      jest.spyOn(runner, 'getAppliedVersions').mockResolvedValue(['1.0.0', '1.1.0']);
      const apply = jest.spyOn(runner, 'applyMigration').mockImplementation(async () => {});

      const result = await runner.run();

      expect(apply).toHaveBeenCalledTimes(1);
      expect(path.basename(apply.mock.calls[0][0])).toBe('V2.0.0__add_analytics.sql');
      expect(result.applied).toEqual(['V2.0.0__add_analytics.sql']);
      expect(result.refused).toBeUndefined();
    });

    it('refuses two or more pending migrations, applies NOTHING, and says which', async () => {
      jest.spyOn(runner, 'getAppliedVersions').mockResolvedValue(['1.0.0']);
      const apply = jest.spyOn(runner, 'applyMigration').mockImplementation(async () => {});
      global.fetch = jest.fn();

      const result = await runner.run();

      expect(apply).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.applied).toEqual([]);
      expect(result.refused).toEqual({
        reason: 'ledger_behind',
        pending: ['V1.1.0__add_sessions.sql', 'V2.0.0__add_analytics.sql'],
      });
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/schema-ledger-audit/));
    });

    it('an unreadable ledger reads as "everything pending", so it is refused too', async () => {
      const mockSelect = jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } }),
      });
      mockFrom.mockReturnValue({ select: mockSelect });
      global.fetch = jest.fn();

      const result = await runner.run();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.refused.reason).toBe('ledger_behind');
      expect(result.refused.pending).toHaveLength(3);
    });

    it('the explicit flag applies the whole backlog, in version order', async () => {
      jest.spyOn(runner, 'getAppliedVersions').mockResolvedValue(['1.0.0']);
      const order = [];
      jest.spyOn(runner, 'applyMigration').mockImplementation(async (f) => { order.push(path.basename(f)); });

      const result = await runner.run({ allowBacklog: true });

      expect(order).toEqual(['V1.1.0__add_sessions.sql', 'V2.0.0__add_analytics.sql']);
      expect(result.refused).toBeUndefined();
    });
  });

  // ── the CLI flag is spelled out, and nothing else is silently accepted ──
  describe('parseCliArgs()', () => {
    const { parseCliArgs } = require('../../infrastructure/scripts/migrate');

    it('defaults to refusing a backlog', () => {
      expect(parseCliArgs([])).toEqual({ allowBacklog: false, unknown: [] });
    });

    it('--apply-all-pending opts in to a backlog', () => {
      expect(parseCliArgs(['--apply-all-pending'])).toEqual({ allowBacklog: true, unknown: [] });
    });

    it('reports an argument it does not know rather than ignoring it', () => {
      expect(parseCliArgs(['--force'])).toEqual({ allowBacklog: false, unknown: ['--force'] });
    });
  });
});
