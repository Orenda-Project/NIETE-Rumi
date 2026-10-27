import { useNavigate } from "react-router-dom";
import { useLang } from "../../../teacher/i18n";
import { Card, Eyebrow } from "../components/Frame";
import { DateText } from "../count";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import type { Moment } from "../types";
import { ClockText } from "./LessonClock";
import { MomentPlayer } from "./MomentPlayer";
import { dropPart, gradeSubject, NO_PART } from "./PairCard";

/**
 * bd-sex15q.16 — S4, the player page's body (DESIGN §3 S4; R6 `GET /coachip/m/:momentId`). MomentRoute (m-ui) keeps the
 * read, the frame, the back link and the app bar title ("{code} · {school}", the school alone for the RM circle form);
 * this is everything under it: the eyebrow LISTEN, the move's sentence in its frame ("… This is one of them."), and the
 * full player, whose "See the move" opens the move page of this W (S5).
 */
/** The EN sentence opens the frame, so its first code point is capitalised (COPY v1.1 §8; Urdu has no case). */
export function openSentence(sentence: string, lang: "en" | "ur"): string {
  if (lang !== "en" || !sentence) return sentence;
  const [first, ...rest] = [...sentence];
  return first.toUpperCase() + rest.join("");
}

export default function MomentPage({ moment }: { moment: Moment }) {
  const lang = useLang();
  const navigate = useNavigate();
  return (
    <Card testId="s4-body">
      <Eyebrow k="eyebrow.listen" />
      <p data-testid="s4-sentence" className="text-[17px] leading-snug text-[#1d2025]">
        {t("s4.sentence_frame", lang, { sentence: openSentence(pick(moment.w.sentence, lang), lang) })}
      </p>
      <MomentPlayer moment={moment} variant="full" onSeeMove={() => navigate(insightsPaths.move(moment.w.w_id))} />
    </Card>
  );
}

/**
 * The app bar's sub line, `s4.appbar.sub`: "Grade 3 Urdu · Tue 13 Oct · 27:40". The grade-and-subject part goes when the
 * session lacks either; the RM circle form has no session, so it has no sub line at all (null).
 */
export function MomentSub({ moment }: { moment: Moment }) {
  const lang = useLang();
  const session = (moment as Partial<Moment>).session;
  if (!session) return null;
  const gs = gradeSubject(session, lang);
  const line = tx("s4.appbar.sub", lang, {
    grade_subject: gs ?? NO_PART,
    date: <DateText iso={session.recorded_on} lang={lang} />,
    duration: <ClockText seconds={session.duration_s} lang={lang} />,
  });
  return <span data-testid="s4-sub">{gs ? line : dropPart(line, NO_PART)}</span>;
}
