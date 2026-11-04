import { MAX_TYPES, defaultTypeCounts, isFde, newPicks, type Picks } from './model';

/**
 * Task 8 (spec §4, §6) — the Topics step's rules, pure. After Chapters, when exactly one chapter is picked and it has
 * topics: the whole chapter (today's paper, unchanged) or only the topics she ticks. English and Urdu topics sit under
 * their skill headings, in teacher words; Maths and Science are one flat list. Every topic ticked is the whole chapter
 * (topicIds null). A strict subset is a topic paper: 10 marks, no book questions, and question types suggested by
 * heading (§6), which she can change on Questions.
 */

export type Topic = { topicId: string; name: string; heading: string | null; headingOrder: number | null; sortOrder: number };
export type OfferedType = { id: string; category: 'objective' | 'subjective' };
export type TopicGroup = { heading: string | null; topics: Topic[] };

/** Marks a topic paper starts with (spec §4.3). */
export const TOPIC_MARKS = 10;

const bookOrder = (a: Topic, b: Topic) => a.sortOrder - b.sortOrder;
const headingRank = (t: Topic) => t.headingOrder ?? Number.MAX_SAFE_INTEGER;

/** Topics grouped under their headings (heading order, then book order), or one flat list when none has a heading. */
export function groupForScreen(topics: readonly Topic[]): { grouped: boolean; groups: TopicGroup[] } {
  if (topics.length === 0) return { grouped: false, groups: [] };
  const sorted = [...topics].sort(bookOrder);
  if (sorted.every((t) => t.heading === null)) return { grouped: false, groups: [{ heading: null, topics: sorted }] };
  const groups: TopicGroup[] = [];
  [...sorted].sort((a, b) => headingRank(a) - headingRank(b) || bookOrder(a, b)).forEach((t) => {
    const last = groups[groups.length - 1];
    if (last && last.heading === t.heading) last.topics.push(t);
    else groups.push({ heading: t.heading, topics: [t] });
  });
  return { grouped: true, groups };
}

// Spec §6: the question types each skill heading suggests (English and Urdu headings, the bot's headings.js words).
const GRAMMAR = ['MCQs', 'Fill in the Blanks', 'Rewrite Sentences', 'Match the Column'];
const BY_HEADING: Record<string, string[]> = {
  'Vocabulary & grammar': GRAMMAR,
  'قواعد': GRAMMAR,
  'الفاظ و معانی': GRAMMAR,
  Reading: ['Comprehension Passage'],
  'تفہیم': ['Comprehension Passage'],
  Writing: ['Simple Writing', 'Paragraph Writing'],
  'تخلیقی لکھائی': ['Simple Writing', 'Paragraph Writing'],
  'Oral communication': ['Listening', 'Speaking'],
  'بلند خوانی': ['Listening', 'Speaking'],
  Phonics: ['Match the Column', 'Fill in the Blanks'],
  'ارکان سازی': ['Match the Column', 'Fill in the Blanks'],
};
const MATHS = ['MCQs', 'Fill in the Blanks', 'Short Questions'];
const SCIENCE = ['MCQs', 'Fill in the Blanks', 'Brief Answers', 'Label the Diagram'];

/** The types the ticked topics suggest (§6), once each, in heading order; only those the subject offers, at most MAX_TYPES. */
export function suggestTypes(subject: string | null, ticked: readonly Topic[], offered: readonly OfferedType[]): string[] {
  const order = [...ticked].sort((a, b) => headingRank(a) - headingRank(b) || bookOrder(a, b));
  const wanted: string[] = [];
  if (order.some((t) => t.heading !== null)) {
    order.forEach((t) => wanted.push(...(t.heading !== null ? BY_HEADING[t.heading] ?? [] : [])));
  } else if (/math/i.test(subject ?? '')) {
    wanted.push(...MATHS, ...(order.some((t) => /word problem/i.test(t.name)) ? ['Word Problems'] : []));
  } else if (/science/i.test(subject ?? '')) {
    wanted.push(...SCIENCE);
  }
  const ids = new Set(offered.map((o) => o.id));
  return [...new Set(wanted)].filter((id) => ids.has(id)).slice(0, MAX_TYPES);
}

/** bd-pw1ccr.6 — the marks FDE gives one writing item (bot/shared/services/assessment/patterns). G1 has no composition:
 *  its writing comes in blocks of 5 × 2 (English Complete the Sentences and This Is A, Urdu Picture Sentences). From G2 a
 *  composition is one 10-mark item (G2 English Paragraph, Urdu Topic Sentences; G5 Paragraph Writing). */
const WRITING = new Set([...BY_HEADING.Writing, ...BY_HEADING['تخلیقی لکھائی']]);
const writingCount = (grade: number | null | undefined) => (grade === 1 ? TOPIC_MARKS / 2 : 1);

/** A topic paper's starting choices: 10 marks, no book questions, 2 of each objective type and 1 of each written one
 *  (a G1 writing task 5, as FDE G1 writes), dropping to 1 from the end until the questions fit the marks. None suggested:
 *  the default mix of 5. */
export function topicDefaults(subject: string | null, ticked: readonly Topic[], offered: readonly OfferedType[], grade?: number | null) {
  const ids = suggestTypes(subject, ticked, offered);
  const objective = new Set(offered.filter((o) => o.category === 'objective').map((o) => o.id));
  const countOf = (id: string) => (objective.has(id) ? 2 : WRITING.has(id) ? writingCount(grade) : 1);
  const typeCounts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, countOf(id)]));
  const total = () => Object.values(typeCounts).reduce((s, n) => s + n, 0);
  for (let i = ids.length - 1; i >= 0 && total() > TOPIC_MARKS; i -= 1) if (typeCounts[ids[i]] > 1) typeCounts[ids[i]] = 1;
  const counts = ids.length ? typeCounts : defaultTypeCounts([...offered], 5);
  return { marks: TOPIC_MARKS, seen: 0, typeCounts: counts, typesSeeded: Object.keys(counts).length > 0 };
}

/** The step applies: one chapter picked (not pages, not the board pattern). Whether it has topics is the server's. */
export const topicsApply = (p: Picks): boolean => p.coverBy === 'chapters' && p.chapters.length === 1 && !isFde(p);

/** A topic subset's defaults taken back (it became the whole chapter, or the chapter changed). Nothing else is touched. */
export function undoDefaults(p: Picks): Partial<Picks> {
  if (!Array.isArray(p.topicIds) || p.topicIds.length === 0) return {};
  return { marks: null, seen: newPicks(15).seen, typeCounts: {}, typesSeeded: false };
}

export const chooseWhole = (p: Picks): Partial<Picks> => ({ topicScope: 'chapter', topicIds: null, ...undoDefaults(p) });

/** Select topics opens with nothing ticked. */
export const chooseTopics = (p: Picks): Partial<Picks> => ({ topicScope: 'topics', topicIds: [], ...undoDefaults(p) });

/** A new class or chapter (or pages): the step is asked again. */
export const clearTopics = (p: Picks): Partial<Picks> => ({ topicScope: null, topicIds: null, ...undoDefaults(p) });

/** The ticked ids on screen: every topic when topicIds is null (all ticked). */
export function tickedOf(p: Picks, all: readonly Topic[]): string[] {
  if (p.topicScope !== 'topics') return [];
  return p.topicIds === null || p.topicIds === undefined ? [...all].sort(bookOrder).map((t) => t.topicId) : [...p.topicIds];
}

/** Her ticks: all = the whole chapter (null), none = [] (Next waits), a subset = a topic paper with its defaults. */
export function setTicked(p: Picks, ids: readonly string[], all: readonly Topic[], offered: readonly OfferedType[]): Partial<Picks> {
  const picked = new Set(ids);
  const ticked = [...all].sort(bookOrder).filter((t) => picked.has(t.topicId));
  if (ticked.length === 0) return { topicIds: [], ...undoDefaults(p) };
  if (ticked.length === all.length) return { topicIds: null, ...undoDefaults(p) };
  return { topicIds: ticked.map((t) => t.topicId), ...topicDefaults(p.subject, ticked, offered, p.grade) };
}
