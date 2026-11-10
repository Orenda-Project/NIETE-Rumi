/**
 * Coach reports in the app, phase 3 — the coach's weekly report as a page (behind app_settings.coach_reports_app).
 *
 * The week (Monday 00:00 to Friday 16:00 PKT, ready on Friday at 16:00) is COMPUTED from her coached debriefs by the
 * bot's pure coach-week.js, never stored: the counts are code, from the judge's booleans. What is stored is only
 * "opened / closed / messaged", one teacher_nudges row per coach per week (kind 'coach_weekly_report', V1.8.12),
 * keyed on the week's Monday: opening the report or closing its Home card inserts it ('skipped', choice opened|seen);
 * the bot's Friday 16:30 sweep inserts it ('sending' → 'sent'); the first writer wins (UNIQUE user_id, nudge_date, kind).
 *
 * Fixed words come in English and Urdu (behaviour names and why-it-matters from the bot's observe-strings, the four
 * steps from observe-strings coach_week_steps, approved 10 Nov), so the language pill switches the page without a second read.
 *
 * WHO. Only the session's coach, by her own observer_user_id; there is no id of anyone else to ask for.
 * READS. One bounded read of her latest coached debriefs (narrow JSON slices: the feedback's rubric and its time).
 * `query` is injected ((sql, params) => Promise<{rows, rowCount}>), like every coach service.
 */

const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const Week = require('../../bot/shared/services/observe/coach-week');
const { BEHAVIOUR_MODULE } = require('../../bot/shared/config/coach-training-modules');

/** The card shows the week from Friday 16:00 for this long, if she neither opens nor closes it. */
const CARD_DAYS = 3;
/** Her latest coached debriefs: enough for this week, last week and ten before (a coach does about a dozen a week). */
const LATEST = 80;

const SQL = {
  DEBRIEFS: `
    SELECT c.id, c.created_at,
           c.analysis_data->'observer_debrief'->>'completed_at' AS feedback_at,
           c.analysis_data->'observer_debrief'->'feedback'->'rubric' AS rubric
    FROM coaching_sessions c
    WHERE c.observer_user_id = $1
      AND c.observation_type = 'leader_observation'
      AND c.debrief_status = 'done'
      AND c.created_at < $2::timestamptz
    ORDER BY c.created_at DESC
    LIMIT ${LATEST}
  `,

  NUDGE: `
    SELECT status, answered_at, choice, sent_at
    FROM teacher_nudges
    WHERE user_id = $1 AND kind = 'coach_weekly_report' AND nudge_date = $2::date
  `,

  MARK: `
    INSERT INTO teacher_nudges (user_id, nudge_date, kind, status, scheduled_at, answered_at, choice, context)
    VALUES ($1, $2::date, 'coach_weekly_report', 'skipped', now(), now(), $3, '{"skip":"answered_in_app"}'::jsonb)
    ON CONFLICT (user_id, nudge_date, kind) DO UPDATE
      SET answered_at = COALESCE(teacher_nudges.answered_at, now()),
          choice = COALESCE(teacher_nudges.choice, EXCLUDED.choice),
          updated_at = now()
    RETURNING id
  `,
};

/** The weekly steps (observe-strings coach_week_steps): approved by the ICT HITL owner (operator, 10 Nov), so not marked as drafts. */
const STEPS_REVIEWED = true;

const EN = observeStrings('en');
const UR = observeStrings('ur');
const both = (field, key) => ({ en: (EN[field] || {})[key] || null, ur: (UR[field] || {})[key] || null });

/** Her debriefs placed in weeks by the week rule; anything without a judged rubric is not a debrief to count. */
async function readDebriefs(query, coachId, untilIso) {
  const { rows } = await query(SQL.DEBRIEFS, [coachId, untilIso]);
  return (rows || [])
    .map((r) => ({ id: r.id, at: r.feedback_at || r.created_at, rubric: r.rubric }))
    .filter((d) => d.at && d.rubric && typeof d.rubric === 'object')
    .map((d) => ({ ...d, week: Week.weekOfDebrief(d.at) }));
}

function splitWeeks(debriefs, monday) {
  const lastMonday = Week.addDays(monday, -7);
  return {
    thisWeek: debriefs.filter((d) => d.week === monday),
    lastWeek: debriefs.filter((d) => d.week === lastMonday),
    before: debriefs.filter((d) => d.week < monday),
  };
}

/** The summary with the words the page needs, in both languages. Pure. */
function shapeWeek(summary) {
  const named = (key) => ({ key, name: both('coach_rubric_names', key) });
  const f = summary.focus;
  return {
    ...summary,
    focus: f ? {
      ...f,
      name: both('coach_rubric_names', f.key),
      why: both('coach_rubric_why', f.key),
      steps: (() => {
        const en = (EN.coach_week_steps || {})[f.key];
        const ur = (UR.coach_week_steps || {})[f.key];
        return Array.isArray(en) && Array.isArray(ur) ? { en, ur, reviewed: STEPS_REVIEWED } : null;
      })(),
      nextName: f.next ? both('coach_rubric_names', f.next) : null,
      nextModule: f.next ? BEHAVIOUR_MODULE[f.next] || null : null,
    } : null,
    strengths: summary.strengths.map((s) => ({ ...s, ...named(s.key) })),
    keepInMind: summary.keepInMind.map((k) => ({ ...k, ...named(k.key), why: both('coach_rubric_why', k.key) })),
    table: summary.table.map((t) => ({ ...t, ...named(t.key) })),
  };
}

/**
 * Her week, or why not.
 * @returns {Promise<{status:'ok', week:object}|{status:'not_found'|'not_ready'}>}
 */
async function getCoachWeek(query, coachId, monday, now = new Date()) {
  if (!coachId || !Week.isMonday(monday)) return { status: 'not_found' };
  if (monday > Week.latestReadyMonday(now)) return { status: 'not_ready' };
  const b = Week.weekBounds(monday);
  const debriefs = await readDebriefs(query, coachId, new Date(Date.parse(b.toIso) + 86400000).toISOString());
  const { thisWeek, lastWeek, before } = splitWeeks(debriefs, monday);
  return { status: 'ok', week: shapeWeek(Week.summariseWeek({ monday, thisWeek, lastWeek, before })) };
}

/** She opened the week, or closed its card: the week's one row, first writer wins. True when written. */
async function markCoachWeek(query, coachId, monday, what, now = new Date()) {
  if (what !== 'opened' && what !== 'seen') throw new Error(`coach week: unknown mark ${what}`);
  if (!coachId || !Week.isMonday(monday) || monday > Week.latestReadyMonday(now)) return false;
  const { rowCount } = await query(SQL.MARK, [coachId, monday, what]);
  return rowCount > 0;
}

/** The Home card's week row: the latest ready week, for CARD_DAYS from Friday 16:00, if she had a debrief and has not answered it. */
async function readyCoachWeek(query, coachId, now = new Date()) {
  if (!coachId) return null;
  const monday = Week.latestReadyMonday(now);
  const b = Week.weekBounds(monday);
  if (now.getTime() - Date.parse(b.toIso) > CARD_DAYS * 86400000) return null;
  const { rows: nudges } = await query(SQL.NUDGE, [coachId, monday]);
  if (nudges && nudges[0] && nudges[0].answered_at) return null;
  const debriefs = await readDebriefs(query, coachId, new Date(Date.parse(b.toIso) + 86400000).toISOString());
  const n = debriefs.filter((d) => d.week === monday).length;
  if (!n) return null;
  return { kind: 'week', id: monday, monday, friday: b.friday, at: b.toIso, debriefs: n };
}

module.exports = { SQL, CARD_DAYS, shapeWeek, getCoachWeek, markCoachWeek, readyCoachWeek };
