'use strict';
/**
 * Tier-A connect context — what the assistant knows before she says hello
 * (bd-1hae7.6).
 *
 * Assembled from our OWN Supabase at connect. Four rules, each failure-driven:
 *
 *  1. **Independent soft-fail.** Every block is fetched separately and bounded
 *     by a timeout. One slow or broken table costs its own block, never the
 *     call. All six failing still yields a usable prompt.
 *  2. **Always as-of-dated** (RT-5). Undated context gets spoken as if true
 *     today — "your coaching last Tuesday" is useful, "your coaching" is a lie
 *     waiting to happen.
 *  3. **Words, not numbers.** executive_summary, focus_area, strengths,
 *     recommendations — the narrative is what lets her have a real conversation.
 *     Scores are deliberately EXCLUDED (the no-measurement rule); if she asks
 *     about her score, the recall tools can fetch it.
 *  4. **Size-capped**, identity-first. A 20KB prompt is a slow, expensive call,
 *     and if something has to go it is not her name.
 *
 * Shapes verified against the live staging DB, 2026-08-24. `analysis_data` keys
 * in production: executive_summary, focus_area, strengths, recommendations,
 * growth_opportunities, scores, domains, framework, topic, subject,
 * notable_moments, reflective_corpus. There is NO `prioritized_action` key —
 * the plan named one; the database does not have it.
 */

const DEFAULT_TIMEOUT_MS = 2500;
const MAX_BLOCK_CHARS = 4000;
const MAX_LIST_ITEMS = 3;

/** Bound every fetch: a hanging table must not hold up the greeting. */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error('context fetch timed out')), ms);
      if (t.unref) t.unref();
    }),
  ]);
}

/** Run one source; on ANY failure return null and record it. Never throws. */
async function soft(name, fn, timeoutMs, failures) {
  if (typeof fn !== 'function') return null;
  try {
    return await withTimeout(Promise.resolve().then(fn), timeoutMs);
  } catch (_) {
    failures.push(name);
    return null;
  }
}

const isoDay = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** "6 days ago" / "today" / "in 3 days" — humans reason in relative time. */
function agoLabel(value, now) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((d.getTime() - now.getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

const list = (value, max = MAX_LIST_ITEMS) => (Array.isArray(value) ? value : [value])
  .filter((v) => typeof v === 'string' && v.trim())
  .slice(0, max)
  .map((v) => `  - ${v.trim()}`)
  .join('\n');

/**
 * Build the connect context for one caller.
 *
 * @param {object} opts
 * @param {string} opts.from   caller's wa_id
 * @param {object} opts.deps   injected fetchers (see tests) + optional now/timeoutMs
 * @returns {Promise<{block:string, language:string, userId:?string, known:boolean, snapshot:object}>}
 */
async function buildCallContext({ from, deps = {} }) {
  const now = deps.now ? deps.now() : new Date();
  const timeoutMs = deps.timeoutMs || DEFAULT_TIMEOUT_MS;
  const failures = [];
  // Every block is recorded explicitly, present or not — an audit trail that
  // only lists what happened to be there cannot answer "why didn't she know?".
  const blocks = {
    identity: false, coaching: false, lessons: false, visit: false, training: false, memory: false,
  };

  const user = await soft('identity', () => deps.fetchUser(from), timeoutMs, failures);
  const userId = (user && user.id) || null;

  // Nothing downstream is meaningful without a user, so the rest is fetched only
  // when we know who she is — and all of it concurrently, to keep connect fast.
  const [coaching, lpContext, visit, training, memory] = userId
    ? await Promise.all([
      soft('coaching', () => deps.fetchLatestCoaching(userId), timeoutMs, failures),
      soft('lessons', () => deps.fetchLpContext(userId), timeoutMs, failures),
      soft('visit', () => deps.fetchUpcomingVisit(userId), timeoutMs, failures),
      soft('training', () => deps.fetchTraining(userId), timeoutMs, failures),
      soft('memory', () => deps.fetchMemory(from, userId), timeoutMs, failures),
    ])
    : [null, null, null, null, null];

  const parts = [];

  // ---- identity (never truncated away) ----
  if (user) {
    const name = user.first_name || user.name || 'this teacher';
    const grades = [].concat(user.grades_taught || user.grade || []).filter(Boolean).join(', ');
    const subjects = [].concat(user.subjects_taught || user.subject || []).filter(Boolean).join(', ');
    parts.push([
      '## WHO SHE IS',
      `Name: ${name}${user.last_name ? ` ${user.last_name}` : ''}`,
      user.school_name ? `School: ${user.school_name}` : null,
      grades ? `Grades: ${grades}` : null,
      subjects ? `Subjects: ${subjects}` : null,
      user.role ? `Role: ${user.role}` : null,
      'Address her by her first name. Do not read this list back to her.',
    ].filter(Boolean).join('\n'));
    blocks.identity = true;
  } else {
    parts.push([
      '## WHO SHE IS',
      'This caller is not recognised in our records — we have no teacher profile for this number.',
      'Be warm, ask who she is and how you can help, and do not guess at any history.',
    ].join('\n'));
    blocks.identity = false;
  }

  // ---- latest coaching, in words ----
  const analysis = coaching && coaching.analysis_data;
  if (analysis && typeof analysis === 'object') {
    const when = isoDay(coaching.completed_at || coaching.created_at);
    const rel = when ? agoLabel(coaching.completed_at || coaching.created_at, now) : '';
    const seg = ['## HER MOST RECENT COACHING'
      + (when ? ` (as of ${when}${rel ? `, ${rel}` : ''})` : '')];
    if (analysis.executive_summary) seg.push(`Summary: ${analysis.executive_summary}`);
    if (analysis.focus_area) seg.push(`Her focus area: ${analysis.focus_area}`);
    const strengths = list(analysis.strengths);
    if (strengths) seg.push(`Strengths noted:\n${strengths}`);
    const recs = list(analysis.recommendations);
    if (recs) seg.push(`What was recommended:\n${recs}`);
    const growth = list(analysis.growth_opportunities, 2);
    if (growth) seg.push(`Growth opportunities:\n${growth}`);
    seg.push('Do NOT volunteer any score. Talk about the moves and the children\'s thinking.');
    if (seg.length > 2) {
      parts.push(seg.join('\n'));
      blocks.coaching = true;
    }
  }

  // ---- recently delivered lessons (buildLpContext reuse) ----
  if (lpContext && String(lpContext).trim()) {
    parts.push(`## LESSONS RECENTLY DELIVERED TO HER\n${String(lpContext).trim()}`);
    blocks.lessons = true;
  }

  // ---- upcoming observation visit ----
  if (visit && visit.scheduled_at) {
    const when = isoDay(visit.scheduled_at);
    parts.push([
      `## HER NEXT COACH VISIT (as of ${isoDay(now)})`,
      `Scheduled: ${when} (${agoLabel(visit.scheduled_at, now)})`
      + (visit.observation_tool ? ` · tool: ${visit.observation_tool}` : ''),
    ].join('\n'));
    blocks.visit = true;
  }

  // ---- training position ----
  if (training && (training.completed !== undefined || training.latestTitle)) {
    parts.push([
      `## HER TRAINING (as of ${isoDay(now)})`,
      training.completed !== undefined ? `Modules completed: ${training.completed} of ${training.total}` : null,
      training.latestTitle ? `Most recent module: ${training.latestTitle}` : null,
    ].filter(Boolean).join('\n'));
    blocks.training = true;
  }

  // ---- rolling memory from previous calls ----
  if (memory && memory.summary) {
    const when = isoDay(memory.updated_at);
    parts.push([
      `## PREVIOUS CALLS WITH HER${when ? ` (as of ${when}, ${agoLabel(memory.updated_at, now)})` : ''}`,
      memory.summary,
    ].join('\n'));
    blocks.memory = true;
  }

  // ---- assemble, identity-first, capped ----
  let block = parts.join('\n\n');
  if (block.length > MAX_BLOCK_CHARS) {
    const identityPart = parts[0];
    let out = identityPart;
    for (const part of parts.slice(1)) {
      if (out.length + part.length + 2 > MAX_BLOCK_CHARS - 20) {
        out += '\n\n… (further context truncated)';
        break;
      }
      out += `\n\n${part}`;
    }
    // A single oversized part (one huge block) still has to fit.
    block = out.length > MAX_BLOCK_CHARS
      ? `${out.slice(0, MAX_BLOCK_CHARS - 30)}… (truncated)`
      : out;
  }

  return {
    block,
    language: (user && user.preferred_language) || 'ur',
    userId,
    known: !!user,
    snapshot: { userId, blocks, failures, builtAt: now.toISOString() },
  };
}

module.exports = { buildCallContext };
