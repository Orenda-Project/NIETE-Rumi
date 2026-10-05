# Account deletion requests: the manual procedure

**Who this is for:** the person who handles the deletion-request mailbox for the NIETE app and portal.

**What we have promised in public** (the page at `/portal/delete-account`, which Google Play links to):

- We delete the account and its data **within 30 days** of the request, and we **email a confirmation** when it is done.
- We delete: the account (name, phone number, school, role); her lesson recordings, including lessons a coach
  recorded, and their transcripts; AI feedback, reports and scores; photos and files she uploaded (lesson plans,
  board photos); training progress and quiz answers.
- We may keep: totals with no name or phone number in them, and anything the law requires us to keep.

The 30-day clock starts when the email arrives, not when someone opens it.

Nothing in the codebase deletes a teacher today. This procedure is manual, and it touches production, so it is
done by **one authorised person, with a second person checking the inventory (step 4) before anything is deleted.**
No agent runs any of this.

> **Privacy of the requests themselves.** This repository is public. Never put a requester's phone number, name or
> email in an issue, a commit, a PR, a bead title or this file. Keep the request log in the team's private tracker.

---

## 1. Log the request (day 0)

In the private tracker, record: date received, the sender's email, the phone number and name they gave, and the
**deadline (date received + 30 days)**. Reply the same week to say we have the request and are working on it:

> Subject: Re: Delete my NIETE account
>
> We've received your request to delete your NIETE account. We'll delete it and its data within 30 days and email
> you again when it's done. — NIETE Portal team

## 2. Find the account

Phone numbers are stored as **digits only, with the country code and no `+`**: `03XX XXXXXXX` → `923XXXXXXXXX`.
Strip spaces and dashes, drop the leading `0`, prefix `92`.

Read-only lookup (Supabase SQL editor, production project):

```sql
SELECT id, name, phone_number, role, school_name, portal_activated, created_at, deleted_at
FROM users
WHERE phone_number = '923XXXXXXXXX';
```

- **No row:** try the number as written in case it was stored differently, then reply asking them to check the
  number they registered with. Do not delete anything by name alone.
- **Name does not match:** do not proceed. Ask the requester to confirm. If the email plainly does not come from the
  account holder, confirm with the account holder on the registered number before deleting.
- **Already deleted** (`deleted_at` set, or phone starts with `deleted:`): reply with the confirmation.

Write down the `id` (a UUID). From here on it is `:uid`, and the phone number is `:phone`. In psql:
`\set uid '…'` and `\set phone '923…'`.

## 3. Teacher, or leader?

`role` decides the path:

| role | path |
|---|---|
| `teacher` (or empty) | **Delete** — §5 to §7 |
| `coach`, `aeo`, `supervisor`, `principal`, `school_leader` | **Delete her own data, anonymise the account row** — §5 to §7, then §6b |

Why leaders differ: other people's records point at a leader with columns that cannot be emptied
(`teacher_attendance_records.marked_by_user_id`, `leader_roster_audit.actor_user_id`,
`child_test_sessions.coach_user_id`, `supervisor_remarks.principal_user_id`, `grade_audit_log.user_id` are all
`NOT NULL`). Those rows are the teachers' and the programme's records, not hers. Deleting her row would either fail
or take other people's data with it, so we remove everything that identifies her and keep the row as an anonymous
placeholder.

**Child test sessions** (`child_test_sessions`, `child_test_blocks`, R2 `child-test/…`) are recordings and results
of **children**, made by a coach. They are programme data, not the coach's personal data. Do not delete them as
part of a coach's request: anonymise the coach and ask the programme lead.

## 4. Inventory: what exists, before deleting anything

### 4a. How each table really reacts to a delete

The schema files disagree with each other about `ON DELETE` for several tables, so **read the live rules first**:

```sql
SELECT c.conrelid::regclass AS table_name,
       a.attname           AS column_name,
       c.confdeltype       AS on_delete   -- a = no action, r = restrict, c = cascade, n = set null
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.confrelid = 'public.users'::regclass AND c.contype = 'f'
ORDER BY 1, 2;
```

Anything marked `a` or `r` must be deleted (or emptied) **before** the `users` row. The order in §6 already does
this for every table known on 2026-10-03. If this query lists a table that §6 does not mention, stop and add it.

### 4b. Count her rows

```sql
SELECT 'coaching_sessions (hers)' AS what, count(*) FROM coaching_sessions WHERE user_id = :'uid'
UNION ALL SELECT 'coaching_sessions (observed by her)', count(*) FROM coaching_sessions WHERE observer_user_id = :'uid'
UNION ALL SELECT 'observation_field_forms (about her)', count(*) FROM observation_field_forms WHERE teacher_user_id = :'uid'
UNION ALL SELECT 'lesson_plan_requests', count(*) FROM lesson_plan_requests WHERE user_id = :'uid'
UNION ALL SELECT 'lesson_plans', count(*) FROM lesson_plans WHERE user_id = :'uid'
UNION ALL SELECT 'niete_lp_downloads', count(*) FROM niete_lp_downloads WHERE user_id = :'uid'
UNION ALL SELECT 'teacher_training_progress', count(*) FROM teacher_training_progress WHERE user_id = :'uid'
UNION ALL SELECT 'training_assessment_attempts', count(*) FROM training_assessment_attempts WHERE user_id = :'uid'
UNION ALL SELECT 'training_certificates', count(*) FROM training_certificates WHERE user_id = :'uid'
UNION ALL SELECT 'quizzes', count(*) FROM quizzes WHERE teacher_id = :'uid'
UNION ALL SELECT 'student_lists', count(*) FROM student_lists WHERE user_id = :'uid'
UNION ALL SELECT 'class_teachers', count(*) FROM class_teachers WHERE teacher_user_id = :'uid'
UNION ALL SELECT 'conversations', count(*) FROM conversations WHERE user_id = :'uid'
UNION ALL SELECT 'record_history (users row)', count(*) FROM record_history WHERE table_name = 'users' AND row_id = :'uid';
```

The second person checks these numbers against the role and the account's age before step 5.

## 5. Collect and delete her files in R2

Do this **before** deleting rows: the rows are where the file locations are written down.

> ⚠️ **The bucket is shared** with other deployments (same bucket name, same Cloudflare account). Only ever delete
> exact keys, or prefixes that **contain her UUID or her phone number**. Never delete a bare prefix such as
> `classroom_audio/`.

Bucket: the env var `R2_BUCKET_NAME` on the bot service; register photos live in `ROSTER_R2_BUCKET`. Use any
S3-compatible client with the R2 credentials (or the helpers in `bot/shared/storage/r2.js`: `listKeys(prefix)`,
`extractKeyFromUrl(url)`, `deleteAudio(url)`).

**5a. Keys written down in her rows.** These catch files stored under someone else's id, for example a lesson a
coach recorded from the portal, which is stored under the **coach's** id even though the session is the teacher's.

```sql
WITH rows AS (
  SELECT to_jsonb(cs)::text AS j FROM coaching_sessions cs WHERE cs.user_id = :'uid'
  UNION ALL SELECT to_jsonb(f)::text  FROM observation_field_forms f WHERE f.teacher_user_id = :'uid'
  UNION ALL SELECT to_jsonb(r)::text  FROM reading_assessments r WHERE r.user_id = :'uid'
  UNION ALL SELECT to_jsonb(a)::text  FROM attendance_sessions a WHERE a.user_id = :'uid'
  UNION ALL SELECT to_jsonb(e)::text  FROM exam_check_sessions e WHERE e.user_id = :'uid'
  UNION ALL SELECT to_jsonb(t)::text  FROM training_certificates t WHERE t.user_id = :'uid'
  UNION ALL SELECT to_jsonb(p)::text  FROM assessment_papers p
            JOIN assessment_requests q ON q.id = p.request_id WHERE q.user_id = :'uid'
  UNION ALL SELECT to_jsonb(h)::text  FROM hcp_feedback_deliveries h WHERE h.teacher_id = :'uid'
)
SELECT DISTINCT m[1] AS r2_key
FROM rows, regexp_matches(
  j,
  '((?:classroom_audio|audio|lesson_plans|images|voice_debriefs|reports|observe-reports|observe2|certs|exams|transcript_quizzes|reading_passages|reading_reports|reading_voice_feedback|attendance)/[^"\\ ?]+)',
  'g') AS m
ORDER BY 1;
```

If `assessment_papers` joins on a different column name in production, adjust the join; the rest stands.

**5b. Prefixes named after her.** List each, check the listing is hers, then delete:

| prefix | what is there |
|---|---|
| `audio/<uid>/` **and** `audio/<phone>/` | WhatsApp voice notes (one code path keys them by phone) |
| `classroom_audio/<uid>/` | her lesson recordings |
| `lesson_plans/<uid>/` | lesson-plan photos, PDFs, Word files |
| `images/<uid>/` | photos, including board photos |
| `voice_debriefs/<uid>/` | voice debriefs |
| `reports/<uid>/` | coaching and quiz reports (PDF/PNG) |
| `certs/<uid>/` | training certificates |
| `exams/<uid>/` | generated assessment papers |
| `transcript_quizzes/<uid>/` | quiz cards and PDFs |
| `reading_passages/<uid>/`, `reading_reports/<uid>/`, `reading_voice_feedback/<uid>/` | reading assessments |

`observe-reports/<coaching_session_id>.png` and `observe2/<form_id>/` are keyed by the session or form, so 5a is
what finds them.

For a **leader**, 5b also lists the lessons she recorded of *other* teachers (`classroom_audio/<her uid>/portal_…`).
Those belong to the teachers. **Leave them.**

Keep the list of deleted keys in the private tracker.

## 6. Delete her rows

One transaction, children before parents. Every statement is scoped to her id or phone. Run the inventory query
from 4b afterwards to check for zeros.

```sql
BEGIN;

-- Coaching: rows hanging off her sessions, then the sessions.
UPDATE coaching_sessions SET duplicate_of_session_id = NULL
  WHERE duplicate_of_session_id IN (SELECT id FROM coaching_sessions WHERE user_id = :'uid');
DELETE FROM coaching_jobs              WHERE coaching_session_id IN (SELECT id FROM coaching_sessions WHERE user_id = :'uid');
DELETE FROM coaching_processing_queue  WHERE coaching_session_id IN (SELECT id FROM coaching_sessions WHERE user_id = :'uid');
DELETE FROM coaching_quality_metrics   WHERE coaching_session_id IN (SELECT id FROM coaching_sessions WHERE user_id = :'uid');
DELETE FROM hcp_feedback_deliveries    WHERE teacher_id = :'uid'
   OR coaching_session_id IN (SELECT id FROM coaching_sessions WHERE user_id = :'uid');
DELETE FROM hcp_visit_schedules        WHERE teacher_id = :'uid';
DELETE FROM observation_field_forms    WHERE teacher_user_id = :'uid';
DELETE FROM observation_schedules      WHERE teacher_user_id = :'uid' OR teacher_ext_id = :'phone';
DELETE FROM supervisor_remarks         WHERE teacher_id = :'uid';           -- scores cascade
DELETE FROM teacher_attendance_records WHERE teacher_id = :'uid';
DELETE FROM coaching_sessions          WHERE user_id = :'uid';

-- Her entry on coaches' rosters.
DELETE FROM leader_teachers WHERE teacher_phone_e164 = :'phone';
UPDATE leader_roster_audit SET teacher_phone_e164 = 'deleted', teacher_name = 'deleted'
  WHERE teacher_phone_e164 = :'phone';

-- Training: certificates before attempts (answers cascade from attempts).
DELETE FROM training_certificates        WHERE user_id = :'uid';
DELETE FROM training_assessment_attempts WHERE user_id = :'uid';
DELETE FROM teacher_training_progress    WHERE user_id = :'uid';
DELETE FROM teacher_training_assignments WHERE user_id = :'uid';

-- Lesson plans, assessments, video, quizzes.
DELETE FROM lesson_plan_requests    WHERE user_id = :'uid';
DELETE FROM lesson_plans            WHERE user_id = :'uid';
DELETE FROM assessment_requests     WHERE user_id = :'uid';   -- papers cascade
DELETE FROM image_analysis_requests WHERE user_id = :'uid';
DELETE FROM video_quiz_deliveries   WHERE user_id = :'uid';
DELETE FROM video_tasks             WHERE video_request_id IN (SELECT id FROM video_requests WHERE user_id = :'uid');
DELETE FROM video_requests          WHERE user_id = :'uid';
DELETE FROM quizzes                 WHERE teacher_id = :'uid'; -- questions, sessions, answers cascade
DELETE FROM quiz_share_codes        WHERE teacher_user_id = :'uid';

-- Her classes, student lists and registers. If a class she created has other teachers on it, stop and ask:
-- the class belongs to the school, not to her.
DELETE FROM class_teachers     WHERE teacher_user_id = :'uid';
DELETE FROM attendance_records WHERE session_id IN (SELECT id FROM attendance_sessions WHERE user_id = :'uid');
DELETE FROM attendance_sessions WHERE user_id = :'uid';
DELETE FROM students           WHERE list_id IN (SELECT id FROM student_lists WHERE user_id = :'uid');
DELETE FROM student_lists      WHERE user_id = :'uid';

-- Reading and exam checker.
DELETE FROM reading_assessments WHERE user_id = :'uid';
DELETE FROM grade_audit_log  WHERE user_id = :'uid'
   OR grade_id IN (SELECT g.id FROM exam_grades g JOIN exam_submissions s ON s.id = g.submission_id
                   JOIN exam_check_sessions e ON e.id = s.session_id WHERE e.user_id = :'uid');
DELETE FROM exam_grades      WHERE submission_id IN (SELECT s.id FROM exam_submissions s
                   JOIN exam_check_sessions e ON e.id = s.session_id WHERE e.user_id = :'uid');
DELETE FROM exam_submissions WHERE session_id IN (SELECT id FROM exam_check_sessions WHERE user_id = :'uid');
DELETE FROM exam_check_sessions WHERE user_id = :'uid';
DELETE FROM exam_templates      WHERE user_id = :'uid';

-- Conversations, calls and analytics.
DELETE FROM conversations          WHERE user_id = :'uid';
DELETE FROM chat_sessions          WHERE user_id = :'uid';
DELETE FROM chat_starts            WHERE user_id = :'uid' OR phone_number = :'phone';
DELETE FROM user_feature_first_use WHERE user_id = :'uid';
DELETE FROM feature_suggestions    WHERE user_id = :'uid';
DELETE FROM ab_test_events         WHERE user_id = :'uid' OR phone_number = :'phone';
DELETE FROM broadcast_messages     WHERE user_id = :'uid' OR phone_number = :'phone';
DELETE FROM teacher_facts          WHERE user_id = :'uid';
DELETE FROM teacher_progress       WHERE user_id = :'uid';
DELETE FROM audio_sessions         WHERE user_id = :'uid';
DELETE FROM call_recall_docs       WHERE caller_number = :'phone' OR user_id = :'uid';
DELETE FROM call_memory            WHERE caller_number = :'phone' OR user_id = :'uid';
DELETE FROM calls                  WHERE caller_number = :'phone' OR user_id = :'uid';

-- 6a. TEACHER: delete the account. Tables declared ON DELETE CASCADE (lp_feedback, niete_lp_downloads,
-- niete_lp612_deliveries, teacher_nudges, student_video_feedback, …) go with it.
DELETE FROM users WHERE id = :'uid';

COMMIT;
```

Column names in the exam-checker block (`grade_id`, `submission_id`, `session_id`) are from the schema files;
check them against production (`\d exam_grades`) before running. Any statement that errors aborts the whole
transaction, so nothing is left half-done: fix it and rerun.

### 6b. LEADER: anonymise the account instead of deleting it

Replace the final `DELETE FROM users` above with this, and skip the child-test tables (see §3):

```sql
UPDATE users SET
  name = 'Deleted user',
  phone_number = 'deleted:' || id::text,
  school_name = NULL,
  preferences = '{}'::jsonb,
  conversation_state = NULL,
  portal_password_hash = NULL, portal_invite_token = NULL, portal_invite_expires_at = NULL,
  portal_activated = false, password_reset_code = NULL, password_reset_expires_at = NULL,
  deleted_at = now(), deleted_reason = 'account deletion request', deleted_by = '<staff name>'
WHERE id = :'uid';

DELETE FROM coach_directory WHERE leader_user_id = :'uid';
DELETE FROM leader_schools  WHERE leader_user_id = :'uid';
DELETE FROM leader_teachers WHERE leader_user_id = :'uid';
```

Her name inside other people's records (for example the coach's name on a teacher's observation report) stays in
those records. They are the teacher's records, and the teacher has a right to them.

## 7. Copies that live elsewhere

- **Audit history.** A trigger on `users` (and on `coaching_sessions`, `observation_schedules`, `students` and
  more) copies the old row, phone and name included, into `record_history` **on delete**. Purge it **after** §6:

  ```sql
  DELETE FROM record_history
  WHERE row_id = :'uid'
     OR old_vals::text LIKE '%' || :'phone' || '%'
     OR new_vals::text LIKE '%' || :'phone' || '%';
  ```

- **Dashboard view.** `mv_users_activity` keeps a copy until it is refreshed: `SELECT refresh_dashboard_views();`
- **Redis** (`REDIS_URL` on the bot service). Delete keys containing her UUID or her phone:
  `redis-cli --scan --pattern '*<uid>*'` and `--pattern '*<phone>*'`, check the list, then `DEL`. Portal login
  sessions are `obs-sess:<sid>` and hold her id inside the value. They expire after 7 days, and the portal does not
  re-check that the account still exists while a session lives, so delete any whose value contains her UUID.
- **BigQuery** (attendance export): `DELETE FROM steps.attendance WHERE teacher_id = '<uid>' OR teacher_phone_e164 = '<phone>'`.
- **Soniox** purges its own copies of old transcriptions automatically (the stale-session worker). Nothing to do.
- **Logs** (Axiom, Railway) contain phone numbers and message text. They cannot be edited and expire with the log
  retention set in each console. Do not promise more than that.
- **WhatsApp** chat history on her phone and with Meta is outside our systems.

## 8. What stays, and why that is fine

Totals already computed without names or phone numbers (counts of lessons, averages by district), and the
anonymised leader row from §6b. Neither can be traced back to her.

## 9. Confirm and close (by day 30)

Re-run 4b: every count is 0, except the `users` row for a leader (anonymised). Then reply:

> Subject: Re: Delete my NIETE account
>
> Your NIETE account has been deleted, along with its recordings, transcripts, reports, scores, photos, files and
> training progress. We keep only totals that contain no name or phone number. If you use the NIETE app again,
> you will need to register as a new user. — NIETE Portal team

Record the completion date in the private tracker.

## If something does not fit

A table that 4a lists and §6 does not, a class shared with other teachers, a request about child-test data, or a
request you cannot verify: stop, keep the clock in mind, and escalate to the programme lead the same day.
