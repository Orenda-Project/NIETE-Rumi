'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const { getClient, getClientForModel } = require('../../llm-client');
const { logToFile } = require('../../../utils/logger');

/**
 * One section's ceiling and wait. A whole 48-item paper with a marking scheme
 * on every written item is more than one reply carries, so a pattern paper is
 * written one section per call. The job's model reasons before it answers and
 * the reasoning spends the same budget: real full-syllabus Maths and Social
 * Studies sections ran out at 12,000 (Maths A: 7,927 of 11,986 tokens reasoning).
 * So a section asks for low reasoning effort, which the client passes to every
 * lane. The wait is the SDK's request option, not a body field.
 *
 * A section's slots can only RAISE that ceiling: about 1,000 tokens per
 * written item (its marking scheme included) and 400 per MCQ, up to 32,000.
 * Never below 24,000. That number was set after a real section ran out at
 * 12,000, and low-effort reasoning has not been measured at the high end, so
 * the formula is a ceiling-raiser only. No section of today's pattern sizes
 * above 24,000; a larger section added later gets the room it needs.
 */
const SECTION_TOKENS_PER_WRITTEN = 1000;
const SECTION_TOKENS_PER_MCQ = 400;
const SECTION_MIN_TOKENS = 24000;
const SECTION_MAX_TOKENS = 32000;
const SECTION_TIMEOUT_MS = 300000;
const SECTION_REASONING = { effort: 'low' };

/**
 * Social Studies C and D: the first ask writes spares past what prints, and the layout keeps the
 * first items that are new. A held item (a Section A fact asked again, a point set another item
 * answers) then leaves no gap, and a reader flag later is less likely to take a choice slot below
 * what it must offer. Every other slot asks exactly what it prints.
 */
const FIRST_ASK_SPARES = Object.freeze({ 'social_studies.C.Q5': 2, 'social_studies.D.Q6': 2, 'social_studies.D.Q7': 2 });
const firstAsk = (slot) => (Number(slot.generate) || 0) + (FIRST_ASK_SPARES[slot.slot] || 0);

/** The output ceiling for one section's call, from the items its slots generate. */
function sectionMaxTokens(section) {
  const want = (section.slots || []).reduce((sum, slot) => sum + firstAsk(slot)
    * (slot.shape === 'mcq' ? SECTION_TOKENS_PER_MCQ : SECTION_TOKENS_PER_WRITTEN), 0);
  return Math.min(SECTION_MAX_TOKENS, Math.max(SECTION_MIN_TOKENS, want));
}

// The direct Anthropic lane caches a marked prefix; every other lane is sent today's strings.
const DIRECT_LANE = 'anthropic-direct/';
const CACHE_EPHEMERAL = Object.freeze({ type: 'ephemeral' });

/**
 * One section's messages. Off the direct lane, exactly today's two strings. On it, the system
 * prompt and the book text are marked for caching: every section of a paper set from the whole
 * syllabus shares both, and they come before anything section-specific. The text is unchanged,
 * only split: the user prompt's parts joined are the same string byte for byte. When the book
 * block cannot be found exactly, only the system prompt is marked.
 */
function _sectionMessages({ system, user, pageContent, model }) {
  if (!String(model || '').startsWith(DIRECT_LANE)) {
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }
  const block = `**Book Text Content:**\n\`\`\`\n${pageContent}\n\`\`\`\n`;
  const at = user.indexOf(block);
  const end = at + block.length;
  const content = at < 0 || end >= user.length
    ? user
    : [{ type: 'text', text: user.slice(0, end), cache_control: CACHE_EPHEMERAL }, { type: 'text', text: user.slice(end) }];
  return [
    { role: 'system', content: [{ type: 'text', text: system, cache_control: CACHE_EPHEMERAL }] },
    { role: 'user', content },
  ];
}

/** The cached part of a section's messages, as a comparable key; null when nothing past the system is cached. */
function _cachedPrefixKey(messages) {
  const user = messages[1] && messages[1].content;
  if (!Array.isArray(user) || !user[0] || !user[0].cache_control) return null;
  return JSON.stringify([messages[0].content, user[0]]);
}

/**
 * Write each prefix that two or more sections share to the cache, once, before the sections go.
 *
 * Sections run in parallel, and a cache entry is readable only once the request writing it has
 * started answering: sent together, every section writes the same prefix and none reads it. One
 * call with that exact prefix, the sections' own model, effort and JSON instruction, and no output
 * (`max_tokens: 1`; the reasoning is cut off with it) writes it; the
 * sections then read it. Maths sections are set from different pages and share nothing past the
 * system prompt, so they get no warm call. A failure here never fails the paper: the sections
 * simply write the cache themselves. Returns each warm call's usage, which is billed.
 */
const WARM_MAX_TOKENS = 1;

async function _warmSharedPrefixes({ built, model, job, requestId, pattern }) {
  if (!String(model || '').startsWith(DIRECT_LANE)) return [];
  const groups = new Map();
  for (const { section, messages } of built) {
    const key = _cachedPrefixKey(messages);
    if (key) groups.set(key, (groups.get(key) || []).concat([{ section, messages }]));
  }
  const shared = [...groups.values()].filter((g) => g.length >= 2);
  return Promise.all(shared.map(async (group) => {
    const [system, user] = group[0].messages;
    const sections = group.map((g) => g.section.id);
    try {
      const { client } = getClientForModel(model, { job, routed: true });
      const response = await client.chat.completions.create({
        model,
        messages: [system, { role: 'user', content: [user.content[0], { type: 'text', text: 'warmup' }] }],
        temperature: 0.7,
        response_format: { type: 'json_object' },
        // One token, not zero: the API took 0 as "no limit" and wrote a whole billed answer to
        // "warmup" (3,702 tokens, ~22 s, before any section could start). The effort stays the
        // sections' own, because a change of thinking settings would stop the sections reading
        // the cache this call writes; the one-token cap is what bounds the reasoning.
        max_tokens: WARM_MAX_TOKENS,
        reasoning: SECTION_REASONING,
      }, { timeout: SECTION_TIMEOUT_MS });
      const usage = (response && response.usage) || {};
      logToFile('[assessment] cache warmed', { requestId, pattern, sections, model, usage, cost: usage.cost ?? null });
      return usage;
    } catch (err) {
      logToFile('[assessment] cache warm failed', { requestId, pattern, sections, model, error: err.message });
      return null;
    }
  })).then((usages) => usages.filter(Boolean));
}

/**
 * The marks split FDE's table of specification asks for, per subject, by
 * marks. A pattern subject carries its own (`tos`, set per grade by FDE);
 * this is the fallback for a subject whose pattern does not.
 */
const TOS = {
  maths: { Remember: 10, Understand: 50, Apply: 40 },
  science: { Remember: 30, Understand: 30, Apply: 40 },
  english: { Remember: 40, Understand: 30, Apply: 30 },
  urdu: { Remember: 30, Understand: 30, Apply: 40 },
  social_studies: { Remember: 30, Understand: 40, Apply: 30 },
};

// The kinds Urdu Q4 asks, which no Q1 item asks, on every scope.
const URDU_Q4_NEVER = 'Q4 on this paper asks گروہی الفاظ, حروفِ شرط و جزا, a present-to-future tense change and ارکان سازی; no Q1 item asks any of these.';

module.exports = {
  SECTION_REASONING, SECTION_TIMEOUT_MS, TOS, URDU_Q4_NEVER, _sectionMessages, _warmSharedPrefixes, firstAsk,
  sectionMaxTokens,
};
