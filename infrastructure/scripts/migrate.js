const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

/**
 * MigrationRunner - Applies SQL migrations from files to a Supabase database.
 *
 * Scans a migrations directory for V*.sql files, compares against the
 * `schema_versions` table to find pending migrations, and applies them
 * in version order.
 *
 * SQL execution uses a direct fetch to the Supabase `exec_sql` RPC endpoint.
 * The `exec_sql` function must exist in the database:
 *
 *   CREATE OR REPLACE FUNCTION exec_sql(query TEXT)
 *   RETURNS VOID AS $$ BEGIN EXECUTE query; END; $$ LANGUAGE plpgsql;
 *
 * THE LEDGER IS WRITTEN IN THE COLUMNS IT HAS. `schema_versions` is
 * (version, applied_at, description) — that is what 00_complete-schema.sql creates and
 * what every live database carries. The filename and the file's SHA-256 are kept inside
 * `description` ("V1.5.3__teacher_nudges.sql sha256:<hex>") rather than in columns of
 * their own: a runner that needs a schema change before it can record anything cannot
 * record the migration that makes that change.
 *
 * A LEDGER THAT IS BEHIND IS REFUSED. The runner applies the ONE pending migration a
 * change normally brings. If more than one is pending, the ledger does not describe the
 * database — files applied by hand were never recorded — and a blanket run would apply
 * them a second time. It stops before touching anything and points at the read-only
 * ledger audit (scripts/schema-ledger-audit.py), which reports what each environment
 * really has. Record what is applied, then re-run. `--apply-all-pending` is the explicit
 * override, for a database whose ledger is genuinely right and genuinely behind.
 *
 * Usage as CLI:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node infrastructure/scripts/migrate.js
 *   ...                                            node infrastructure/scripts/migrate.js --apply-all-pending
 */
class MigrationRunner {
  /**
   * @param {Object} config
   * @param {string} config.supabaseUrl - Supabase project URL
   * @param {string} config.supabaseKey - Supabase service role key
   * @param {string} config.migrationsDir - Path to directory containing V*.sql files
   */
  constructor({ supabaseUrl, supabaseKey, migrationsDir }) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.migrationsDir = migrationsDir;
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Extracts the version string from a migration filename.
   * E.g. "V1.2.3__description.sql" -> "1.2.3"
   *
   * @param {string} filename - The migration filename
   * @returns {string|null} The version string, or null if not a valid migration file
   */
  extractVersion(filename) {
    const match = filename.match(/^V(\d+\.\d+\.\d+)__/);
    return match ? match[1] : null;
  }

  /**
   * Compares two semver version strings for sorting.
   *
   * @param {string} a - Version string (e.g. "1.2.3")
   * @param {string} b - Version string (e.g. "2.0.0")
   * @returns {number} Negative if a < b, positive if a > b, zero if equal
   */
  compareVersions(a, b) {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA !== numB) return numA - numB;
    }
    return 0;
  }

  /**
   * Queries the schema_versions table for already-applied migration versions.
   *
   * @returns {Promise<string[]>} Array of version strings that have been applied
   */
  async getAppliedVersions() {
    const { data, error } = await this.supabase
      .from('schema_versions')
      .select('version')
      .order('version');

    if (error) {
      console.warn(
        '[migrate] Could not read schema_versions table:',
        error.message
      );
      return [];
    }

    return (data || []).map((row) => row.version);
  }

  /**
   * Scans the migrations directory for V*.sql files that have not yet been applied.
   * Returns them sorted by version number (ascending).
   *
   * @returns {Promise<string[]>} Array of absolute file paths for pending migrations
   */
  async getPendingMigrations() {
    const appliedVersions = await this.getAppliedVersions();
    const appliedSet = new Set(appliedVersions);

    const files = fs.readdirSync(this.migrationsDir);

    const migrationFiles = files
      .filter((f) => /^V\d+\.\d+\.\d+__.*\.sql$/.test(f))
      .filter((f) => {
        const version = this.extractVersion(f);
        return version && !appliedSet.has(version);
      })
      .sort((a, b) => {
        const vA = this.extractVersion(a);
        const vB = this.extractVersion(b);
        return this.compareVersions(vA, vB);
      })
      .map((f) => path.join(this.migrationsDir, f));

    return migrationFiles;
  }

  /**
   * Applies a single migration file:
   * 1. Reads the SQL content
   * 2. Executes it via the exec_sql RPC endpoint
   * 3. Records it in schema_versions: version, description (filename + SHA-256), applied_at
   *
   * @param {string} filePath - Absolute path to the .sql migration file
   * @throws {Error} If SQL execution or recording fails
   */
  async applyMigration(filePath) {
    const filename = path.basename(filePath);
    const version = this.extractVersion(filename);
    const sql = fs.readFileSync(filePath, 'utf-8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    console.log(`[migrate] Applying ${filename} (${version})...`);

    // Execute SQL via the exec_sql RPC endpoint
    const response = await fetch(
      `${this.supabaseUrl}/rest/v1/rpc/exec_sql`,
      {
        method: 'POST',
        headers: {
          apikey: this.supabaseKey,
          Authorization: `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ query: sql }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to execute migration ${filename}: ${response.status} - ${errorText}`
      );
    }

    // Record the applied migration — in the three columns the ledger actually has.
    const { error: insertError } = await this.supabase
      .from('schema_versions')
      .insert([
        {
          version,
          description: `${filename} sha256:${checksum}`,
          applied_at: new Date().toISOString(),
        },
      ]);

    if (insertError) {
      throw new Error(
        `Migration ${filename} executed but failed to record: ${insertError.message}`
      );
    }

    console.log(`[migrate] Applied ${filename} successfully.`);
  }

  /**
   * Runs pending migrations in version order.
   * Continues on error - failed migrations are recorded in the errors array.
   *
   * Refuses — applying nothing — when more than one migration is pending, unless
   * `allowBacklog` is set. See the file header for why.
   *
   * @param {Object} [opts]
   * @param {boolean} [opts.allowBacklog=false] - apply a multi-migration backlog anyway
   * @returns {Promise<Object>} Result with:
   *   - applied: string[] - filenames of successfully applied migrations
   *   - skipped: string[] - filenames of already-applied migrations
   *   - errors: Array<{ file: string, error: string }> - failed migrations
   *   - refused?: { reason: 'ledger_behind', pending: string[] } - set when nothing was
   *     applied because the ledger is behind by more than one migration
   */
  async run({ allowBacklog = false } = {}) {
    const result = { applied: [], skipped: [], errors: [] };

    // Determine what is already applied (for the skipped list)
    const appliedVersions = await this.getAppliedVersions();
    const appliedSet = new Set(appliedVersions);

    // Build skipped list from all migration files that are already applied
    const allFiles = fs.readdirSync(this.migrationsDir);
    const allMigrations = allFiles.filter((f) =>
      /^V\d+\.\d+\.\d+__.*\.sql$/.test(f)
    );

    for (const f of allMigrations) {
      const version = this.extractVersion(f);
      if (version && appliedSet.has(version)) {
        result.skipped.push(f);
      }
    }

    // Get and apply pending migrations
    const pending = await this.getPendingMigrations();

    if (pending.length === 0) {
      console.log('[migrate] All migrations are up to date.');
      return result;
    }

    if (pending.length > 1 && !allowBacklog) {
      const names = pending.map((p) => path.basename(p));
      result.refused = { reason: 'ledger_behind', pending: names };
      console.error(
        `[migrate] REFUSED: ${names.length} migrations are pending, and a change brings one. ` +
        'The ledger (schema_versions) does not describe this database, so a run would ' +
        're-apply migrations that were applied by hand and never recorded. Nothing was applied.'
      );
      for (const n of names) console.error(`[migrate]   pending: ${n}`);
      console.error(
        '[migrate] Run the read-only audit to see what is really applied, record those rows, ' +
        'then re-run: python3 scripts/schema-ledger-audit.py --target <env> --env-file <file>'
      );
      console.error(
        '[migrate] Only if every pending file genuinely still needs to run: --apply-all-pending'
      );
      return result;
    }

    console.log(`[migrate] ${pending.length} pending migration(s) to apply.`);

    for (const filePath of pending) {
      try {
        await this.applyMigration(filePath);
        result.applied.push(path.basename(filePath));
      } catch (err) {
        console.error(
          `[migrate] Error applying ${path.basename(filePath)}: ${err.message}`
        );
        result.errors.push({
          file: path.basename(filePath),
          error: err.message,
        });
        // Continue to next migration - don't stop on error
      }
    }

    console.log(
      `[migrate] Done. Applied: ${result.applied.length}, Skipped: ${result.skipped.length}, Errors: ${result.errors.length}`
    );

    return result;
  }
}

/**
 * The CLI's flags. Anything unrecognised is reported, never ignored — a mistyped
 * override that silently did nothing would look exactly like the refusal it meant to lift.
 *
 * @param {string[]} argv
 * @returns {{ allowBacklog: boolean, unknown: string[] }}
 */
function parseCliArgs(argv) {
  const known = new Set(['--apply-all-pending']);
  return {
    allowBacklog: argv.includes('--apply-all-pending'),
    unknown: argv.filter((a) => !known.has(a)),
  };
}

module.exports = { MigrationRunner, parseCliArgs };

// ── CLI entrypoint ──
if (require.main === module) {
  const { allowBacklog, unknown } = parseCliArgs(process.argv.slice(2));
  if (unknown.length) {
    console.error(`[migrate] Unknown argument(s): ${unknown.join(' ')}`);
    console.error('[migrate] The only flag is --apply-all-pending.');
    process.exit(2);
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      '[migrate] Missing required environment variables:'
    );
    console.error('  SUPABASE_URL');
    console.error('  SUPABASE_SERVICE_ROLE_KEY');
    console.error('');
    console.error('Usage:');
    console.error(
      '  SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx node infrastructure/scripts/migrate.js'
    );
    process.exit(1);
  }

  const migrationsDir = path.resolve(
    __dirname,
    '../supabase/migrations'
  );

  if (!fs.existsSync(migrationsDir)) {
    console.error(
      `[migrate] Migrations directory not found: ${migrationsDir}`
    );
    console.error(
      '[migrate] Please create infrastructure/supabase/migrations/ and add V*.sql files.'
    );
    process.exit(1);
  }

  console.log('[migrate] Supabase URL:', SUPABASE_URL);
  console.log('[migrate] Migrations dir:', migrationsDir);
  console.log('');
  console.log(
    '[migrate] NOTE: This requires a `exec_sql` function in your Supabase database.'
  );
  console.log(
    '[migrate] If it does not exist, create it with:'
  );
  console.log(
    '  CREATE OR REPLACE FUNCTION exec_sql(query TEXT)'
  );
  console.log(
    "  RETURNS VOID AS $$ BEGIN EXECUTE query; END; $$ LANGUAGE plpgsql;"
  );
  console.log('');

  const runner = new MigrationRunner({
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_SERVICE_ROLE_KEY,
    migrationsDir,
  });

  runner
    .run({ allowBacklog })
    .then((result) => {
      if (result.refused) {
        process.exit(1);
      }
      if (result.errors.length > 0) {
        console.error(
          `[migrate] Completed with ${result.errors.length} error(s).`
        );
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('[migrate] Fatal error:', err.message);
      process.exit(1);
    });
}
