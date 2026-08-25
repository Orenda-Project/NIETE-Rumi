# Giving leader_schools a real school id

Status: plan, not started. Measured against NIETE prod on 2026-08-25. Tracked internally.

## The problem

Two coaches currently see one of their schools twice, with its teacher list split across
the two copies. One completed visit is filed under the wrong school.

The reason is that `leader_schools` decides which school a row is about by reading a
string that came from a spreadsheet:

```
school_ext_id = 'niete:' || <EMIS number typed into the coach roster sheet>
```

Two rows got the wrong number typed into them. `IMSB (I-V) Sang Jani` was saved under
EMIS 607, which belongs to `IMSB (VI-X) Shah Allah Ditta`. `IMSB (I-VIII) Dhoke Paracha`
(boys) was saved under EMIS 628, which belongs to the girls' school of the same name.

That is bad on its own. The worse part is what happens next. Roster inheritance finds a
school's teachers with `WHERE school_ext_id = $1` and nothing else, so the first coach who
adds `niete:607` inherits 16 teachers from two different schools. Nobody has done that yet.

## Why it keeps happening

Every other table in this database points at a school with `schools.id`, a uuid primary
key. `leader_schools` is the only one that uses a hand-typed string instead. So the
duplicate rows, the pooled rosters, and the wrong-school visit are all the same bug: the
identity is a value someone typed, not a key the database owns.

`V1.1.3__classes_model.sql` already made this argument for classes:

> The institutional spine it should have hung off ALREADY EXISTS and is fully populated:
> schools, users.school_id, users.role, leader_schools, leader_teachers.

Classes got fixed. `leader_schools` did not.

## The fix

Add `school_id uuid REFERENCES schools(id)` to the three tables that carry
`school_ext_id`, fill it in, switch every read to it, and let the database enforce what
we currently hope for. Keep `school_ext_id` afterwards as a record of what the sheet said.

Once a foreign key holds the identity, a coach cannot hold the same school twice and two
schools cannot share a roster. Neither is possible to express.

## What we measured first

On prod, 2026-08-25:

| | |
|---|---|
| `leader_schools` rows | 501 |
| `leader_teachers` rows | 8,034 |
| `schools` rows | 466 |
| `users` with `school_id` set | 8,801 of 9,591 |
| `leader_teachers` that match a user by phone | 8,026 of 8,034 (99.9%) |
| of those, with `school_id` set | 7,988 |

That last row is the important one. Almost every teacher in the roster is a real user who
already knows which school they work at. We can fill in `school_id` from the teachers
themselves and never trust the sheet.

## How the backfill decides

Three ways to work out which school a row means, each independent of the others:

1. From the EMIS in `school_ext_id`, matched against `schools.emis`.
2. From the teachers on that row: the most common `users.school_id` among them.
3. From the name, matched against `schools.name` after stripping punctuation and case, the
   same way `idx_schools_name_canon_region` already does it.

Fill the column in only where at least two of the three agree. Where they do not, leave it
null and print the row.

Run against prod, all 501 rows land like this:

| Outcome | Rows |
|---|---|
| EMIS and teachers agree, teachers unanimous | 350 |
| EMIS and teachers agree, teachers 60% or better | 137 |
| EMIS and teachers agree, weak teacher vote | 3 |
| No teachers on the row, EMIS only | 9 |
| Sources disagree, needs a person | 2 |

That table compares two of the three sources, the EMIS and the teachers. So 490 rows fill
themselves from two sources that agree, and 9 more from the EMIS alone because they have no
teachers to ask.

Bringing in the third source, the name, settles one of the last two. On `niete:607` the name
and the teachers both say Sang Jani against the EMIS, which is two of three, so it fills.
`niete:239` has no two sources that agree and stays null.

That leaves 500 of 501 rows filled and exactly one row waiting on a person. Teacher votes
are strong: 351 unanimous, 118 above 80%, 20 above 60%, and 3 with no majority.

The two rows where the EMIS and the teachers disagree:

- `niete:239` is labelled `IMSG (VI-X) G-8-2`. The EMIS says `IMSG (I-X), Malot`. Twelve of
  eighteen teachers say `IMCG (VI-XII) G-8/4`. The name matches neither, so nothing carries
  it and a person has to decide.
- `niete:607` is labelled `IMSB (I-V) Sang Jani` while the EMIS says Shah Allah Ditta. The
  name and the teachers agree on Sang Jani, so it fills. Worth one human glance anyway,
  since this is the row we already knew about.

Write which rule fired into `name_match_quality`. That column has been filled in for 425
rows since July and read by nothing, so give it a job.

## Order of work

### Phase 1: add the columns

```sql
ALTER TABLE leader_schools        ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id);
ALTER TABLE leader_teachers       ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id);
ALTER TABLE observation_schedules ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id);
CREATE INDEX IF NOT EXISTS idx_leader_schools_school  ON leader_schools (school_id);
CREATE INDEX IF NOT EXISTS idx_leader_teachers_school ON leader_teachers (school_id);
```

Nullable, so nothing changes for anyone. Reverting is a `DROP COLUMN`.

Test: the columns exist and every existing test still passes.

### Phase 2: clean up what cannot be resolved

Five rows point at no school at all: `test:9001` (3 rows) and `test:9002` (2 rows). They
are test data sitting in prod. Delete them or add a flag column and set it. Either way they
have to go before Phase 4, because a null `school_id` blocks `NOT NULL`.

Note that `test:9001` is assigned to three different coaches, so deleting it changes three
coaches' school lists. Tell them, or flag the rows instead of deleting.

`observation_schedules` has 647 rows across 198 distinct `school_ext_id` values, 12 of
which match no school. Those 12 do not block Phase 1, because the new `school_id` column is
nullable and can simply stay null. They do block using `school_id` for reads in Phase 5,
and they would block `NOT NULL` if we ever want it there. Decide what those 12 are before
Phase 5 reaches the scheduling code.

Test: after this phase, every remaining `leader_schools` row resolves to a school by at
least one of the three rules.

### Phase 3: fill the column and merge the duplicates

One script, one transaction, in this order:

1. Work out `school_id` for each `leader_schools` row using the three rules above.
2. Where a row was mis-keyed, it now points at a different school than its `school_ext_id`
   implies. Correct `school_ext_id` too, so the two agree. This matters during the
   transition: until Phase 5 lands, all the live code still reads `school_ext_id`, so
   leaving it wrong means the coach keeps seeing the split list.
3. Copy `school_id` down to `leader_teachers`, matching each teacher row to its parent on
   `(leader_user_id, school_ext_id)`. Do this after step 2 so the corrected rows carry the
   right value.
4. Only now merge the duplicates. Two coaches each end up with two rows pointing at the
   same school. Keep the row holding more teachers, move any teacher the winner does not
   already have, and delete the loser.
5. Assert the expected counts and roll back if any of them is off.

The order matters and it is easy to get wrong. If you fill `school_id` from the EMIS alone,
Sang Jani's row quietly becomes Shah Allah Ditta and the bug disappears from view instead
of being fixed. The duplicates also do not collide until after the correction, so
`UNIQUE (leader_user_id, school_id)` reports zero violations today and would fail the
moment Phase 3 runs if you added it first.

The two merges, measured:

| Coach holds | Wrong row | Right row | After |
|---|---|---|---|
| Sang Jani | `niete:607`, 1 teacher | `niete:632`, 12 teachers | 13 at 632 |
| Dhoke Paracha (boys) | `niete:628`, 1 teacher | `niete:620`, 18 teachers | 18 at 620 |

The two teacher rows behave differently, so do not write one loop for both. On the Sang
Jani pair, the teacher on the losing row is not yet on the winning row, so move them. On the
Dhoke Paracha pair, the teacher is already on the winning row, so delete the duplicate.
Moving that second one instead would break the unique key on `leader_teachers`. Read the two
identities out of the database when you write the script rather than copying them here,
since this file is public.

Two populations must come out unchanged: 15 teachers on Shah Allah Ditta at `niete:607`,
and 19 on the girls' Dhoke Paracha at `niete:628`. Assert both.

Rollback: dump the affected rows to CSV before starting. It is about 40 rows.

Test: write the assertions as a test first and watch them fail on a copy of prod data.

### Phase 4: let the database enforce it

```sql
ALTER TABLE leader_schools  ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE leader_teachers ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE leader_schools  ADD CONSTRAINT leader_schools_leader_school_key
  UNIQUE (leader_user_id, school_id);
```

This phase is blocked until a person resolves `niete:239`. Phase 3 fills 500 of 501 rows,
and `NOT NULL` fails while that one is still null. So Phase 4 waits on a single decision,
not on any code.

Keep the existing `UNIQUE (leader_user_id, source, school_ext_id)` in place for now. Two
unique keys on the same table is fine, and the old one still protects the columns that
Phase 5 has not moved off yet.

From here the bug cannot be written again. Rollback is dropping the constraint and the
`NOT NULL`, both instant.

Test: try to insert a second row for the same coach and school, and expect a unique
violation.

### Phase 5: switch the reads

128 references to `school_ext_id` across 13 files, plus 103 in tests. The heaviest are
`observe-visit-flow.handler.js` (33), `observe-school-admin.service.js` (22),
`leader-assignment.service.js` (17), and `leader-source.js` (12). A new one arrived this
month in `calls/call-tools.repo.js`, so the surface is still growing.

Move them file by file while both columns exist. The one that matters most is roster
inheritance, because keying it on `school_id` is what makes pooled rosters impossible
rather than merely unlikely.

Roster inheritance is written twice, and both copies have to move or the bug survives in
one of them. `dashboard/services/leader-assignment.service.js` serves the portal routes.
`bot/shared/services/observe/observe-school-admin.service.js` serves the WhatsApp Flow.
They have already drifted apart: the bot copy does one bulk insert, the dashboard copy
still loops one insert per teacher. Moving both is a good moment to collapse them into one.

Split this across several pull requests. The existing 103 test references are the safety
net, so keep them green at every step.

### Phase 6: freeze the sheet value, derive the name

`school_ext_id` stays, as a record of what the roster said. Do not make it the identity
again.

Keep `school_name`, and change where it comes from. Today a caller passes it in, which is
how a row ends up naming one school while its id points at another. After Phase 5 the write
path should read it from `schools.name` for the `school_id` it just resolved. Then the two
cannot disagree, because there is only one source.

That replaces the check I first wanted to add here. The duplicated name is what made this
bug visible, so it was worth keeping as a warning signal while identity was a typed string.
Once the identity is a foreign key and the name is copied from the row it points at, there
is nothing left to diverge, and a detector would be guarding against something that can no
longer happen.

One thing not to do: do not put that kind of check in
`infrastructure/supabase/verify-schema.sql`. Nothing executes that file. The only thing
referencing it is a test that checks the file exists and reads it as text, and no CI job in
this repo connects to a database at all. A check placed there would look like coverage and
provide none. The enforcement in Phase 4 is real because the database applies it on every
write.

## Two other things to fix while in here

Neither is required for this migration, but both are in the way.

`leader_schools` and `leader_teachers` are not in `00_complete-schema.sql`, and
`bootstrap-db.js` applies only that file plus the RLS and seed files. A fresh clone comes up
without these tables, and the feature then fails silently because
`leaderHasAssignment()` catches every error and returns false. Add both tables to the
schema file and drop them from `tests/baseline.snapshot.json`, so the completeness guard
protects the contract instead of recording that it is broken.

`schema_versions` lists 8 of the 21 migration files on prod and 7 on staging. `V1.0.9`, the
migration that created these tables, is in neither. Nobody can answer "what is applied?"
from the database, and `migrate.js` would treat thirteen migrations as pending.

## Risks

Row counts move. `leader_schools` grew from 496 to 501 during this investigation, so the
Phase 3 assertions must read live counts rather than the ones written here.

Prod was unreachable for 42 minutes on 2026-08-24 and the cause was never established. Do
not start a multi phase identity migration until it has been quiet for a few days.

RLS is off on `leader_schools` and `leader_teachers` while `schools` has it on. That is a
separate problem, but these two tables hold 8,034 rows of teacher names and phone numbers,
so it should be settled before or alongside this work.

## What this plan does not do

It does not add a foreign key from `school_ext_id` to anything. That column is not
trustworthy, which is the whole reason for the migration.

It does not scope roster inheritance to a single coach. Sharing a roster across coaches is
deliberate: it is how a coach picking up a school gets its teacher list. Phase 5 fixes the
key it joins on, not the sharing.

It does not resolve `niete:239`. No two sources agree on what that school is, so the
backfill leaves it null and prints it.
