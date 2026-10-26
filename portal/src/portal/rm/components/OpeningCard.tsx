import { useLang } from "../../teacher/i18n";
import { WindowMark } from "../../coach/insights/count";
import { range } from "../../coach/insights/format";
import type { Window } from "../../coach/insights/types";
import type { RmHome } from "../types";
import { CountLine } from "./CountLine";
import { RmCard } from "./RmFrame";
import { rt, rtx } from "../text";

/**
 * bd-sex15q.17 — S8's opening sentence (direction B, COPY s8.opening): schools visited, schools and teacher codes not
 * observed for 4 weeks or more, each a Count with the sector's base; then the floor line, and the schools no coach holds
 * and the roster coaches with no school (E2), each with its base. Codes are counted, never listed (C3).
 */
export function OpeningCard({ home }: { home: RmHome }) {
  const lang = useLang();
  const o = home.opening;
  const act = home.windows.find((w) => w.id === o.visited.window_id) as Window | undefined;
  return (
    <RmCard testId="rm-opening">
      <p data-testid="rm-opening-sentence" data-window={o.visited.window_id} className="text-[17px] leading-snug text-[#1d2025] md:text-[18px]">
        {rtx("s8.opening", lang, {}, [
          { n: "n", d: "d", count: o.visited },
          { n: "u", d: "d", count: o.unobserved_schools },
          { n: "c", d: "t", count: o.unobserved_codes },
        ])}
      </p>
      <p className="text-[13.5px] text-[#6b7280]">
        <span data-nonum="">{rt("s8.floor", lang)}</span>
        {act && <>{lang === "ur" ? "، " : " · "}<WindowMark window={act} as="span">{range(act.from, act.to, lang)}</WindowMark></>}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-[#6b7280]">
        <CountLine k="s8.unassigned" count={home.unassigned_schools} />
        {home.no_scope_coaches.n > 0 && <CountLine k="s8.no_scope_coaches.of" count={home.no_scope_coaches} />}
      </div>
    </RmCard>
  );
}
