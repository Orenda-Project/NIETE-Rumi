import { useLang } from "../../teacher/i18n";
import { DateText, LibraryText } from "../../coach/insights/count";
import { pick } from "../../coach/insights/text";
import { Section } from "../../coachip-ui/Section";
import type { RmHome } from "../types";
import { RM_COPY } from "../rm.copy";
import { rtxTemplate } from "../text";

/**
 * bd-sex15q.17 — the cluster session card (S8): the first W is the agenda; the library's sector- or school-level I is
 * run in a room, with a date and a follow-up (never a broadcast as the whole intervention, A7). No I yet: "Pick the
 * agenda from the coaches' moves this week".
 *
 * bd-sex15q.47 (R6, SCREENS S8): a hairline section. The words are COPY verbatim, split at the template's first colon:
 * "Cluster session" becomes the small-caps label, the title the 17/600 lead, the date and "run in a room" the meta.
 */
function parts(key: "s8.cluster" | "s8.cluster.no_date" | "s8.cluster.none", lang: "en" | "ur") {
  const head = RM_COPY["s8.cluster"][lang];
  const at = head.indexOf(":");
  const label = head.slice(0, at).trim();
  const colon = head.slice(at).match(/^:\s*/)?.[0] ?? ": ";
  const tpl = RM_COPY[key][lang];
  const cut = tpl.indexOf(":");
  return { label, colon, body: cut >= 0 && key !== "s8.cluster.none" ? tpl.slice(cut + 1).trim() : tpl };
}

export function ClusterCard({ home }: { home: RmHome }) {
  const lang = useLang();
  const c = home.cluster;
  // fix-r5 s2 item 5 (qa-rm 072623): no date is its own sentence, never an empty "· ·" slot
  const key = !c ? "s8.cluster.none" : c.date ? "s8.cluster" : "s8.cluster.no_date";
  const { label, colon, body } = parts(key, lang);
  // the title is the lead; whatever follows it in the template is the meta line. The joins the cut removes (": " and
  // " · ") stay in the DOM for a screen reader, so the section still reads as the one COPY sentence.
  const [, after = ""] = body.split("{title}");
  const join = after.match(/^\s*[·،]\s*/)?.[0] ?? "";
  const meta = after.slice(join.length);
  return (
    <Section testId="rm-cluster" label={c ? <>{label}<span className="sr-only">{colon}</span></> : label}>
      {!c
        ? <p className="text-[17px] font-semibold leading-[1.4] text-cp-ink">{body}</p>
        : (
          <>
            <p className="text-[17px] font-semibold leading-[1.4] text-cp-ink"><LibraryText>{pick(c.title, lang)}</LibraryText></p>
            <p className="mt-1 text-[13px] leading-[1.45] text-cp-ink-3">
              <span className="sr-only">{join}</span>
              {rtxTemplate(meta, key, lang, c.date ? { date: <DateText iso={c.date} lang={lang} /> } : {})}
            </p>
          </>
        )}
    </Section>
  );
}
