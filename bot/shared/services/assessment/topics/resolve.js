'use strict';
/**
 * resolveTopics(all, ids) -> {pageRanges, slos, topics, isAll}. Pure: no I/O.
 *
 * `all` is one chapter's current topics (camelCase, as topics.repo returns them); `ids` are the ones she ticked.
 *  - topics:     the ticked topics, each once, in the chapter's sortOrder.
 *  - pageRanges: their pages sorted, de-duplicated, runs collapsed: "58-63, 90-95". Never one merged start-end
 *                span (spec §6) — a gap between topics stays a gap. "" when no ticked topic has pages.
 *  - slos:       [{code, description, topicId, topicName}], each code once (the first ticked topic that holds it).
 *                sloDescriptions is a SET, not paired with sloCodes (a merged topic can carry more descriptions
 *                than codes), so every code of a topic gets the topic's whole description set joined " / " —
 *                never one description picked by position.
 *  - isAll:      every topic in the chapter is ticked: the caller sends today's chapter request unchanged (spec §4).
 * An id that is not in `all` throws TopicNotFound. No ids at all is refused, never read as "the whole chapter".
 */

class TopicNotFound extends Error {
  constructor(ids) {
    super(`Unknown topic id(s): ${ids.join(', ')}`);
    this.name = 'TopicNotFound';
    this.code = 'TOPIC_NOT_FOUND';
    this.ids = ids;
  }
}

/** [9, 10, 12, 14, 10] -> "9-10, 12, 14". */
function collapsePages(pages) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs = [];
  for (const p of sorted) {
    const last = runs[runs.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else runs.push([p, p]);
  }
  return runs.map(([lo, hi]) => (lo === hi ? `${lo}` : `${lo}-${hi}`)).join(', ');
}

function resolveTopics(all, ids) {
  const wanted = [...new Set(ids || [])];
  if (!wanted.length) throw new Error('pick at least one topic');
  const byId = new Map(all.map((t) => [t.topicId, t]));
  const unknown = wanted.filter((id) => !byId.has(id));
  if (unknown.length) throw new TopicNotFound(unknown);

  const topics = wanted.map((id) => byId.get(id)).sort((a, b) => a.sortOrder - b.sortOrder);
  const slos = [];
  const seen = new Set();
  for (const t of topics) {
    const description = (t.sloDescriptions || []).join(' / ');
    for (const code of t.sloCodes || []) {
      if (seen.has(code)) continue;
      seen.add(code);
      slos.push({ code, description, topicId: t.topicId, topicName: t.name });
    }
  }
  return {
    pageRanges: collapsePages(topics.flatMap((t) => t.pages || [])),
    slos,
    topics,
    isAll: byId.size > 0 && wanted.length === byId.size,
  };
}

module.exports = { resolveTopics, TopicNotFound, collapsePages };
