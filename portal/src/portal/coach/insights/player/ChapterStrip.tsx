import { COPY } from "../copy";
import type { Lang } from "../../../teacher/i18n";
import { pick, t } from "../text";
import type { MomentStep, Verdict } from "../types";

/**
 * bd-sex15q.16 — the chapter strip (DESIGN §3 S4, SPEC v2 §7): the plan's steps as segments, each marked by its verdict:
 * ✓ executed, ½ partial, ✗ not done, and GREY, never red, for a step the clip did not reach (G7);
 * not_adjudicable / substituted are neutral. Red never appears on a teacher's step. The segment holding the moment
 * (`lesson_s`) carries a ring. The strip runs left to right in Urdu too, like the kit's track it seeks. Each segment is a button named by its label and its verdict word; a tap asks the player to
 * seek (the player decides: inside the clip it seeks, outside it says so). `tappable = false` (no timestamps, or no
 * player) leaves the steps marked but disabled.
 */
type Look = { mark: string; bar: string; text: string };

const LOOK: Record<Verdict, Look> = {
  executed: { mark: "✓", bar: "bg-cp-green", text: "text-cp-green-ink" },
  partial: { mark: "½", bar: "bg-[linear-gradient(90deg,var(--cp-green)_50%,var(--cp-track)_50%)]", text: "text-cp-ink-2" },
  not_done: { mark: "✗", bar: "bg-cp-navy", text: "text-cp-navy" },
  not_reached: { mark: "–", bar: "chapter-grey bg-cp-hairline", text: "text-cp-ink-3" },
  not_adjudicable: { mark: "–", bar: "chapter-neutral bg-cp-track", text: "text-cp-ink-3" },
  substituted: { mark: "–", bar: "chapter-neutral bg-cp-track", text: "text-cp-ink-3" },
};

/**
 * The verdict words, read out of COPY's own legend ("✓ done · ½ partial · ✗ not done · grey: the clip did not reach it")
 * so no word is invented here; not_adjudicable / substituted take COPY v1.1's `s4.verdict.*` (the strip's accessible name).
 */
export function verdictWord(v: Verdict, lang: Lang): string {
  const parts = COPY["s4.legend"][lang].split(lang === "ur" ? "، " : " · ").map((p) => p.replace(/^[✓½✗]\s*/, ""));
  if (v === "not_adjudicable") return t("s4.verdict.not_adjudicable", lang);
  if (v === "substituted") return t("s4.verdict.substituted", lang);
  const at: Partial<Record<Verdict, number>> = { executed: 0, partial: 1, not_done: 2, not_reached: 3 };
  const i = at[v];
  return i === undefined ? "" : parts[i] ?? "";
}

export default function ChapterStrip({ steps, lang, tappable, momentAt, onStep, legend }: {
  steps: readonly MomentStep[];
  lang: Lang;
  tappable: boolean;
  /** The moment's second in the lesson, to ring the segment it falls in. */
  momentAt: number | null;
  onStep: (step: MomentStep) => void;
  /** The legend and the "tap a step" line (the full player); the inline player shows the strip alone. */
  legend: boolean;
}) {
  if (!steps.length) return null;
  return (
    <div data-testid="chapter-strip" className="flex flex-col gap-1">
      {/* LTR like the kit's track above it (a timeline; COPY §0.3 "the player stays LTR in Urdu"); the words stay Urdu */}
      <div role="group" dir="ltr" className="flex gap-1">
        {steps.map((s, i) => {
          const look = LOOK[s.verdict] ?? LOOK.not_adjudicable;
          const label = pick(s.label, lang);
          const word = verdictWord(s.verdict, lang);
          const here = momentAt != null && s.from_s != null && s.to_s != null && momentAt >= s.from_s && momentAt < s.to_s;
          return (
            <button
              key={`${s.phase}-${i}`}
              type="button"
              data-testid="chapter-seg"
              data-verdict={s.verdict}
              data-moment={here ? "true" : undefined}
              disabled={!tappable}
              aria-label={word ? `${label}: ${word}` : label}
              onClick={() => onStep(s)}
              className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center gap-1 rounded-md px-0.5 text-start disabled:cursor-default"
            >
              <span
                data-testid="chapter-bar"
                className={`block h-2 w-full rounded-full ${look.bar} ${here ? "ring-2 ring-cp-navy ring-offset-1" : ""}`}
              />
              {/* FIX_R6 A9: wraps at the space only: a hyphen is a no-break hyphen, so "Warm-up" never splits; the mark may sit on
                  its own line */}
              <span className={`text-[12px] font-medium leading-tight [hyphens:none] ${look.text}`}>
                <span aria-hidden="true">{look.mark}</span> {label.replace(/-/g, "\u2011")}
              </span>
            </button>
          );
        })}
      </div>
      {legend && (
        <p data-testid="chapter-legend" className="text-[13px] leading-snug text-cp-ink-3">
          {t("s4.legend", lang)}
          {tappable && <>{lang === "ur" ? "۔ " : ". "}{t("s4.tap_step", lang)}</>}
        </p>
      )}
    </div>
  );
}
