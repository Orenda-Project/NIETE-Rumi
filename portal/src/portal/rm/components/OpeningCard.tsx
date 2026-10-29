import { useLang } from "../../teacher/i18n";
import { WindowMark } from "../../coach/insights/count";
import { range } from "../../coach/insights/format";
import type { Window } from "../../coach/insights/types";
import { RingCount } from "../../coachip-ui/Count";
import { Pill } from "../../coachip-ui/Pill";
import type { RmHome } from "../types";
import { RM_COPY } from "../rm.copy";
import { CountLine } from "./CountLine";
import { rt, rtxTemplate } from "../text";

/**
 * bd-sex15q.17 — S8's opening sentence (direction B, COPY s8.opening): schools visited, schools and teacher codes not
 * observed for 4 weeks or more, each a Count with the sector's base; then the floor line, and the schools no coach holds
 * and the roster coaches with no school (E2), each with its base. Codes are counted, never listed (C3).
 *
 * bd-sex15q.47 (R6, DIRECTION delta 6): the band's body. The first sentence's count is the hero ring (schools visited,
 * n of d) with the rest of that sentence beside it; the second sentence under it at 80 % white; the floor as the green
 * pill with the activity window in it. The words are s8.opening verbatim, split at its first full stop (no new copy):
 * the ring carries "{n} of {d}", so the lead is the first sentence without it.
 */
export function openingParts(lang: "en" | "ur") {
  const tpl = RM_COPY["s8.opening"][lang];
  const stop = lang === "ur" ? "۔ " : ". ";
  const cut = tpl.indexOf(stop) + 1;
  const first = cut > 0 ? tpl.slice(0, cut) : tpl;
  const rest = cut > 0 ? tpl.slice(cut).trim() : "";
  const lead = first.replace(lang === "ur" ? "{d} میں سے {n}" : "{n} of {d}", "").replace(/\s+/g, " ").trim();
  return { lead, rest };
}

export function OpeningCard({ home }: { home: RmHome }) {
  const lang = useLang();
  const o = home.opening;
  const act = home.windows.find((w) => w.id === o.visited.window_id) as Window | undefined;
  const { lead, rest } = openingParts(lang);
  const sep = lang === "ur" ? "، " : " · ";
  return (
    <div data-testid="rm-opening" className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-x-10">
      <div data-testid="rm-opening-sentence" data-window={o.visited.window_id} className="contents">
        <RingCount count={o.visited} lang={lang} size="hero">
          <p className="text-[17px] font-medium leading-[1.42]">{lead}</p>
        </RingCount>
        {rest && (
          <p className="cp-on-band-2 text-[14px] leading-[1.45] lg:text-[16px]">
            {rtxTemplate(rest, "s8.opening", lang, {}, [
              { n: "u", d: "d", count: o.unobserved_schools },
              { n: "c", d: "t", count: o.unobserved_codes },
            ])}
          </p>
        )}
      </div>
      <div className="flex flex-col items-start lg:col-span-2">
        <Pill tone="green" as="p" testId="rm-floor">
          <span data-nonum="">{rt("s8.floor", lang)}</span>
          {act && <>{sep}<WindowMark window={act} as="span">{range(act.from, act.to, lang)}</WindowMark></>}
        </Pill>
      </div>
    </div>
  );
}

/**
 * bd-sex15q.47 (ux-lead-2 183234 #3): the schools no coach holds and the roster coaches with no school, each with its
 * base, as 13 px ink-3 coverage lines under the weaknesses card (S1's coverage pattern), not in the band.
 */
export function Coverage({ home }: { home: RmHome }) {
  return (
    <p data-testid="rm-coverage" className="flex flex-wrap gap-x-4 gap-y-1 pt-4 text-[13px] leading-[1.45] text-cp-ink-3">
      <CountLine k="s8.unassigned" count={home.unassigned_schools} />
      {home.no_scope_coaches.n > 0 && <CountLine k="s8.no_scope_coaches.of" count={home.no_scope_coaches} />}
    </p>
  );
}
