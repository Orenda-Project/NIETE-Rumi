# The classes model

A class is a first-level entity: it belongs to a **school**, sits for a
**session**, is at one **grade**, and is taught by one-or-more **teachers** across
one-or-more **subjects**, at most one of whom is the prime-responsible class
teacher. Students are **enrolled** into it rather than being rows inside it.

This document is the design record: what exists today, what is deliberately
scaffolding, and the plan for the parts that are **not built yet**. The promotion
and rollover sections describe intended future work, not shipped behaviour.

---

## 1. Why it exists

Before this model, a "class" was a row in `student_lists` — a table the attendance
feature created to hold a roster to mark attendance against. Class identity was a
side effect of a feature, so it inherited that feature's shape: owned by one
teacher, named by free text, with no school, no subject, no session, and no notion
of a student who exists independently of it.

Two things made the case decisive rather than aesthetic:

- **The roster model was unused.** Every live quiz carried no roster link at all,
  and most student rows belonged to no list. The features that should sit on a
  class were not sitting on it.
- **The institutional spine already existed and was fully populated** — schools,
  `users.school_id`, `users.role`, leader/school and leader/teacher links.
  `student_lists` simply never referenced any of it.

Meanwhile class identity had degraded into a string. The rostered-nowhere students
carried eighteen distinct spellings of what were really about three classes,
including a superscript digit — free text collects everything.

---

## 2. The tables

| Table | What it holds |
|---|---|
| `academic_sessions` | The period a class sits for. `kind` (annual / semester / term) + real dates, so a non-year cycle is representable. |
| `grade_levels` | Canonical grades: `code`, `ordinal`, `band`, `aliases`. |
| `subjects` | Canonical subjects: `code`, `parent_code`, `aliases`. |
| `classes` | school × grade × section × session. |
| `class_teachers` | One row per (class, teacher). The **role** lives here. |
| `class_teacher_subjects` | Which subjects that one assignment covers. |
| `class_enrollments` | Membership, as a row with a date range. |

### Three decisions worth not re-litigating

**The role is on the (class, teacher) pair, not the subject row.** A teacher
taking Maths *and* Science for one class who is also its class teacher would
otherwise carry an ambiguous flag on two rows. At most one prime-responsible
teacher per class, enforced by a partial unique index — "at most", not "exactly",
because a class may legitimately have none yet. A class teacher with
administrative responsibility and no teaching load is representable: the subject
rows are simply absent.

**Enrollment is a row, not a pointer.** See §4.

**The reference tables hold no display copy.** Labels live in the bot's copy
catalog (`bot/shared/config/ux-strings.js`) keyed by these codes. Two reasons:
WhatsApp field caps are an outage class and the cap audit measures *source*, so a
label in a database column is invisible to it; and choosing between a `name_ur`
and a `name_en` column at render time would be a second language clamp, which is
the structural defect the catalog exists to remove. A conformance test asserts the
label key sets equal the seeded codes, so adding a subject to the seed without a
label fails the build instead of rendering a blank picker row.

### Aliases

`grade_levels.aliases` and `subjects.aliases` are how the legacy encodings resolve
without migrating their columns. Production holds four incompatible grade
encodings (band names, `grade_N` slugs, English words across the whole lesson-plan
catalog, and bare digits) and five subject spellings. A canonical row with an
alias array gives all of them somewhere to resolve *to*, on our schedule.

`class-vocabulary.service.js` resolves them and **fails closed** — a wrong grade
silently picks the wrong reading passage and the wrong lesson plan, so no answer
beats a guess. This is the opposite of most gates here, which fail open so a
teacher is never dead-ended; the difference is that the failure mode is a wrong
answer rather than a missing screen.

`class-label-parser.js` handles compound free text (`4A`, `3-c`, `5th A`,
`Class:3`) and refuses anything it does not fully recognise. A digit inside junk
text is incidental, not a grade.

---

## 3. Sessions

A class is session-scoped by construction: `classes` is unique on
`(school_id, grade_code, section, session_code)`, so "4-A this year" and "4-A next
year" are different rows. That is what makes rollover an enrollment operation
rather than a mutation.

Spans follow this deployment's **August–July** cycle, matching the one existing
definition of an academic year in the codebase. A test parses the seeded spans and
asserts they name the same session that function does, sampled on both sides of the
rollover. This is worth keeping: the seed was first written with April–March spans
copied from a sibling deployment, and nothing else would have caught it until a
class created in spring was filed a year off.

There is deliberately **no `is_current` flag**. Current-ness is a date predicate,
because with mixed annual and semester schools more than one session can
legitimately contain today.

### Open question: mixed cycles

If one school runs annual sessions and another runs semesters, "the current
session" stops being global. The date predicate returns both, and today the code
picks the shortest span containing the date — the most specific answer, and a
placeholder for a real decision.

The likely resolution is that the **cycle is a property of the school**, so the
question becomes "the current session *for this school*". That is a schema change
(a `schools.session_kind`, or a school↔session link table) and should not be
guessed at before a second cycle actually exists. Until then, all seeded sessions
are annual and the ambiguity is unreachable.

---

## 3a. Applying the migration

`V1.1.3` carries **no explicit `BEGIN`/`COMMIT`**, unlike the six migrations before
it. `npm run migrate` applies migrations through the `exec_sql` RPC, whose body is
`EXECUTE query` — and Postgres cannot `EXECUTE` a transaction command, so a file
containing `BEGIN` raises `0A000: EXECUTE of transaction commands is not
implemented` and never applies.

Atomicity is not lost: a plpgsql function body is itself one transaction, so the
whole batch still commits or rolls back together. Applying by hand instead (psql,
or the Supabase SQL editor) runs in autocommit, so wrap it yourself there if you
want all-or-nothing.

**This affects the other six too.** `V1.0.8`, `V1.0.9`, `V1.0.10`, `V1.1.0`,
`V1.1.1` and `V1.1.2` all contain `BEGIN;`, so none of them can go through the
runner as written — which is the likely reason `schema_versions` lags well behind
the migration files on disk and those changes were applied by hand. Worth fixing
the same way, but not from this change.

---

## 4. Promotion and rollover — NOT BUILT

A class ends with its session. Students are then promoted to the next grade, or
retained into a same-grade class in the next session. With a pointer column on the
student, every rollover would duplicate the child. With enrollment as a row it is:

```
close  class_enrollments(child, 4-A / this session)      left_on, outcome
open   class_enrollments(child, 5-A / next session)      enrolled_on
```

Retention is the **same operation with a different target** — same grade, next
session, different class row. No flag, no special case, no `repeated_year` boolean.

The byproduct: a child's ordered enrollment list *is* their academic history,
which is impossible in the old model where student rows were welded to one
teacher's list.

`left_on` and a nullable `outcome` (`promoted` / `retained` / `transferred` /
`left` / `completed`) are already in the schema as unused hooks, so building this
needs no migration. No code reads `outcome` yet.

### Ordering constraints when it is built

1. **Target classes must exist first.** Promotion writes into next session's
   classes, so "create next session's classes" precedes "promote".
2. **It is a batch operation per class, with per-student exceptions.** The common
   case is "promote the whole class"; retention is the exception list.
3. **It must be idempotent and reversible.** Someone will run it twice, and
   someone will run it a session early. Re-running should be a no-op, and an
   accidental run should be undoable from the enrollment rows alone.
4. **Roll-forward of teaching assignments is a separate question** from student
   promotion, and should not be bundled into the same operation.

---

## 5. Scaffolding to remove

These exist only to keep the old world working while the new one is adopted, and
should be deleted together:

- **The mirror write** in `class.service.js` — creating a class also writes, or
  adopts, a legacy `student_lists` row.
- **`student_lists.class_id`** — the bridge column linking a legacy roster to its
  replacement, so the cutover can find each row's counterpart instead of matching
  on free text.
- **`mirrorLabel()`** — the English `class_name` the mirror needs because that
  column is `NOT NULL` and attendance renders it.

Adoption rather than plain insertion matters: `student_lists` is unique on
`(user_id, LOWER(class_name), academic_year)` where active, so a teacher who
already added a class the old way must have that row adopted, students intact,
rather than hitting a duplicate-key error.

A failed mirror does **not** fail the class. Losing the class a teacher just
created is unrecoverable; a missing mirror only degrades attendance visibility and
is repairable.

---

## 6. Migration order for the features

Nothing has moved yet. Each step is its own change, and each removes a reason for
the mirror to exist:

1. **Attendance** — the largest consumer and the reason `student_lists` exists.
   Move sessions and records onto `class_id`, then the roster becomes
   `class_enrollments`.
2. **Quizzes** — every live quiz currently carries no roster link at all, so this
   is closer to *adopting* the model than migrating onto it.
3. **Reading assessments** — already resolve a grade for passage difficulty; that
   read becomes `classes.grade_code` instead of parsing free text.
4. **`users.grades_taught`** — becomes **derivable** from `class_teachers` rather
   than a hand-typed field held in two incompatible formats. Derive it, then stop
   writing it.

Only once no feature reads `student_lists` can §5 be deleted.

---

## 7. Deliberately not done

- **Editing a class** on either surface. View and add are built; edit is worth its
  own screens rather than being bolted onto the add path.
- **Principal and coach views** of a school's classes. The spine supports it — the
  scoping decision (own / school / allocated schools) is made, not implemented.
- **A subject vocabulary beyond the lesson-plan corpus.** The seeded set is scoped
  to subjects we can actually serve a lesson plan for, so `class_teacher_subjects`
  cannot yet express a subject outside it. Adding one is a one-row insert, not a
  migration.
- **Regenerating the registration subject dropdown from the `subjects` table.** It
  offers more subjects than the table does, so doing this would silently remove
  options teachers currently pick. It needs a decision, not a refactor.
- **Reconciling the legacy `subject` columns** on the lesson-plan and quiz tables
  onto canonical codes. The aliases make it possible whenever it is wanted.
- **Grades 6–12 lesson-plan coverage.** The corpus covers a small set of
  grade × subject pairs; classes outside it resolve to an empty corpus. Worth
  knowing before promising a teacher "your class's lesson plans".
