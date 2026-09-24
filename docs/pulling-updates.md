# Pulling Updates from Upstream

This guide explains how to receive bug fixes and new features from the Rumi repository.

## Overview

Rumi uses a standard Git upstream model. Your fork/clone receives updates by merging from the upstream repository. Database migrations are applied separately.

## One-Time Setup

```bash
# Add the upstream remote (only needed once)
git remote add upstream https://github.com/Orenda-Project/rumi-platform.git

# Verify
git remote -v
# origin    https://github.com/YOUR-ORG/rumi-platform.git (fetch)
# upstream  https://github.com/Orenda-Project/rumi-platform.git (fetch)
```

## Update Workflow

### 1. Fetch and Merge

```bash
git fetch upstream
git merge upstream/main
```

If you have merge conflicts, they will most likely be in files you customized. See [File Zones](customization.md#file-zones) to understand which files are safe to customize vs. upstream-owned.

### 2. Apply Database Migrations

New versions may include database schema changes. Apply them:

```bash
# Set your Supabase credentials
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-key

# Run pending migrations
node infrastructure/scripts/migrate.js
```

The migration runner:
- Reads the `schema_versions` table to find what's already applied
- Applies the new migration and records it (version, the filename and the file's
  SHA-256 in `description`, and `applied_at`)
- **Refuses, applying nothing, when more than one migration is pending.** An update
  normally brings one. More than one means the ledger does not describe the database —
  a file applied by hand and never recorded would be applied a second time. It lists
  what is pending and stops. Check what the database really has with the read-only
  audit, record what is already applied, and run it again:

  ```bash
  python3 scripts/schema-ledger-audit.py --plan                                  # what each file is checked by
  python3 scripts/schema-ledger-audit.py --target <env> --env-file <env file>    # read-only report
  ```

  A database bootstrapped from `00_complete-schema.sql` records none of the `V*.sql`
  files, so its first run is refused the same way. Only when every pending file really
  does still need to run: `node infrastructure/scripts/migrate.js --apply-all-pending`.

**Prerequisite**: Your Supabase database needs the `exec_sql` function:

```sql
CREATE OR REPLACE FUNCTION exec_sql(query TEXT)
RETURNS VOID AS $$ BEGIN EXECUTE query; END; $$ LANGUAGE plpgsql;
```

### 3. Install New Dependencies

```bash
cd bot && npm install && cd ..
```

### 4. Check for New Environment Variables

```bash
# Compare your .env with the template
diff .env .env.template
```

New features may require additional environment variables. Check `CHANGELOG.md` for details.

### 5. Restart

```bash
# Railway
railway up

# Or local
cd bot && node whatsapp-bot.js
```

## Version Check

The bot checks for updates on startup (10-second delay, non-blocking). If a newer version exists, you'll see:

```
[version-check] Update available: 1.0.0 -> 1.1.0
[version-check] Download: https://github.com/Orenda-Project/rumi-platform/releases/tag/v1.1.0
```

## Migration Files

Migrations live in `infrastructure/supabase/migrations/` and follow the naming convention:

```
V{major}.{minor}.{patch}__{description}.sql
```

Example: `V1.1.0__add_attendance_tables.sql`

Each migration is:
- **Idempotent**: Uses `IF NOT EXISTS` / `IF EXISTS`
- **Additive**: Never drops or modifies existing columns
- **Versioned**: Recorded in `schema_versions` with a SHA-256 checksum

## Resolving Conflicts

### Safe to Keep Your Version

If conflicts appear in these files, keep your version (`--ours`):

- `.env`
- `bot/shared/config/branding.js`
- `bot/shared/config/feature-availability.js`
- `bot/shared/config/capabilities.config.js`

### Accept Upstream Version

For these files, accept upstream (`--theirs`):

- `bot/shared/handlers/*`
- `bot/shared/services/*`
- `bot/shared/database/*`
- `infrastructure/supabase/*`

### Example Conflict Resolution

```bash
# Accept upstream for all handler files
git checkout --theirs bot/shared/handlers/
git add bot/shared/handlers/

# Keep your branding
git checkout --ours bot/shared/config/branding.js
git add bot/shared/config/branding.js

# Commit the merge
git commit
```

## Release Notes

Check `CHANGELOG.md` in each release for:
- New features and their required environment variables
- Breaking changes (rare, only in major versions)
- Database migration notes
- Deprecated features
