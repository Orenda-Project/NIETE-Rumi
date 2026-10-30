import { useLang } from "../../../teacher/i18n";
import { t } from "../text";
import { Section } from "../../../coachip-ui/Section";
import type { WRow as WRowData } from "../types";
import { WRow } from "./WRow";

/**
 * bd-sex15q.15 — S1's "Not yet" block (COPY §S1): a compact grey tile holding the weaknesses that have not cleared the
 * floor, each as G9's one row in its not_yet state. The rows keep the payload's order (never sorted by a count). R6
 * (bd-sex15q.46): a hairline section with a grey label, not a dashed box (not yet = grey, DESIGN_SYSTEM §6).
 */
export function NotYetTile({ rows }: { rows: readonly WRowData[] }) {
  const lang = useLang();
  if (!rows.length) return null;
  return (
    <Section testId="s1-not-yet" label={t("s1.not_yet.title", lang)} hint={t("s1.not_yet.sub", lang)}>
      {rows.map((row) => <WRow key={row.w_id} row={row} testId="wrow-not-yet" />)}
    </Section>
  );
}
