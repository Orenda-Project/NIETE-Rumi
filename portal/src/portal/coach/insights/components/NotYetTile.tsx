import { useLang } from "../../../teacher/i18n";
import { t } from "../text";
import type { WRow as WRowData } from "../types";
import { WRow } from "./WRow";

/**
 * bd-sex15q.15 — S1's "Not yet" block (COPY §S1): a compact grey tile holding the weaknesses that have not cleared the
 * floor, each as G9's one row in its not_yet state. The rows keep the payload's order (never sorted by a count).
 */
export function NotYetTile({ rows }: { rows: readonly WRowData[] }) {
  const lang = useLang();
  if (!rows.length) return null;
  return (
    <section data-testid="s1-not-yet" className="flex flex-col gap-2 rounded-2xl border border-dashed border-[#d1d5db] bg-[#f9fafb] px-4 py-3.5">
      <h2 className="text-[16px] font-semibold text-[#1d2025]">{t("s1.not_yet.title", lang)}</h2>
      <p className="text-[13.5px] leading-snug text-[#6b7280]">{t("s1.not_yet.sub", lang)}</p>
      {rows.map((row) => <WRow key={row.w_id} row={row} testId="wrow-not-yet" />)}
    </section>
  );
}
