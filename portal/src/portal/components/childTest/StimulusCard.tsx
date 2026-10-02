import type { ReadingCard, MathsCard } from "../../types/childTest";
import type { ChildTestCopy } from "../../lib/childTest/copy";

/**
 * bd-s1oo0.7 — what the CHILD reads, in large print, with no item numbers.
 * A story is connected text, as in a book. Urdu is Nastaliq, right to left;
 * English and numbers are left to right. The coach's own prompts (questions,
 * first-sound words) sit apart, small, under "Ask" — the child is not meant to
 * read those.
 */

export type ReadingView = "story" | "fallback" | "after";
export type MathsView = "numbers" | "sums" | "strip";

const URDU_TEXT = "font-['Noto_Nastaliq_Urdu'] leading-[2.4]";

function Grid({ items, dir, big }: { items: (string | number)[]; dir: "rtl" | "ltr"; big?: boolean }) {
  return (
    <div dir={dir} className={`grid ${big ? "grid-cols-2" : "grid-cols-3"} gap-3`}>
      {items.map((x, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className={`rounded-xl bg-white border border-slate-200 py-3 text-center text-slate-900 ${big ? "text-4xl" : "text-3xl"} ${dir === "rtl" ? URDU_TEXT : "font-semibold"}`}>
          {x}
        </div>
      ))}
    </div>
  );
}

export function ReadingStimulus({ card, view, copy }: { card: ReadingCard; view: ReadingView; copy: ChildTestCopy }) {
  const dir = card.block === "urdu" ? "rtl" : "ltr";
  if (view === "story") {
    return (
      <div className="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-6">
        <p
          data-testid="story-text"
          dir={dir}
          lang={card.block === "urdu" ? "ur" : "en"}
          className={card.block === "urdu" ? `text-[30px] text-slate-900 ${URDU_TEXT}` : "text-[28px] leading-[1.7] text-slate-900 font-medium"}
        >
          {card.child.story.text}
        </p>
      </div>
    );
  }
  if (view === "fallback" && card.child.fallback) {
    return (
      <div className="space-y-5">
        <Grid items={card.child.fallback.letters} dir={dir} big />
        <Grid items={card.child.fallback.words} dir={dir} />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-500 mb-2">{copy.madeUpWords}</p>
        <Grid items={card.child.nonwords.map((n) => n.text)} dir={dir} big />
      </div>
      <CoachPrompts card={card} copy={copy} />
    </div>
  );
}

export function CoachPrompts({ card, copy }: { card: ReadingCard; copy: ChildTestCopy }) {
  const dir = card.block === "urdu" ? "rtl" : "ltr";
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{copy.ask}</p>
      <ol className="space-y-2">
        {card.coach.questions.map((q) => (
          <li key={q.id} dir={dir} className={`text-lg text-slate-800 ${dir === "rtl" ? URDU_TEXT : ""}`}>{q.prompt}</li>
        ))}
      </ol>
      {card.coach.firstSounds.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1">{copy.firstSoundOf}</p>
          <p dir={dir} className={`text-lg text-slate-800 ${dir === "rtl" ? URDU_TEXT : ""}`}>
            {card.coach.firstSounds.map((s) => s.word).join(" ، ")}
          </p>
        </div>
      )}
    </div>
  );
}

export function MathsStimulus({ card, view, copy }: { card: MathsCard; view: MathsView; copy: ChildTestCopy }) {
  if (view === "numbers") {
    return (
      <div className="space-y-2">
        <Grid items={card.child.numbers} dir="ltr" big />
        {card.coach.numbersStopRule && <p className="text-sm text-slate-500">{copy.stopRule}</p>}
      </div>
    );
  }
  if (view === "sums") {
    return <Grid items={card.child.quickSums} dir="ltr" />;
  }
  return <p className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-lg text-slate-800">{copy.stripNow}</p>;
}
