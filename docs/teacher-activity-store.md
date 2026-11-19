# Teacher activity store (Redis)

The numbers on the teacher's Home ("Last 30 days"), her **My journey** page and the team's "Where teachers get to"
view are counted **twice a day by one scheduled job** on the bot's worker, reading the **read replica only**, and kept
in Redis. Opening Home, My journey or the team view reads Redis and **never the database**: a miss shows no numbers.

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
  `exams` = `exams` ready by `created_by_user_id`.
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

`steps` has one entry per rung (`none`, `plan_opened`, `taught`, `coached`, `report`, `quiz`): `count` = teachers
whose furthest step is **exactly** this one ("Stopped here"), `user_ids` = those teachers, oldest last step first.
"Reached" for a rung = the sum of `count` from that rung up. Tracked teachers = active ICT + GB teachers of the run.

## Rules for both sides

- The writer checks every value with the contract's `checkTeacherActivity` / `checkTeamActivity` before writing and
  writes only what passes. The reader runs the same check and answers `null` for anything that fails it.
- The reader answers `null` for: no Redis client, Redis down, no key, bad JSON, a value that fails the check, or an
  `updated_at` more than 36 h old. `null` means "show no numbers", never an error and never a database read.
- Logs carry no user id (the reader logs only that a stored value was unreadable, and which key family).
