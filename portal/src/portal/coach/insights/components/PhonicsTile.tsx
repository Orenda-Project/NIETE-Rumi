import { useLang } from "../../../teacher/i18n";
import { CountSpan } from "../count";
import { t } from "../text";
import type { Home } from "../types";
import { WCard } from "./WCard";
import { Section } from "../../../coachip-ui/Section";

/**
 * bd-sex15q.15 — S1's phonics tile (COPY §S1 phonics, API R2 `phonics`). Three states:
 *
 *   testing  (fix-r5 s2 item 20: one line, `s1.phonics.line`) the detector is being checked against a person's read; "{read} of 30 read" is the gate's progress, not a
 *            count about teachers, so the line is marked `data-nonum` (its 30 is the gate's fixed size)
 *   paused   held for a person's check; no number
 *   ok       the phonics move as a full card (WCard) and "n of d reading-hour recordings read" as a count
 *
 * R6 (bd-sex15q.46): a hairline section under a small-caps label, never a box; the ok move is WCard `flat` (a card ring,
 * both buttons secondary: S1's one primary is the headline's See the move).
 */
export function PhonicsTile({ phonics }: { phonics: Home["phonics"] }) {
  const lang = useLang();
  const ok = phonics.status === "ok" && phonics.card;
  // fix-r5 s2 item 20 (panel 094004, design-qa 073634): while the detector is being tested the tile is ONE line, no
  // title; "{read} of 30" is the gate's progress, not a count about teachers, so it stays `data-nonum` as before
  if (!ok && phonics.status !== "paused") {
    return (
      <section data-testid="s1-phonics" data-status="testing" data-section="" className="mt-5 border-t border-cp-hairline pt-5">
        <p data-testid="s1-phonics-line" data-nonum="" className="text-[15px] leading-[1.45] text-cp-ink-2">
          {t("s1.phonics.line", lang, { read: phonics.read })}
        </p>
      </section>
    );
  }
  return (
    <div data-testid="s1-phonics" data-status={ok ? "ok" : phonics.status === "paused" ? "paused" : "testing"}>
      <Section title={t("s1.phonics.title", lang)}>
        {ok && phonics.card ? (
          <div className="flex flex-col gap-3 pt-1">
            <WCard card={phonics.card} total={1} testId="wcard-phonics" flat />
            {phonics.reading_hours && (
              <CountSpan as="p" count={phonics.reading_hours} className="text-[13px] leading-[1.45] text-cp-ink-3">
                {t("s1.phonics.ok.sub", lang, { n: phonics.reading_hours.n, d: phonics.reading_hours.d })}
              </CountSpan>
            )}
          </div>
        ) : (
          <p className="text-[15px] leading-[1.45] text-cp-ink-2">{t("s1.phonics.paused", lang)}</p>
        )}
      </Section>
    </div>
  );
}
