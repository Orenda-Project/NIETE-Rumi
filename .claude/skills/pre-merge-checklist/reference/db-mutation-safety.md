# DB Mutation Safety — Pre-Flight Checks

Run these before merging any code that writes to the database. They catch the recurring DB bug classes.
Use a read-only role for inspection (`$DATABASE_URL` / your analyst connection — from env, never inline).

## 1. Before writing a new value to an enum-like column

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'YOUR_TABLE'::regclass AND contype = 'c';
```

If the new value is missing from the CHECK whitelist, ship a migration that expands the constraint **before**
the code that writes the value goes live.

```sql
-- migration: add NEW_VALUE to YOUR_TABLE.col
ALTER TABLE your_table DROP CONSTRAINT IF EXISTS your_table_col_check;
ALTER TABLE your_table ADD CONSTRAINT your_table_col_check
  CHECK (col IN ('existing', 'values', 'NEW_VALUE'));
```

**Failure mode if skipped**: a `status` CHECK allowed only `('generating','ready','sent','failed')`; the
cancel path wrote `'cancelled'`, Postgres silently rejected it, and the Supabase JS chain (§4) hid the
rejection — so the logs blamed "already finalized" instead of a constraint violation.

## 2. Before writing to a column with a unique index

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'YOUR_TABLE' AND indexdef LIKE '%UNIQUE%';
```

Read the column list inside `(...)`. If your "look up, insert if missing" check uses a *different* column
set than the index, you'll hit `duplicate key value violates unique constraint` on rows your code thinks
don't exist. Match the index exactly, or catch the duplicate-key error as a recovery path:

```js
const { data: row, error: insertErr } = await supabase.from('t').insert({...}).select().single();
if (insertErr && /duplicate key/.test(insertErr.message || '')) {
  const { data: existing } = await supabase.from('t').select('*')
    .ilike('column_in_index', value)   // match the index's lower()/normalisation
    .single();
  return existing;
}
if (insertErr) throw insertErr;
```

## 3. Before querying a column with possibly-inconsistent storage formats

```sql
SELECT
  COUNT(*) FILTER (WHERE col LIKE '+%')  AS with_plus,
  COUNT(*) FILTER (WHERE col ~ '^[0-9]') AS without_plus,
  COUNT(*) AS total
FROM your_table;
```

If formats are mixed, your `.eq()` must match both, or normalise at write-time and migrate existing rows.

```js
// try both formats — cheap, two round-trips at worst
const noPlus   = phone.startsWith('+') ? phone.slice(1) : phone;
const withPlus = phone.startsWith('+') ? phone : `+${phone}`;
let { data: user } = await supabase.from('users').select('id').eq('phone_number', noPlus).single();
if (!user) ({ data: user } = await supabase.from('users').select('id').eq('phone_number', withPlus).single());
```

**Failure mode if skipped**: `users.phone_number` stored without a leading `+` for nearly all rows, but new
code wrote `+<countrycode>…` — the `.eq()` lookup matched almost nobody, and the free-message path was
effectively dead.

## 4. The Supabase JS chain pitfall

```js
// ❌ returns {data:null, error:null} even on a constraint rejection
await supabase.from('t').update({...}).eq('id', x).in('status', [...]).select(...).single();

// ✅ split — errors are explicit
const { data: row, error: fetchErr } = await supabase.from('t').select('id, status, ...').eq('id', x).single();
if (fetchErr || !row) { /* not-found */ }
if (!['allowed_a','allowed_b'].includes(row.status)) { /* invalid-state */ }
const { error: updErr } = await supabase.from('t').update({...}).eq('id', x);
if (updErr) { /* surface the real SQL error — typically a constraint violation */ }
```

**Apply when**: any UPDATE with two or more WHERE conditions beyond `eq('id', ...)`, or an enum-like new value.
Cost: one extra SELECT. Benefit: correct error attribution and explicit guards.

## When something goes wrong in production

The bot's own log line is often generic, but the underlying `err`/`error.message` field usually carries the
real Postgres error (`violates check constraint "X"`, `duplicate key value violates unique constraint "Y"`)
that points straight at the fix. Query the logs for the reported window and read that field — don't speculate.
