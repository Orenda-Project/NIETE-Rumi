import { useLang } from "../../teacher/i18n";
import { DateText, LibraryText } from "../../coach/insights/count";
import { pick } from "../../coach/insights/text";
import type { RmHome } from "../types";
import { RmCard } from "./RmFrame";
import { rt, rtx } from "../text";

/**
 * bd-sex15q.17 — the cluster session card (S8): the first W is the agenda; the library's sector- or school-level I is
 * run in a room, with a date and a follow-up (never a broadcast as the whole intervention, A7). No I yet: "Pick the
 * agenda from the coaches' moves this week".
 */
export function ClusterCard({ home }: { home: RmHome }) {
  const lang = useLang();
  const c = home.cluster;
  return (
    <RmCard testId="rm-cluster">
      <p className="text-[15.5px] leading-snug text-[#1d2025]">
        {c
          ? rtx("s8.cluster", lang, {
            title: <LibraryText>{pick(c.title, lang)}</LibraryText>,
            date: c.date ? <DateText iso={c.date} lang={lang} /> : "",
          })
          : rt("s8.cluster.none", lang)}
      </p>
    </RmCard>
  );
}
