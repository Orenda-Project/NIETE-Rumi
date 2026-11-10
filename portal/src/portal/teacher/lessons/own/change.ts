import { LESSONS_OWN } from '../paths';

/**
 * bd-snkn32.15 — "Change this plan", pure: the parts she may pick (the bot's own list, lp-own-edit-guard PARTS), the
 * page's address (everything it needs rides in it, the Lesson Plans rule), and the one check made on the phone. The
 * bot holds every other rule (two changes, tiny edits, repeats, one at a time, five a day) and answers with an outcome.
 * no "whole plan" part (a change is one section); the bot also refuses dropping a GRR phase (`grr`)
 * and rote drill (`rote`).
 */

export const CHANGE_PARTS = {
  k5: ['hook', 'i_do', 'we_do', 'you_do', 'wrap'],
  g612: ['objectives', 'introduction', 'development', 'activity', 'conclusion', 'homework'],
} as const;
export type Band = keyof typeof CHANGE_PARTS;
export type Part = (typeof CHANGE_PARTS)[Band][number];

export const TEXT_MIN = 15;
export const TEXT_MAX = 300;
const MAX_LEFT = 2;

export const REFUSALS = ['too_short', 'too_small', 'repeat', 'in_flight', 'cap_reached', 'daily_limit', 'grr', 'rote'] as const;
export type Refusal = (typeof REFUSALS)[number];
export const isRefusal = (v: unknown): v is Refusal => typeof v === 'string' && (REFUSALS as readonly string[]).includes(v);

export const LESSONS_CHANGE = `${LESSONS_OWN}/change`;

/** Her plan (any id in its chain), its band, changes left, and where the waiting screen goes afterwards. */
export type ChangeAt = {
  own: string; band: Band; left: number; grade: number; subject: string; chapter?: string; lesson: string; title?: string;
  /** the section card she tapped, so the change page starts on it. */
  part?: Part;
};

const isPart = (band: Band, v: string | null): v is Part => !!v && (CHANGE_PARTS[band] as readonly string[]).includes(v);

export function changeUrl(c: ChangeAt): string {
  const q = new URLSearchParams({
    own: c.own, band: c.band, remaining: String(c.left), grade: String(c.grade), subject: c.subject, lesson: c.lesson,
  });
  if (c.chapter) q.set('chapter', c.chapter);
  if (c.title) q.set('title', c.title);
  if (c.part) q.set('part', c.part);
  return `${LESSONS_CHANGE}?${q.toString()}`;
}

export function readChange(search: string): ChangeAt | null {
  const q = new URLSearchParams(search);
  const own = q.get('own');
  const band = q.get('band');
  const grade = Number(q.get('grade'));
  const subject = q.get('subject');
  const lesson = q.get('lesson');
  if (!own || (band !== 'k5' && band !== 'g612') || !Number.isInteger(grade) || grade < 1 || grade > 12 || !subject || !lesson) return null;
  const n = Number(q.get('remaining'));
  const at: ChangeAt = { own, band, left: Number.isFinite(n) ? Math.min(MAX_LEFT, Math.max(0, Math.trunc(n))) : 0, grade, subject, lesson };
  const chapter = q.get('chapter');
  const title = q.get('title');
  if (chapter) at.chapter = chapter;
  if (title) at.title = title;
  const part = q.get('part');
  if (isPart(band, part)) at.part = part;
  return at;
}

/** null when it may be sent; else what to tell her (a part off her band's list is a bad request, never sent). */
export function checkLocal(band: Band, part: string | null, text: string): Refusal | 'bad_request' | null {
  if (!isPart(band, part)) return 'bad_request';
  if (text.trim().length < TEXT_MIN) return 'too_short';
  return null;
}

/** What the viewer needs to offer a change, from the waiting screen's address and the status poll's answer. */
export function ownChangeAt(
  at: { grade: number; subject: string; chapter?: string; lesson: string; render: string },
  info: { changesLeft: number; band: Band },
  title?: string,
): ChangeAt {
  const c: ChangeAt = {
    own: at.render, band: info.band, left: Math.min(MAX_LEFT, Math.max(0, info.changesLeft)),
    grade: at.grade, subject: at.subject, lesson: at.lesson,
  };
  if (at.chapter) c.chapter = at.chapter;
  if (title) c.title = title;
  return c;
}
