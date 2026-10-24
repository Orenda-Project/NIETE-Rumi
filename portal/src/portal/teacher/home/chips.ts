import { createElement, Fragment, type ReactNode } from 'react';
import type { Words } from '../i18n';
import { lessonPath } from '../coaching/paths';
import { OBS_HOME } from '../observations/paths';
import type { HOME_CARD_COPY } from './copy';
import type { HomeCardKind, HomeScores } from './api';

/**
 * The score chips' rule, shared by today's row (ScoresRow) and the look's strip (LookScores): the latest own AI-coach
 * score and the latest observation score (both marks out of max), each going to its report. Drawn only where a score
 * EXISTS (report.ts: never a stand-in zero): no number, no chip. The chip that repeats the card's own rung is left out
 * (the card already opens that report).
 */
export type Chip = { key: 'chip_coach' | 'chip_obs'; text: string; frac: string; href: string };

/**
 * The chip's words with its "{marks}/{max}" as a <bdi dir="ltr"> (the copy's LRI…PDI pair is dropped for the element,
 * which is the same isolate), so "29/38" never reads "38/29" inside Urdu.
 */
export function withFraction(text: string, frac: string): ReactNode {
  const bare = text.replace(/[⁦-⁩]/g, '');
  const at = bare.lastIndexOf(frac);
  if (at < 0) return bare;
  return createElement(Fragment, null, bare.slice(0, at), createElement('bdi', { dir: 'ltr' }, frac), bare.slice(at + frac.length));
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The chips to draw, in order (coach, then observation); empty means no row at all. */
export function pickChips(scores: HomeScores, cardKind: HomeCardKind | null | undefined, C: Words<typeof HOME_CARD_COPY>): Chip[] {
  const chips: Chip[] = [];
  // The report page's rule for both: marks out of max, and no chip unless both are numbers.
  const c = scores.coach;
  if (c && cardKind !== 'coach_report' && isNum(c.marks) && isNum(c.max)) {
    chips.push({ key: 'chip_coach', text: C.scores.coach(c.marks, c.max), frac: `${c.marks}/${c.max}`, href: lessonPath(c.id) });
  }
  const o = scores.observation;
  if (o && cardKind !== 'observation' && isNum(o.marks) && isNum(o.max)) {
    chips.push({ key: 'chip_obs', text: C.scores.obs(o.marks, o.max), frac: `${o.marks}/${o.max}`, href: OBS_HOME });
  }
  return chips;
}
