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
 *  3. **Words first, but the number is there too.** executive_summary,
 *     focus_area, strengths, recommendations are what let her have a real
 *     conversation. The score is INCLUDED and marked answer-only-if-asked:
 *     withholding it meant that when a caller asked "why were my numbers low?"
 *     she had nothing to answer with and claimed she could not see his records.
 *  4. **Size-capped, and trimmed SILENTLY**, identity-first. Trimming used to
 *     leave a "(truncated)" marker, which she read aloud to the teacher as
 *     "your record is incomplete".
 *
 * Shapes verified against the live staging DB, 2026-08-24. `analysis_data` keys
 * in production: executive_summary, focus_area, strengths, recommendations,
 * growth_opportunities, scores, domains, framework, topic, subject,
 * notable_moments, reflective_corpus. There is NO `prioritized_action` key —
 * the plan named one; the database does not have it.
 */

const DEFAULT_TIMEOUT_MS = 2500;
// Raised from 4,000 after the second live call. The old cap was cutting real
// lesson content AND — worse — the "… (truncated)" markers were being READ ALOUD
// to the teacher ("truncation کی وجہ سے پورا نہیں ہے"). A realtime model handles
// ~12KB of instructions comfortably and the prefix is byte-stable, so caching
// absorbs the cost. Trimming is now SILENT: never a marker, never narrated.
const MAX_BLOCK_CHARS = 12000;
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

/**
 * Pull the one line worth speaking out of a corpus item.
 *
 * Production `strengths` and `growth_opportunities` are arrays of OBJECTS
 * ({title, impact, analysis, evidence, …}), while `recommendations` really are
 * strings. A string-only filter silently dropped every strength — the assistant
 * knew none of them and nothing in the logs said so. So: strings pass through,
 * objects surrender their title (or the nearest text field), and anything with
 * no readable text is skipped rather than stringified into "[object Object]".
 *
 * Deliberately title-only: `analysis` and `evidence` run to paragraphs each, and
 * a call prompt has to stay lean enough to start fast.
 */
const TEXT_KEYS = ['title', 'text', 'summary', 'name', 'label', 'description'];

function itemText(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    for (const key of TEXT_KEYS) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
  }
  return '';
}

const list = (value, max = MAX_LIST_ITEMS) => (Array.isArray(value) ? value : [value])
  .map(itemText)
  .filter(Boolean)
  .slice(0, max)
  .map((v) => `  - ${v}`)
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
    identity: false, coaching: false, lessons: false, visit: false,
    training: false, memory: false, observed: false,
  };

  const user = await soft('identity', () => deps.fetchUser(from), timeoutMs, failures);
  const userId = (user && user.id) || null;

  // Nothing downstream is meaningful without a user, so the rest is fetched only
  // when we know who she is — and all of it concurrently, to keep connect fast.
  const [coaching, lpContext, visit, training, memory, observed] = userId
    ? await Promise.all([
      soft('coaching', () => deps.fetchLatestCoaching(userId), timeoutMs, failures),
      soft('lessons', () => deps.fetchLpContext(userId), timeoutMs, failures),
      soft('visit', () => deps.fetchUpcomingVisit(userId), timeoutMs, failures),
      soft('training', () => deps.fetchTraining(userId), timeoutMs, failures),
      soft('memory', () => deps.fetchMemory(from, userId), timeoutMs, failures),
      // A caller is not always the subject of an observation. Coaches, AEOs and
      // school leaders ring up about the teachers THEY observed, and until now
      // we held that data and never gave it to her.
      soft('observed', () => deps.fetchObservedSessions(userId), timeoutMs, failures),
    ])
    : [null, null, null, null, null, null];

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
      user.role ? `Role: ${user.role} (if this is a coach/observer role, she may ask about the `
        + `teachers SHE observed as well as her own teaching)` : null,
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

    // focus_area is an OBJECT in every production row — {title, domain,
    // indicator, rationale, lever_question, try_this_tomorrow}. The last two are
    // the most conversation-worthy things we hold about her teaching, so they go
    // in by name rather than being flattened away.
    const focus = analysis.focus_area;
    if (typeof focus === 'string' && focus.trim()) {
      seg.push(`Her focus area: ${focus.trim()}`);
    } else if (focus && typeof focus === 'object') {
      const title = itemText(focus);
      if (title) seg.push(`Her focus area: ${title}`);
      if (focus.try_this_tomorrow) seg.push(`What she was asked to try: ${focus.try_this_tomorrow}`);
      if (focus.lever_question) seg.push(`The question to reflect on: ${focus.lever_question}`);
    }

    const strengths = list(analysis.strengths);
    if (strengths) seg.push(`Strengths noted:\n${strengths}`);
    const recs = list(analysis.recommendations);
    if (recs) seg.push(`What was recommended:\n${recs}`);
    const growth = list(analysis.growth_opportunities, 2);
    if (growth) seg.push(`Growth opportunities:\n${growth}`);

    // The score is INCLUDED, deliberately. Withholding it meant that when she
    // asked "why were my numbers low?" the assistant had nothing to answer with
    // and said it could not see her records — the worst possible answer to a
    // direct question about her own work. It is marked answer-only-if-asked so
    // it is never led with.
    const score = analysis.scores && (analysis.scores.overall_percentage
      ?? analysis.scores.overall ?? analysis.scores.percentage);
    if (score !== undefined && score !== null) {
      seg.push(`Her overall score on this observation: ${score}. `
        + 'Do not mention this number unless SHE asks — but if she asks what she scored or why '
        + 'it was low, tell her the number and what drove it. Never say you cannot see it.');
    }
    seg.push('Lead with the moves and the children\'s thinking, not the ranking.');
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

  // ---- what she has observed in OTHERS (coach / AEO / school-leader callers) ----
  if (Array.isArray(observed) && observed.length) {
    const rows = observed.slice(0, 5).map((o) => {
      const when = isoDay(o.when);
      const bits = [o.teacherName || 'a teacher'];
      if (o.schoolName) bits.push(o.schoolName);
      if (when) bits.push(`${when} (${agoLabel(o.when, now)})`);
      if (o.focus) bits.push(`focus: ${o.focus}`);
      return `  - ${bits.join(' · ')}`;
    }).join('\n');
    parts.push([
      `## TEACHERS SHE HAS OBSERVED (as of ${isoDay(now)})`,
      'She is a coach/observer as well as a caller. These are the observations SHE conducted:',
      rows,
      'If she asks about a teacher she observed, this is hers to discuss — answer from it.',
    ].join('\n'));
    blocks.observed = true;
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

  // ---- what we hold, and what we DON'T ----
  //
  // From the first real call: asked about his coaching scores, she replied that
  // she could not see his report or "system access". That is false — there was
  // simply no finished session on record. Omitting an absent block left the
  // model with no way to tell "nothing recorded" from "not allowed to look", and
  // it guessed the one that makes the product look broken.
  //
  // So absence is now STATED, and stated differently from failure: a block that
  // is missing is a fact about her records; a block that threw is a temporary
  // problem, and she should not present it as either a fact or a limitation.
  if (user) {
    const present = [];
    const missing = [];
    const label = {
      coaching: 'coaching observations',
      lessons: 'lesson plans we have sent her',
      visit: 'an upcoming coach visit',
      training: 'training progress',
      memory: 'previous calls with her',
      observed: 'observations she has done of other teachers',
    };
    Object.keys(label).forEach((key) => {
      if (blocks[key]) present.push(label[key]);
      else if (!failures.includes(key === 'lessons' ? 'lessons' : key)) missing.push(label[key]);
    });

    const temporarilyUnavailable = failures
      .filter((f) => f !== 'identity')
      .map((f) => label[f] || f);

    const seg = [`## WHAT IS ON RECORD FOR HER (as of ${isoDay(now)})`];
    if (present.length) seg.push(`On record: ${present.join(', ')}.`);
    if (missing.length) {
      seg.push(`NOTHING RECORDED for: ${missing.join(', ')}. If she asks about any of `
        + 'these, say plainly that there is nothing recorded for her yet — do NOT say you '
        + 'lack access, permission, or the ability to see her records. You can see '
        + 'everything we hold; there is simply nothing there.');
    }
    if (temporarilyUnavailable.length) {
      seg.push(`Could not be loaded right now (a temporary problem, NOT missing data): `
        + `${temporarilyUnavailable.join(', ')}. If she asks, say you cannot pull it up this `
        + 'moment and offer to help another way.');
    }
    parts.push(seg.join('\n'));
  }

  // ---- assemble: identity first, then every block gets a fair share ----
  //
  // The first synthetic call exposed the flaw in a simple running total: a rich
  // FICO analysis consumed the whole budget and the LESSONS block — the thing a
  // teacher is most likely to ring about — was cut entirely. So each optional
  // block is trimmed to its own share BEFORE assembly. Every block survives in
  // some form; none can starve the rest.
  let block;
  if (parts.join('\n\n').length <= MAX_BLOCK_CHARS) {
    block = parts.join('\n\n');
  } else {
    const identityPart = parts[0];
    const optional = parts.slice(1);
    const remaining = MAX_BLOCK_CHARS - identityPart.length - 40;
    const share = Math.max(200, Math.floor(remaining / Math.max(1, optional.length)));

    // Trim SILENTLY. A "(truncated)" marker in the prompt got narrated to the
    // teacher as "your record is incomplete" — internal plumbing spoken aloud.
    // Cut at a line boundary where possible so a block never ends mid-word.
    const trimAt = (text, limit) => {
      if (text.length <= limit) return text;
      const cut = text.slice(0, limit);
      const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
      return (lastBreak > limit * 0.5 ? cut.slice(0, lastBreak) : cut).trimEnd();
    };

    const trimmed = optional.map((part) => trimAt(part, share));
    block = trimAt([identityPart, ...trimmed].join('\n\n'), MAX_BLOCK_CHARS);
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
