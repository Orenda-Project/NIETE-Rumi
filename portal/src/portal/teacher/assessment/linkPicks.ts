import { newPicks, type Picks } from './model';
import type { Catalogue } from './api';

/**
 * bd-pw1ccr.1/.2 — the A/B report button's link (/go → Class?origin=report&grade=&subject=&chapter=, the bot's
 * app-login-link.js): the paper it makes is tagged origin report, and the class and chapter come filled in.
 */

export type Prefill = { grade: number; subject: string; chapter: number };
export type LinkRead = { origin: 'report' | null; prefill: Prefill | null };

const whole = (s: string | null, min: number, max: number): number | null => {
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
};

const prefillOf = (q: URLSearchParams): Prefill | null => {
  const grade = whole(q.get('grade'), 1, 12);
  const chapter = whole(q.get('chapter'), 1, 99);
  const subject = q.get('subject');
  return grade !== null && chapter !== null && !!subject && /^[a-z][a-z_]{0,39}$/.test(subject) ? { grade, chapter, subject } : null;
};

/** What Class's query says: a pre-fill only comes with origin=report (no other door sends one). */
export function readLink(q: URLSearchParams): LinkRead {
  if (q.get('origin') !== 'report') return { origin: null, prefill: null };
  return { origin: 'report', prefill: prefillOf(q) };
}

/** bd-pw1ccr.4.3 — the topic-end nudge's link (?by=topics&grade=&subject=&chapter=, untagged): its pre-fill, else null. */
export function readTopicLink(q: URLSearchParams): Prefill | null {
  return q.get('by') === 'topics' && !q.get('origin') ? prefillOf(q) : null;
}

const chapterPicks = (f: Prefill, cat: Catalogue, defaultCount: number): Picks | null => {
  const hit = cat.byGrade[f.grade]?.find((s) => s.key === f.subject);
  if (!hit) return null;
  return { ...newPicks(defaultCount), grade: f.grade, subject: f.subject, subjectName: hit.name, coverBy: 'chapters', chapters: [f.chapter] };
};

/** A fresh paper on the pre-filled chapter, tagged report; null when the catalogue does not offer that subject in that grade. */
export function reportPicks(f: Prefill, cat: Catalogue, defaultCount: number): Picks | null {
  const p = chapterPicks(f, cat, defaultCount);
  return p && { ...p, origin: 'report' };
}

/** A fresh, untagged paper on the pre-filled chapter that opens Topics on Select topics, nothing ticked; null as above. */
export function topicPicks(f: Prefill, cat: Catalogue, defaultCount: number): Picks | null {
  const p = chapterPicks(f, cat, defaultCount);
  return p && { ...p, byTopics: true };
}
