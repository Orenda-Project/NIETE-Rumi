# Teacher activity store (Redis)

The numbers on the teacher's Home ("Last 30 days"), her **My journey** page and the team's "Where teachers get to"
view are counted **twice a day by one scheduled job** on the bot's worker, reading the **read replica only**, and kept
in Redis. (The test sites, staging and sandbox, have no paid read copy, so there the job reads their own database;
`bot/shared/config/supabase-replica-only.js` allows that only for those two Railway environment names.) Opening Home, My journey or the team view reads Redis and **never the database**: a miss shows no numbers.

- Contract (key names, TTL, kinds, the shape check both sides use): `bot/shared/config/teacher-activity-contract.js`
- Reader (portal, zero database access, fails soft): `dashboard/services/teacher-activity-store.js`
- Redis: the shared `REDIS_URL` (bot writes with `cache/railway-redis.service.js`, portal reads with
  `dashboard/lib/edge-redis.js`; no key prefix). Values are JSON strings.

## Keys

| Key | Holds | TTL |
|---|---|---|
| `teacher_activity:v1:<users.id>` | one teacher's numbers, below | 36 h (outlives one missed run) |
| `teacher_activity:v1:team` | the team summary, below | 36 h |
| `teacher_activity:v1:run:<YYYY-MM-DD>:<slot>` | run marker: this Pakistan date's `day` or `night` run is done | 36 h |

`<YYYY-MM-DD>` is the Pakistan date (`nudges/pkt-time.js pktDate`). A run that fails part-way leaves earlier keys as
they were until their TTL.

## Per teacher: `teacher_activity:v1:<users.id>`

```json
{
  "updated_at": "2026-11-19T09:30:00.000Z",
  "slot": "day",
  "tiles": {
    "plans_opened": { "now": 14, "prev": 9 },
    "taught":       { "now": 3,  "prev": 1 },
    "coached":      { "now": 2,  "prev": 2 },
    "quizzes":      { "now": 4,  "prev": 0 },
    "exams":        { "now": 1,  "prev": 0 }
  },
  "trend": [
    { "indicator_id": "D3", "indicator_name": "Checks for understanding", "framework": "fico17-v6",
      "points": [ { "session_id": "…", "at": "…", "band": "average" }, { "session_id": "…", "at": "…", "band": "good" } ] }
  ],
  "tip": { "session_id": "…", "text": "Ask two children to explain …", "at": "…" },
  "journey": [ { "kind": "plan_opened", "at": "…", "ref_id": "…", "meta": { "plan_kind": "k5", "grade": 3, "subject": "math" } } ],
  "furthest_step": "taught",
  "grade_band": "k5"
}
```

- `slot`: `"day"` or `"night"`, the run that wrote it. `updated_at`: ISO time of that run (Home's "Updated …" line).
- `tiles.*.now` = the last 30 days, `prev` = the 30 days before; whole numbers ≥ 0. Rules per tile (plan "Load on the
  database" and the product spec §3): `plans_opened` = the lp-history rule (every grade); `taught` =
  `lp_feedback.used_in_class = 'taught'` by `created_at`; `coached` = `coaching_sessions` completed with
  `observation_type` null (the `countsFor` rule); `quizzes` = `quizzes` sent / report_sent by `teacher_id`;
  `exams` = her papers as the teacher app's Papers list counts them: one per Assessment Generator request that reached a
  ready root paper (`assessment_papers` ready, never an edit; progress.service's rule), dated by the paper. (The tile
  key keeps the name `exams`; the `exams` table is another generator's and is not read.)
- `trend`: at most 2 entries, in display order (line 1 = the indicator whose band rose most, else her best band; line
  2 = her lowest band in the latest report). Present only when she has ≥ 2 reports of the same framework in 90 days,
  else `[]`. `points` oldest first, ≥ 2. `band` is a key of `score-bands.js` / `lib/scoreBands.ts`:
  `excellent`, `good`, `average`, `below_average`, `needs_support`. **Never a mark, score or percentage.**
- `tip`: the latest report's "try next class" (`prioritized_action.thing_to_try.text`, else `.action`), or `null`.
- `journey`: newest first, every step of the last 60 days, at most 200. `kind` is one of `plan_opened`, `taught`,
  `coached`, `report`, `tip`, `quiz`, `exam`; `ref_id` the row it came from (plan ref, session id, quiz id, exam id);
  `meta` ids and labels only (grade, subject, topic, plan_kind, band, `opened_at` for a report, `played` for a quiz,
  the tip's text). Never a name, a phone number or a mark.
- `furthest_step`: her furthest rung on the ladder in the last 30 days, or `null` (none):
  `plan_opened` < `taught` < `coached` < `report` (she opened the report, `coach_report_opened_at`) < `quiz`.
  Tips and papers are not rungs.
- `grade_band`: `"k5"`, `"g612"` or `null`.

## Team: `teacher_activity:v1:team`

```json
{ "updated_at": "…", "window_days": 30,
  "steps": { "none": { "count": 40, "user_ids": ["…"] }, "plan_opened": { "count": 22, "user_ids": ["…"] } } }
```

`teachers` (optional) is the roster the team view scopes and lists by, one entry per counted teacher:
`{ "<users.id>": { "org": "niete" | "moawin" | null, "region": "Sihala" | null, "band": "k5" | "g612" | null,
"name": "…", "school": "…", "furthest": "<rung or none>", "last_kind": "<journey kind>" | null, "last_at": "…" | null } }`.
`org` is region.service's rule (users.source, users.region, the school's region) through the region registry; a
teacher it cannot place has `org: null` and is seen only by the default organization's accounts, as every analytics
tab treats unplaced teachers. The name and school are here so opening the team view reads no database; they are never
logged.

`steps` has one entry per rung (`none`, `plan_opened`, `taught`, `coached`, `report`, `quiz`): `count` = teachers
whose furthest step is **exactly** this one ("Stopped here"), `user_ids` = those teachers, oldest last step first.
"Reached" for a rung = the sum of `count` from that rung up. Tracked teachers = active ICT + GB teachers of the run.

## Rules for both sides

- The writer checks every value with the contract's `checkTeacherActivity` / `checkTeamActivity` before writing and
  writes only what passes. The reader runs the same check and answers `null` for anything that fails it.
- The reader answers `null` for: no Redis client, Redis down, no key, bad JSON, a value that fails the check, or an
  `updated_at` more than 36 h old. `null` means "show no numbers", never an error and never a database read.
- Logs carry no user id (the reader logs only that a stored value was unreadable, and which key family).

## The writer: the twice-a-day job

- **Where:** the bot worker (`bot/workers/teacher-activity-schedule.js`, ticked hourly on main-queue replicas) runs
  `bot/shared/services/teacher-activity/teacher-activity-run.service.js`; the pure shaping is
  `teacher-activity/teacher-journey.service.js`.
- **Switch:** `app_settings` `teacher_activity_slots`, e.g. `{"day":"14:30","night":"01:30"}` (Pakistan times; one or
  both slots). No row, a malformed value or a failed read = off. A slot is due from its time for 90 minutes; one worker
  claims the tick (Redis), and the run marker stops a second run of the same slot on the same Pakistan date.
- **Replica only:** `bot/shared/config/supabase-replica-only.js` — `NIETE_SUPABASE_REPLICA_URL` + the service key; no
  URL = the job is off on that tier. Every hourly tick first calls `rpc('db_is_replica')`, before any other read, and
  refuses unless it answers true. A slot is at most 22:30, so its 90-minute window ends by midnight.
  The switch, the region registry and every count are read on the replica; the primary is never read by the job.
- **Reads (migration V1.10.5):** `teacher_activity_teachers()` once (active teachers: role teacher, not deleted or
  merged, and a WhatsApp message, a portal sign-in or an app plan open in the last 60 days), then
  `teacher_activity_batch(ids)` per 500 teachers with a 1 s pause. Both are read only with a 20 s statement timeout.
- **Writes:** one key per teacher (36 h), then the team key and the run marker only when every batch was read; a failed
  batch keeps those teachers' previous values and the next hourly tick inside the slot's window runs again.
- **Logs:** counts and timings with a correlation id (`teacher_activity.run.<outcome>`); never a user id or a name.

## Readers

- `GET /api/portal/me/journey` (`dashboard/routes/portal-teacher-journey.routes.js`): the session teacher's own steps.
- `GET /api/portal/analytics/journey`, `/analytics/journey/teachers?step=`, `/analytics/journey/teacher/:id`
  (`dashboard/routes/portal-analytics-journey.routes.js`, behind the analytics-account guard): counts, the teachers who
  stopped at a rung and one teacher's journey, scoped to the account's organization from the roster above.
- Both behind `portal_teacher_journey` (per user; for the team view, the analytics account must be named).
