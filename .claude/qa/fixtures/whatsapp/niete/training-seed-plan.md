# NIETE training — seed plan to run the remaining `@wip`/`@destructive` scenarios

**Goal:** make the 13 currently-excluded `training.feature` scenarios runnable against the
test driver **`923028931858`** (operator's disposable number = `test_driver`) on **prod**.

**Automated:** the seeds/lookups/answer-key/revert below are all encoded in
[`.claude/qa/shared/niete_training_db.py`](../../shared/niete_training_db.py) (reads free; writes gated by
`--yes-write`) + the browser exam-driver [`grandquiz_exam_drive.js`](../../shared/grandquiz_exam_drive.js).
The executor agent's **§2.4a** drives #3/#4/#9 from these — prefer the script over hand-writing the SQL below.
The raw SQL here is the reference/fallback.

**Schema source:** `infrastructure/supabase/00_complete-schema.sql` (read fresh, not memory — Rule 15).
**Who runs the writes:** the operator. I never execute prod-DB writes (config + tooling only).
**Golden rules for every block below:**
1. Run the **lookup queries first**, paste the real IDs into the write blocks (never hardcode UUIDs from memory).
2. After each write, run the paired **read-back** and confirm before driving.
3. Prod DB — get a fresh per-block "go". `@destructive` blocks (#3/#9/#7) are irreversible-ish; do them knowingly.
4. Reversible blocks (#10 Urdu) — revert after.

---

## 0 — Lookups (run these once; reuse the IDs everywhere below)

```sql
-- (a) the test user's UUID
SELECT id AS uid, phone_number, first_name, last_name, name,
       registration_completed, registration_state, preferred_language, language_locked, role
FROM users WHERE phone_number = '923028931858';

-- (b) programmes + vendors that exist (tells us what's already seeded for Bucket C)
SELECT id AS program_id, key, name, is_active FROM training_programs ORDER BY key;
SELECT id AS vendor_id, key, name, passing_pct, cooldown_hours, cert_code_prefix, unlock_logic
FROM training_vendors ORDER BY key;

-- (c) NIETE Level-0 id (for the exam-unlock seed). Adjust vendor key if not the default `<vendor-key>`/'NIETE'.
SELECT l.id AS level_id, l.name, l.order_index, v.key AS vendor_key
FROM training_levels l JOIN training_vendors v ON v.id = l.vendor_id
ORDER BY v.key, l.order_index;

-- (d) which vendor has 6+ levels (for #15 reachability)
SELECT v.key, count(*) AS levels
FROM training_levels l JOIN training_vendors v ON v.id = l.vendor_id
GROUP BY v.key ORDER BY levels DESC;

-- (e) the test user's current active programme assignment
SELECT a.id, a.program_id, p.key, a.is_active
FROM teacher_training_assignments a JOIN training_programs p ON p.id = a.program_id
WHERE a.user_id = :uid;
```

Placeholders used below: `:uid`, `:level0_id`, `:niete_program_id`, `:bh_program_id`, `:bh_program_key`.

---

## Bucket D — #10 Urdu content  (REVERSIBLE — do first, safest)
> **Try the no-DB path first:** send `/language` → pick **Urdu**; then drive a module quiz and confirm
> the question text + options render in Urdu (Rule 20). Only if the picker path is blocked, force it:
```sql
UPDATE users SET preferred_language = 'ur', language_locked = true WHERE id = :uid;      -- set
-- drive #10, then REVERT:
UPDATE users SET preferred_language = 'en', language_locked = false WHERE id = :uid;
```
Read-back: `SELECT preferred_language, language_locked FROM users WHERE id=:uid;`

---

## Bucket A — teacher-state seeds (on the test account)

### Prereq for #3 + #9 — unlock Level 0's grand quiz (mark every Level-0 module done)
```sql
INSERT INTO teacher_training_progress (user_id, module_id)
SELECT :uid, m.id
FROM training_modules m
JOIN training_courses c ON c.id = m.course_id
WHERE c.level_id = :level0_id AND m.is_active = true
ON CONFLICT (user_id, module_id) DO NOTHING;
```
Read-back (expect done == total, and the grand quiz to unlock in `/training`):
```sql
SELECT
 (SELECT count(*) FROM teacher_training_progress p
    JOIN training_modules m ON m.id=p.module_id
    JOIN training_courses c ON c.id=m.course_id
   WHERE p.user_id=:uid AND c.level_id=:level0_id) AS done,
 (SELECT count(*) FROM training_modules m
    JOIN training_courses c ON c.id=m.course_id
   WHERE c.level_id=:level0_id AND m.is_active) AS total;
```
Then in WhatsApp: `/training` → Open → Level 0 → the grand quiz should now be **unlocked**.

### #3 — finish-all → pass level exam → certify   (@destructive: certifies Level 0)
- **No extra SQL** — the prereq above unlocks it. **DRIVE** the grand quiz live and pass (NIETE = MCQ, ~20 served, 80%).
- ⚠️ I don't have the grand-quiz answer key; I resolve options by meaning (like the module checks). Expect possible retries.
- On pass, the bot writes `training_assessment_attempts` (is_passed=true) + a `training_certificates` row. Grab the code for #4:
```sql
SELECT certificate_code, level_name_snapshot, teacher_name_snapshot, issued_at
FROM training_certificates WHERE user_id = :uid ORDER BY issued_at DESC LIMIT 1;
```

### #4 — certificate by code → PDF
- Needs #3 done. In WhatsApp: `/certificate <certificate_code>` (the code from the read-back) → expect the PDF document.

### #9 — fail level exam → 24h cooldown   (@destructive: real lock)
- **Mutually exclusive with #3 on the same level/attempt.** Sequence: do **#9 first** (fail), verify the lock, then RESET and do #3 (pass) — or accept only one per account.
- Drive the grand quiz and deliberately answer wrong (<80%). Verify:
```sql
SELECT status, is_passed, score, total_score, cooldown_until
FROM training_assessment_attempts
WHERE user_id=:uid AND level_id=:level0_id ORDER BY started_at DESC LIMIT 1;   -- expect status 'failed', cooldown_until ~ now()+24h
```
- **Reset to re-enable the exam** (so #3 can then run without waiting 24h):
```sql
DELETE FROM training_assessment_attempts
WHERE user_id=:uid AND level_id=:level0_id AND status = 'failed';
```

### #1 — no-quiz module → "▶ Next video"   (needs a no-quiz module)
- A module is "no-quiz" when it has **no `training_questions`** rows → CTA renders **"▶ Next video"** (not "Take quiz"; the "✓ Done" caption is historical). Two options:
  - **(pref)** if any vendor programme already contains a no-quiz module, assign the user there (see Bucket C) and reach it.
  - **(seed)** insert one as the next-up module of a Level-0 course (pick a `course_id` + an `order_index` that is genuinely next):
```sql
INSERT INTO training_modules (course_id, title, video_url, order_index, is_active)
VALUES (:course_id, 'QA no-quiz module', 'https://example.com/placeholder.mp4', :next_order_index, true);
-- (leave training_questions empty for this module id)
```
  Read-back: confirm `/training` → course shows the new module as next-up with a **"▶ Next video"** button.

### #7 — unregistered → "register first"   (@destructive: wipes identity — DO LAST)
```sql
UPDATE users SET registration_completed = false, registration_state = 'unregistered',
       first_name = NULL, last_name = NULL, name = NULL, registration_completed_at = NULL
WHERE id = :uid;
```
- Then `/training` → expect the **"register first"** prompt; then run `/register` to re-onboard.
- ⚠️ Do this **after** #3/#4/#10 — it removes the name/identity those rely on.

---

## Bucket C — vendor programmes  (#2 PDF, #5 Beacon House, #6 Oxbridge, #15 6-level)
Beacon House content is **already imported** (`scripts/migrations/2026-07-21-capstone-import.sql` seeded BH capstone
levels 18–21 with written-answer exams). So these likely need **only an assignment**, not content seeding.

1. From lookup (b)/(d): find the BH program key (e.g. `bh_ai_v1`), an Oxbridge program if present, and any 6+-level vendor.
2. Assign the test user (guard against dupes — no unique constraint on the table):
```sql
INSERT INTO teacher_training_assignments (user_id, program_id, assigned_by, is_active)
SELECT :uid, :bh_program_id, 'qa_seed', true
WHERE NOT EXISTS (
  SELECT 1 FROM teacher_training_assignments
  WHERE user_id = :uid AND program_id = :bh_program_id AND is_active = true
);
```
3. In WhatsApp: `/training` → the **"Choose a program"** screen should now list the extra programme(s) → open Beacon House for **#5** (written-answer capstone), its PDF modules for **#2** ("Read the PDF" → document), an Oxbridge programme for **#6** (module-score cert, no exam), and a 6+-level vendor for **#15** (all levels reachable).
   - If a vendor doesn't exist in lookup (b), that scenario still needs a content seed (out of scope here) — flag it.

---

## Bucket B — env toggles  (#8, #13) — NOT DB
- **#8** "coming soon": assert on a deployment where **`TEACHER_TRAINING_FLOW_ID` is unset**.
- **#13** MSQ tick-box vs list: toggle **`TRAINING_MSQ_FLOW_ID`** on/off.
- Both need **staging** (own env vars) — blocked until staging's GitHub connection is reconnected and it's redeployed. Not runnable on prod (won't unset prod flow IDs).

---

## Suggested run order (one sitting)
1. #10 Urdu (reversible) → revert.
2. Bucket C assignment → #5, #2, #6, #15 (read-only-ish; just adds a programme).
3. Exam-unlock prereq → **#9 fail** → verify lock → reset attempt → **#3 pass** → **#4 cert-by-code**.
4. #1 no-quiz module (seed or via a vendor programme).
5. **#7 last** (wipes identity) → re-register.
6. Bucket B (#8/#13) once staging is back.

## Coverage after this plan
- Runnable on prod with the seeds above: **#1, #2, #3, #4, #5, #6, #7, #9, #10, #15** (+ #12 falls out once #1/#2 render).
- Still need staging: **#8, #13**.
- Already green: 13 SAFE + #11 + #14.
→ With staging back, **all 28** are runnable.
