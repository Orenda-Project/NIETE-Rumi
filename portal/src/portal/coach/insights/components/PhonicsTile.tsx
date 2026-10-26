import { useLang } from "../../../teacher/i18n";
import { CountSpan } from "../count";
import { t } from "../text";
import type { Home } from "../types";
import { WCard } from "./WCard";

/**
 * bd-sex15q.15 — S1's phonics tile (COPY §S1 phonics, API R2 `phonics`). Three states:
 *
 *   testing  the detector is being checked against a person's read; "{read} of 30 read" is the gate's progress, not a
 *            count about teachers, so the line is marked `data-nonum` (its 30 is the gate's fixed size)
 *   paused   held for a person's check; no number
 *   ok       the phonics move as a full card (WCard) and "n of d reading-hour recordings read" as a count
 */
export function PhonicsTile({ phonics }: { phonics: Home["phonics"] }) {
  const lang = useLang();
  const ok = phonics.status === "ok" && phonics.card;
  return (
    <section data-testid="s1-phonics" data-status={ok ? "ok" : phonics.status === "paused" ? "paused" : "testing"}
      className="flex flex-col gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5">
      <h2 className="text-[16px] font-semibold text-[#1d2025]">{t("s1.phonics.title", lang)}</h2>
      {ok && phonics.card ? (
        <>
          <WCard card={phonics.card} total={1} testId="wcard-phonics" />
          {phonics.reading_hours && (
            <CountSpan as="p" count={phonics.reading_hours} className="text-[13.5px] leading-snug text-[#6b7280]">
              {t("s1.phonics.ok.sub", lang, { n: phonics.reading_hours.n, d: phonics.reading_hours.d })}
            </CountSpan>
          )}
        </>
      ) : phonics.status === "paused" ? (
        <p className="text-[14.5px] leading-snug text-[#374151]">{t("s1.phonics.paused", lang)}</p>
      ) : (
        <p data-nonum="" className="text-[14.5px] leading-snug text-[#374151]">{t("s1.phonics.testing", lang, { read: phonics.read })}</p>
      )}
    </section>
  );
}
