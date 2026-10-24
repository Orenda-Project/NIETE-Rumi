import type { Lang, Words } from '../../i18n';
import { dayLabel } from '../../format';
import { lessonPath, COACHING_HOME } from '../../coaching/paths';
import { OBS_HOME } from '../../observations/paths';
import { LESSONS_HOME } from '../../lessons/paths';
import { teacherPath } from '../../routes';
import type { HOME_CARD_COPY } from '../copy';
import type { HomeCard, HomeCardKind } from '../api';

/**
 * The Home card's words and where each tap goes, in one place: the full kinds' as NextCard draws them, the slim kinds'
 * two verbs as SlimCard draws them, and the look's card (one shape for all five kinds), which reads both. The hrefs and
 * the quiz-home rule ("Quiz this" on a coach report only with a signed quiz home) are the same for every shape.
 */
export type CardCopy = Words<typeof HOME_CARD_COPY>;
export type CardAction = { label: string; href: string };
export type CardWords = { title: string; sub: string; primary: CardAction; secondary: CardAction | null };
type FullKind = Extract<HomeCardKind, 'coach_report' | 'observation' | 'first_plan'>;

/** A full kind's title, sub line and two verbs (NextCard). */
export function fullCardWords(kind: FullKind, card: HomeCard, quizHome: string | null, C: CardCopy, day: string): CardWords {
  return kind === 'coach_report' ? {
    title: C.coach.title,
    sub: C.coach.sub(card.title, day),
    primary: { label: C.coach.primary, href: card.id ? lessonPath(card.id) : COACHING_HOME },
    secondary: quizHome ? { label: C.coach.secondary, href: quizHome } : null,
  } : kind === 'observation' ? {
    title: C.obs.title(day || card.title),
    sub: C.obs.sub,
    primary: { label: C.obs.primary, href: OBS_HOME },
    secondary: { label: C.obs.secondary, href: LESSONS_HOME },
  } : {
    title: C.first.title,
    sub: C.first.sub,
    primary: { label: C.first.primary, href: LESSONS_HOME },
    secondary: { label: C.first.secondary, href: teacherPath('training') },
  };
}

/** A slim kind's two verbs (SlimCard): the quiz home first; "Open the plan" opens a coaching session's report, else Lesson Plans. */
export function slimCardActions(card: HomeCard, C: CardCopy): { primary: CardAction; secondary: CardAction } {
  const isClass = card.kind === 'class';
  return {
    primary: { label: isClass ? C.class.primary : C.lesson.primary, href: card.href },
    secondary: isClass
      ? { label: C.class.secondary, href: card.href }
      : { label: C.lesson.secondary, href: card.from === 'coach' && card.id ? lessonPath(card.id) : LESSONS_HOME },
  };
}

/**
 * The look's words for any kind. The lesson's title is the registry lead-in alone (its topic is drawn as its own block)
 * and it has no sub line (the lesson's sub needs a grade and a subject the card does not carry); the class names its
 * count, then its topic.
 */
export function lookCardWords(card: HomeCard, quizHome: string | null, C: CardCopy, lang: Lang): CardWords {
  if (card.kind === 'lesson' || card.kind === 'class') {
    const { primary, secondary } = slimCardActions(card, C);
    return card.kind === 'lesson'
      ? { title: C.look.leadIn, sub: '', primary, secondary }
      : { title: C.class.title(card.played ?? 0), sub: C.class.sub(card.title), primary, secondary };
  }
  return fullCardWords(card.kind, card, quizHome, C, dayLabel(card.at, lang));
}
