import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useLang, type Lang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { useLoad } from "../useLoad";
import { coachip } from "../api";
import { insightsPaths } from "../paths";
import { InsightsPage, MetaLine, Eyebrow, Card } from "../components/Frame";
import { StateBlock, NoteCard } from "../components/StateBlock";
import { CodeText, DateText, LibraryText, Num } from "../count";
import { digits, LRI, PDI, todayKarachi } from "../format";
import { pick, t, tx } from "../text";
import type { MoveDetail } from "../types";

/**
 * bd-sex15q.15 — S5, the move (`/w/:wId/move?school=`, R9). The intervention exactly as the library wrote it: every
 * library field goes through <LibraryText> untouched, the client only frames it with COPY. The pairing W → I is the
 * server's (LIBRARY_RULES §2), never this file's.
 *
 *   check line   read from `check_by_default.rule` ("visit" or "14_days"), never worked out from a visit date here.
 *   evidence     the citation as text, never a link (API R9: a library url is never passed through).
 *   FLN          the existing send page with NO recipient and no query string (c-api finding 10:09Z).
 *   Set button   needs a teacher `code_id` the S5 payload does not carry, so setting a step lives on S2 (G1).
 */

/** The FLN send page: no code, no recipient, no query (a pre-selection would be a decode path). */
export const FLN_SEND = "/portal/fln/send";

/**
 * A material title in Urdu: every Latin-script run ("NIETE", «Five step lesson plan», an English title standing in for an
 * empty name_ur) sits in LRI…PDI (COPY §0.3; red-2 18:08Z, fix-r5 5e). English is untouched; the words stay the library's.
 */
export function isolateLatin(title: string, lang: Lang): string {
  if (lang !== "ur") return title;
  return title.replace(/[A-Za-z][A-Za-z0-9'’.,:/&-]*(?:\s+[A-Za-z0-9][A-Za-z0-9'’.,:/&-]*)*/g, (run) => `${LRI}${run}${PDI}`);
}

/** Whole calendar days from `from` to `to` (both ISO days). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function Section({ title, testId, children }: { title: ReactNode; testId?: string; children: ReactNode }) {
  return (
    <Card testId={testId}>
      <h2 className="text-[15px] font-semibold leading-snug text-[#1d2025]">{title}</h2>
      {children}
    </Card>
  );
}

const body = "text-[15px] leading-snug text-[#374151]";

function CheckRule({ data, lang }: { data: MoveDetail; lang: Lang }) {
  const c = data.check_by_default;
  if (c.rule === "visit") {
    const on = c.visit?.date ?? c.date;
    return (
      <p data-testid="s5-check-rule" data-nonum="" className="text-[13px] leading-snug text-[#6b7280]">
        {tx("s5.check.rule", lang, {
          date: <DateText iso={on} lang={lang} />,
          days: <span data-nonum="">{digits(daysBetween(todayKarachi(), on), lang)}</span>,
        })}
      </p>
    );
  }
  return (
    <p data-testid="s5-check-rule" data-nonum="" className="text-[13px] leading-snug text-[#6b7280]">
      {tx("s5.check.rule.14", lang, { date: <DateText iso={c.date} lang={lang} /> })}
    </p>
  );
}

/** The read sits INSIDE the gate, so with portal_coachip off no /coachip/* request fires (B7; red-2 18:08Z). */
export default function Move() {
  return (
    <InsightsGate>
      <MoveLoaded />
    </InsightsGate>
  );
}

function MoveLoaded() {
  const { wId = "" } = useParams();
  const [params] = useSearchParams();
  const school = params.get("school");
  const lang = useLang();
  const { data, error } = useLoad<MoveDetail>(() => coachip.move(wId, school), [wId, school]);
  const i = data?.i ?? null;
  const flnTitle = i?.materials.find((m) => m.kind === "fln")?.title ?? null;

  return (
    <InsightsPage
      testId="insights-move"
      backTo={insightsPaths.w(wId)}
      title={i ? <LibraryText>{pick(i.title, lang)}</LibraryText> : data ? pick(data.w.short_name, lang) : ""}
      crumb={i ? tx("s5.chip", lang, { i_id: <CodeText lang={lang}>{i.i_id}</CodeText> }) : null}
      windows={data?.windows}
    >
      {!data ? <StateBlock error={error} /> : (
        <>
          <Card testId="s5-w">
            <Eyebrow k="eyebrow.one_move" />
            <p className="text-[15.5px] leading-snug text-[#1d2025]">
              <Num count={data.w.count} lang={lang} className="font-bold" /> {pick(data.w.sentence, lang)}
            </p>
            <MetaLine window={data.w.window} />
          </Card>

          {!i ? <NoteCard testId="s5-no-i">{t("s5.no_i", lang)}</NoteCard> : (
            <>
              <Section title={t("s5.step.title", lang)} testId="s5-step">
                <p className={`${body} font-medium text-[#1d2025]`}>
                  {tx("d.try_tomorrow", lang, { step: <LibraryText>{pick(i.teacher_action_step, lang)}</LibraryText> })}
                </p>
              </Section>

              <Card testId="s5-facts">
                <h2 className="text-[13px] font-semibold text-[#6b7280]">{t("s5.with.title", lang)}</h2>
                <LibraryText as="p" className={body}>{pick(i.with_whom, lang)}</LibraryText>
                <h2 className="pt-1 text-[13px] font-semibold text-[#6b7280]">{t("s5.how_long.title", lang)}</h2>
                <LibraryText as="p" className={body}>{pick(i.duration, lang)}</LibraryText>
              </Card>

              {i.materials.some((m) => m.kind !== "none") && (
                <Section title={t("s5.materials.title", lang)} testId="s5-materials">
                  <ul className="flex flex-col divide-y divide-[#f0f1f3]">
                    {i.materials.map((m, k) => {
                      if (m.kind === "none") return null;
                      if (m.kind === "fln") {
                        // with the send on, the send link below carries this title; never twice
                        if (data.fln?.can_send) return null;
                        return (
                          <li key={k} className="py-2">
                            <LibraryText className={body}>{isolateLatin(pick(m.title, lang), lang)}</LibraryText>
                          </li>
                        );
                      }
                      // vidrec: the minutes are not in the payload, so the title alone (s5.materials.video needs {n})
                      return (
                        <li key={k} data-kind={m.kind} className={`py-2 ${body}`}>
                          <LibraryText>{isolateLatin(pick(m.title, lang), lang)}</LibraryText>
                        </li>
                      );
                    })}
                  </ul>
                  {data.fln && (data.fln.can_send && flnTitle ? (
                    <Link
                      to={FLN_SEND}
                      data-testid="s5-fln"
                      className="flex min-h-[44px] items-center justify-center rounded-xl bg-[#33374a] px-4 py-2.5 text-center text-[15px] font-semibold text-white [overflow-wrap:anywhere]"
                    >
                      <LibraryText>{isolateLatin(pick(flnTitle, lang), lang)}</LibraryText>
                    </Link>
                  ) : !data.fln.can_send ? (
                    <p data-testid="s5-fln-off" className="text-[13.5px] text-[#6b7280]">{t("s5.fln.off", lang)}</p>
                  ) : null)}
                </Section>
              )}

              <Section title={<span data-nonum="">{t("s5.rehearsal.title", lang)}</span>} testId="s5-rehearsal">
                <p className={body} data-nonum="">
                  {tx("d.rehearse.frame", lang, { script: <LibraryText>{pick(i.rehearsal_script, lang)}</LibraryText> })}
                </p>
                <Link
                  to={`${insightsPaths.w(wId)}#moment`}
                  data-testid="s5-play"
                  className="flex min-h-[44px] items-center justify-center rounded-xl border border-[#d1d5db] bg-white px-4 py-2.5 text-center text-[15px] font-semibold text-[#1d2025]"
                >
                  {t("s5.play", lang)}
                </Link>
              </Section>

              <Section title={t("s5.listen_for.title", lang)} testId="s5-listen-for">
                <LibraryText as="p" className={body}>{pick(i.listen_for, lang)}</LibraryText>
              </Section>

              <Section title={t("s5.check.title", lang)} testId="s5-check">
                <LibraryText as="p" className={body}>{pick(i.check_it_worked, lang)}</LibraryText>
                <CheckRule data={data} lang={lang} />
              </Section>

              {i.evidence.length > 0 && (
                <Section title={t("s5.evidence.title", lang)} testId="s5-evidence">
                  <ul className="flex flex-col gap-2">
                    {i.evidence.map((e, k) => (
                      <li key={k} className="text-[13.5px] leading-snug text-[#4b5563]">
                        <LibraryText as="p" className="font-medium text-[#374151]">{e.source}</LibraryText>
                        <LibraryText as="p">{pick(e.claim, lang)}</LibraryText>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {data.alternatives.length > 0 && (
                <Section title={t("s5.alternatives.title", lang)} testId="s5-alternatives">
                  <ul className="flex flex-col divide-y divide-[#f0f1f3]">
                    {data.alternatives.map((a) => (
                      <li key={a.i_id} data-i={a.i_id} className={`py-2 ${body}`}>
                        <LibraryText>{pick(a.title, lang)}</LibraryText>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <p data-testid="s5-footer" className="px-1 text-center text-[12.5px] text-[#6b7280]">{t("s5.footer", lang)}</p>
            </>
          )}
        </>
      )}
    </InsightsPage>
  );
}
